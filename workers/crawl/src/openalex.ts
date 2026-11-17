/**
 * OpenAlex 高校侧采集：批量机构 + 分页作品；在线失败回落夹具。
 * 合规红线：只用 OpenAlex 公开 API，不爬 CNKI / 知网，不碰未授权企查查。
 */
import { PrismaClient, OrgType, OutcomeType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const shared = require(path.join(__dirname, '../../../packages/shared/src/match-lib.js'));
const { embedText, stripLocked } = shared;

const prisma = new PrismaClient();
const MAILTO = process.env.OPENALEX_MAILTO || 'yanqi-match@example.com';
const ROOT = path.resolve(__dirname, '../../..');
const PER_PAGE = Math.min(50, Math.max(8, Number(process.env.OPENALEX_PER_PAGE || 40)));
const MAX_PAGES = Math.min(5, Math.max(1, Number(process.env.OPENALEX_MAX_PAGES || 3)));
const DELAY_MS = Math.max(200, Number(process.env.OPENALEX_DELAY_MS || 450));
const FILL_EMPTY = process.env.OPENALEX_FILL_EMPTY === '1' || process.env.OPENALEX_FILL_EMPTY === 'true';
const FILL_EMPTY_PREVIEW = process.env.OPENALEX_FILL_EMPTY_PREVIEW === '1' || process.env.OPENALEX_FILL_EMPTY_PREVIEW === 'true';

const DEFAULT_UNIVERSITIES: Array<{ search: string; nameZh: string; regionHint?: string }> = [
  { search: 'University of Shanghai for Science and Technology', nameZh: '上海理工大学', regionHint: '上海' },
  { search: 'Tsinghua University', nameZh: '清华大学', regionHint: '北京' },
  { search: 'Shanghai Jiao Tong University', nameZh: '上海交通大学', regionHint: '上海' },
  { search: 'Zhejiang University', nameZh: '浙江大学', regionHint: '浙江' },
  { search: 'Harbin Institute of Technology', nameZh: '哈尔滨工业大学', regionHint: '黑龙江' },
  { search: 'Fudan University', nameZh: '复旦大学', regionHint: '上海' },
  { search: 'Nanjing University', nameZh: '南京大学', regionHint: '江苏' },
  { search: 'Huazhong University of Science and Technology', nameZh: '华中科技大学', regionHint: '湖北' },
  { search: "Xi'an Jiaotong University", nameZh: '西安交通大学', regionHint: '陕西' },
  { search: 'Sun Yat-sen University', nameZh: '中山大学', regionHint: '广东' },
  { search: 'Tongji University', nameZh: '同济大学', regionHint: '上海' },
  { search: 'Southeast University', nameZh: '东南大学', regionHint: '江苏' },
  { search: 'Tianjin University', nameZh: '天津大学', regionHint: '天津' },
  { search: 'Dalian University of Technology', nameZh: '大连理工大学', regionHint: '辽宁' },
  { search: 'Sichuan University', nameZh: '四川大学', regionHint: '四川' },
  { search: 'Beihang University', nameZh: '北京航空航天大学', regionHint: '北京' },
  { search: 'South China University of Technology', nameZh: '华南理工大学', regionHint: '广东' },
  { search: 'University of Science and Technology of China', nameZh: '中国科学技术大学', regionHint: '安徽' },
  { search: 'Peking University', nameZh: '北京大学', regionHint: '北京' },
  { search: 'Wuhan University', nameZh: '武汉大学', regionHint: '湖北' },
  { search: 'Nankai University', nameZh: '南开大学', regionHint: '天津' },
  { search: 'Xiamen University', nameZh: '厦门大学', regionHint: '福建' },
  { search: 'Chongqing University', nameZh: '重庆大学', regionHint: '重庆' },
];

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string) {
  const u = new URL(url);
  if (!u.searchParams.has('mailto')) u.searchParams.set('mailto', MAILTO);
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': `yanqi-match/0.2 (mailto:${MAILTO}; research matching)` },
  });
  if (res.status === 429) {
    await sleep(2000);
    const retry = await fetch(u.toString(), {
      headers: { 'User-Agent': `yanqi-match/0.2 (mailto:${MAILTO})` },
    });
    if (!retry.ok) throw new Error(`OpenAlex HTTP ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  return res.json();
}

async function loadOnline(searchName: string) {
  const inst = await fetchJson(
    `https://api.openalex.org/institutions?search=${encodeURIComponent(searchName)}&per_page=1`,
  );
  const institution = inst?.results?.[0];
  if (!institution) throw new Error('未找到机构: ' + searchName);
  const works: any[] = [];
  let cursor: string | null = '*';
  for (let page = 0; page < MAX_PAGES && cursor; page++) {
    const q =
      `https://api.openalex.org/works?filter=institutions.id:${institution.id}` +
      `&per_page=${PER_PAGE}&sort=cited_by_count:desc&cursor=${encodeURIComponent(cursor)}`;
    const batch = await fetchJson(q);
    works.push(...(batch.results || []));
    cursor = batch.meta?.next_cursor || null;
    if (!(batch.results || []).length) break;
    await sleep(DELAY_MS);
  }
  return { institution, works };
}

function loadFixture(nameZh: string) {
  const map: Record<string, string> = {
    上海理工大学: 'openalex-usst.json',
    清华大学: 'openalex-tsinghua.json',
    上海交通大学: 'openalex-sjtu.json',
    浙江大学: 'openalex-zju.json',
    哈尔滨工业大学: 'openalex-hit.json',
  };
  const file = map[nameZh] || 'openalex-usst.json';
  const p = path.join(ROOT, 'data/fixtures', file);
  if (!fs.existsSync(p)) {
    const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fixtures/openalex-usst.json'), 'utf8'));
    base.institution = {
      ...base.institution,
      id: `https://openalex.org/fixture-${Buffer.from(nameZh).toString('hex').slice(0, 12)}`,
      display_name: nameZh,
      display_name_alternatives: [nameZh],
    };
    return base;
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (nameZh && !map[nameZh]) {
    data.institution = {
      ...data.institution,
      id: `https://openalex.org/fixture-${Buffer.from(nameZh).toString('hex').slice(0, 12)}`,
      display_name: nameZh,
      display_name_alternatives: [nameZh],
    };
  }
  return data;
}

function reconstructAbstract(work: any): string {
  if (work.abstract) return work.abstract;
  const inv = work.abstract_inverted_index;
  if (!inv) return '';
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inv as Record<string, number[]>)) {
    for (const pos of positions) pairs.push([pos, word]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map((x) => x[1]).join(' ');
}

function regionFromInst(inst: any, hint?: string) {
  if (hint) return hint;
  const city = inst.geo?.city;
  const map: Record<string, string> = {
    Shanghai: '上海',
    Beijing: '北京',
    Hangzhou: '浙江',
    Harbin: '黑龙江',
    Nanjing: '江苏',
    Guangzhou: '广东',
    Chengdu: '四川',
    Hefei: '安徽',
    Tianjin: '天津',
    Dalian: '辽宁',
    XiAn: '陕西',
  };
  return map[city] || city || null;
}

/** 粗启发式 TRL：论文默认 3；有专利概念 bump */
function guessTrl(work: any, concepts: string[]) {
  const blob = (concepts.join(' ') + ' ' + (work.type || '')).toLowerCase();
  if (/patent|prototype|pilot|clinical|device/.test(blob)) return 5;
  if (/software|algorithm|dataset/.test(blob)) return 4;
  return 3;
}

async function upsertFromBundle(bundle: any, displayNameZh?: string, regionHint?: string) {
  const inst = bundle.institution;
  const openAlexId = String(inst.id).replace('https://openalex.org/', '');
  const nameZh =
    displayNameZh ||
    (inst.display_name_alternatives || []).find((x: string) => /[\u4e00-\u9fff]/.test(x)) ||
    inst.display_name;

  let org = await prisma.organization.findFirst({ where: { openAlexId } });
  if (!org) org = await prisma.organization.findFirst({ where: { name: nameZh } });
  const orgData = {
    name: nameZh,
    type: OrgType.UNIVERSITY,
    region: regionFromInst(inst, regionHint),
    website: inst.homepage_url || null,
    summary: `OpenAlex 公开机构档案：${inst.display_name}。用于高校侧冷启动，非正式背书。`,
    openAlexId,
    trustBadges: ['verified_import'],
    extensions: { openalex_id: openAlexId, source: 'openalex', lineage: 'openalex.institution' },
  };
  if (org) org = await prisma.organization.update({ where: { id: org.id }, data: orgData });
  else org = await prisma.organization.create({ data: orgData });

  let n = 0;
  let skippedJunk = 0;
  let skippedDup = 0;
  let filledEmpty = 0;
  const fillDiffs: any[] = [];
  const skipReasons: Array<{ title: string; reason: string; key?: string }> = [];
  for (const w of bundle.works || []) {
    const oaId = String(w.id).replace('https://openalex.org/', '');
    const abstract = reconstructAbstract(w);
    const concepts = (w.concepts || []).map((c: any) => c.display_name).filter(Boolean);
    const title = (w.title || '').trim() || '未命名论文';
    if (title.length < 4 || /^untitled$/i.test(title)) {
      skippedJunk++;
      continue;
    }
    const doi = w.doi ? String(w.doi).replace('https://doi.org/', '') : null;
    // M24 增量去重：已入库的 openalex id / doi / 同单位同标题 → 跳过，不再重写
    let existing =
      (await prisma.outcome.findFirst({ where: { openAlexId: oaId } })) ||
      (doi ? await prisma.outcome.findFirst({ where: { doi } }) : null) ||
      (await prisma.outcome.findFirst({ where: { orgId: org.id, title } }));
    if (existing) {
      const reason = existing.openAlexId === oaId ? 'openalex_id' : existing.doi && doi && existing.doi === doi ? 'doi' : 'title+org';
      if (FILL_EMPTY) {
        // M25：仅补空字段，不覆盖人改过的内容
        const patch: any = {};
        if (!existing.abstract && abstract) patch.abstract = abstract;
        if (existing.trl == null) patch.trl = guessTrl(w, concepts);
        if ((!existing.ipcOrDisc || existing.ipcOrDisc.length === 0) && concepts.length) {
          patch.ipcOrDisc = concepts.slice(0, 12);
        }
        if (!existing.doi && doi) patch.doi = doi;
        if (!existing.openAlexId) patch.openAlexId = oaId;
        const ext = { ...((existing.extensions as any) || {}) };
        let extChanged = false;
        if (ext.cited_by_count == null && w.cited_by_count != null) {
          ext.cited_by_count = w.cited_by_count;
          extChanged = true;
        }
        if (ext.publication_year == null && w.publication_year != null) {
          ext.publication_year = w.publication_year;
          extChanged = true;
        }
        if (extChanged) {
          ext.fillEmptyAt = new Date().toISOString();
          patch.extensions = ext;
        }
        const lockedPatch = stripLocked(patch, existing.lockedFields);
        if (patch.extensions && !(existing.lockedFields || []).includes('extensions')) lockedPatch.extensions = patch.extensions;
        if (Object.keys(lockedPatch).length) {
          const changes: Array<{ field: string; old: any; new: any }> = [];
          for (const k of Object.keys(lockedPatch)) {
            if (k === 'extensions') continue;
            changes.push({ field: k, old: (existing as any)[k] ?? null, new: lockedPatch[k] });
          }
          if (lockedPatch.extensions) {
            changes.push({
              field: 'extensions.cited_by_count/publication_year',
              old: (existing.extensions as any) || null,
              new: lockedPatch.extensions,
            });
          }
          const diffRow = {
            outcomeId: existing.id,
            title: title.slice(0, 100),
            reason,
            changes,
            patch: lockedPatch,
          };
          if (FILL_EMPTY_PREVIEW) {
            fillDiffs.push(diffRow);
            filledEmpty++;
            if (skipReasons.length < 12) {
              skipReasons.push({ title: title.slice(0, 80), reason: reason + '+fill_empty_preview', key: oaId });
            }
          } else {
            await prisma.outcome.update({ where: { id: existing.id }, data: lockedPatch });
            fillDiffs.push(diffRow);
            filledEmpty++;
            if (skipReasons.length < 12) {
              skipReasons.push({ title: title.slice(0, 80), reason: reason + '+fill_empty', key: oaId });
            }
          }
        } else {
          skippedDup++;
          if (skipReasons.length < 12) skipReasons.push({ title: title.slice(0, 80), reason, key: oaId });
        }
      } else {
        skippedDup++;
        if (skipReasons.length < 12) skipReasons.push({ title: title.slice(0, 80), reason, key: oaId });
      }
      continue;
    }
    const emb = await embedText([title, abstract, ...concepts].join(' '));
    const data = {
      orgId: org.id,
      title,
      type: OutcomeType.PAPER as const,
      abstract: abstract || null,
      ipcOrDisc: concepts.slice(0, 12),
      trl: guessTrl(w, concepts),
      rights: '公开论文·许可待核',
      ipOwnership: 'university',
      licenseOpenness: 'unclear',
      readinessBand: 'lab',
      doi,
      openAlexId: oaId,
      embedding: emb,
      trustBadges: ['verified_import'],
      year: w.publication_year || null,
      summaryPublic: (abstract || '').slice(0, 280),
      publishStatus: (w.authorships || w.authors || []).length ? 'canonical' : 'canonical',
      publishBlockers: ['no_person'],
      sourceUpdatedAt: new Date(),
      reviewedAt: new Date(),
      extensions: {
        source: 'openalex',
        lineage: 'openalex.works',
        cited_by_count: w.cited_by_count || 0,
        publication_year: w.publication_year || null,
      },
    };
    const createdOutcome = await prisma.outcome.create({ data });
    await linkAuthors(org, createdOutcome.id, w, nameZh);
    await rememberRaw('openalex', oaId, w, 'outcome');
    n++;
  }

  // 按概念频次切 1～3 张能力卡，比「一张大杂烩」好用
  const freq = new Map<string, number>();
  for (const w of bundle.works || []) {
    for (const c of w.concepts || []) {
      const name = c.display_name;
      if (!name) continue;
      freq.set(name, (freq.get(name) || 0) + 1);
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const clusters: string[][] = [];
  if (ranked.length) clusters.push(ranked.slice(0, 6));
  if (ranked.length > 6) clusters.push(ranked.slice(6, 12));
  if (ranked.length > 12) clusters.push(ranked.slice(12, 18));
  for (let i = 0; i < clusters.length; i++) {
    const topConcepts = clusters[i];
    const title = clusters.length === 1 ? `${nameZh}·公开成果凝练能力` : `${nameZh}·方向${i + 1}·${topConcepts[0]}`;
    const found = await prisma.capability.findFirst({ where: { orgId: org.id, title } });
    const emb = await embedText([title, ...topConcepts].join(' '));
    const summary = `根据 OpenAlex 公开论文高频主题自动凝练（非正式自评）：${topConcepts.join('、')}`;
    const decision = shared.publishDecision('capability', {
      title,
      summary,
      keywords: topConcepts,
      orgId: org.id,
      sourceCode: 'openalex-derived',
    });
    const payload = {
      orgId: org.id,
      title,
      disciplines: topConcepts.slice(0, 4),
      keywords: topConcepts as string[],
      offerTypes: ['技术咨询', '联合攻关'],
      summary,
      summaryPublic: shared.summaryPublic(summary),
      trl: 4,
      ipOwnership: 'university',
      licenseOpenness: 'negotiable',
      readinessBand: 'lab',
      trustBadges: ['verified_import'],
      embedding: emb,
      embeddingModel: shared.embeddingMeta().mode,
      publishStatus: decision.status,
      publishBlockers: decision.blockers,
      reviewedAt: new Date(),
      sourceUpdatedAt: new Date(),
      extensions: { source: 'openalex-derived', lineage: 'openalex.works→capability', cluster: i },
    };
    if (found) {
      const safe = stripLocked(payload, found.lockedFields);
      delete safe.orgId;
      delete safe.title;
      if (found.publishStatus === 'published') {
        delete safe.publishStatus;
        delete safe.publishBlockers;
      }
      if (Object.keys(safe).length) await prisma.capability.update({ where: { id: found.id }, data: safe });
    } else await prisma.capability.create({ data: payload });
  }

  console.log(`OpenAlex 入库：机构=${org.name} 新建=${n} 跳过重复=${skippedDup} 补空=${filledEmpty} 跳过垃圾=${skippedJunk} fillEmpty=${FILL_EMPTY}`);
  return { org, outcomes: n, newOutcomes: n, skippedDup, filledEmpty, skippedJunk, skipReasons, fillEmpty: FILL_EMPTY, fillEmptyPreview: FILL_EMPTY_PREVIEW, fillDiffs };
}

async function rememberRaw(sourceCode: string, externalId: string, body: any, entityHint: string) {
  const crypto = await import('crypto');
  const bodyText = JSON.stringify(body);
  const contentHash = crypto.createHash('sha256').update(bodyText).digest('hex');
  await prisma.rawDocument.upsert({
    where: { sourceCode_externalId_contentHash: { sourceCode, externalId, contentHash } },
    update: {},
    create: {
      sourceCode,
      externalId,
      contentHash,
      bodyText,
      contentType: 'application/json',
      entityHint,
      httpStatus: 200,
    },
  }).catch(() => null);
}

async function linkAuthors(org: { id: string; name: string; openAlexId: string | null }, outcomeId: string, work: any, schoolName: string) {
  const authorships = work.authorships || work.authors || [];
  let primaryId: string | null = null;
  let order = 0;
  for (const a of authorships) {
    order += 1;
    const author = a.author || a;
    const name = author.display_name || author.name;
    if (!name) continue;
    const openAlexAuthorId = author.id ? String(author.id).replace('https://openalex.org/', '') : null;
    let person = openAlexAuthorId
      ? await prisma.person.findFirst({ where: { openAlexAuthorId } })
      : null;
    if (!person) {
      const same = await prisma.person.findMany({ where: { name, orgId: org.id }, take: 3 });
      if (same.length > 1) continue;
      person = same[0] || null;
    }
    const summary = (author.display_name || name) + ' · ' + schoolName;
    if (!person) {
      person = await prisma.person.create({
        data: {
          name,
          orgId: org.id,
          openAlexAuthorId,
          orcid: author.orcid ? String(author.orcid).replace('https://orcid.org/', '') : null,
          role: a.is_corresponding || a.corresponding ? '通讯作者' : '作者',
          researchSummary: summary.length >= 40 ? summary : summary + '，公开论文作者档案。',
          source: 'openalex',
          publishStatus: 'canonical',
          publishBlockers: ['thin_summary'],
          sourceUpdatedAt: new Date(),
          reviewedAt: new Date(),
        },
      });
    }
    await prisma.authorship.upsert({
      where: { personId_outcomeId: { personId: person.id, outcomeId } },
      update: { authorOrder: order, isCorresponding: Boolean(a.is_corresponding || a.corresponding) },
      create: {
        personId: person.id,
        outcomeId,
        authorOrder: order,
        isCorresponding: Boolean(a.is_corresponding || a.corresponding),
      },
    });
    if (!primaryId && (a.is_corresponding || a.corresponding || a.author_position === 'first' || order === 1)) {
      primaryId = person.id;
    }
  }
  if (primaryId) {
    await prisma.outcome.update({ where: { id: outcomeId }, data: { personId: primaryId } });
    const blockers = (await prisma.outcome.findUnique({ where: { id: outcomeId } }))?.publishBlockers || [];
    const next = blockers.filter((b) => b !== 'no_person');
    if (next.length !== blockers.length) {
      await prisma.outcome.update({
        where: { id: outcomeId },
        data: { publishBlockers: next, publishStatus: next.length ? 'canonical' : 'published' },
      });
    }
  }
}

async function crawlOne(u: { search: string; nameZh: string; regionHint?: string }) {
  let bundle: any;
  let mode = 'online';
  try {
    bundle = await loadOnline(u.search);
    console.log(`在线 OpenAlex 拉取成功：${u.nameZh} · works=${(bundle.works || []).length}`);
  } catch (e: any) {
    mode = 'fixture';
    console.warn(`在线 OpenAlex 不可用（${u.nameZh}），改用演示夹具：`, e?.message || e);
    bundle = loadFixture(u.nameZh);
  }
  const r = await upsertFromBundle(bundle, u.nameZh, u.regionHint);
  return { mode, ...r };
}

async function main() {
  const job = await prisma.jobLog.create({
    data: {
      queue: 'crawl',
      jobName: 'openalex',
      status: 'running',
      message: 'OpenAlex 采集开始',
      payload: { batch: process.env.OPENALEX_BATCH === '1', perPage: PER_PAGE, maxPages: MAX_PAGES },
    },
  });
  try {
    const batch = process.env.OPENALEX_BATCH === '1' || !process.env.OPENALEX_SEARCH;
    const limit = process.env.OPENALEX_LIMIT ? Number(process.env.OPENALEX_LIMIT) : undefined;
    let modes: Record<string, number> = {};
    let totalOut = 0;
    let totalSkippedDup = 0;
    let totalFilledEmpty = 0;
    let totalSkippedJunk = 0;
    const sampleSkips: any[] = [];
    const allFillDiffs: any[] = [];
    if (batch) {
      const list = limit ? DEFAULT_UNIVERSITIES.slice(0, limit) : DEFAULT_UNIVERSITIES;
      console.log(`批量采集 ${list.length} 所高校（每所最多 ${PER_PAGE * MAX_PAGES} 篇）…`);
      for (const u of list) {
        const r = await crawlOne(u);
        modes[r.mode] = (modes[r.mode] || 0) + 1;
        totalOut += r.outcomes || 0;
        totalSkippedDup += r.skippedDup || 0;
        totalFilledEmpty += r.filledEmpty || 0;
        totalSkippedJunk += r.skippedJunk || 0;
        for (const d of r.fillDiffs || []) {
          if (allFillDiffs.length < 200) allFillDiffs.push({ org: u.nameZh, ...d });
        }
        for (const s of r.skipReasons || []) {
          if (sampleSkips.length < 20) sampleSkips.push({ org: u.nameZh, ...s });
        }
        await sleep(DELAY_MS);
      }
    } else {
      const search = process.env.OPENALEX_SEARCH!;
      const nameZh = process.env.OPENALEX_NAME_ZH || search;
      const r = await crawlOne({ search, nameZh, regionHint: process.env.OPENALEX_REGION });
      modes[r.mode] = 1;
      totalOut = r.outcomes || 0;
      totalSkippedDup = r.skippedDup || 0;
      totalFilledEmpty = r.filledEmpty || 0;
      totalSkippedJunk = r.skippedJunk || 0;
      for (const s of r.skipReasons || []) sampleSkips.push({ org: nameZh, ...s });
      for (const d of r.fillDiffs || []) allFillDiffs.push({ org: nameZh, ...d });
    }
    const previewOut =
      process.env.OPENALEX_PREVIEW_OUT ||
      path.join(ROOT, '.data', 'fill-empty-preview.json');
    if (FILL_EMPTY && allFillDiffs.length) {
      const fs = require('fs');
      const dir = path.dirname(previewOut);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        previewOut,
        JSON.stringify(
          {
            preview: FILL_EMPTY_PREVIEW,
            applied: FILL_EMPTY && !FILL_EMPTY_PREVIEW,
            at: new Date().toISOString(),
            count: allFillDiffs.length,
            diffs: allFillDiffs,
          },
          null,
          2,
        ),
      );
    }
    await prisma.jobLog.update({
      where: { id: job.id },
      data: {
        status: 'done',
        message: `采集完成 新建=${totalOut} · 跳过重复=${totalSkippedDup} · 补空=${totalFilledEmpty} · 跳过垃圾=${totalSkippedJunk}${FILL_EMPTY ? ' · 仅补空开' : ''}`,
        payload: {
          modes,
          totalOut,
          newOutcomes: totalOut,
          skippedDup: totalSkippedDup,
          filledEmpty: totalFilledEmpty,
          fillEmpty: FILL_EMPTY,
          fillEmptyPreview: FILL_EMPTY_PREVIEW,
          fillDiffCount: allFillDiffs.length,
          previewOut: FILL_EMPTY ? previewOut : undefined,
          skippedJunk: totalSkippedJunk,
          sampleSkips,
          perPage: PER_PAGE,
          maxPages: MAX_PAGES,
        },
      },
    });
  } catch (e: any) {
    await prisma.jobLog.update({
      where: { id: job.id },
      data: { status: 'failed', message: String(e?.message || e).slice(0, 500) },
    });
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
