#!/usr/bin/env node
/**
 * M12 匹配评测：冻结黄金对 + 默认权重，防学习权重把回归弄假绿。
 * npm run test:match-eval
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scorePair } = require(path.join(root, 'packages/shared/src/match-lib.js'));

const fixturePath = path.join(root, 'fixtures/match-eval-golden.json');
const outDir = path.join(root, '.data/metrics');
fs.mkdirSync(outDir, { recursive: true });
const baselinePath = path.join(outDir, 'match-eval-baseline.json');
const latestPath = path.join(outDir, 'match-eval-latest.json');

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const weights = fixture.weights;
const thr = fixture.thresholds || {};

const results = [];
let failures = [];

for (const c of fixture.cases) {
  const scored = c.candidates.map((cand) => {
    const r = scorePair({
      weights,
      demandText: `${c.demand.title} ${c.demand.text}`,
      supplyText: `${cand.title} ${cand.text}`,
      demandKeywords: c.demand.keywords,
      demandIndustry: c.demand.industry,
      supplyKeywords: cand.keywords,
      supplyDisciplines: cand.disciplines,
      demandRegion: c.demand.region,
      supplyRegion: cand.region,
      trl: cand.trl,
      licenseOpenness: cand.licenseOpenness,
      ipOwnership: cand.ipOwnership,
      readinessBand: cand.readinessBand,
      trustBadges: cand.trustBadges,
      qualityScore: cand.qualityScore,
      rights: cand.rights,
      licenseNeed: c.demand.licenseNeed,
      minTrl: c.demand.minTrl,
      demandExpectedOut: c.demand.expectedOut || c.demand.text,
      demandProblem: c.demand.text,
      demandTitle: c.demand.title,
      supplyTitle: cand.title,
      hardNegative: cand.hardNegative,
      demandTaxonomy: c.demand.taxonomyCodes || [],
      supplyTaxonomy: cand.taxonomyCodes || [],
    });
    return { id: cand.id, title: cand.title, expectRank: cand.expectRank, total: r.total, breakdown: r.breakdown };
  });
  scored.sort((a, b) => b.total - a.total);
  const ranked = scored.map((s, i) => ({ ...s, actualRank: i + 1 }));
  const top1 = ranked[0];
  const top2 = ranked[1];
  const expectedTop = c.candidates.find((x) => x.expectRank === 1);
  const caseFails = [];
  if (expectedTop && top1.id !== expectedTop.id) {
    caseFails.push(`Top1 漂移：期望 ${expectedTop.id}，实际 ${top1.id}`);
  }
  const nonNegIds = c.candidates.filter((x) => !x.hardNegative).map((x) => x.id);
  const nonNegRanked = ranked.filter((x) => nonNegIds.includes(x.id));
  // 非反例：相对名次（忽略硬反例插入造成的绝对名次偏移）
  for (const s of nonNegRanked) {
    const expectRel = c.candidates.find((x) => x.id === s.id)?.expectRank;
    const actualRel = nonNegRanked.findIndex((x) => x.id === s.id) + 1;
    if (expectRel != null && expectRel !== actualRel) {
      caseFails.push(`名次 ${s.id}: expectRel=${expectRel} actualRel=${actualRel}`);
    }
  }
  if (top1.total < (c.minTop1Score ?? 0)) {
    caseFails.push(`Top1 分过低 ${top1.total} < ${c.minTop1Score}`);
  }
  // 裕度：相对第一名与第一名非反例之外的下一个非反例
  const topNonNeg = nonNegRanked[0];
  const secondNonNeg = nonNegRanked[1];
  if (topNonNeg && secondNonNeg && c.minTop1Margin != null) {
    const margin = topNonNeg.total - secondNonNeg.total;
    if (margin < c.minTop1Margin) {
      caseFails.push(`Top1 裕度不足 Δ=${margin.toFixed(3)} < ${c.minTop1Margin}`);
    }
  }
  const nonNegCount = nonNegIds.length;
  for (const cand of c.candidates) {
    if (!cand.hardNegative) continue;
    const hit = ranked.find((x) => x.id === cand.id);
    if (!hit) continue;
    if (hit.actualRank === 1) caseFails.push(`硬反例 ${cand.id} 不应 Top1`);
    if (hit.actualRank <= nonNegCount) {
      caseFails.push(`硬反例 ${cand.id} 挤进前 ${nonNegCount}（实际名次 ${hit.actualRank}）`);
    }
  }
  results.push({
    id: c.id,
    demandTitle: c.demand.title,
    ranking: ranked.map((x) => ({ id: x.id, total: x.total, expectRank: x.expectRank, actualRank: x.actualRank })),
    top1: { id: top1.id, total: top1.total },
    ok: caseFails.length === 0,
    fails: caseFails,
  });
  failures = failures.concat(caseFails.map((f) => `${c.id}: ${f}`));
}

// baseline drift
let baseline = null;
if (fs.existsSync(baselinePath)) {
  baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}
if (!baseline || baseline.fixtureVersion !== fixture.version) {
  baseline = {
    createdAt: new Date().toISOString(),
    fixtureVersion: fixture.version,
    cases: Object.fromEntries(results.map((r) => [r.id, { top1Id: r.top1.id, top1Score: r.top1.total, ranking: r.ranking.map((x) => x.id) }])),
  };
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  console.log('[match-eval] 已写入/重建基线 v' + fixture.version, baselinePath);
}

const maxDrift = thr.maxScoreAbsDriftFromFrozen ?? 0.08;
const driftFails = [];
for (const r of results) {
  const b = baseline.cases?.[r.id];
  if (!b) continue;
  if (thr.failOnTop1Swap !== false && b.top1Id && b.top1Id !== r.top1.id) {
    driftFails.push(`${r.id}: 相对基线 Top1 互换 ${b.top1Id} → ${r.top1.id}`);
  }
  const d = Math.abs(r.top1.total - b.top1Score);
  if (d > maxDrift) driftFails.push(`${r.id}: Top1 分数相对基线漂移 ${d.toFixed(3)} > ${maxDrift}`);
}
failures = failures.concat(driftFails);

const report = {
  ok: failures.length === 0,
  wave: 'M18',
  evaluatedAt: new Date().toISOString(),
  fixtureVersion: fixture.version,
  weights,
  passed: results.filter((r) => r.ok).length,
  total: results.length,
  failures,
  results,
  baselineAt: baseline.createdAt,
};
fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

for (const r of results) {
  console.log(r.ok ? '✓' : '✗', r.id, 'top1=', r.top1.id, r.top1.total, r.fails.join('; ') || 'ok');
}
console.log('\nsummary', { ok: report.ok, passed: report.passed, total: report.total, failures: failures.length });
console.log('latest →', latestPath);
if (!report.ok) process.exit(1);
