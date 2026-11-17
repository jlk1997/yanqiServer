/**
 * 独立匹配：与运营台同一套发布、隔离、演示和卷宗规则。
 * 不删除已人审或已发送的线索。
 */
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const shared = require(path.join(__dirname, '../../../packages/shared/src/match-lib.js'));
const { scorePair, buildOutreachDraft, embedText, buildMatchDossier, summarizeSlices, isDemoSource, embeddingMeta } = shared;

const prisma = new PrismaClient();
const mode = embeddingMeta().mode;

function live(row: { publishStatus?: string | null; extensions?: any }) {
  if (row.publishStatus && row.publishStatus !== 'published') return false;
  const ext = row.extensions || {};
  if (ext.quarantine) return false;
  if (isDemoSource(ext.source)) return false;
  return true;
}

async function ensureEmbedding(model: 'demand' | 'capability' | 'outcome', id: string, row: any, text: string) {
  if (Array.isArray(row.embedding) && row.embedding.length > 8 && row.embeddingModel === mode) return row.embedding;
  const emb = await embedText(text);
  await (prisma[model] as any).update({ where: { id }, data: { embedding: emb, embeddingModel: mode } });
  return emb;
}

async function run() {
  const topN = Number(process.env.TOP_N || 5);
  const minScore = Number(process.env.MIN_SCORE || 0.25);
  const [demands, caps, outs, people, contacts] = await Promise.all([
    prisma.demand.findMany({ include: { org: true } }),
    prisma.capability.findMany({ include: { org: true } }),
    prisma.outcome.findMany({ include: { org: true } }),
    prisma.person.findMany({ select: { id: true, name: true, email: true, publishStatus: true, taxonomyCodes: true, sourceUpdatedAt: true, updatedAt: true } }),
    prisma.contactPoint.findMany({ select: { personId: true, confidence: true } }),
  ]);
  const coverage = summarizeSlices({ people, demands, outcomes: outs, capabilities: caps, contacts });
  const stageOf = new Map(coverage.slices.map((s: any) => [s.taxonomyCode, s.stage]));
  const personName = new Map(people.map((p) => [p.id, p.name]));

  let count = 0;
  let drafts = 0;
  let keptHuman = 0;
  const summary: any[] = [];

  for (const d of demands) {
    if (!live(d)) continue;
    const demandText = [d.title, d.problem, d.expectedOut, ...(d.industry || [])].join(' ');
    const demb = await ensureEmbedding('demand', d.id, d, demandText);
    const sliceKey = (d.taxonomyCodes && d.taxonomyCodes[0]) || (d.industry && d.industry[0]) || 'unspecified';
    const cands: any[] = [];

    for (const c of caps) {
      if (!live(c) || c.orgId === d.orgId) continue;
      const text = [c.title, c.summary, ...(c.keywords || []), ...(c.disciplines || [])].join(' ');
      const emb = await ensureEmbedding('capability', c.id, c, text);
      cands.push({
        kind: 'capability', id: c.id, title: c.title, orgName: c.org.name, orgId: c.orgId,
        region: c.org.region, keywords: c.keywords, disciplines: c.disciplines, text, emb,
        trl: c.trl, rights: c.rights, ipOwnership: c.ipOwnership, licenseOpenness: c.licenseOpenness,
        readinessBand: c.readinessBand, taxonomyCodes: c.taxonomyCodes || [], personId: c.personId,
        sourceUpdatedAt: c.sourceUpdatedAt, embeddingModel: c.embeddingModel,
      });
    }
    for (const o of outs) {
      if (!live(o) || o.orgId === d.orgId) continue;
      const text = [o.title, o.abstract, ...(o.ipcOrDisc || [])].join(' ');
      const emb = await ensureEmbedding('outcome', o.id, o, text);
      cands.push({
        kind: 'outcome', id: o.id, title: o.title, orgName: o.org.name, orgId: o.orgId,
        region: o.org.region, keywords: o.ipcOrDisc, disciplines: o.ipcOrDisc, text, emb,
        trl: o.trl, rights: o.rights, ipOwnership: o.ipOwnership, licenseOpenness: o.licenseOpenness,
        readinessBand: o.readinessBand, taxonomyCodes: o.taxonomyCodes || [], personId: o.personId,
        sourceUpdatedAt: o.sourceUpdatedAt, embeddingModel: o.embeddingModel,
      });
    }

    const scored = cands.map((c) => {
      const scoredPair = scorePair({
        demandText: [d.title, d.problem, d.expectedOut].join(' '),
        demandKeywords: d.industry,
        demandIndustry: d.industry,
        demandRegion: d.regionPref,
        supplyText: c.text,
        supplyKeywords: c.keywords,
        supplyDisciplines: c.disciplines,
        supplyRegion: c.region,
        trl: c.trl,
        rights: c.rights,
        ipOwnership: c.ipOwnership,
        licenseOpenness: c.licenseOpenness,
        readinessBand: c.readinessBand,
        demandTaxonomy: d.taxonomyCodes || [],
        supplyTaxonomy: c.taxonomyCodes || [],
        licenseNeed: d.licenseNeed,
        minTrl: d.minTrl,
        demandExpectedOut: d.expectedOut,
        demandProblem: d.problem,
        demandTitle: d.title,
        supplyTitle: c.title,
        demandEmb: demb,
        supplyEmb: c.emb,
      });
      const fresh = Boolean(c.sourceUpdatedAt) && Date.now() - new Date(c.sourceUpdatedAt).getTime() <= 45 * 86400000;
      const dossier = buildMatchDossier({
        breakdown: scoredPair.breakdown,
        total: scoredPair.total,
        demandKind: d.demandKind,
        demandTitle: d.title,
        demandProblem: d.problem,
        trl: c.trl,
        licenseOpenness: c.licenseOpenness,
        supplyId: c.id,
        supplyTitle: c.title,
        supplyKind: c.kind,
        sliceKey,
        sliceStage: stageOf.get(sliceKey) || 'accumulating',
        primaryPersonId: c.personId,
        demandThin: !d.problem || String(d.problem).length < 40,
        embeddingMode: mode,
        modelMismatch: Boolean(d.embeddingModel && c.embeddingModel && d.embeddingModel !== c.embeddingModel),
        fresh,
        hasContact: false,
      });
      scoredPair.breakdown = {
        ...scoredPair.breakdown,
        action: dossier.action,
        collabMode: dossier.collabMode,
        collabModeLabel: dossier.collabModeLabel,
        evidence: dossier.evidence,
        confidence: dossier.confidence,
        blockers: dossier.blockers,
        sliceKey: dossier.sliceKey,
        sliceStage: dossier.sliceStage,
        demandKind: dossier.demandKind,
        ruleVersion: dossier.ruleVersion,
      };
      if (dossier.reasonSuffix && !String(scoredPair.reason || '').includes('证据：')) {
        scoredPair.reason = `${scoredPair.reason || ''}${dossier.reasonSuffix}`;
      }
      return { c, ...scoredPair, primaryPersonId: dossier.primaryPersonId };
    })
      .filter((x) => x.breakdown.hardPass && x.total >= minScore)
      .sort((a, b) => b.total - a.total)
      .slice(0, topN);

    const keepIds: string[] = [];
    for (const s of scored) {
      const supplyKey = s.c.kind === 'capability' ? `c:${s.c.id}` : `o:${s.c.id}`;
      const existing = await prisma.matchResult.findFirst({ where: { demandId: d.id, supplyKey } });
      const data = {
        capabilityId: s.c.kind === 'capability' ? s.c.id : null,
        outcomeId: s.c.kind === 'outcome' ? s.c.id : null,
        supplyKey,
        totalScore: s.total,
        scoreBreakdown: s.breakdown,
        reason: s.reason,
        primaryPersonId: s.primaryPersonId,
      };
      const match = existing
        ? await prisma.matchResult.update({ where: { id: existing.id }, data })
        : await prisma.matchResult.create({ data: { ...data, demandId: d.id, status: 'PENDING_REVIEW' } });
      keepIds.push(match.id);
      count++;
      const allowLead = s.breakdown.action === 'REVIEW' || s.breakdown.action === 'FIND_PEOPLE';
      if (allowLead) {
        const protectedLead = await prisma.lead.findFirst({
          where: { matchId: match.id, status: { in: ['approved', 'sent', 'dry_run'] } },
        });
        if (!protectedLead) {
          const personId = s.primaryPersonId || null;
          const draft = buildOutreachDraft({
            demandTitle: d.title,
            demandOrg: d.org.name,
            supplyTitle: s.c.title,
            supplyOrg: s.c.orgName,
            reason: s.reason,
            personName: personId ? personName.get(personId) : undefined,
            collabModeLabel: s.breakdown.collabModeLabel,
          });
          const draftLead = await prisma.lead.findFirst({ where: { matchId: match.id, channel: 'email_draft' } });
          if (draftLead) {
            await prisma.lead.update({
              where: { id: draftLead.id },
              data: { personId, draftSubject: draft.subject, draftBody: draft.body, status: 'draft' },
            });
          } else {
            await prisma.lead.create({
              data: {
                matchId: match.id,
                personId,
                channel: 'email_draft',
                status: 'draft',
                draftSubject: draft.subject,
                draftBody: draft.body,
              },
            });
          }
          drafts++;
        } else {
          keptHuman++;
        }
      }
      summary.push({ 需求: d.title, 供给: s.c.title, 机构: s.c.orgName, 分数: s.total, 下一步: s.breakdown.action });
    }

    const leftovers = await prisma.matchResult.findMany({
      where: {
        demandId: d.id,
        status: 'PENDING_REVIEW',
        ...(keepIds.length ? { id: { notIn: keepIds } } : {}),
      },
      select: { id: true },
    });
    for (const leftover of leftovers) {
      const hot = await prisma.lead.findFirst({
        where: { matchId: leftover.id, status: { in: ['approved', 'sent', 'dry_run'] } },
      });
      if (hot) {
        keptHuman++;
        continue;
      }
      await prisma.lead.deleteMany({ where: { matchId: leftover.id, status: 'draft' } });
      await prisma.matchResult.delete({ where: { id: leftover.id } });
    }
  }

  console.log(JSON.stringify({ 匹配条数: count, 新草稿: drafts, 保留人审: keptHuman, 样例: summary.slice(0, 8) }, null, 2));
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
