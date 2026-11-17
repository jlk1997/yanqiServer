import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import * as cron from 'node-cron';
import { PrismaService } from '../prisma/prisma.service';
import { QualityService } from '../quality/quality.service';

const applyParsed = require(require('path').join(
  __dirname,
  '../../../../packages/shared/src/apply-parsed.js',
));
const dossier = require(require('path').join(__dirname, '../../../../packages/shared/src/dossier.js'));

const SOURCES = [
  { code: 'openalex', name: '学术机构与论文作者', targetEntity: 'outcome', adapter: 'openalex', cronExpr: '0 3 * * 1', enabled: true },
  { code: 'faculty-page', name: '师资与实验室公开页', targetEntity: 'person', adapter: 'faculty-page', cronExpr: '0 4 * * 1', enabled: true },
  { code: 'patent-list', name: '专利与软著清单', targetEntity: 'outcome', adapter: 'patent-list', cronExpr: '0 5 1 * *', enabled: true },
  { code: 'file-demand', name: '授权需求文件', targetEntity: 'demand', adapter: 'file-demand', cronExpr: '30 4 * * *', enabled: true },
  { code: 'notice-page', name: '揭榜与采购公告', targetEntity: 'demand', adapter: 'notice-page', cronExpr: '0 6 * * *', enabled: true },
  { code: 'org-directory', name: '企业与机构名录', targetEntity: 'org', adapter: 'org-directory', cronExpr: '0 7 * * 1', enabled: true },
  { code: 'demo', name: '演示夹具', targetEntity: 'demand', adapter: 'demo', cronExpr: null, enabled: false },
];

@Injectable()
export class IngestService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private quality: QualityService,
  ) {}

  async onModuleInit() {
    await this.ensureSources().catch((err) => console.warn('[ingest] ensureSources', err?.message || err));
    const expr = process.env.INGEST_CRON || '20 1 * * *';
    if (process.env.INGEST_CRON !== 'off' && cron.validate(expr)) {
      cron.schedule(expr, () => {
        this.runPending().catch((err) => console.warn('[ingest] nightly', err?.message || err));
      });
    }
  }

  async ensureSources() {
    for (const s of SOURCES) {
      await this.prisma.sourceDefinition.upsert({
        where: { code: s.code },
        update: { name: s.name, targetEntity: s.targetEntity, adapter: s.adapter },
        create: {
          code: s.code,
          name: s.name,
          targetEntity: s.targetEntity,
          adapter: s.adapter,
          cronExpr: s.cronExpr,
          enabled: s.enabled,
        },
      });
    }
    const aliases = [
      { kind: 'school', alias: 'tsinghuauniversity', canonical: '清华大学' },
      { kind: 'school', alias: '清华大学', canonical: '清华大学' },
    ];
    for (const a of aliases) {
      const alias = dossier.normalizeName(a.alias);
      await this.prisma.nameAlias.upsert({
        where: { kind_alias: { kind: a.kind, alias } },
        update: { canonical: a.canonical },
        create: { kind: a.kind, alias, canonical: a.canonical },
      });
    }
    return this.prisma.sourceDefinition.findMany({ orderBy: { code: 'asc' } });
  }

  listSources() {
    return this.prisma.sourceDefinition.findMany({ orderBy: { code: 'asc' }, include: { batches: { take: 1, orderBy: { startedAt: 'desc' } } } });
  }

  listBatches(take = 30) {
    return this.prisma.ingestBatch.findMany({ orderBy: { startedAt: 'desc' }, take });
  }

  async evidenceFor(entityType: string, entityId: string) {
    const rows = await this.prisma.fieldEvidence.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    return { ok: true, entityType, entityId, fields: rows };
  }

  async acceptDocuments(input: {
    sourceCode: string;
    documents: Array<{ externalId?: string; url?: string; bodyText?: string; contentType?: string; entityHint?: string; fields?: any; httpStatus?: number }>;
  }) {
    const sourceCode = input.sourceCode || 'file-demand';
    await this.ensureSources();
    await this.prisma.sourceDefinition.upsert({
      where: { code: sourceCode },
      update: {},
      create: { code: sourceCode, name: sourceCode, targetEntity: 'demand', adapter: sourceCode, enabled: true },
    });
    const batch = await this.prisma.ingestBatch.create({
      data: { sourceCode, status: 'running', ruleVersion: dossier.RULE_VERSION },
    });
    let fetched = 0;
    let parsed = 0;
    const errors: any[] = [];
    const createdParsed: any[] = [];
    for (const doc of input.documents || []) {
      fetched += 1;
      const bodyText = doc.bodyText || JSON.stringify(doc.fields || {});
      const contentHash = createHash('sha256').update(bodyText).digest('hex');
      const externalId = doc.externalId || contentHash.slice(0, 24);
      try {
        const raw = await this.prisma.rawDocument.upsert({
          where: { sourceCode_externalId_contentHash: { sourceCode, externalId, contentHash } },
          update: { batchId: batch.id, url: doc.url || null },
          create: {
            sourceCode,
            externalId,
            url: doc.url || null,
            contentHash,
            bodyText,
            contentType: doc.contentType || 'application/json',
            entityHint: doc.entityHint || null,
            httpStatus: doc.httpStatus || 200,
            batchId: batch.id,
          },
        });
        const fields = Object.assign({}, doc.fields || {}, { sourceCode });
        const row = await this.prisma.parsedRecord.create({
          data: {
            rawId: raw.id,
            batchId: batch.id,
            entityHint: doc.entityHint || 'demand',
            fields,
            parser: sourceCode,
            parserVersion: '1',
            confidence: typeof fields.confidence === 'number' ? fields.confidence : 0.8,
            missingFields: [],
            status: 'pending',
          },
        });
        createdParsed.push({ ...row, sourceCode, fields });
        parsed += 1;
      } catch (err: any) {
        errors.push({ externalId, message: err?.message || String(err) });
      }
    }
    const applied = await applyParsed.applyParsedRecords(this.prisma, createdParsed);
    const counts = { created: 0, filled: 0, merged: 0, rejected: 0 };
    for (const r of applied.results) {
      if (r.action === 'created') counts.created += 1;
      else if (r.action === 'filled') counts.filled += 1;
      else if (r.action === 'merged') counts.merged += 1;
      else counts.rejected += 1;
    }
    await this.prisma.ingestBatch.update({
      where: { id: batch.id },
      data: {
        status: errors.length && !parsed ? 'failed' : 'done',
        finishedAt: new Date(),
        fetched,
        parsed,
        createdN: counts.created,
        mergedN: counts.merged,
        filledN: counts.filled,
        quarantinedN: applied.results.filter((r: any) => r.publishStatus === 'quarantine').length,
        failedN: errors.length + counts.rejected,
        errorSamples: errors.slice(0, 12),
        ruleVersion: dossier.RULE_VERSION,
      },
    });
    const coverage = await this.recomputeCoverage();
    return { ok: true, batchId: batch.id, fetched, parsed, counts, capabilities: applied.capabilities, errors, coverage, ruleVersion: dossier.RULE_VERSION };
  }

  async runPending() {
    const pending = await this.prisma.parsedRecord.findMany({ where: { status: 'pending' }, take: 200, orderBy: { createdAt: 'asc' } });
    const applied = await applyParsed.applyParsedRecords(
      this.prisma,
      pending.map((p) => ({ ...p, sourceCode: (p.fields as any)?.sourceCode })),
    );
    const coverage = await this.recomputeCoverage();
    let scan: any = null;
    try {
      scan = await this.quality.scanAll();
    } catch (err: any) {
      scan = { ok: false, message: err?.message || String(err) };
    }
    const rejudge = await this.rejudge();
    return { ok: true, pending: pending.length, capabilities: applied.capabilities, coverage, scan, rejudge, ruleVersion: dossier.RULE_VERSION };
  }

  private sourceOf(row: { extensions?: unknown }) {
    const ext = row.extensions && typeof row.extensions === 'object' ? (row.extensions as any) : {};
    return ext.source || ext.sourceCode || null;
  }

  private async applyRejudge(
    entity: 'outcome' | 'demand' | 'capability' | 'person',
    row: any,
    decisionInput: any,
    extras: Record<string, unknown>,
  ) {
    const ext = row.extensions && typeof row.extensions === 'object' ? row.extensions : {};
    if (row.publishStatus === 'quarantine' || ext.quarantine) {
      return { promoted: false, updated: false };
    }
    const decision = dossier.publishDecision(entity, decisionInput);
    const data: Record<string, unknown> = { ...extras };
    let promoted = false;
    const blockerSame = JSON.stringify(decision.blockers || []) === JSON.stringify(row.publishBlockers || []);
    if (decision.status === 'published' && row.publishStatus !== 'published') {
      data.publishStatus = 'published';
      data.publishBlockers = [];
      data.reviewedAt = new Date();
      promoted = true;
    } else if (row.publishStatus !== 'published' && (row.publishStatus !== decision.status || !blockerSame)) {
      data.publishStatus = decision.status;
      data.publishBlockers = decision.blockers;
      data.reviewedAt = new Date();
    }
    for (const key of Object.keys(data)) {
      if (data[key] === undefined) delete data[key];
    }
    const keys = Object.keys(data);
    if (!keys.length) return { promoted: false, updated: false };
    const model = entity === 'outcome' ? this.prisma.outcome : entity === 'demand' ? this.prisma.demand : entity === 'capability' ? this.prisma.capability : this.prisma.person;
    await (model as any).update({ where: { id: row.id }, data });
    return { promoted, updated: true };
  }

  async rejudge() {
    const mode = process.env.EMBEDDING_MODE || 'hash';
    let promoted = 0;
    let surfaced = 0;
    let stale = 0;
    const cutoff = Date.now() - 180 * 86400000;

    const outcomes = await this.prisma.outcome.findMany({ take: 300, orderBy: { updatedAt: 'desc' } });
    for (const row of outcomes) {
      const summaryPublic = row.summaryPublic || dossier.summaryPublic(row.abstract || '');
      const extras: Record<string, unknown> = {};
      if (!row.summaryPublic && summaryPublic) {
        extras.summaryPublic = summaryPublic;
        surfaced += 1;
      }
      if (row.embedding && !row.embeddingModel) extras.embeddingModel = mode;
      const result = await this.applyRejudge('outcome', row, {
        title: row.title,
        type: row.type,
        year: row.year,
        externalId: row.openAlexId,
        doi: row.doi,
        patentNo: row.patentNo,
        abstract: row.abstract,
        orgId: row.orgId,
        personId: row.personId,
        sourceCode: this.sourceOf(row),
        junk: dossier.isJunkTitle(row.title),
      }, extras);
      if (result.promoted) promoted += 1;
      if (row.publishStatus === 'published' && this.isStale(row, cutoff)) stale += await this.markStale('Outcome', row.id, row.title);
    }

    const demands = await this.prisma.demand.findMany({ take: 300, orderBy: { updatedAt: 'desc' } });
    for (const row of demands) {
      const demandKind = !row.demandKind || row.demandKind === 'unknown'
        ? dossier.inferDemandKind('', `${row.title || ''} ${row.problem || ''}`)
        : row.demandKind;
      const summaryPublic = row.summaryPublic || dossier.summaryPublic(row.problem || '');
      const extras: Record<string, unknown> = {};
      if (demandKind !== row.demandKind) extras.demandKind = demandKind;
      if (!row.summaryPublic && summaryPublic) {
        extras.summaryPublic = summaryPublic;
        surfaced += 1;
      }
      if (row.embedding && !row.embeddingModel) extras.embeddingModel = mode;
      const tags = row.taxonomyCodes?.length ? row.taxonomyCodes : row.industry || [];
      const result = await this.applyRejudge('demand', row, {
        title: row.title,
        problem: row.problem,
        orgId: row.orgId,
        demandKind,
        taxonomyCodes: tags,
        industry: row.industry,
        sourceCode: this.sourceOf(row),
        junk: dossier.isJunkTitle(row.title),
      }, extras);
      if (result.promoted) promoted += 1;
      if (row.publishStatus === 'published' && this.isStale(row, cutoff)) stale += await this.markStale('Demand', row.id, row.title);
    }

    const caps = await this.prisma.capability.findMany({ take: 200, orderBy: { updatedAt: 'desc' } });
    for (const row of caps) {
      const ext = row.extensions && typeof row.extensions === 'object' ? (row.extensions as any) : {};
      const summaryPublic = row.summaryPublic || dossier.summaryPublic(row.summary || '');
      const extras: Record<string, unknown> = {};
      if (!row.summaryPublic && summaryPublic) {
        extras.summaryPublic = summaryPublic;
        surfaced += 1;
      }
      if (row.embedding && !row.embeddingModel) extras.embeddingModel = mode;
      const result = await this.applyRejudge('capability', row, {
        personId: row.personId,
        orgId: row.orgId,
        summary: row.summary,
        keywords: row.keywords,
        evidenceOutcomeIds: ext.evidenceOutcomeIds || [],
        homepage: ext.homepage,
        sourceCode: this.sourceOf(row),
      }, extras);
      if (result.promoted) promoted += 1;
    }

    const people = await this.prisma.person.findMany({ take: 200, include: { org: true, outcomes: { select: { id: true }, take: 1 } } });
    for (const row of people) {
      const result = await this.applyRejudge('person', row, {
        name: row.name,
        schoolName: row.org?.name,
        orgId: row.orgId,
        researchSummary: row.researchSummary,
        outcomeCount: row.outcomes.length,
        sourceCode: row.source,
      }, {});
      if (result.promoted) promoted += 1;
    }

    let capabilities = 0;
    const teachers = await this.prisma.person.findMany({
      where: { publishStatus: 'published', outcomes: { some: { publishStatus: 'published' } } },
      select: { id: true },
      take: 40,
    });
    for (const teacher of teachers) {
      const made = await applyParsed.generateCapabilitiesForPerson(this.prisma, teacher.id);
      capabilities += Array.isArray(made) ? made.length : 0;
    }

    return { ok: true, promoted, surfaced, stale, capabilities, ruleVersion: dossier.RULE_VERSION };
  }

  private isStale(row: { sourceUpdatedAt?: Date | null; updatedAt?: Date | null }, cutoff: number) {
    const t = row.sourceUpdatedAt || row.updatedAt;
    return Boolean(t && t.getTime() < cutoff);
  }

  private async markStale(entityType: string, entityId: string, title: string) {
    const existing = await this.prisma.dataQualityIssue.findFirst({
      where: { entityType, entityId, code: 'stale', resolvedAt: null },
    });
    if (existing) return 0;
    await this.prisma.dataQualityIssue.create({
      data: {
        entityType,
        entityId,
        code: 'stale',
        severity: 'info',
        message: `「${title}」超过半年没有来源再印证，广场排序会靠后。`,
      },
    });
    return 1;
  }

  async unpublishedQueue() {
    const [outcomes, demands, people] = await Promise.all([
      this.prisma.outcome.findMany({
        where: { publishStatus: { not: 'published' } },
        take: 30,
        orderBy: { updatedAt: 'desc' },
        include: { org: true, person: true },
      }),
      this.prisma.demand.findMany({
        where: { publishStatus: { not: 'published' } },
        take: 30,
        orderBy: { updatedAt: 'desc' },
        include: { org: true },
      }),
      this.prisma.person.findMany({
        where: { publishStatus: { not: 'published' } },
        take: 30,
        orderBy: { updatedAt: 'desc' },
        include: { org: true },
      }),
    ]);
    const mapRow = (entityType: string, row: any, title: string, org?: string | null) => ({
      entityType,
      id: row.id,
      title,
      org: org || null,
      publishStatus: row.publishStatus,
      blockers: row.publishBlockers || [],
      blockerZh: (row.publishBlockers || []).map((code: string) => dossier.BLOCKER_ZH[code] || code),
    });
    return [
      ...outcomes.map((row) => mapRow('outcome', row, row.title, row.org?.name)),
      ...demands.map((row) => mapRow('demand', row, row.title, row.org?.name)),
      ...people.map((row) => mapRow('person', row, row.name, row.org?.name)),
    ];
  }

  async desk() {
    const [overview, queue, gaps, dupes, pausedSlices] = await Promise.all([
      this.overview(),
      this.unpublishedQueue(),
      this.openGaps(),
      this.duplicatePeople(),
      this.pausedSlices(),
    ]);
    return {
      ...overview,
      queue,
      gaps,
      dupes,
      pausedSlices,
      stageZh: dossier.STAGE_ZH,
      noteZh: '只有发布态会进门户和匹配。影子匹配不写线索。缺联系人的高分匹配留在缺口里，不编造邮箱。',
    };
  }

  async pausedSlices() {
    const rows = await this.prisma.featureFlag.findMany({
      where: { key: { startsWith: 'slice-outreach:' }, enabled: false },
      take: 20,
    });
    return rows.map((r) => ({
      key: r.key.replace(/^slice-outreach:/, ''),
      note: r.note,
    }));
  }

  async duplicatePeople() {
    const people = await this.prisma.person.findMany({
      where: { nameNorm: { not: null } },
      take: 400,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, nameNorm: true, orgId: true, email: true, org: { select: { name: true } } },
    });
    const groups = new Map<string, typeof people>();
    for (const person of people) {
      const key = `${person.nameNorm}|${person.orgId || ''}`;
      const list = groups.get(key) || [];
      list.push(person);
      groups.set(key, list);
    }
    return [...groups.values()]
      .filter((list) => list.length > 1)
      .slice(0, 8)
      .map((list) => ({
        name: list[0].name,
        org: list[0].org?.name || '未挂学校',
        people: list.map((p) => ({ id: p.id, name: p.name, email: p.email })),
      }));
  }

  async openGaps() {
    const rows = await this.prisma.contactGap.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        match: {
          include: {
            demand: { select: { title: true } },
            capability: { select: { title: true } },
            outcome: { select: { title: true } },
            primaryPerson: { select: { name: true } },
          },
        },
      },
    });
    const reasonZh: Record<string, string> = {
      no_person: '没有解析到老师',
      no_contact: '有老师，没有可用联系点',
    };
    return rows.map((g) => ({
      id: g.id,
      matchId: g.matchId,
      reason: g.reason,
      reasonZh: reasonZh[g.reason] || g.reason,
      note: g.note,
      demandTitle: g.match?.demand?.title || '',
      supplyTitle: g.match?.capability?.title || g.match?.outcome?.title || '',
      teacherName: g.match?.primaryPerson?.name || null,
    }));
  }

  async recomputeCoverage() {
    const [people, demands, outcomes, capabilities, contacts] = await Promise.all([
      this.prisma.person.findMany({
        select: { id: true, email: true, publishStatus: true, taxonomyCodes: true, sourceUpdatedAt: true, updatedAt: true },
      }),
      this.prisma.demand.findMany({
        select: { id: true, publishStatus: true, taxonomyCodes: true, industry: true, demandKind: true, sourceUpdatedAt: true, updatedAt: true },
      }),
      this.prisma.outcome.findMany({
        select: { id: true, personId: true, publishStatus: true, taxonomyCodes: true, sourceUpdatedAt: true, updatedAt: true },
      }),
      this.prisma.capability.findMany({
        select: { id: true, personId: true, publishStatus: true, taxonomyCodes: true },
      }),
      this.prisma.contactPoint.findMany({ select: { personId: true, confidence: true } }),
    ]);
    const summary = dossier.summarizeSlices({ people, demands, outcomes, capabilities, contacts });
    if (summary.slices.length) {
      await this.prisma.coverageSnapshot.createMany({
        data: summary.slices.map((s: any) => ({
          taxonomyCode: s.taxonomyCode,
          teacherCount: s.teacherCount,
          demandCount: s.demandCount,
          outcomeCount: s.outcomeCount,
          contactRatio: s.contactRatio,
          medianAgeDays: s.medianAgeDays,
          stage: s.stage,
          metrics: { ruleVersion: summary.ruleVersion, thresholds: summary.thresholds },
        })),
      });
    }
    return summary;
  }

  async latestCoverage() {
    const rows = await this.prisma.coverageSnapshot.findMany({ orderBy: { computedAt: 'desc' }, take: 200 });
    const seen = new Set<string>();
    const latest = [];
    for (const row of rows) {
      if (seen.has(row.taxonomyCode)) continue;
      seen.add(row.taxonomyCode);
      latest.push(row);
    }
    return { ok: true, slices: latest, ruleVersion: dossier.RULE_VERSION, thresholds: dossier.thresholds() };
  }

  async setPublish(entityType: string, entityId: string, status: string) {
    const allowed = ['draft', 'quarantine', 'canonical', 'published'];
    if (!allowed.includes(status)) throw new NotFoundException('状态只能是 draft、quarantine、canonical、published');
    const model = this.publishModel(entityType);
    const current = await (model as any).findUnique({ where: { id: entityId } });
    if (!current) throw new NotFoundException('档案不存在');
    const ext = { ...((current.extensions as any) || {}) };
    const data: any = { publishStatus: status, reviewedAt: new Date() };
    if (status === 'published') {
      data.publishBlockers = [];
      delete ext.quarantine;
      delete ext.quarantineReason;
      ext.publishedBy = 'ops';
      data.extensions = ext;
    } else if (status === 'quarantine') {
      data.publishBlockers = ['junk'];
      ext.quarantine = true;
      ext.quarantineReason = 'ops_hold';
      data.extensions = ext;
    }
    return (model as any).update({ where: { id: entityId }, data });
  }

  private publishModel(entityType: string) {
    if (entityType === 'outcome') return this.prisma.outcome;
    if (entityType === 'capability') return this.prisma.capability;
    if (entityType === 'demand') return this.prisma.demand;
    if (entityType === 'person') return this.prisma.person;
    if (entityType === 'org') return this.prisma.organization;
    throw new NotFoundException('未知实体');
  }

  async resumeSlice(key: string) {
    const sliceKey = String(key || '').trim();
    if (!sliceKey) return { ok: false, message: '缺少产业方向' };
    const flagKey = 'slice-outreach:' + sliceKey;
    const row = await this.prisma.featureFlag.findUnique({ where: { key: flagKey } });
    if (!row || row.enabled) return { ok: false, message: '这个方向没有处于暂停' };
    await this.prisma.featureFlag.update({
      where: { key: flagKey },
      data: { enabled: true, note: '运营已恢复找人' },
    });
    return { ok: true, key: sliceKey, message: '已恢复这个方向的找人' };
  }

  async mergePersons(keepId: string, dropId: string) {
    if (keepId === dropId) return { ok: false, message: '不能把同一人并到自己身上' };
    const keep = await this.prisma.person.findUnique({ where: { id: keepId } });
    const drop = await this.prisma.person.findUnique({ where: { id: dropId } });
    if (!keep || !drop) throw new NotFoundException('老师不存在');
    await this.prisma.authorship.updateMany({ where: { personId: dropId }, data: { personId: keepId } });
    await this.prisma.outcome.updateMany({ where: { personId: dropId }, data: { personId: keepId } });
    await this.prisma.capability.updateMany({ where: { personId: dropId }, data: { personId: keepId } });
    await this.prisma.contactPoint.updateMany({ where: { personId: dropId }, data: { personId: keepId } });
    await this.prisma.matchResult.updateMany({ where: { primaryPersonId: dropId }, data: { primaryPersonId: keepId } });
    await this.prisma.lead.updateMany({ where: { personId: dropId }, data: { personId: keepId } });
    await this.prisma.person.delete({ where: { id: dropId } });
    return { ok: true, keepId, droppedId: dropId };
  }

  async overview() {
    const [pendingParsed, batches, coverage, blockers] = await Promise.all([
      this.prisma.parsedRecord.count({ where: { status: 'pending' } }),
      this.prisma.ingestBatch.count({ where: { status: 'running' } }),
      this.latestCoverage(),
      this.prisma.dataQualityIssue.groupBy({
        by: ['code'],
        where: { resolvedAt: null },
        _count: { _all: true },
      }),
    ]);
    return {
      ok: true,
      columns: {
        cleaning: { pendingParsed, runningBatches: batches },
        blockers: blockers.map((b) => ({ code: b.code, count: b._count._all })),
        slices: coverage.slices,
      },
    };
  }

  async rawHidden(id: string) {
    const row = await this.prisma.rawDocument.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('原文不存在');
    return {
      id: row.id,
      sourceCode: row.sourceCode,
      externalId: row.externalId,
      url: row.url,
      fetchedAt: row.fetchedAt,
      contentHash: row.contentHash,
      entityHint: row.entityHint,
      bodyStored: Boolean(row.bodyText),
      note: '原文只在运营接口返回，门户不读这一层',
      bodyText: row.bodyText,
    };
  }
}
