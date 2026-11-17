/**
 * M83/M84：ANN/召回池命中率分位数看板 + demandId 钻取。
 * 从匹配跑批喂样；无新配额子系统。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type RecallPoolDemandContribution = {
  demandId: string;
  hit: number;
  miss: number;
  hitRatePct: number | null;
  title?: string | null;
};

export type RecallPoolHitSample = {
  at: string;
  hit: number;
  miss: number;
  hitRatePct: number | null;
  recallAvgMs: number | null;
  runId?: string | null;
  /** M84：本轮贡献 demandId 样本（钻取用） */
  demandIds?: string[];
  demandContributions?: RecallPoolDemandContribution[];
};

export type RecallPoolHitStore = {
  tenantId: string;
  samples: RecallPoolHitSample[];
  updatedAt: string | null;
  wave: 'M84';
  labelZh: string;
};

function safeTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function storePath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'recall-pool-hit-stats.json');
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return Math.round((sorted[lo] * (1 - w) + sorted[hi] * w) * 100) / 100;
}

export function readRecallPoolHitStore(tenantId?: string | null): RecallPoolHitStore {
  const tid = safeTenant(tenantId);
  const p = storePath(tid);
  const empty: RecallPoolHitStore = {
    tenantId: tid,
    samples: [],
    updatedAt: null,
    wave: 'M84',
    labelZh: '召回池命中率分位数看板',
  };
  if (!existsSync(p)) return empty;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return {
      ...empty,
      samples: Array.isArray(raw.samples) ? raw.samples.slice(-200) : [],
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return empty;
  }
}

export function recordRecallPoolHitSample(
  tenantId: string | null | undefined,
  sample: {
    hit: number;
    miss: number;
    recallAvgMs?: number | null;
    runId?: string | null;
    demandIds?: string[] | null;
    demandContributions?: RecallPoolDemandContribution[] | null;
  },
) {
  const tid = safeTenant(tenantId);
  const store = readRecallPoolHitStore(tid);
  const hit = Math.max(0, Number(sample.hit) || 0);
  const miss = Math.max(0, Number(sample.miss) || 0);
  const denom = hit + miss;
  const hitRatePct = denom > 0 ? Math.round((hit / denom) * 1000) / 10 : null;
  const demandContributions = Array.isArray(sample.demandContributions)
    ? sample.demandContributions
        .filter((d) => d && d.demandId)
        .slice(0, 80)
        .map((d) => {
          const h = Math.max(0, Number(d.hit) || 0);
          const m = Math.max(0, Number(d.miss) || 0);
          const den = h + m;
          return {
            demandId: String(d.demandId),
            hit: h,
            miss: m,
            hitRatePct: den > 0 ? Math.round((h / den) * 1000) / 10 : null,
            title: d.title != null ? String(d.title).slice(0, 80) : null,
          };
        })
    : [];
  const demandIds = Array.isArray(sample.demandIds)
    ? [...new Set(sample.demandIds.map(String).filter(Boolean))].slice(0, 80)
    : demandContributions.map((d) => d.demandId);
  const next: RecallPoolHitSample = {
    at: new Date().toISOString(),
    hit,
    miss,
    hitRatePct,
    recallAvgMs:
      sample.recallAvgMs != null && Number.isFinite(Number(sample.recallAvgMs))
        ? Math.round(Number(sample.recallAvgMs))
        : null,
    runId: sample.runId || null,
    demandIds,
    demandContributions,
  };
  store.samples.push(next);
  while (store.samples.length > 120) store.samples.shift();
  store.updatedAt = next.at;
  writeFileSync(storePath(tid), JSON.stringify(store, null, 0), 'utf8');
  return next;
}

export function recallPoolHitRatePercentileBoard(tenantId?: string | null) {
  const store = readRecallPoolHitStore(tenantId);
  const rates = store.samples
    .map((s) => s.hitRatePct)
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  const lat = store.samples
    .map((s) => s.recallAvgMs)
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  const last = store.samples.length ? store.samples[store.samples.length - 1] : null;
  const p50 = percentile(rates, 50);
  const p90 = percentile(rates, 90);
  const p95 = percentile(rates, 95);
  const p10 = percentile(rates, 10);
  const latP50 = percentile(lat, 50);
  const latP90 = percentile(lat, 90);
  const tipZh = rates.length
    ? `召回池命中率分位：p10 ${p10 ?? '—'}% · p50 ${p50 ?? '—'}% · p90 ${p90 ?? '—'}% · p95 ${p95 ?? '—'}%（样本 ${rates.length} 次跑批）` +
      (lat.length ? ` · 召回均耗 p50 ${latP50 ?? '—'}ms / p90 ${latP90 ?? '—'}ms` : '') +
      ' · 可钻取 demandId'
    : '尚无匹配跑批命中样；跑一轮匹配后即可看分位数。';
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M84',
    labelZh: '召回池命中率分位数看板',
    tipZh,
    toastZh: rates.length ? `召回命中 p50 ${p50}% · p90 ${p90}%` : '暂无召回命中样',
    busyZh: '加载召回池命中率分位数…',
    sampleCount: rates.length,
    updatedAt: store.updatedAt,
    lastSample: last,
    percentiles: {
      hitRatePct: {
        p10,
        p50,
        p90,
        p95,
        labelZh: '命中率分位数（%）',
        labelsZh: {
          p10: '命中率 p10（偏低尾）',
          p50: '命中率中位 p50',
          p90: '命中率 p90',
          p95: '命中率 p95',
        },
      },
      recallAvgMs: {
        p50: latP50,
        p90: latP90,
        labelZh: '召回均耗分位数（ms）',
        labelsZh: {
          p50: '召回均耗中位 p50',
          p90: '召回均耗 p90',
        },
      },
    },
    recent: store.samples.slice(-12).reverse(),
    drillPath: '/api/metrics/recall-pool-hit-rate/drill',
    drillLabelZh: '分位钻取到 demandId',
    path: '/api/metrics/recall-pool-hit-rate',
  };
}

/**
 * M84：按分位（默认偏低尾 p10）钻取贡献 demandId。
 * band=low → 命中率 ≤ 目标分位的样本；band=high → ≥；band=around → 邻近。
 */
export function recallPoolHitRateDrillToDemandIds(
  tenantId?: string | null,
  opts: {
    percentile?: 'p10' | 'p50' | 'p90' | 'p95' | number;
    band?: 'low' | 'high' | 'around' | 'all';
    limit?: number;
  } = {},
) {
  const store = readRecallPoolHitStore(tenantId);
  const board = recallPoolHitRatePercentileBoard(tenantId);
  const pctKey = opts.percentile;
  let target: number | null = null;
  let pctLabel = 'p10';
  if (typeof pctKey === 'number' && Number.isFinite(pctKey)) {
    target = Number(pctKey);
    pctLabel = `p${pctKey}`;
  } else {
    const key = (pctKey as string) || 'p10';
    pctLabel = key;
    const map = board.percentiles.hitRatePct as any;
    target = map[key] != null ? Number(map[key]) : null;
  }
  const band = opts.band || (pctLabel === 'p10' ? 'low' : pctLabel === 'p90' || pctLabel === 'p95' ? 'high' : 'around');
  const withRate = store.samples.filter((s) => s.hitRatePct != null && Number.isFinite(s.hitRatePct));
  let selected = withRate;
  if (target != null && band !== 'all') {
    if (band === 'low') selected = withRate.filter((s) => Number(s.hitRatePct) <= target!);
    else if (band === 'high') selected = withRate.filter((s) => Number(s.hitRatePct) >= target!);
    else {
      const slack = 5;
      selected = withRate.filter((s) => Math.abs(Number(s.hitRatePct) - target!) <= slack);
    }
  }
  if (!selected.length && withRate.length) selected = withRate.slice(-Math.min(6, withRate.length));

  const agg = new Map<string, RecallPoolDemandContribution & { sampleCount: number }>();
  for (const s of selected) {
    const contribs =
      Array.isArray(s.demandContributions) && s.demandContributions.length
        ? s.demandContributions
        : (s.demandIds || []).map((id) => ({
            demandId: id,
            hit: 0,
            miss: 0,
            hitRatePct: s.hitRatePct,
            title: null as string | null,
          }));
    for (const c of contribs) {
      if (!c?.demandId) continue;
      const prev = agg.get(c.demandId) || {
        demandId: c.demandId,
        hit: 0,
        miss: 0,
        hitRatePct: null,
        title: c.title || null,
        sampleCount: 0,
      };
      prev.hit += Number(c.hit) || 0;
      prev.miss += Number(c.miss) || 0;
      if (c.title) prev.title = c.title;
      prev.sampleCount += 1;
      const den = prev.hit + prev.miss;
      prev.hitRatePct = den > 0 ? Math.round((prev.hit / den) * 1000) / 10 : c.hitRatePct ?? null;
      agg.set(c.demandId, prev);
    }
  }
  const demandIds = [...agg.values()]
    .sort((a, b) => {
      const ar = a.hitRatePct == null ? 999 : a.hitRatePct;
      const br = b.hitRatePct == null ? 999 : b.hitRatePct;
      if (band === 'high') return br - ar;
      return ar - br;
    })
    .slice(0, Math.max(1, Math.min(60, Number(opts.limit) || 24)));

  const tipZh = demandIds.length
    ? `分位钻取 ${pctLabel}（${band}）→ ${demandIds.length} 个 demandId` +
      (target != null ? ` · 目标命中率 ${target}%` : '') +
      ` · 来自 ${selected.length} 次跑批样`
    : `分位钻取 ${pctLabel}：暂无 demandId 贡献样（先跑匹配或写入带 demandIds 的干跑样）`;

  const firstId = demandIds[0]?.demandId || null;
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M85',
    labelZh: '召回分位钻取到 demandId',
    tipZh,
    toastZh: demandIds.length ? `钻取到 ${demandIds.length} 个 demandId` : '暂无 demandId',
    busyZh: '分位钻取 demandId…',
    percentile: pctLabel,
    targetHitRatePct: target,
    band,
    sampleCountSelected: selected.length,
    sampleCountTotal: store.samples.length,
    demandIds: demandIds.map((d) => d.demandId),
    contributions: demandIds,
    boardSummary: {
      p10: board.percentiles.hitRatePct.p10,
      p50: board.percentiles.hitRatePct.p50,
      p90: board.percentiles.hitRatePct.p90,
      p95: board.percentiles.hitRatePct.p95,
    },
    path: '/api/metrics/recall-pool-hit-rate/drill',
    // M85：一键单需求重跑旁路（绕开整批）
    singleDemandRerun: firstId
      ? {
          available: true,
          demandId: firstId,
          bypassFullBatch: true,
          path: '/api/metrics/recall-pool-hit-rate/drill/rerun',
          matchesRunPath: '/api/matches/run',
          body: { demandId: firstId, topN: 3, minScore: 0.1, bypassFullBatch: true },
          labelZh: '单需求重跑旁路',
          tipZh: `仅重跑 demandId=${firstId}，绕开整批匹配；中文进度与软取消仍在`,
          toastZh: '可一键单需求重跑',
          busyZh: '单需求重跑旁路…',
          softCancelIntact: true,
          wave: 'M85',
        }
      : {
          available: false,
          demandId: null,
          bypassFullBatch: true,
          path: '/api/metrics/recall-pool-hit-rate/drill/rerun',
          labelZh: '单需求重跑旁路',
          tipZh: '钻取暂无 demandId，无法一键重跑',
          toastZh: '无可重跑 demandId',
          busyZh: '单需求重跑旁路…',
          softCancelIntact: true,
          wave: 'M85',
        },
  };
}
