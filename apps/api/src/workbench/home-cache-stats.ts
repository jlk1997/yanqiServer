/** M46–M50：工作台 home 短缓存 HIT/MISS + 告警 + 分壳看板 + 持久分壳命中曲线 + 分壳持续偏低告警 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type Counters = {
  hits: number;
  misses: number;
  bypass: number;
  notModified: number;
  lastHitAt: string | null;
  lastMissAt: string | null;
};

function emptyCounters(): Counters {
  return {
    hits: 0,
    misses: 0,
    bypass: 0,
    notModified: 0,
    lastHitAt: null,
    lastMissAt: null,
  };
}

const c: Counters = emptyCounters();
const byShell = new Map<string, Counters>();

const DATA_DIR = join(process.cwd(), '.data', 'metrics');
const CURVE_FILE = join(DATA_DIR, 'home-cache-curve.json');
const MAX_POINTS = Number(process.env.HOME_CACHE_CURVE_MAX_POINTS || 288);
const FLUSH_MS = Number(process.env.HOME_CACHE_CURVE_FLUSH_MS || 30_000);

type CurvePoint = {
  t: string;
  ts: number;
  total: { hits: number; misses: number; bypass: number; hitRate: number | null };
  byShell: Record<string, { hits: number; misses: number; bypass: number; hitRate: number | null }>;
};

let curve: CurvePoint[] = [];
let dirty = false;
let flushTimer: NodeJS.Timeout | null = null;
let curveLoaded = false;

function ensureCurveLoaded() {
  if (curveLoaded) return;
  curveLoaded = true;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(CURVE_FILE)) {
      const raw = JSON.parse(readFileSync(CURVE_FILE, 'utf8'));
      if (Array.isArray(raw?.points)) curve = raw.points.slice(-MAX_POINTS);
    }
  } catch (_) {
    curve = [];
  }
}

function scheduleCurveFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushHomeCacheCurve(false);
  }, Math.max(5_000, FLUSH_MS));
}

function snapshotPoint(): CurvePoint {
  const totalDenom = c.hits + c.misses;
  const shells: CurvePoint['byShell'] = {};
  for (const [k, v] of byShell.entries()) {
    const d = v.hits + v.misses;
    shells[k] = {
      hits: v.hits,
      misses: v.misses,
      bypass: v.bypass,
      hitRate: d > 0 ? Math.round((v.hits / d) * 1000) / 1000 : null,
    };
  }
  const now = Date.now();
  return {
    t: new Date(now).toISOString(),
    ts: now,
    total: {
      hits: c.hits,
      misses: c.misses,
      bypass: c.bypass,
      hitRate: totalDenom > 0 ? Math.round((c.hits / totalDenom) * 1000) / 1000 : null,
    },
    byShell: shells,
  };
}

/** 立刻落盘一个点（或仅当 dirty） */
export function flushHomeCacheCurve(force = true) {
  ensureCurveLoaded();
  if (!force && !dirty) return { ok: true, skipped: true };
  const point = snapshotPoint();
  // 若与上一点间隔太近且 force=false，合并
  const last = curve[curve.length - 1];
  if (last && point.ts - last.ts < Math.max(5_000, FLUSH_MS / 2) && !force) {
    curve[curve.length - 1] = point;
  } else {
    curve.push(point);
  }
  if (curve.length > MAX_POINTS) curve = curve.slice(-MAX_POINTS);
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      CURVE_FILE,
      JSON.stringify(
        {
          wave: 'M50',
          updatedAt: point.t,
          maxPoints: MAX_POINTS,
          flushMs: FLUSH_MS,
          points: curve,
          noteZh: '分壳 home 短缓存命中时间序列；运营台/图表友好。重启后进程计数清零，曲线文件保留。',
        },
        null,
        0,
      ),
      'utf8',
    );
  } catch (_) {}
  dirty = false;
  return { ok: true, points: curve.length, file: CURVE_FILE };
}

/** 命中率低于此阈值且样本足够 → 告警（可用 HOME_CACHE_HIT_RATE_MIN 覆盖，0–1） */
export function homeCacheHitRateMin(): number {
  const n = Number(process.env.HOME_CACHE_HIT_RATE_MIN);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.35;
}

/** 至少这么多样本（HIT+MISS）才评估命中率，避免冷启动误报 */
export function homeCacheAlertMinSamples(): number {
  const n = Number(process.env.HOME_CACHE_ALERT_MIN_SAMPLES);
  if (Number.isFinite(n) && n >= 5) return Math.floor(n);
  return 20;
}

function bump(target: Counters, kind: 'HIT' | 'MISS' | 'BYPASS' | 'NOT_MODIFIED') {
  const now = new Date().toISOString();
  if (kind === 'HIT') {
    target.hits++;
    target.lastHitAt = now;
  } else if (kind === 'MISS') {
    target.misses++;
    target.lastMissAt = now;
  } else if (kind === 'BYPASS') {
    target.bypass++;
    target.lastMissAt = now;
  } else if (kind === 'NOT_MODIFIED') {
    target.notModified++;
    target.hits++;
    target.lastHitAt = now;
  }
}

export function recordHomeCache(
  kind: 'HIT' | 'MISS' | 'BYPASS' | 'NOT_MODIFIED',
  shell?: string | null,
) {
  ensureCurveLoaded();
  bump(c, kind);
  const s = String(shell || 'unknown').slice(0, 40) || 'unknown';
  let row = byShell.get(s);
  if (!row) {
    row = emptyCounters();
    byShell.set(s, row);
  }
  bump(row, kind);
  scheduleCurveFlush();
}

function rateOf(row: Counters) {
  const denom = row.hits + row.misses;
  const hitRate = denom > 0 ? Math.round((row.hits / denom) * 1000) / 1000 : null;
  return {
    hits: row.hits,
    misses: row.misses,
    bypass: row.bypass,
    notModified: row.notModified,
    samples: denom,
    hitRate,
    hitRatePct: hitRate == null ? null : Math.round(hitRate * 1000) / 10,
    lastHitAt: row.lastHitAt,
    lastMissAt: row.lastMissAt,
  };
}

export function homeCacheAlert() {
  const minRate = homeCacheHitRateMin();
  const minSamples = homeCacheAlertMinSamples();
  const denom = c.hits + c.misses;
  const hitRate = denom > 0 ? Math.round((c.hits / denom) * 1000) / 1000 : null;
  const sampleOk = denom >= minSamples;
  const low = sampleOk && hitRate != null && hitRate < minRate;
  return {
    enabled: true,
    wave: 'M50',
    threshold: minRate,
    thresholdPct: Math.round(minRate * 1000) / 10,
    minSamples,
    samples: denom,
    hitRate,
    hitRatePct: hitRate == null ? null : Math.round(hitRate * 1000) / 10,
    alerting: low,
    level: low ? ('warn' as const) : ('ok' as const),
    messageZh: low
      ? `工作台首页短缓存命中率偏低：当前 ${Math.round((hitRate as number) * 1000) / 10}%（阈值 ${Math.round(minRate * 1000) / 10}%，样本 ${denom}）。可能频繁 ?fresh=1、写后未复用 ETag，或壳键抖动——请看 /api/metrics/home-cache（含分壳与曲线）。`
      : sampleOk
        ? `首页短缓存命中率正常：${hitRate == null ? '—' : Math.round(hitRate * 1000) / 10}%（阈值 ${Math.round(minRate * 1000) / 10}%）。`
        : `首页短缓存样本不足（${denom}/${minSamples}），暂不告警。`,
  };
}

export function homeCacheStats() {
  ensureCurveLoaded();
  const total = c.hits + c.misses + c.bypass;
  const denom = c.hits + c.misses;
  const hitRate = denom > 0 ? Math.round((c.hits / denom) * 1000) / 1000 : null;
  const alert = homeCacheAlert();
  const shells: Record<string, ReturnType<typeof rateOf>> = {};
  for (const [k, v] of [...byShell.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    shells[k] = rateOf(v);
  }
  return {
    ok: true,
    wave: 'M50',
    hits: c.hits,
    misses: c.misses,
    bypass: c.bypass,
    notModified: c.notModified,
    totalObserved: total,
    hitRate,
    hitRatePct: hitRate == null ? null : Math.round(hitRate * 1000) / 10,
    lastHitAt: c.lastHitAt,
    lastMissAt: c.lastMissAt,
    alert,
    byShell: shells,
    shellCount: Object.keys(shells).length,
    curvePoints: curve.length,
    curvePath: '/api/metrics/home-cache/curve',
    curveShellAlert: homeCacheCurveShellAlert(),
    noteZh:
      '进程内计数；重启清零。HIT=短 TTL 命中；MISS=回源；BYPASS=?fresh=1；NOT_MODIFIED=If-None-Match→304。M50：分壳命中持久曲线 + 持续偏低告警见 curve/alerts。',
  };
}

/** 图表友好：labels + series（累计命中率按壳） */
export function homeCacheCurve(limit = 120) {
  ensureCurveLoaded();
  const n = Math.min(Math.max(Number(limit) || 120, 1), MAX_POINTS);
  const points = curve.slice(-n);
  const shellSet = new Set<string>();
  for (const p of points) {
    for (const k of Object.keys(p.byShell || {})) shellSet.add(k);
  }
  const shells = [...shellSet].sort();
  const labels = points.map((p) => p.t);
  const series: Record<string, Array<number | null>> = {
    totalHitRatePct: points.map((p) =>
      p.total.hitRate == null ? null : Math.round(p.total.hitRate * 1000) / 10,
    ),
  };
  for (const s of shells) {
    series[s] = points.map((p) => {
      const row = p.byShell?.[s];
      if (!row || row.hitRate == null) return null;
      return Math.round(row.hitRate * 1000) / 10;
    });
  }
  return {
    ok: true,
    wave: 'M50',
    file: CURVE_FILE,
    count: points.length,
    maxPoints: MAX_POINTS,
    flushMs: FLUSH_MS,
    labels,
    shells,
    series,
    points,
    chartFriendly: true,
    noteZh:
      'labels=ISO 时间；series.<shell>=命中率%（累计至该点）；series.totalHitRatePct=合计。适合折线图。',
  };
}

export function resetHomeCacheStatsForTests() {
  c.hits = 0;
  c.misses = 0;
  c.bypass = 0;
  c.notModified = 0;
  c.lastHitAt = null;
  c.lastMissAt = null;
  byShell.clear();
  curve = [];
  dirty = false;
}


/** M50：最近 N 个曲线点中，分壳命中率持续低于阈值 → 持久告警 */
export function homeCacheCurveShellAlert(opts?: { lookback?: number; minPoints?: number }) {
  ensureCurveLoaded();
  const minRate = homeCacheHitRateMin();
  const lookback = Math.min(
    Math.max(Number(opts?.lookback) || Number(process.env.HOME_CACHE_CURVE_ALERT_LOOKBACK) || 6, 2),
    MAX_POINTS,
  );
  const minPoints = Math.min(
    Math.max(Number(opts?.minPoints) || Number(process.env.HOME_CACHE_CURVE_ALERT_MIN_POINTS) || 3, 2),
    lookback,
  );
  const points = curve.slice(-lookback);
  const shellNames = new Set<string>();
  for (const p of points) {
    for (const k of Object.keys(p.byShell || {})) shellNames.add(k);
  }
  const shells: Array<{
    shell: string;
    alerting: boolean;
    consecutiveLow: number;
    lastHitRate: number | null;
    lastHitRatePct: number | null;
    messageZh: string;
  }> = [];
  let any = false;
  for (const shell of [...shellNames].sort()) {
    let consecutive = 0;
    let last: number | null = null;
    for (const p of points) {
      const row = p.byShell?.[shell];
      const hr = row?.hitRate;
      if (hr == null) {
        consecutive = 0;
        continue;
      }
      last = hr;
      if (hr < minRate) consecutive += 1;
      else consecutive = 0;
    }
    const alerting = consecutive >= minPoints;
    if (alerting) any = true;
    shells.push({
      shell,
      alerting,
      consecutiveLow: consecutive,
      lastHitRate: last,
      lastHitRatePct: last == null ? null : Math.round(last * 1000) / 10,
      messageZh: alerting
        ? `壳「${shell}」首页短缓存命中率连续 ${consecutive} 个曲线点低于 ${Math.round(minRate * 1000) / 10}%（最近 ${last == null ? '—' : Math.round(last * 1000) / 10}%）。请检查 ?fresh=1 滥用或写后未复用 ETag。`
        : consecutive > 0
          ? `壳「${shell}」近期有 ${consecutive} 点偏低，尚未达持续告警阈值（${minPoints}）。`
          : `壳「${shell}」曲线命中率正常。`,
    });
  }
  return {
    ok: true,
    wave: 'M51',
    alerting: any,
    level: any ? ('warn' as const) : ('ok' as const),
    threshold: minRate,
    thresholdPct: Math.round(minRate * 1000) / 10,
    lookback: points.length,
    minPoints,
    shells,
    messageZh: any
      ? `分壳命中曲线持续偏低：${shells.filter((s) => s.alerting).map((s) => s.shell).join('、') || '—'}。详见 /api/metrics/home-cache/curve/alerts。`
      : points.length
        ? '分壳命中曲线未见持续偏低。'
        : '曲线样本不足，暂不分壳告警。',
    tipZh: '基于持久曲线（非仅进程计数）；重启后曲线文件仍可判定持续偏低。',
  };
}

