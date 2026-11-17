/** M62–M67：收件箱 delta 短缓存 + 分壳曲线 + 偏低告警 + 定向 bust + 一键自愈 + HIT 探测 + 壳健康持久化/探针失败二次干跑 bust */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  startOrReplaceAnomalyChainJob,
  markAnomalyChainPhase,
  readAnomalyChainJob,
  requestCancelAnomalyChainJob,
  listAnomalyChainResumeCards,
} from './anomaly-chain-job';

export type InboxDeltaKind = 'HIT' | 'MISS' | 'BYPASS' | 'NOT_MODIFIED';

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

type CacheEntry = { at: number; body: any; etag: string; key: string; shell: string; tenantId: string };
const store = new Map<string, CacheEntry>();

const DATA_DIR = join(process.cwd(), '.data', 'metrics');
const CURVE_FILE = join(DATA_DIR, 'inbox-delta-curve.json');
const MAX_POINTS = Number(process.env.INBOX_DELTA_CURVE_MAX_POINTS || 288);
const FLUSH_MS = Number(process.env.INBOX_DELTA_CURVE_FLUSH_MS || 30_000);
const DEFAULT_TTL_MS = Number(process.env.WORKBENCH_INBOX_DELTA_CACHE_MS || 2500);

type CurvePoint = {
  t: string;
  ts: number;
  total: { hits: number; misses: number; bypass: number; notModified: number; hitRate: number | null };
  byShell: Record<
    string,
    { hits: number; misses: number; bypass: number; notModified: number; hitRate: number | null }
  >;
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
    flushInboxDeltaCurve(false);
  }, Math.max(5_000, FLUSH_MS));
}

function bump(target: Counters, kind: InboxDeltaKind) {
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

export function recordInboxDeltaCache(kind: InboxDeltaKind, shell?: string | null) {
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

function snapshotPoint(): CurvePoint {
  const totalDenom = c.hits + c.misses;
  const shells: CurvePoint['byShell'] = {};
  for (const [k, v] of byShell.entries()) {
    const d = v.hits + v.misses;
    shells[k] = {
      hits: v.hits,
      misses: v.misses,
      bypass: v.bypass,
      notModified: v.notModified,
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
      notModified: c.notModified,
      hitRate: totalDenom > 0 ? Math.round((c.hits / totalDenom) * 1000) / 1000 : null,
    },
    byShell: shells,
  };
}

export function flushInboxDeltaCurve(force = true) {
  ensureCurveLoaded();
  if (!force && !dirty) return { ok: true, skipped: true };
  const point = snapshotPoint();
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
          wave: 'M65',
          updatedAt: point.t,
          maxPoints: MAX_POINTS,
          flushMs: FLUSH_MS,
          points: curve,
          noteZh:
            '分壳 inbox/delta 短缓存命中时间序列；匹配写库后按 tenant/shell 定向 bust。重启后进程计数清零，曲线文件保留。',
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

export function inboxDeltaCacheStats() {
  ensureCurveLoaded();
  const total = c.hits + c.misses + c.bypass;
  const denom = c.hits + c.misses;
  const hitRate = denom > 0 ? Math.round((c.hits / denom) * 1000) / 1000 : null;
  const shells: Record<string, ReturnType<typeof rateOf>> = {};
  for (const [k, v] of [...byShell.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    shells[k] = rateOf(v);
  }
  return {
    ok: true,
    wave: 'M65',
    hits: c.hits,
    misses: c.misses,
    bypass: c.bypass,
    notModified: c.notModified,
    totalObserved: total,
    hitRate,
    hitRatePct: hitRate == null ? null : Math.round(hitRate * 1000) / 10,
    lastHitAt: c.lastHitAt,
    lastMissAt: c.lastMissAt,
    byShell: shells,
    shellCount: Object.keys(shells).length,
    cacheSize: store.size,
    ttlMs: DEFAULT_TTL_MS,
    curvePoints: curve.length,
    curvePath: '/api/metrics/inbox-delta-cache/curve',
    alertPath: '/api/metrics/inbox-delta-cache/curve/alerts',
    alert: inboxDeltaCacheAlert(),
    curveShellAlert: inboxDeltaCurveShellAlert(),
    noteZh:
      '进程内计数；HIT=短 TTL；MISS=回源；BYPASS=?fresh=1；NOT_MODIFIED=If-None-Match→304。M63：分壳曲线 + 持续偏低告警 + 匹配写后按租户/壳定向 bust。',
  };
}

export function inboxDeltaCacheCurve(limit = 120) {
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
    wave: 'M65',
    labels,
    series,
    shells,
    points,
    tipZh: '收件箱 delta 分壳命中曲线（累计命中率 %）。持续偏低见 /curve/alerts。',
  };
}

export function inboxDeltaTtlMs() {
  return DEFAULT_TTL_MS;
}

export function getInboxDeltaCache(key: string): CacheEntry | undefined {
  return store.get(key);
}

export function setInboxDeltaCache(key: string, entry: CacheEntry) {
  store.set(key, entry);
  if (store.size > 240) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) store.delete(oldest[0]);
  }
}

export function deleteInboxDeltaKeys(pred: (key: string, entry: CacheEntry) => boolean) {
  let n = 0;
  for (const [k, v] of [...store.entries()]) {
    if (pred(k, v)) {
      store.delete(k);
      n++;
    }
  }
  return n;
}

/**
 * 定向打穿：优先按 tenantId / shell；也可按 uid 前缀。
 * 匹配写库后只清受影响租户，避免误伤其它壳命中曲线。
 */
export function bustInboxDeltaCache(
  opts: { uid?: string | null; tenantId?: string | null; shell?: string | null; all?: boolean } = {},
) {
  if (opts.all) {
    const n = store.size;
    store.clear();
    return { ok: true, cleared: n > 0, clearedKeys: n, scope: 'all', wave: 'M65' };
  }
  const uid = opts.uid ? String(opts.uid) : null;
  const tenantId = opts.tenantId ? String(opts.tenantId) : null;
  const shell = opts.shell ? String(opts.shell) : null;
  const n = deleteInboxDeltaKeys((k, e) => {
    if (uid && (k === uid || k.startsWith(uid + '::'))) {
      if (tenantId && e.tenantId !== tenantId && !k.includes(`::${tenantId}::`)) return false;
      if (shell && e.shell !== shell && !k.includes(`::${shell}::`)) return false;
      return true;
    }
    if (!uid && tenantId) {
      if (e.tenantId !== tenantId && !k.includes(`::${tenantId}::`)) return false;
      if (shell && e.shell !== shell && !k.includes(`::${shell}::`)) return false;
      return true;
    }
    if (!uid && !tenantId && shell) {
      return e.shell === shell || k.includes(`::${shell}::`);
    }
    return false;
  });
  return {
    ok: true,
    cleared: n > 0,
    clearedKeys: n,
    scope: { uid, tenantId, shell },
    wave: 'M65',
    tipZh: n
      ? `已定向打穿收件箱 delta 短缓存 ${n} 条（tenant=${tenantId || '—'} shell=${shell || '—'}）。`
      : '没有命中可打穿的收件箱 delta 缓存键。',
  };
}


function inboxDeltaHitRateMin() {
  return Math.min(
    0.95,
    Math.max(0.05, Number(process.env.INBOX_DELTA_HIT_RATE_MIN) || 0.35),
  );
}

/** M63：最近 N 个曲线点中，分壳命中率持续低于阈值 → 中文告警（对齐 home 曲线） */
export function inboxDeltaCurveShellAlert(opts?: { lookback?: number; minPoints?: number }) {
  ensureCurveLoaded();
  const minRate = inboxDeltaHitRateMin();
  const lookback = Math.min(
    Math.max(Number(opts?.lookback) || Number(process.env.INBOX_DELTA_CURVE_ALERT_LOOKBACK) || 6, 2),
    MAX_POINTS,
  );
  const minPoints = Math.min(
    Math.max(Number(opts?.minPoints) || Number(process.env.INBOX_DELTA_CURVE_ALERT_MIN_POINTS) || 3, 2),
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
    selfHealHintsZh: string[];
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
    const selfHealHintsZh = alerting
      ? [
          `一键自愈：运营台点「一键自愈偏低壳（干跑 bust）」或 POST /api/metrics/inbox-delta-cache/curve/alerts/self-heal（shell=${shell}），定向 bust + 重写曲线样本窗口。`,
          `定向 bust：按壳「${shell}」打穿收件箱 delta（bustInboxDeltaCache({ shell: '${shell}' })）。`,
          '少用 ?fresh=1 强制刷新；写后复用 ETag，确认 304 回升。',
          `样本探测：对壳「${shell}」连续无 fresh 拉 inbox/delta 3 次，看命中曲线是否回升。`,
        ]
      : consecutive > 0
        ? [`壳「${shell}」略偏低：可一键自愈或定向 bust 该壳，暂不必全量清理。`]
        : [];
    shells.push({
      shell,
      alerting,
      consecutiveLow: consecutive,
      lastHitRate: last,
      lastHitRatePct: last == null ? null : Math.round(last * 1000) / 10,
      selfHealHintsZh,
      messageZh: alerting
        ? `壳「${shell}」收件箱 delta 命中率连续 ${consecutive} 个曲线点低于 ${Math.round(minRate * 1000) / 10}%（最近 ${last == null ? '—' : Math.round(last * 1000) / 10}%）。请检查频繁 ?fresh=1、匹配写后未复用 ETag，或壳键抖动。`
        : consecutive > 0
          ? `壳「${shell}」收件箱近期有 ${consecutive} 点偏低，尚未达持续告警阈值（${minPoints}）。`
          : `壳「${shell}」收件箱曲线命中率正常。`,
    });
  }
  const selfHealHintsZh = shells
    .filter((s) => s.alerting)
    .flatMap((s) => s.selfHealHintsZh || []);
  return {
    ok: true,
    wave: 'M65',
    alerting: any,
    level: any ? ('warn' as const) : ('ok' as const),
    threshold: minRate,
    thresholdPct: Math.round(minRate * 1000) / 10,
    lookback: points.length,
    minPoints,
    shells,
    selfHealHintsZh,
    selfHeal: {
      available: true,
      dryRunOnly: true,
      tipZh: '一键自愈 = 定向 bust + 重写曲线样本（干跑，不真外发）。不扩张导出/SSE/配额。',
      oneClickPath: '/api/metrics/inbox-delta-cache/curve/alerts/self-heal',
      suggestedBustShells: shells.filter((s) => s.alerting).map((s) => s.shell),
    },
    messageZh: any
      ? `收件箱分壳命中曲线持续偏低：${shells.filter((s) => s.alerting).map((s) => s.shell).join('、') || '—'}。详见 /api/metrics/inbox-delta-cache/curve/alerts。`
      : points.length
        ? '收件箱分壳命中曲线未见持续偏低。'
        : '收件箱曲线样本不足，暂不分壳告警。',
    tipZh: any
      ? '偏低壳可一键自愈（干跑 bust + 样本窗口重写）。双通道干跑，不真外发。'
      : '基于持久曲线；默认双通道干跑，不真外发。不扩张导出/SSE/配额子系统。',
  };
}



/** M65：重写/重置曲线样本窗口（按壳删 byShell 点，或清空） */
export function rewriteInboxDeltaCurveSampleWindow(
  opts: { shells?: string[]; clearAll?: boolean } = {},
) {
  ensureCurveLoaded();
  const shells = [...new Set((opts.shells || []).map(String).filter(Boolean))];
  const before = curve.length;
  if (opts.clearAll) {
    curve = [];
    dirty = true;
    flushInboxDeltaCurve(true);
    return {
      ok: true,
      clearedPoints: before,
      shells: [] as string[],
      tipZh: `已重置全部收件箱曲线样本窗口（原 ${before} 点）。`,
      wave: 'M65',
    };
  }
  if (!shells.length) {
    return {
      ok: true,
      clearedShellSamples: 0,
      shells,
      points: curve.length,
      tipZh: '未指定壳，曲线样本未改。',
      wave: 'M65',
    };
  }
  let touched = 0;
  curve = curve.map((p) => {
    const nextBy: CurvePoint['byShell'] = { ...(p.byShell || {}) };
    for (const s of shells) {
      if (nextBy[s]) {
        delete nextBy[s];
        touched += 1;
      }
    }
    return { ...p, byShell: nextBy };
  });
  for (const s of shells) byShell.delete(s);
  dirty = true;
  flushInboxDeltaCurve(true);
  return {
    ok: true,
    clearedShellSamples: touched,
    shells,
    points: curve.length,
    tipZh: `已重写壳「${shells.join('、')}」的曲线样本窗口（清除 ${touched} 处分壳点），连续偏低计数归零。`,
    wave: 'M65',
  };
}

/**
 * M65：一键自愈偏低壳 — 定向 bust + 可选重写曲线样本窗口。
 * 干跑：不真外发、不扩张导出/SSE/配额。
 */
export function selfHealInboxDeltaAlertingShells(
  opts: {
    shell?: string | null;
    shells?: string[] | null;
    rewriteCurveSample?: boolean;
    allAlerting?: boolean;
  } = {},
) {
  const alert = inboxDeltaCurveShellAlert();
  let shells = [
    ...new Set(
      [
        ...(Array.isArray(opts.shells) ? opts.shells : []),
        ...(opts.shell ? [String(opts.shell)] : []),
      ]
        .map(String)
        .filter(Boolean),
    ),
  ];
  const suggested =
    alert.selfHeal?.suggestedBustShells ||
    alert.shells.filter((s) => s.alerting).map((s) => s.shell);
  if (!shells.length) {
    shells = [...suggested];
  } else if (opts.allAlerting) {
    shells = [...new Set([...shells, ...suggested])];
  }
  if (!shells.length) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M68',
      shells: [] as string[],
      bust: [] as any[],
      clearedKeys: 0,
      curveRewrite: null,
      tipZh: '当前无偏低告警壳，无需 bust。可先 POST .../alerts/notify 干跑观察；也可带 shells 强制探针。',
      toastZh: '无偏低壳，跳过自愈',
      selfHealHintsZh: ['暂无 alerting 壳；保持少用 ?fresh=1。'],
      alert,
    };
  }
  const bust = shells.map((shell) => bustInboxDeltaCache({ shell }));
  const clearedKeys = bust.reduce((n, r) => n + (Number(r.clearedKeys) || 0), 0);
  const curveRewrite =
    opts.rewriteCurveSample === false
      ? null
      : rewriteInboxDeltaCurveSampleWindow({ shells });
  const tipZh =
    `已对偏低壳「${shells.join('、')}」定向 bust（清 ${clearedKeys} 键）` +
    (curveRewrite ? '并重写曲线样本窗口' : '') +
    '。干跑、不真外发。可接 HIT 探测闭环。';
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M68',
    shells,
    bust,
    clearedKeys,
    curveRewrite,
    tipZh,
    toastZh: `自愈完成：${shells.join('、')} 已 bust` + (curveRewrite ? ' + 样本窗口已重置' : ''),
    selfHealHintsZh: [
      `已执行一键干跑 bust：${shells.join('、')}`,
      ...(curveRewrite ? [`曲线样本：${curveRewrite.tipZh}`] : []),
      '自愈后可跑 HIT 探测闭环（probeAfter），确认 304/HIT。',
    ],
    alertAfter: inboxDeltaCurveShellAlert(),
  };
}

/**
 * M66：自愈后 HIT 探测闭环（干跑，无外发）。
 * 对壳注入探针键：MISS → 写入 → HIT → If-None-Match→304，回报中文 HIT/MISS/304。
 * 不走真实出网；可选 rounds（默认 3）。
 */
export function probeInboxDeltaHitAfterHeal(
  opts: {
    shells?: string[] | null;
    rounds?: number;
    tenantId?: string | null;
    /** 探测后是否保留探针键；默认清掉以免污染业务键 */
    keepProbeKeys?: boolean;
    /** M68：标记为二次 bust 后的复探针点（写入趋势） */
    afterRebust?: boolean;
  } = {},
) {
  const shells = [...new Set((opts.shells || []).map(String).filter(Boolean))];
  const rounds = Math.max(2, Math.min(6, Number(opts.rounds) || 3));
  const tenantId = opts.tenantId || 'default';
  const keep = opts.keepProbeKeys === true;
  if (!shells.length) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M68',
      shells: [] as string[],
      rounds: 0,
      samples: [] as any[],
      totals: { HIT: 0, MISS: 0, NOT_MODIFIED: 0, BYPASS: 0 },
      tipZh: '无壳可探测；跳过 HIT 探针。',
      toastZh: '无壳，跳过 HIT 探测',
      summaryZh: '自愈后 HIT 探测：无壳。',
    };
  }

  const samples: Array<{
    shell: string;
    round: number;
    kind: InboxDeltaKind;
    kindZh: string;
    etag?: string;
    timingMs: number;
  }> = [];
  const totals = { HIT: 0, MISS: 0, NOT_MODIFIED: 0, BYPASS: 0 };
  const kindZhMap: Record<InboxDeltaKind, string> = {
    HIT: '命中 HIT',
    MISS: '未命中 MISS',
    NOT_MODIFIED: '未修改 304',
    BYPASS: '绕过 BYPASS',
  };
  const probeKeys: string[] = [];

  for (const shell of shells) {
    const probeKey = `probe::m67::${shell}::${tenantId}::heal`;
    probeKeys.push(probeKey);
    // 确保起点干净（模拟 bust 后）
    store.delete(probeKey);
    let lastEtag: string | null = null;
    for (let r = 1; r <= rounds; r++) {
      const t0 = Date.now();
      const hit = getInboxDeltaCache(probeKey);
      const now = Date.now();
      let kind: InboxDeltaKind;
      let etag: string | undefined;
      if (hit && now - hit.at < inboxDeltaTtlMs()) {
        etag = hit.etag;
        if (lastEtag && lastEtag === hit.etag && r >= 3) {
          kind = 'NOT_MODIFIED';
          recordInboxDeltaCache('NOT_MODIFIED', shell);
        } else {
          kind = 'HIT';
          recordInboxDeltaCache('HIT', shell);
          lastEtag = hit.etag;
        }
      } else {
        kind = 'MISS';
        recordInboxDeltaCache('MISS', shell);
        etag =
          'W/"probe-' +
          shell +
          '-' +
          Math.abs(hashStr(probeKey + ':' + r)).toString(16).slice(0, 10) +
          '"';
        setInboxDeltaCache(probeKey, {
          at: Date.now(),
          body: {
            tipZh: `M67 干跑探针壳「${shell}」`,
            probe: true,
            wave: 'M68',
            added: [],
            updated: [],
            removedIds: [],
          },
          etag,
          key: probeKey,
          shell,
          tenantId,
        });
        lastEtag = etag;
      }
      totals[kind] += 1;
      samples.push({
        shell,
        round: r,
        kind,
        kindZh: kindZhMap[kind],
        etag,
        timingMs: Math.max(0, Date.now() - t0),
      });
    }
  }

  if (!keep) {
    for (const k of probeKeys) store.delete(k);
  }

  const hitN = totals.HIT + totals.NOT_MODIFIED;
  const denom = totals.HIT + totals.MISS + totals.NOT_MODIFIED + totals.BYPASS;
  const hitRate = denom ? Math.round((hitN / denom) * 1000) / 10 : null;
  const summaryZh =
    `自愈后 HIT 探测（干跑）：壳 ${shells.join('、')} · ${rounds} 轮/壳 → ` +
    `HIT ${totals.HIT} · 304 ${totals.NOT_MODIFIED} · MISS ${totals.MISS}` +
    (hitRate != null ? ` · 有效命中 ${hitRate}%` : '') +
    '。不真外发。';
  const healthScore =
    hitRate == null ? null : Math.max(0, Math.min(100, Math.round(hitRate)));
  const healthZh =
    hitRate == null
      ? '样本不足'
      : hitRate >= 60
        ? `分壳健康分 ${Math.round(hitRate)}（良好）`
        : hitRate >= 35
          ? `分壳健康分 ${Math.round(hitRate)}（一般，继续观察）`
          : `分壳健康分 ${Math.round(hitRate)}（偏低，请少用 fresh=1）`;
  const probeFailed = hitRate != null && hitRate < 35;
  const sustainedMiss = totals.MISS > totals.HIT + totals.NOT_MODIFIED;
  const probedAt = new Date().toISOString();
  try {
    persistInboxShellHealth(tenantId, {
      shells,
      hitRatePct: hitRate,
      healthScore,
      totals,
      probedAt,
      wave: 'M76',
      afterRebust: opts.afterRebust === true,
    });
  } catch (_) {}
  try {
    const health = readInboxShellHealth(tenantId);
    const day = dayKeyFromIso(probedAt);
    health.lastProbeSamples = {
      at: probedAt,
      day,
      shells,
      hitRatePct: hitRate,
      totals,
      samples: samples.slice(0, 48),
      summaryZh,
      afterRebust: opts.afterRebust === true,
    };
    health.updatedAt = probedAt;
    health.wave = 'M76';
    const p = shellHealthPath(tenantId);
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M76',
    shells,
    rounds,
    samples,
    totals,
    hitRatePct: hitRate,
    tipZh: summaryZh,
    summaryZh,
    healthScore,
    healthZh,
    probeFailed,
    sustainedMiss,
    shellHealthPersisted: true,
    shellHealthPath: shellHealthPath(tenantId),
    afterRebust: opts.afterRebust === true,
    toastZh: opts.afterRebust
      ? `复探针（二次 bust 后）：HIT ${totals.HIT} / 304 ${totals.NOT_MODIFIED} / MISS ${totals.MISS}`
      : `HIT 探测：HIT ${totals.HIT} / 304 ${totals.NOT_MODIFIED} / MISS ${totals.MISS}`,
  };
}

/** M67/M68：租户隔离分壳健康文件路径 .data/tenants/<tenant>/inbox-shell-health.json */
function shellHealthPath(tenantId: string) {
  const safe = String(tenantId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'default';
  return join(process.cwd(), '.data', 'tenants', safe, 'inbox-shell-health.json');
}

export type InboxShellHealthTrendPoint = {
  at: string;
  hitRatePct: number | null;
  HIT: number;
  MISS: number;
  NOT_MODIFIED: number;
  BYPASS?: number;
  afterRebust?: boolean;
};

export type InboxShellRecoverySla = {
  startedAt: string | null;
  recoveredAt: string | null;
  deadlineAt: string | null;
  windowMs: number;
  status: 'idle' | 'pending' | 'recovered' | 'breached';
  timeToRecoverMs: number | null;
  tipZh: string;
};

export type InboxShellHealthRecord = {
  updatedAt: string;
  wave: string;
  byShell: Record<
    string,
    {
      hitRatePct: number | null;
      healthScore: number | null;
      lastProbeAt: string;
      totals?: { HIT: number; MISS: number; NOT_MODIFIED: number; BYPASS: number };
      lastRebustAt?: string | null;
      rebustCount?: number;
      /** M68：短 HIT/MISS 趋势（最近约 12 点） */
      trend?: InboxShellHealthTrendPoint[];
      lastReprobeAt?: string | null;
      reprobeCount?: number;
      /** M70：拐点后建议 bust */
      suggestedBust?: boolean;
      suggestedBustAt?: string | null;
      suggestedBustReasonZh?: string | null;
      /** M70：回升 SLA 窗口 */
      recoverySla?: InboxShellRecoverySla | null;
      /** M74：按日聚合的周 HIT 火花图（约 7 天） */
      weeklySparkline?: InboxShellWeeklySparkPoint[];
    }
  >;
  /** M70：最近一次拐点建议 bust 摘要 */
  lastSuggestedBust?: {
    at: string;
    shells: string[];
    tipZh: string;
    toastZh: string;
  } | null;
  /** M74：串联自愈后 SLA 重开摘要 */
  lastSlaReopenAfterChainHeal?: {
    at: string;
    shells: string[];
    tipZh: string;
    toastZh: string;
    windowMs: number;
  } | null;
  /** M76：最近探针样本（供日点注解钻取） */
  lastProbeSamples?: {
    at: string;
    day: string;
    shells: string[];
    hitRatePct: number | null;
    totals: { HIT: number; MISS: number; NOT_MODIFIED: number; BYPASS: number };
    samples: Array<{
      shell: string;
      round: number;
      kind: string;
      kindZh: string;
      etag?: string;
      timingMs: number;
    }>;
    summaryZh: string;
    afterRebust?: boolean;
  } | null;
};

/** M74/M75：壳健康周 HIT 火花图日点（含日点注解） */
export type InboxShellWeeklySparkAnnotation = {
  kind: string;
  kindZh: string;
  at: string;
  tipZh: string;
  hitRatePct?: number | null;
};

export type InboxShellWeeklySparkPoint = {
  day: string; // YYYY-MM-DD
  hitRatePct: number | null;
  HIT: number;
  MISS: number;
  NOT_MODIFIED: number;
  samples: number;
  spark: string; // 单日字符强度
  /** M75：日点注解（HIT%/事件） */
  annotations?: InboxShellWeeklySparkAnnotation[];
  eventZh?: string | null;
};

export function readInboxShellHealth(tenantId?: string | null): InboxShellHealthRecord {
  const p = shellHealthPath(tenantId || 'default');
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      return {
        updatedAt: raw.updatedAt || new Date().toISOString(),
        wave: raw.wave || 'M75',
        byShell: raw.byShell && typeof raw.byShell === 'object' ? raw.byShell : {},
        lastSuggestedBust: raw.lastSuggestedBust || null,
        lastSlaReopenAfterChainHeal: raw.lastSlaReopenAfterChainHeal || null,
        lastProbeSamples: raw.lastProbeSamples || null,
      };
    }
  } catch (_) {}
  return {
    updatedAt: new Date().toISOString(),
    wave: 'M76',
    byShell: {},
    lastSuggestedBust: null,
    lastSlaReopenAfterChainHeal: null,
    lastProbeSamples: null,
  };
}

export function persistInboxShellHealth(
  tenantId: string | null | undefined,
  probe: {
    shells: string[];
    hitRatePct: number | null;
    healthScore: number | null;
    totals: { HIT: number; MISS: number; NOT_MODIFIED: number; BYPASS: number };
    probedAt: string;
    wave?: string;
    /** M68：二次 bust 后的复探针点 */
    afterRebust?: boolean;
  },
) {
  const tid = tenantId || 'default';
  const p = shellHealthPath(tid);
  const dir = join(
    process.cwd(),
    '.data',
    'tenants',
    String(tid).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'default',
  );
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cur = readInboxShellHealth(tid);
  const now = probe.probedAt || new Date().toISOString();
  const afterRebust = (probe as any).afterRebust === true;
  for (const shell of probe.shells) {
    const prev = cur.byShell[shell] || ({} as any);
    const point: InboxShellHealthTrendPoint = {
      at: now,
      hitRatePct: probe.hitRatePct,
      HIT: Number(probe.totals?.HIT) || 0,
      MISS: Number(probe.totals?.MISS) || 0,
      NOT_MODIFIED: Number(probe.totals?.NOT_MODIFIED) || 0,
      BYPASS: Number(probe.totals?.BYPASS) || 0,
      afterRebust,
    };
    const trend: InboxShellHealthTrendPoint[] = Array.isArray(prev.trend) ? [...prev.trend] : [];
    trend.push(point);
    while (trend.length > 12) trend.shift();
    const weeklySparkline = upsertShellWeeklySparkline(prev.weeklySparkline, {
      at: now,
      hitRatePct: probe.hitRatePct,
      HIT: Number(probe.totals?.HIT) || 0,
      MISS: Number(probe.totals?.MISS) || 0,
      NOT_MODIFIED: Number(probe.totals?.NOT_MODIFIED) || 0,
    });
    // M75：探针日点注解
    const sparkList = Array.isArray(weeklySparkline) ? [...weeklySparkline] : [];
    try {
      const day = dayKeyFromIso(now);
      let idx = sparkList.findIndex((d) => d.day === day);
      if (idx < 0) {
        sparkList.push({
          day,
          hitRatePct: probe.hitRatePct,
          HIT: Number(probe.totals?.HIT) || 0,
          MISS: Number(probe.totals?.MISS) || 0,
          NOT_MODIFIED: Number(probe.totals?.NOT_MODIFIED) || 0,
          samples: 1,
          spark: sparkCharFromHit(probe.hitRatePct),
          annotations: [],
          eventZh: null,
        });
        idx = sparkList.length - 1;
      }
      const curDay = sparkList[idx];
      const anns = Array.isArray(curDay.annotations) ? [...curDay.annotations] : [];
      anns.push({
        kind: afterRebust ? 'reprobe' : 'probe',
        kindZh: afterRebust ? '复探针' : 'HIT探针',
        at: now,
        tipZh:
          (afterRebust ? '复探针' : 'HIT探针') +
          (probe.hitRatePct != null ? ` · HIT ${probe.hitRatePct}%` : ''),
        hitRatePct: probe.hitRatePct,
      });
      while (anns.length > 8) anns.shift();
      sparkList[idx] = {
        ...curDay,
        annotations: anns,
        eventZh:
          (afterRebust ? '复探针' : 'HIT探针') +
          (probe.hitRatePct != null ? ` · HIT ${probe.hitRatePct}%` : ''),
      };
    } catch (_) {}
    cur.byShell[shell] = {
      hitRatePct: probe.hitRatePct,
      healthScore: probe.healthScore,
      lastProbeAt: now,
      totals: { ...probe.totals },
      lastRebustAt: prev.lastRebustAt || null,
      rebustCount: Number(prev.rebustCount) || 0,
      trend,
      lastReprobeAt: afterRebust ? now : prev.lastReprobeAt || null,
      reprobeCount: afterRebust
        ? (Number(prev.reprobeCount) || 0) + 1
        : Number(prev.reprobeCount) || 0,
      recoverySla: prev.recoverySla || null,
      suggestedBust: prev.suggestedBust,
      suggestedBustAt: prev.suggestedBustAt,
      suggestedBustReasonZh: prev.suggestedBustReasonZh,
      weeklySparkline: sparkList,
    };
  }
  cur.updatedAt = now;
  cur.wave = probe.wave || 'M75';
  writeFileSync(p, JSON.stringify(cur, null, 0), 'utf8');
  return { ok: true, path: p, shells: probe.shells, wave: 'M75', trendAppended: true, weeklySparklineUpdated: true };
}

/**
 * M67/M68：探针失败时干跑二次 bust 一次；M68 建议随后自动复探针并写入趋势；不真外发。
 */
export function maybeRebustAfterProbeFail(
  opts: {
    shells?: string[] | null;
    tenantId?: string | null;
    hitProbe?: {
      hitRatePct?: number | null;
      probeFailed?: boolean;
      sustainedMiss?: boolean;
      totals?: { HIT: number; MISS: number; NOT_MODIFIED: number; BYPASS: number };
    } | null;
    force?: boolean;
  } = {},
) {
  const shells = [...new Set((opts.shells || []).map(String).filter(Boolean))];
  const tenantId = opts.tenantId || 'default';
  const probe = opts.hitProbe || {};
  const failed =
    opts.force === true ||
    probe.probeFailed === true ||
    probe.sustainedMiss === true ||
    (probe.hitRatePct != null && Number(probe.hitRatePct) < 35);
  if (!shells.length) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M71',
      didRebust: false,
      shells: [] as string[],
      tipZh: '无壳，跳过二次 bust。',
      toastZh: '无壳，跳过二次 bust',
    };
  }
  if (!failed) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M71',
      didRebust: false,
      shells,
      tipZh: '探针健康尚可，无需二次 bust。',
      toastZh: '探针正常，未二次 bust',
    };
  }
  const health = readInboxShellHealth(tenantId);
  const eligible: string[] = [];
  for (const shell of shells) {
    const row = health.byShell[shell];
    const count = Number(row?.rebustCount) || 0;
    if (count >= 1 && row?.lastRebustAt) {
      const age = Date.now() - Date.parse(row.lastRebustAt);
      if (Number.isFinite(age) && age < 10 * 60 * 1000) continue;
    }
    eligible.push(shell);
  }
  if (!eligible.length) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M71',
      didRebust: false,
      shells,
      skippedRecent: true,
      tipZh: '探针偏低，但近 10 分钟已做过二次干跑 bust，跳过。',
      toastZh: '二次 bust 已跳过（近期做过）',
    };
  }
  const bust = eligible.map((shell) => bustInboxDeltaCache({ shell }));
  const clearedKeys = bust.reduce((n, r) => n + (Number(r.clearedKeys) || 0), 0);
  const now = new Date().toISOString();
  for (const shell of eligible) {
    const prev = health.byShell[shell] || {
      hitRatePct: probe.hitRatePct ?? null,
      healthScore: null,
      lastProbeAt: now,
      rebustCount: 0,
    };
    health.byShell[shell] = {
      ...prev,
      lastRebustAt: now,
      rebustCount: (Number(prev.rebustCount) || 0) + 1,
      hitRatePct: probe.hitRatePct ?? prev.hitRatePct ?? null,
      lastProbeAt: prev.lastProbeAt || now,
    };
  }
  health.updatedAt = now;
  health.wave = 'M72';
  try {
    const p = shellHealthPath(tenantId);
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  const tipZh =
    `探针持续偏低：已对「${eligible.join('、')}」干跑二次 bust（清 ${clearedKeys} 键）；将自动复探针一次。不真外发。`;
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M71',
    didRebust: true,
    shells: eligible,
    bust,
    clearedKeys,
    reProbeSuggested: true,
    tipZh,
    toastZh: `探针失败 · 已二次干跑 bust：${eligible.join('、')} · 将复探针`,
    selfHealHintsZh: [tipZh, '仍干跑、无外发；二次 bust 后自动复探针更新健康趋势。'],
  };
}



function dayKeyFromIso(iso: string) {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return new Date().toISOString().slice(0, 10);
    // Asia/Shanghai day bucket (UTC+8)
    const sh = new Date(d.getTime() + 8 * 3600_000);
    return sh.toISOString().slice(0, 10);
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

function sparkCharFromHit(pct: number | null) {
  if (pct == null || !Number.isFinite(pct)) return '·';
  if (pct >= 80) return '█';
  if (pct >= 60) return '▇';
  if (pct >= 45) return '▅';
  if (pct >= 30) return '▃';
  if (pct >= 15) return '▂';
  return '▁';
}

/** M74：把探针点并入按日周火花图（最多 7 天） */
export function upsertShellWeeklySparkline(
  prev: InboxShellWeeklySparkPoint[] | undefined,
  point: { at: string; hitRatePct: number | null; HIT: number; MISS: number; NOT_MODIFIED: number },
): InboxShellWeeklySparkPoint[] {
  const day = dayKeyFromIso(point.at);
  const list: InboxShellWeeklySparkPoint[] = Array.isArray(prev) ? [...prev] : [];
  const idx = list.findIndex((p) => p.day === day);
  const HIT = Number(point.HIT) || 0;
  const MISS = Number(point.MISS) || 0;
  const NOT_MODIFIED = Number(point.NOT_MODIFIED) || 0;
  if (idx >= 0) {
    const cur = list[idx];
    const samples = (Number(cur.samples) || 0) + 1;
    const hitRatePct =
      point.hitRatePct != null && Number.isFinite(point.hitRatePct)
        ? Math.round(
            (((Number(cur.hitRatePct) || 0) * (samples - 1) + Number(point.hitRatePct)) / samples) * 10,
          ) / 10
        : cur.hitRatePct;
    const ann = Array.isArray(cur.annotations) ? [...cur.annotations] : [];
    list[idx] = {
      day,
      hitRatePct,
      HIT: (Number(cur.HIT) || 0) + HIT,
      MISS: (Number(cur.MISS) || 0) + MISS,
      NOT_MODIFIED: (Number(cur.NOT_MODIFIED) || 0) + NOT_MODIFIED,
      samples,
      spark: sparkCharFromHit(hitRatePct),
      annotations: ann,
      eventZh: cur.eventZh || null,
    };
  } else {
    list.push({
      day,
      hitRatePct: point.hitRatePct,
      HIT,
      MISS,
      NOT_MODIFIED,
      samples: 1,
      spark: sparkCharFromHit(point.hitRatePct),
      annotations: [],
      eventZh: null,
    });
  }
  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  while (list.length > 7) list.shift();
  return list;
}

/** M74/M75：周火花图中文摘要 + ASCII + 日点注解 */
export function inboxShellWeeklySparklineSummary(health: InboxShellHealthRecord): {
  ok: true;
  wave: string;
  byShell: Record<
    string,
    {
      sparkline: string;
      days: InboxShellWeeklySparkPoint[];
      dayAnnotations: Array<{
        day: string;
        hitRatePct: number | null;
        spark: string;
        eventZh: string | null;
        annotations: InboxShellWeeklySparkAnnotation[];
        tipZh: string;
      }>;
      tipZh: string;
      labelZh: string;
    }
  >;
  tipZh: string;
  toastZh: string;
  labelZh: string;
  dayAnnotationsLabelZh: string;
  dayDrillLabelZh?: string;
  dayDrillPath?: string;
} {
  const byShell: Record<
    string,
    {
      sparkline: string;
      days: InboxShellWeeklySparkPoint[];
      dayAnnotations: Array<{
        day: string;
        hitRatePct: number | null;
        spark: string;
        eventZh: string | null;
        annotations: InboxShellWeeklySparkAnnotation[];
        tipZh: string;
      }>;
      tipZh: string;
      labelZh: string;
    }
  > = {};
  const parts: string[] = [];
  for (const [shell, row] of Object.entries(health.byShell || {})) {
    const days = Array.isArray(row?.weeklySparkline) ? row.weeklySparkline : [];
    const sparkline = days.map((d) => d.spark || sparkCharFromHit(d.hitRatePct)).join('') || '·······';
    const last = days[days.length - 1];
    const dayAnnotations = days.map((d) => {
      const anns = Array.isArray(d.annotations) ? d.annotations : [];
      const eventZh =
        d.eventZh ||
        (anns.length
          ? anns[anns.length - 1].kindZh + (d.hitRatePct != null ? ` · HIT ${d.hitRatePct}%` : '')
          : null);
      const tipZh =
        `${d.day} ${d.spark || sparkCharFromHit(d.hitRatePct)}` +
        (d.hitRatePct != null ? ` · HIT ${d.hitRatePct}%` : '') +
        (eventZh ? ` · ${eventZh}` : anns.length ? ` · 事件 ${anns.length}` : ' · 无注解');
      return {
        day: d.day,
        hitRatePct: d.hitRatePct,
        spark: d.spark || sparkCharFromHit(d.hitRatePct),
        eventZh,
        annotations: anns,
        tipZh,
      };
    });
    const annHint = dayAnnotations.filter((d) => d.annotations.length || d.eventZh).slice(-2);
    const tipZh = days.length
      ? `${shell} 周火花图 ${sparkline}（${days[0].day}~${days[days.length - 1].day}` +
        (last?.hitRatePct != null ? ` · 末日命中 ${last.hitRatePct}%` : '') +
        (annHint.length
          ? ` · 注解 ${annHint.map((a) => a.day + (a.eventZh ? '/' + a.eventZh : '')).join('、')}`
          : '') +
        `）`
      : `${shell}：尚无周火花图样本`;
    byShell[shell] = {
      sparkline,
      days,
      dayAnnotations,
      tipZh,
      labelZh: '分壳周 HIT 火花图（含日点注解）',
    };
    if (parts.length < 8) parts.push(tipZh);
  }
  const tipZh = parts.length
    ? '分壳周 HIT 火花图（日点注解）：' + parts.join('；')
    : '暂无分壳周火花图样本（干跑探针后落盘）。';
  return {
    ok: true,
    wave: 'M76',
    byShell,
    tipZh,
    toastZh: parts.length ? `周火花图 · ${Object.keys(byShell).length} 壳（含日点注解）` : '周火花图暂无样本',
    labelZh: '分壳周 HIT 火花图',
    dayAnnotationsLabelZh: '周火花图日点注解',
    dayDrillLabelZh: '日点注解钻取探针样本',
    dayDrillPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill',
  };
}

/** M75：给某壳某日火花点追加事件注解（HIT%/事件） */
export function annotateShellWeeklySparkDay(
  tenantId: string | null | undefined,
  opts: {
    shells?: string[] | null;
    shell?: string | null;
    kind: string;
    kindZh: string;
    tipZh?: string;
    hitRatePct?: number | null;
    at?: string;
  },
) {
  const tid = tenantId || 'default';
  const health = readInboxShellHealth(tid);
  const now = opts.at || new Date().toISOString();
  const day = dayKeyFromIso(now);
  const shells = [
    ...new Set(
      [
        ...(Array.isArray(opts.shells) ? opts.shells : []),
        ...(opts.shell ? [String(opts.shell)] : []),
      ]
        .map(String)
        .filter(Boolean),
    ),
  ];
  const target = shells.length ? shells : Object.keys(health.byShell || {});
  const annotated: string[] = [];
  for (const shell of target) {
    const prev = health.byShell[shell];
    if (!prev) continue;
    const list: InboxShellWeeklySparkPoint[] = Array.isArray(prev.weeklySparkline)
      ? [...prev.weeklySparkline]
      : [];
    let idx = list.findIndex((p) => p.day === day);
    if (idx < 0) {
      list.push({
        day,
        hitRatePct: opts.hitRatePct != null ? opts.hitRatePct : prev.hitRatePct,
        HIT: 0,
        MISS: 0,
        NOT_MODIFIED: 0,
        samples: 0,
        spark: sparkCharFromHit(opts.hitRatePct != null ? opts.hitRatePct : prev.hitRatePct),
        annotations: [],
        eventZh: null,
      });
      idx = list.length - 1;
    }
    const cur = list[idx];
    const anns = Array.isArray(cur.annotations) ? [...cur.annotations] : [];
    anns.push({
      kind: opts.kind,
      kindZh: opts.kindZh,
      at: now,
      tipZh: opts.tipZh || opts.kindZh,
      hitRatePct: opts.hitRatePct != null ? opts.hitRatePct : cur.hitRatePct,
    });
    while (anns.length > 8) anns.shift();
    const eventZh =
      opts.kindZh +
      (opts.hitRatePct != null
        ? ` · HIT ${opts.hitRatePct}%`
        : cur.hitRatePct != null
          ? ` · HIT ${cur.hitRatePct}%`
          : '');
    list[idx] = {
      ...cur,
      annotations: anns,
      eventZh,
      hitRatePct: opts.hitRatePct != null ? opts.hitRatePct : cur.hitRatePct,
      spark: sparkCharFromHit(opts.hitRatePct != null ? opts.hitRatePct : cur.hitRatePct),
    };
    list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    while (list.length > 7) list.shift();
    health.byShell[shell] = { ...prev, weeklySparkline: list };
    annotated.push(shell);
  }
  health.updatedAt = now;
  health.wave = 'M76';
  try {
    const path = shellHealthPath(tid);
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M76',
    shells: annotated,
    day,
    tipZh: annotated.length
      ? `已注解日点 ${day}「${opts.kindZh}」于 ${annotated.join('、')}`
      : '无壳可注解日点',
    toastZh: annotated.length ? `日点注解 · ${opts.kindZh}` : '日点注解未写入',
    labelZh: '周火花图日点注解',
  };
}

/** M74/M75：串联自愈后重开/重置回升 SLA 窗口（带冷却，防 thrash） */
export function reopenRecoverySlaAfterChainHeal(
  tenantId: string | null | undefined,
  opts: {
    shells?: string[] | null;
    windowMs?: number;
    force?: boolean;
    ignoreCooldown?: boolean;
    annotateSpark?: boolean;
  } = {},
) {
  const tid = tenantId || 'default';
  const health = readInboxShellHealth(tid);
  const windowMs = Math.max(
    60_000,
    Number(opts.windowMs ?? (process.env.INBOX_SHELL_RECOVERY_SLA_MS || 15 * 60_000)) || 15 * 60_000,
  );
  const cooldownMs = Math.max(
    0,
    Number(process.env.INBOX_SHELL_SLA_REOPEN_COOLDOWN_MS || 5 * 60_000) || 5 * 60_000,
  );
  const shells = [
    ...new Set(
      (opts.shells && opts.shells.length
        ? opts.shells
        : Object.keys(health.byShell || {})
      )
        .map(String)
        .filter(Boolean),
    ),
  ];
  const now = new Date().toISOString();
  const last = (health as any).lastSlaReopenAfterChainHeal;
  const lastAtMs = last?.at ? Date.parse(String(last.at)) : NaN;
  const sinceLast = Number.isFinite(lastAtMs) ? Date.now() - lastAtMs : Number.POSITIVE_INFINITY;
  const cooled =
    !opts.force &&
    !opts.ignoreCooldown &&
    cooldownMs > 0 &&
    sinceLast < cooldownMs;
  if (cooled) {
    const remainMs = Math.max(0, cooldownMs - sinceLast);
    const tipZh =
      `SLA 重开冷却中：距上次重开约 ${Math.round(sinceLast / 1000)} 秒，还需等待约 ${Math.round(remainMs / 1000)} 秒（冷却 ${Math.round(cooldownMs / 1000)} 秒）。干跑、无外发，防 thrash。`;
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M76',
      cooled: true,
      cooldownMs,
      remainMs,
      sinceLastMs: sinceLast,
      shells: [] as string[],
      windowMs,
      tipZh,
      toastZh: `SLA 重开冷却中 · 约 ${Math.round(remainMs / 1000)} 秒`,
      shellHealth: health,
      labelZh: '串联自愈后回升 SLA 重开（冷却）',
      cooldownTipZh: tipZh,
    };
  }
  const reopened: string[] = [];
  for (const shell of shells) {
    const prev = health.byShell[shell];
    if (!prev) continue;
    const sla: InboxShellRecoverySla = {
      startedAt: now,
      recoveredAt: null,
      deadlineAt: new Date(Date.now() + windowMs).toISOString(),
      windowMs,
      status: 'pending',
      timeToRecoverMs: null,
      tipZh: `【M75】串联自愈后回升 SLA 已重开：${Math.round(windowMs / 60000)} 分钟内复探针回升即记 recovered；冷却 ${Math.round(cooldownMs / 1000)} 秒防 thrash。`,
    };
    health.byShell[shell] = { ...prev, recoverySla: sla };
    reopened.push(shell);
  }
  const tipZh = reopened.length
    ? `串联自愈后已重开回升 SLA「${reopened.join('、')}」（窗口 ${Math.round(windowMs / 60000)} 分钟 · 冷却 ${Math.round(cooldownMs / 1000)} 秒）。干跑、无外发。`
    : '无壳可重开回升 SLA。';
  (health as any).lastSlaReopenAfterChainHeal = {
    at: now,
    shells: reopened,
    tipZh,
    toastZh: reopened.length ? `SLA 已重开 · ${reopened.join('、')}` : 'SLA 未重开',
    windowMs,
    cooldownMs,
  };
  health.updatedAt = now;
  health.wave = 'M76';
  try {
    const path = shellHealthPath(tid);
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  let sparkAnnotate: any = null;
  if (opts.annotateSpark !== false && reopened.length) {
    try {
      sparkAnnotate = annotateShellWeeklySparkDay(tid, {
        shells: reopened,
        kind: 'sla-reopen',
        kindZh: 'SLA重开',
        tipZh: `回升 SLA 重开（窗口 ${Math.round(windowMs / 60000)} 分钟）`,
        at: now,
      });
    } catch (_) {}
  }
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M76',
    cooled: false,
    cooldownMs,
    remainMs: 0,
    shells: reopened,
    windowMs,
    tipZh,
    toastZh: reopened.length ? `SLA 已重开 · ${reopened.join('、')}` : 'SLA 未重开',
    shellHealth: readInboxShellHealth(tid),
    labelZh: '串联自愈后回升 SLA 重开',
    sparkDayAnnotation: sparkAnnotate,
  };
}


/** M68/M69：壳健康短趋势摘要（中文） */
export function inboxShellHealthTrendSummaryZh(health: InboxShellHealthRecord): string {
  const shells = Object.keys(health.byShell || {});
  if (!shells.length) return '暂无分壳健康趋势样本。';
  const parts: string[] = [];
  for (const shell of shells.slice(0, 8)) {
    const row = health.byShell[shell];
    const trend = Array.isArray(row?.trend) ? row.trend : [];
    if (!trend.length) {
      parts.push(`${shell}：尚无趋势点（命中 ${row?.hitRatePct ?? '—'}%）`);
      continue;
    }
    const last3 = trend.slice(-3).map((p) => (p.hitRatePct != null ? `${p.hitRatePct}%` : '—')).join('→');
    const after = trend.filter((p) => p.afterRebust).length;
    parts.push(
      `${shell}：近${Math.min(3, trend.length)}点 ${last3}` +
        (row?.hitRatePct != null ? ` · 当前 ${row.hitRatePct}%` : '') +
        (after ? ` · 复探针点 ${after}` : ''),
    );
  }
  return '分壳 HIT/MISS 短趋势：' + parts.join('；');
}

/**
 * M69：检测壳 HIT 趋势持续下行拐点（至少 4 个有效点、近段均值低于前段且末点下滑）。
 * 仅干跑告警，不扩张导出/SSE/配额。
 */
export function detectShellTrendInflection(health: InboxShellHealthRecord): {
  ok: true;
  wave: string;
  alerting: boolean;
  shells: Array<{
    shell: string;
    inflection: boolean;
    direction: 'down' | 'flat' | 'up' | 'unknown';
    beforeAvgPct: number | null;
    afterAvgPct: number | null;
    lastPct: number | null;
    dropPct: number | null;
    points: number;
    tipZh: string;
  }>;
  suggestedBustShells: string[];
  suggestBustTipZh: string;
  messageZh: string;
  tipZh: string;
  toastZh: string;
  dualChannelHintZh: string;
} {
  const out: Array<{
    shell: string;
    inflection: boolean;
    direction: 'down' | 'flat' | 'up' | 'unknown';
    beforeAvgPct: number | null;
    afterAvgPct: number | null;
    lastPct: number | null;
    dropPct: number | null;
    points: number;
    tipZh: string;
  }> = [];
  const minPts = Math.max(4, Number(process.env.INBOX_SHELL_INFLECTION_MIN_POINTS) || 4);
  const dropMin = Math.max(3, Number(process.env.INBOX_SHELL_INFLECTION_DROP_PCT) || 8);
  for (const shell of Object.keys(health.byShell || {})) {
    const trend = Array.isArray(health.byShell[shell]?.trend) ? health.byShell[shell].trend! : [];
    const rates = trend
      .map((p) => (p.hitRatePct != null && Number.isFinite(Number(p.hitRatePct)) ? Number(p.hitRatePct) : null))
      .filter((x): x is number => x != null);
    if (rates.length < minPts) {
      out.push({
        shell,
        inflection: false,
        direction: 'unknown',
        beforeAvgPct: null,
        afterAvgPct: null,
        lastPct: rates.length ? rates[rates.length - 1] : null,
        dropPct: null,
        points: rates.length,
        tipZh: `${shell}：趋势点不足 ${rates.length}/${minPts}，暂不判拐点`,
      });
      continue;
    }
    const half = Math.floor(rates.length / 2);
    const before = rates.slice(0, half);
    const after = rates.slice(half);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
    const beforeAvg = Math.round(avg(before) * 10) / 10;
    const afterAvg = Math.round(avg(after) * 10) / 10;
    const last = rates[rates.length - 1];
    const prev = rates[rates.length - 2];
    const drop = Math.round((beforeAvg - afterAvg) * 10) / 10;
    const sustainedDown =
      afterAvg + 0.5 < beforeAvg &&
      drop >= dropMin &&
      last <= prev &&
      last + dropMin / 2 <= beforeAvg;
    const direction: 'down' | 'flat' | 'up' =
      afterAvg + 1 < beforeAvg ? 'down' : afterAvg > beforeAvg + 1 ? 'up' : 'flat';
    out.push({
      shell,
      inflection: sustainedDown,
      direction,
      beforeAvgPct: beforeAvg,
      afterAvgPct: afterAvg,
      lastPct: last,
      dropPct: drop,
      points: rates.length,
      tipZh: sustainedDown
        ? `${shell}：HIT 持续下行拐点（前均 ${beforeAvg}% → 近均 ${afterAvg}% · 末 ${last}% · 落 ${drop}pt）`
        : `${shell}：趋势${direction === 'up' ? '回升' : direction === 'down' ? '偏弱但未达拐点' : '平稳'}（前均 ${beforeAvg}% → 近均 ${afterAvg}% · 末 ${last}%）`,
    });
  }
  const alertingShells = out.filter((s) => s.inflection);
  const alerting = alertingShells.length > 0;
  const suggestedBustShells = alertingShells.map((s) => s.shell);
  const messageZh = alerting
    ? `壳 HIT 趋势拐点告警：${alertingShells.map((s) => s.tipZh).join('；')}`
    : out.length
      ? `壳 HIT 趋势未检出持续下行拐点（已看 ${out.length} 壳）。`
      : '暂无分壳趋势，无法判拐点。';
  const suggestZh = alerting
    ? `建议干跑 bust 壳：${suggestedBustShells.join('、')}（拐点后优先清这些壳短缓存）。`
    : '无需建议 bust。';
  return {
    ok: true,
    wave: 'M71',
    alerting,
    shells: out,
    suggestedBustShells,
    suggestBustTipZh: suggestZh,
    messageZh,
    tipZh: messageZh + (alerting ? ' ' + suggestZh : '') + ' 干跑双通道可带此文案；不真外发。',
    toastZh: alerting
      ? `拐点告警 · 建议 bust：${suggestedBustShells.join('、')}`
      : '趋势无持续下行拐点',
    dualChannelHintZh: 'POST .../inbox-delta-cache/curve/alerts/notify 可将拐点/建议 bust 文案写入双通道干跑草稿。',
  };
}

/**
 * M69：复探针后 HIT 回升判定（recovered / still-low）。
 */
export function judgeShellHitRecoveryAfterReprobe(opts: {
  beforeHitRatePct?: number | null;
  afterHitRatePct?: number | null;
  healthScore?: number | null;
  shell?: string | null;
  shells?: string[] | null;
  recoverMinPct?: number;
  stillLowBelowPct?: number;
}): {
  ok: true;
  wave: string;
  status: 'recovered' | 'still_low' | 'unknown';
  statusZh: string;
  beforeHitRatePct: number | null;
  afterHitRatePct: number | null;
  deltaPct: number | null;
  tipZh: string;
  toastZh: string;
} {
  const recoverMin = opts.recoverMinPct ?? Number(process.env.INBOX_SHELL_RECOVER_MIN_PCT || 35);
  const stillLow = opts.stillLowBelowPct ?? Number(process.env.INBOX_SHELL_STILL_LOW_PCT || 35);
  const before =
    opts.beforeHitRatePct != null && Number.isFinite(Number(opts.beforeHitRatePct))
      ? Number(opts.beforeHitRatePct)
      : null;
  const after =
    opts.afterHitRatePct != null && Number.isFinite(Number(opts.afterHitRatePct))
      ? Number(opts.afterHitRatePct)
      : null;
  const delta = before != null && after != null ? Math.round((after - before) * 10) / 10 : null;
  const shellLabel =
    (opts.shell && String(opts.shell)) ||
    (Array.isArray(opts.shells) && opts.shells.length ? opts.shells.join('、') : '相关壳');
  if (after == null) {
    return {
      ok: true,
      wave: 'M71',
      status: 'unknown',
      statusZh: '无法判定',
      beforeHitRatePct: before,
      afterHitRatePct: after,
      deltaPct: delta,
      tipZh: `复探针后缺少 HIT 率，暂无法判定「${shellLabel}」是否回升。`,
      toastZh: '复探针回升：无法判定',
    };
  }
  const recovered = after >= recoverMin && (before == null || after + 0.5 >= before);
  const still = after < stillLow;
  const status: 'recovered' | 'still_low' | 'unknown' = recovered ? 'recovered' : still ? 'still_low' : 'unknown';
  const statusZh = recovered ? '已回升' : still ? '仍偏低' : '持平/观察';
  const tipZh = recovered
    ? `复探针判定「${shellLabel}」已回升：HIT ${after}%` +
      (before != null ? `（较复探针前 ${before}%` + (delta != null ? ` · Δ${delta > 0 ? '+' : ''}${delta}pt` : '') + '）' : '')
    : still
      ? `复探针判定「${shellLabel}」仍偏低：HIT ${after}%` +
        (before != null ? `（前 ${before}%）` : '') +
        '；可再干跑自愈，不真外发。'
      : `复探针「${shellLabel}」HIT ${after}%` +
        (before != null ? `（前 ${before}%）` : '') +
        '，介于回升与偏低之间，继续观察。';
  return {
    ok: true,
    wave: 'M71',
    status,
    statusZh,
    beforeHitRatePct: before,
    afterHitRatePct: after,
    deltaPct: delta,
    tipZh,
    toastZh: `复探针${statusZh} · HIT ${after}%`,
  };
}


function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** 进程计数瞬时偏低（样本够才告） */
export function inboxDeltaCacheAlert() {
  const minRate = inboxDeltaHitRateMin();
  const minSamples = Math.max(5, Number(process.env.INBOX_DELTA_ALERT_MIN_SAMPLES) || 12);
  const denom = c.hits + c.misses;
  const hitRate = denom > 0 ? Math.round((c.hits / denom) * 1000) / 1000 : null;
  const sampleOk = denom >= minSamples;
  const low = sampleOk && hitRate != null && hitRate < minRate;
  return {
    enabled: true,
    wave: 'M71',
    threshold: minRate,
    thresholdPct: Math.round(minRate * 1000) / 10,
    minSamples,
    samples: denom,
    hitRate,
    hitRatePct: hitRate == null ? null : Math.round(hitRate * 1000) / 10,
    alerting: low,
    level: low ? ('warn' as const) : ('ok' as const),
    messageZh: low
      ? `收件箱 delta 短缓存命中率偏低：当前 ${Math.round((hitRate as number) * 1000) / 10}%（阈值 ${Math.round(minRate * 1000) / 10}%，样本 ${denom}）。`
      : sampleOk
        ? `收件箱 delta 命中率正常：${hitRate == null ? '—' : Math.round(hitRate * 1000) / 10}%（阈值 ${Math.round(minRate * 1000) / 10}%）。`
        : `收件箱 delta 样本不足（${denom}/${minSamples}），暂不告警。`,
  };
}


/** M70：拐点后写入建议 bust 壳，并可选开启回升 SLA 计时（干跑，无外发） */
export function applySuggestedBustAfterInflection(
  tenantId: string | null | undefined,
  inflection: ReturnType<typeof detectShellTrendInflection>,
  opts: { startSla?: boolean; windowMs?: number } = {},
) {
  const tid = tenantId || 'default';
  const shells = [...new Set((inflection.suggestedBustShells || []).map(String).filter(Boolean))];
  const health = readInboxShellHealth(tid);
  const now = new Date().toISOString();
  const windowMs = Math.max(
    60_000,
    Number(opts.windowMs ?? (process.env.INBOX_SHELL_RECOVERY_SLA_MS || 15 * 60_000)) || 15 * 60_000,
  );
  const startSla = opts.startSla !== false;
  for (const shell of shells) {
    const prev = health.byShell[shell] || {
      hitRatePct: null,
      healthScore: null,
      lastProbeAt: now,
    };
    const sla: InboxShellRecoverySla =
      startSla
        ? {
            startedAt: now,
            recoveredAt: null,
            deadlineAt: new Date(Date.now() + windowMs).toISOString(),
            windowMs,
            status: 'pending',
            timeToRecoverMs: null,
            tipZh: `回升 SLA 已开：${Math.round(windowMs / 60000)} 分钟内复探针回升即记 recovered。`,
          }
        : prev.recoverySla || {
            startedAt: null,
            recoveredAt: null,
            deadlineAt: null,
            windowMs,
            status: 'idle',
            timeToRecoverMs: null,
            tipZh: '回升 SLA 未启动',
          };
    health.byShell[shell] = {
      ...prev,
      suggestedBust: true,
      suggestedBustAt: now,
      suggestedBustReasonZh: inflection.shells.find((s) => s.shell === shell)?.tipZh || inflection.messageZh,
      recoverySla: sla,
    };
  }
  if (shells.length) {
    health.lastSuggestedBust = {
      at: now,
      shells,
      tipZh: inflection.suggestBustTipZh || `建议 bust：${shells.join('、')}`,
      toastZh: `建议 bust · ${shells.join('、')}`,
    };
  }
  health.updatedAt = now;
  health.wave = 'M73';
  try {
    const p = shellHealthPath(tid);
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M71',
    shells,
    suggestedBustShells: shells,
    tipZh: shells.length
      ? `拐点后建议 bust「${shells.join('、')}」已写入壳健康` +
        (startSla ? `；回升 SLA ${Math.round(windowMs / 60000)} 分钟已开。` : '。') +
        ' 干跑、无外发。'
      : '无拐点壳，未写入建议 bust。',
    toastZh: shells.length ? `建议 bust · ${shells.join('、')}` : '无建议 bust',
    recoverySlaWindowMs: windowMs,
    shellHealth: health,
  };
}

/** M70：复探针后结算回升 SLA（time-to-recovered / breached） */
export function settleShellRecoverySla(
  tenantId: string | null | undefined,
  opts: {
    shells?: string[] | null;
    recovery?: ReturnType<typeof judgeShellHitRecoveryAfterReprobe> | null;
  } = {},
) {
  const tid = tenantId || 'default';
  const health = readInboxShellHealth(tid);
  const shells = [
    ...new Set(
      (opts.shells && opts.shells.length
        ? opts.shells
        : Object.keys(health.byShell || {})
      ).map(String).filter(Boolean),
    ),
  ];
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const settled: Array<{
    shell: string;
    status: string;
    timeToRecoverMs: number | null;
    tipZh: string;
  }> = [];
  for (const shell of shells) {
    const row = health.byShell[shell];
    if (!row?.recoverySla || row.recoverySla.status === 'idle') continue;
    const sla = { ...row.recoverySla };
    const started = sla.startedAt ? Date.parse(sla.startedAt) : NaN;
    if (opts.recovery?.status === 'recovered' && Number.isFinite(started)) {
      sla.status = 'recovered';
      sla.recoveredAt = now;
      sla.timeToRecoverMs = Math.max(0, nowMs - started);
      sla.tipZh = `回升 SLA 达成：用时 ${Math.round((sla.timeToRecoverMs || 0) / 1000)}s（窗口 ${Math.round(sla.windowMs / 60000)} 分钟）。`;
    } else if (sla.status === 'pending' && sla.deadlineAt && Date.parse(sla.deadlineAt) < nowMs) {
      sla.status = 'breached';
      sla.tipZh = `回升 SLA 超时：截止 ${sla.deadlineAt} 仍未 recovered；可再干跑自愈。`;
    } else if (opts.recovery?.status === 'still_low' && sla.status === 'pending') {
      sla.tipZh = `回升 SLA 进行中：复探针仍偏低；截止 ${sla.deadlineAt || '—'}。`;
    }
    health.byShell[shell] = { ...row, recoverySla: sla };
    settled.push({
      shell,
      status: sla.status,
      timeToRecoverMs: sla.timeToRecoverMs,
      tipZh: sla.tipZh,
    });
  }
  health.updatedAt = now;
  health.wave = 'M72';
  try {
    const p = shellHealthPath(tid);
    writeFileSync(p, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  const tipZh = settled.length
    ? '回升 SLA：' + settled.map((s) => `${s.shell}=${s.status}`).join('；')
    : '无待结算的回升 SLA。';
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M71',
    settled,
    tipZh,
    toastZh: settled.some((s) => s.status === 'recovered')
      ? '回升 SLA 已达成'
      : settled.some((s) => s.status === 'breached')
        ? '回升 SLA 超时'
        : tipZh,
    shellHealth: health,
  };
}

/** M70：汇总建议 bust + SLA 给运营台 toast */
export function inboxShellSuggestedBustSummary(health: InboxShellHealthRecord): {
  shells: string[];
  tipZh: string;
  toastZh: string;
  recoverySlaZh: string;
} {
  const shells = Object.entries(health.byShell || {})
    .filter(([, v]) => v?.suggestedBust)
    .map(([k]) => k);
  const slaParts: string[] = [];
  for (const shell of shells.slice(0, 8)) {
    const sla = health.byShell[shell]?.recoverySla;
    if (!sla) continue;
    slaParts.push(
      `${shell}:${sla.status}` +
        (sla.timeToRecoverMs != null ? `(${Math.round(sla.timeToRecoverMs / 1000)}s)` : ''),
    );
  }
  const tipZh = shells.length
    ? `建议 bust 壳：${shells.join('、')}` +
      (health.lastSuggestedBust?.tipZh ? ` · ${health.lastSuggestedBust.tipZh}` : '')
    : '暂无建议 bust 壳。';
  return {
    shells,
    tipZh,
    toastZh: shells.length ? `建议 bust · ${shells.join('、')}` : '无建议 bust',
    recoverySlaZh: slaParts.length ? '回升 SLA：' + slaParts.join('；') : '回升 SLA：无进行中窗口',
  };
}


/** M76/M77：日点注解钻取到探针样本摘要；M77 支持多日对比（干跑、无外发） */
export function drillSparkDayAnnotationToProbeSamples(
  tenantId: string | null | undefined,
  opts: { shell?: string | null; day?: string | null; days?: string[] | null; multiDay?: boolean } = {},
) {
  const tid = tenantId || 'default';
  const health = readInboxShellHealth(tid);
  const spark = inboxShellWeeklySparklineSummary(health);
  const wantDays = [
    ...new Set(
      [
        ...(Array.isArray(opts.days) ? opts.days : []),
        ...(opts.day ? [opts.day] : []),
      ]
        .map((d) => String(d || '').slice(0, 10))
        .filter(Boolean),
    ),
  ];
  const wantDay = wantDays.length === 1 ? wantDays[0] : null;
  const multiDay = opts.multiDay === true || wantDays.length > 1;
  const wantShell = opts.shell ? String(opts.shell) : null;
  const dayRows: Array<{
    shell: string;
    day: string;
    hitRatePct: number | null;
    spark: string;
    eventZh: string | null;
    annotations: InboxShellWeeklySparkAnnotation[];
    tipZh: string;
  }> = [];
  for (const [shell, row] of Object.entries(spark.byShell || {})) {
    if (wantShell && shell !== wantShell) continue;
    for (const d of row.dayAnnotations || []) {
      if (wantDays.length && !wantDays.includes(d.day)) continue;
      if (!d.annotations?.length && !d.eventZh && wantDays.length === 0 && !multiDay) continue;
      dayRows.push({
        shell,
        day: d.day,
        hitRatePct: d.hitRatePct,
        spark: d.spark,
        eventZh: d.eventZh,
        annotations: d.annotations || [],
        tipZh: d.tipZh,
      });
    }
  }
  const probe = health.lastProbeSamples || null;
  const probeLinked =
    probe &&
    (!wantDays.length || wantDays.includes(String(probe.day || '')) || (!wantDay && multiDay)) &&
    (!wantShell || (probe.shells || []).includes(wantShell));
  const sampleSummaries = probeLinked
    ? (probe.samples || [])
        .filter((x) => !wantShell || x.shell === wantShell)
        .slice(0, 24)
        .map((x) => ({
          shell: x.shell,
          round: x.round,
          kind: x.kind,
          kindZh: x.kindZh,
          timingMs: x.timingMs,
          tipZh: `${x.shell} 第${x.round}轮 · ${x.kindZh}` + (x.timingMs != null ? ` · ${x.timingMs}ms` : ''),
        }))
    : [];
  const tipZh = dayRows.length
    ? `日点注解钻取：${dayRows.length} 日点` +
      (probeLinked
        ? ` · 关联探针 ${sampleSummaries.length} 条（${probe!.day} · HIT ${probe!.hitRatePct ?? '—'}%）`
        : ' · 当日暂无落盘探针样本（先跑自愈/建议bust探针）')
    : '暂无匹配日点注解可钻取；先看周火花图或跑探针。';
  const byDay: Record<string, typeof dayRows> = {};
  for (const row of dayRows) {
    if (!byDay[row.day]) byDay[row.day] = [];
    byDay[row.day].push(row);
  }
  const multiDayCompare = (multiDay || Object.keys(byDay).length > 1)
    ? Object.keys(byDay)
        .sort()
        .map((day) => {
          const rows = byDay[day];
          const hits = rows.map((r) => r.hitRatePct).filter((x): x is number => x != null);
          const avgHit =
            hits.length > 0 ? Math.round((hits.reduce((a, b) => a + b, 0) / hits.length) * 10) / 10 : null;
          return {
            day,
            shells: rows.map((r) => r.shell),
            avgHitRatePct: avgHit,
            annotationCount: rows.reduce((n, r) => n + (r.annotations?.length || 0), 0),
            eventZhList: rows.map((r) => r.eventZh).filter(Boolean),
            tipZh:
              `${day}：壳 ${rows.map((r) => r.shell).join('、')}` +
              (avgHit != null ? ` · 均 HIT ${avgHit}%` : '') +
              (rows.some((r) => r.eventZh) ? ` · ${rows.map((r) => r.eventZh).filter(Boolean).join('；')}` : ''),
          };
        })
    : null;
  const tipZh2 = multiDayCompare?.length
    ? `多日钻取对比：${multiDayCompare.length} 天 · ` + tipZh
    : tipZh;
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: multiDayCompare && multiDayCompare.length > 1 ? 'M79' : 'M77',
    shell: wantShell,
    day: wantDay,
    days: wantDays.length ? wantDays : multiDayCompare?.map((x) => x.day) || [],
    multiDay: Boolean(multiDayCompare && multiDayCompare.length > 1),
    multiDayCompare,
    multiDayCompareLabelZh: '日点多日对比',
    dayAnnotations: dayRows,
    probeSamples: sampleSummaries,
    probeSummary: probeLinked
      ? {
          at: probe!.at,
          day: probe!.day,
          shells: probe!.shells,
          hitRatePct: probe!.hitRatePct,
          totals: probe!.totals,
          summaryZh: probe!.summaryZh,
          afterRebust: probe!.afterRebust,
        }
      : null,
    tipZh: tipZh2,
    toastZh: dayRows.length
      ? (multiDayCompare && multiDayCompare.length > 1 ? `多日钻取 · ${multiDayCompare.length} 天` : `日点钻取 · ${dayRows.length} 点`) +
        (sampleSummaries.length ? ` · 探针 ${sampleSummaries.length}` : '')
      : '日点钻取无样本',
    labelZh: multiDayCompare && multiDayCompare.length > 1 ? '日点多日对比钻取探针样本' : '日点注解钻取探针样本',
    drillPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill',
    /** M78/M79：多日钻取本地对比卡（无外发）+ 日环比 HIT 趋势差分 */
    localCompareCard: (() => {
      const daysRaw = (multiDayCompare || []).map((x) => ({
        day: x.day,
        avgHitRatePct: x.avgHitRatePct,
        annotationCount: x.annotationCount,
        shells: x.shells,
        tipZh: x.tipZh,
      }));
      const daysSorted = [...daysRaw].sort((a, b) => String(a.day).localeCompare(String(b.day)));
      const anomalyAbsPt = Math.max(
        1,
        Number(process.env.INBOX_TREND_DELTA_ANOMALY_PT || 5) || 5,
      );
      const trendDeltas = daysSorted.map((d, i) => {
        const prev = i > 0 ? daysSorted[i - 1] : null;
        const cur = d.avgHitRatePct == null ? null : Number(d.avgHitRatePct);
        const prv = prev && prev.avgHitRatePct != null ? Number(prev.avgHitRatePct) : null;
        const delta =
          cur != null && prv != null && Number.isFinite(cur) && Number.isFinite(prv)
            ? Math.round((cur - prv) * 10) / 10
            : null;
        let deltaZh = '无环比';
        let tone: 'up' | 'down' | 'flat' | 'na' = 'na';
        if (delta == null) {
          deltaZh = i === 0 ? '首日基准' : '缺样本';
          tone = 'na';
        } else if (delta > 0.05) {
          deltaZh = `↑ +${delta.toFixed(1)}pt`;
          tone = 'up';
        } else if (delta < -0.05) {
          deltaZh = `↓ ${delta.toFixed(1)}pt`;
          tone = 'down';
        } else {
          deltaZh = `→ ${delta.toFixed(1)}pt`;
          tone = 'flat';
        }
        const anomalous = delta != null && Math.abs(delta) >= anomalyAbsPt;
        const annCur = Number(d.annotationCount) || 0;
        const annPrev = prev ? Number(prev.annotationCount) || 0 : null;
        const annDelta = annPrev == null ? null : annCur - annPrev;
        const attributionHintsZh: string[] = [];
        if (anomalous) {
          if (tone === 'down') {
            attributionHintsZh.push(`HIT 日环比骤降 ${deltaZh}（阈值 ±${anomalyAbsPt}pt）`);
            if (annDelta != null && annDelta < 0)
              attributionHintsZh.push(`日点注解减少 ${annDelta}，样本变稀可能放大波动`);
            else if (annDelta != null && annDelta > 0)
              attributionHintsZh.push(`注解反而 +${annDelta}，更像分壳命中结构变化而非样本不足`);
            attributionHintsZh.push('建议：干跑建议 bust / 复探针核对偏低壳，勿外发');
          } else if (tone === 'up') {
            attributionHintsZh.push(`HIT 日环比骤升 ${deltaZh}（阈值 ±${anomalyAbsPt}pt）`);
            if (annDelta != null && annDelta > 0)
              attributionHintsZh.push(`注解 +${annDelta}，回升可能来自样本变密或自愈后命中`);
            attributionHintsZh.push('建议：对照周火花与探针样本，确认非瞬时毛刺');
          }
          const shellBits = Array.isArray(d.shells) ? d.shells.slice(0, 3) : [];
          if (shellBits.length) {
            attributionHintsZh.push(
              '相关壳：' +
                shellBits
                  .map((s: any) => `${s.shell || s.name || s.id || '壳'}${s.hitRatePct != null ? '(' + s.hitRatePct + '%)' : ''}`)
                  .join('、'),
            );
          }
        }
        return {
          day: d.day,
          avgHitRatePct: d.avgHitRatePct,
          prevDay: prev?.day || null,
          prevHitRatePct: prv,
          deltaHitRatePct: delta,
          deltaZh,
          tone,
          annotationCount: d.annotationCount,
          anomalous,
          anomalyAbsPt,
          attributionHintsZh,
          attributionLabelZh: anomalous ? '趋势差分异常归因（干跑）' : null,
          tipZh:
            `${d.day} HIT ${cur == null ? '—' : cur + '%'} · 环比 ${deltaZh}` +
            (anomalous ? ` · 异常·${attributionHintsZh[0] || '待归因'}` : ''),
        };
      });
      const upN = trendDeltas.filter((t) => t.tone === 'up').length;
      const downN = trendDeltas.filter((t) => t.tone === 'down').length;
      const anomalyRows = trendDeltas.filter((t) => t.anomalous);
      const anomalyAlertDryRun = {
        enabled: true,
        dryRun: true,
        noEgress: true,
        wave: 'M81',
        labelZh: '趋势差分异常干跑告警',
        thresholdPt: anomalyAbsPt,
        count: anomalyRows.length,
        days: anomalyRows.map((t) => t.day),
        tipZh: anomalyRows.length
          ? `发现 ${anomalyRows.length} 个异常日环比点（|Δ|≥${anomalyAbsPt}pt）：${anomalyRows.map((t) => t.day + ' ' + t.deltaZh).join('；')}。仅本地告警，无外发。`
          : `无异常日环比（阈值 ±${anomalyAbsPt}pt）。`,
        toastZh: anomalyRows.length
          ? `趋势异常 ${anomalyRows.length} 点（干跑）`
          : '趋势差分无异常',
        path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly',
      };
      return {
        enabled: true,
        wave: 'M81',
        dryRun: true,
        noEgress: true,
        labelZh: '多日钻取本地对比卡（含趋势差分·异常归因）',
        tipZh: multiDayCompare?.length
          ? `本地对比卡：${multiDayCompare.length} 天 HIT/注解并排 · 环比↑${upN}/↓${downN} · 异常 ${anomalyRows.length}（仅本机，无外发）。`
          : '本地对比卡：暂无多日样本，仍可看单日钻取。',
        days: daysRaw,
        trendDeltas,
        trendDeltaLabelZh: '日环比 HIT 趋势差分',
        trendDeltaAnomalyLabelZh: '趋势差分异常归因（干跑）',
        trendDeltaAnomalyAlert: anomalyAlertDryRun,
        trendSummaryZh:
          trendDeltas.length > 1
            ? `趋势差分：↑${upN} · ↓${downN} · 持平/缺 ${trendDeltas.length - upN - downN} · 异常 ${anomalyRows.length}`
            : '趋势差分：样本不足（需≥2 天）',
        sparkSummaryZh: tipZh2,
        probeSampleCount: sampleSummaries.length,
      };
    })(),
    localCompareCardLabelZh: '多日钻取本地对比卡（含趋势差分·异常归因）',
    localCompareTrendDeltaLabelZh: '日环比 HIT 趋势差分',
    localCompareTrendDeltaAnomalyLabelZh: '趋势差分异常归因（干跑）',
  };
}


/** M80：仅抽取本地对比卡趋势差分异常干跑归因（无外发） */
export function trendDeltaAnomalyAttributionDryRun(
  tenantId: string | null | undefined,
  opts: { shell?: string | null; days?: string[]; multiDay?: boolean } = {},
) {
  const drill = drillSparkDayAnnotationToProbeSamples(tenantId, {
    shell: opts.shell || null,
    day: null,
    days: opts.days || [],
    multiDay: opts.multiDay !== false,
  });
  const card = (drill as any)?.localCompareCard || {};
  const alert = card.trendDeltaAnomalyAlert || null;
  const anomalies = Array.isArray(card.trendDeltas)
    ? card.trendDeltas.filter((t: any) => t && t.anomalous)
    : [];
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M82',
    labelZh: '趋势差分异常干跑归因',
    tipZh: alert?.tipZh || '暂无趋势差分异常归因。',
    toastZh: alert?.toastZh || (anomalies.length ? `异常 ${anomalies.length} 点` : '无异常'),
    anomalyAlert: alert,
    anomalies,
    localCompareCard: card,
    drillPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill',
    attributionPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly',
    oneClickChainPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe',
    oneClickChainLabelZh: '异常归因一键串联 bust/复探针（干跑）',
  };
}

/** M81–M83：异常归因卡一键串联建议 bust + 复探针；M82/M83 挂统一任务卡·分项 SSE（可取消/续跑/看进度；干跑无外发） */
export function trendAnomalyOneClickChainBustReprobe(
  tenantId: string | null | undefined,
  opts: {
    shell?: string | null;
    days?: string[];
    shells?: string[] | null;
    force?: boolean;
    notifyDryRun?: boolean;
    autoHitProbe?: boolean;
    notifyDispatch?: ((payload: any) => any) | null;
    /** 续跑：从取消点继续 */
    resume?: boolean;
    jobId?: string | null;
  } = {},
) {
  const tid = tenantId || 'default';
  let job = opts.resume ? readAnomalyChainJob(tid) : null;
  if (opts.resume && job) {
    job = markAnomalyChainPhase(tid, {
      phase: 'attribution',
      status: 'running',
      cancelRequested: false,
      resumeAvailable: false,
      tipZh: '异常串联续跑：从归因阶段继续（干跑）…',
      toastZh: '异常串联续跑中',
      percent: 10,
    });
  } else {
    job = startOrReplaceAnomalyChainJob(tid, {
      force: opts.force === true,
      anomalyCount: 0,
    });
  }

  // phase: attribution
  job = markAnomalyChainPhase(tid, {
    phase: 'attribution',
    tipZh: '异常串联任务卡：归因中…（干跑、无外发）',
    percent: 20,
    itemizedDetail: { attribution: '归因中…' },
  });
  if (job.phase === 'cancelled') {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M83',
      cancelled: true,
      labelZh: '异常归因一键串联 bust/复探针（统一任务卡）',
      tipZh: job.tipZh,
      toastZh: job.toastZh,
      busyZh: '异常串联已取消',
      job,
      unifiedJobCard: true,
      resumeAvailable: true,
      path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe',
    };
  }

  const attribution = trendDeltaAnomalyAttributionDryRun(tid, {
    shell: opts.shell || null,
    days: opts.days || [],
    multiDay: true,
  });
  const anomalies = Array.isArray(attribution.anomalies) ? attribution.anomalies : [];
  job = markAnomalyChainPhase(tid, {
    phase: 'bust',
    anomalyCount: anomalies.length,
    tipZh: `异常串联：归因 ${anomalies.length} 点 → 建议 bust 中…`,
    percent: 45,
    itemizedDetail: {
      attribution: `已归因 ${anomalies.length} 点`,
      bust: '建议 bust 执行中…',
    },
  });
  if (job.phase === 'cancelled') {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M83',
      cancelled: true,
      labelZh: '异常归因一键串联 bust/复探针（统一任务卡）',
      tipZh: job.tipZh,
      toastZh: job.toastZh,
      job,
      unifiedJobCard: true,
      resumeAvailable: true,
      anomalyCount: anomalies.length,
      attribution,
      path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe',
    };
  }

  const chain = executeSuggestedBustDryRun(tid, {
    shells: opts.shells || null,
    notifyDryRun: opts.notifyDryRun !== false,
    autoHitProbe: false, // 复探针单独阶段，便于取消边界
    force: opts.force === true,
    notifyDispatch: opts.notifyDispatch || null,
  });

  job = markAnomalyChainPhase(tid, {
    phase: 'reprobe',
    shells: chain.shells || [],
    tipZh: `异常串联：bust 完成 → 复探针中…（干跑）`,
    percent: 75,
    itemizedDetail: {
      attribution: `已归因 ${anomalies.length} 点`,
      bust: chain.throttled ? 'bust 节流跳过' : 'bust 已干跑',
      reprobe: 'HIT 复探针中…',
    },
  });
  if (job.phase === 'cancelled') {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M83',
      cancelled: true,
      labelZh: '异常归因一键串联 bust/复探针（统一任务卡）',
      tipZh: job.tipZh,
      toastZh: job.toastZh,
      job,
      unifiedJobCard: true,
      resumeAvailable: true,
      anomalyCount: anomalies.length,
      attribution,
      chainBustReprobe: chain,
      shells: chain.shells || [],
      throttled: Boolean(chain.throttled),
      path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe',
    };
  }

  let hitProbe = chain.hitProbe || null;
  let slaChainSelfHeal = chain.slaChainSelfHeal || null;
  if (opts.autoHitProbe !== false && !chain.throttled) {
    // 复用 executeSuggestedBust 的探针路径：再跑一遍带 autoHitProbe
    const probed = executeSuggestedBustDryRun(tid, {
      shells: chain.shells || opts.shells || null,
      notifyDryRun: false,
      autoHitProbe: true,
      force: true,
      ignoreCooldown: true,
    });
    hitProbe = probed.hitProbe || hitProbe;
    slaChainSelfHeal = probed.slaChainSelfHeal || slaChainSelfHeal;
  }

  const chained = Boolean(chain && chain.ok !== false);
  const tipZh = anomalies.length
    ? `异常归因 ${anomalies.length} 点 → 已一键串联建议 bust/复探针（干跑、无外发；已挂统一任务卡）。` +
      (chain.tipZh ? ' ' + chain.tipZh : '')
    : `暂无异常日环比点；仍可干跑串联建议 bust/复探针（已挂统一任务卡）。` +
      (chain.tipZh ? ' ' + chain.tipZh : '');
  const toastZh = anomalies.length
    ? `异常串联已干跑 · ${anomalies.length} 点 · 任务卡已更新`
    : (chain.toastZh || '异常串联干跑（无异常点）') + ' · 任务卡已更新';

  const healDetail =
    slaChainSelfHeal
      ? 'SLA 自愈已串联'
      : 'skipped';
  // optional heal phase before done for itemized SSE
  if (slaChainSelfHeal) {
    job = markAnomalyChainPhase(tid, {
      phase: 'heal',
      shells: chain.shells || [],
      tipZh: '异常串联：复探针后 → SLA 自愈中…（干跑）',
      percent: 92,
      itemizedDetail: {
        attribution: `已归因 ${anomalies.length} 点`,
        bust: chain.throttled ? 'bust 节流跳过' : 'bust 已干跑',
        reprobe: hitProbe ? '复探针已完成' : '复探针跳过/节流',
        heal: 'SLA 自愈中…',
      },
    });
  }
  job = markAnomalyChainPhase(tid, {
    phase: 'done',
    status: 'done',
    percent: 100,
    anomalyCount: anomalies.length,
    shells: chain.shells || [],
    tipZh,
    toastZh,
    resumeAvailable: false,
    itemizedDetail: {
      attribution: `已归因 ${anomalies.length} 点`,
      bust: chain.throttled ? 'bust 节流跳过' : 'bust 已干跑',
      reprobe: hitProbe ? '复探针已完成' : '复探针跳过/节流',
      heal: healDetail,
    },
    lastResult: {
      attribution,
      chainBustReprobe: chain,
      hitProbe,
      slaChainSelfHeal,
      itemizedPhasesSse: true,
    },
  });

  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M83',
    labelZh: '异常归因一键串联 bust/复探针（统一任务卡·分项 SSE）',
    tipZh,
    toastZh,
    busyZh: '异常归因一键串联 bust/复探针…',
    chained,
    anomalyCount: anomalies.length,
    attribution,
    chainBustReprobe: chain,
    shells: chain.shells || [],
    hitProbe,
    slaChainSelfHeal,
    throttled: Boolean(chain.throttled),
    job,
    unifiedJobCard: true,
    itemizedPhases: job.itemizedPhases || null,
    itemizedPhasesSse: true,
    itemizedPhasesSseTipZh: '异常串联分项进度经真 EventSource 推送（归因/bust/复探针/自愈）；取消/续跑仍在；干跑无外发',
    itemizedPhasesEventSource: true,
    streamPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/stream',
    resumeAvailable: false,
    cancelPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/cancel',
    resumePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/resume',
    jobPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/job',
    path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe',
  };
}

export function getAnomalyChainJobCard(tenantId?: string | null) {
  const job = readAnomalyChainJob(tenantId);
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M84',
    labelZh: '异常串联统一任务卡（真 EventSource）',
    job,
    cards: listAnomalyChainResumeCards(tenantId),
    tipZh: job ? job.tipZh : '暂无异常串联任务卡',
    toastZh: job ? job.toastZh : '无任务卡',
    itemizedPhases: job?.itemizedPhases || null,
    itemizedPhasesSse: true,
    itemizedPhasesEventSource: true,
    streamPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/stream',
    itemizedPhasesSseTipZh: '异常串联分项进度经真 EventSource 推送（归因/bust/复探针/自愈）；取消/续跑仍在；干跑无外发',
  };
}

export function cancelAnomalyChainJobCard(tenantId?: string | null) {
  return { ...requestCancelAnomalyChainJob(tenantId), dryRun: true, noEgress: true };
}

export function resumeAnomalyChainJobCard(
  tenantId?: string | null,
  opts: {
    shell?: string | null;
    days?: string[];
    shells?: string[] | null;
    force?: boolean;
    notifyDryRun?: boolean;
    autoHitProbe?: boolean;
  } = {},
) {
  const job = readAnomalyChainJob(tenantId);
  if (!job) {
    return {
      ok: false,
      dryRun: true,
      noEgress: true,
      wave: 'M84',
      messageZh: '没有可续跑的异常串联任务卡',
      tipZh: '请先一键串联，或任务卡已过期清理。',
      toastZh: '无可续跑任务卡',
    };
  }
  if (!(job.resumeAvailable || job.status === 'cancelled' || job.status === 'failed')) {
    return {
      ok: false,
      dryRun: true,
      noEgress: true,
      wave: 'M84',
      messageZh: `任务卡状态 ${job.status}，当前不可续跑`,
      tipZh: job.tipZh,
      toastZh: '不可续跑',
      job,
    };
  }
  return trendAnomalyOneClickChainBustReprobe(tenantId, {
    ...opts,
    resume: true,
    force: opts.force !== false,
    jobId: job.id,
  });
}

/** M76：SLA 重开冷却是否仍在节流建议 bust 执行 */
export function suggestedBustThrottledBySlaCooldown(
  tenantId: string | null | undefined,
  opts: { force?: boolean; ignoreCooldown?: boolean } = {},
) {
  const tid = tenantId || 'default';
  const health = readInboxShellHealth(tid);
  const cooldownMs = Math.max(
    0,
    Number(process.env.INBOX_SHELL_SLA_REOPEN_COOLDOWN_MS || 5 * 60_000) || 5 * 60_000,
  );
  const last = (health as any).lastSlaReopenAfterChainHeal;
  const lastAtMs = last?.at ? Date.parse(String(last.at)) : NaN;
  const sinceLast = Number.isFinite(lastAtMs) ? Date.now() - lastAtMs : Number.POSITIVE_INFINITY;
  const cooled =
    !opts.force &&
    !opts.ignoreCooldown &&
    cooldownMs > 0 &&
    sinceLast < cooldownMs;
  const remainMs = cooled ? Math.max(0, cooldownMs - sinceLast) : 0;
  const tipZh = cooled
    ? `建议 bust 已与 SLA 重开冷却联动节流：距上次 SLA 重开约 ${Math.round(sinceLast / 1000)} 秒，还需约 ${Math.round(remainMs / 1000)} 秒（冷却 ${Math.round(cooldownMs / 1000)} 秒）。干跑、无外发，防 thrash。可 force=true 跳过。`
    : '建议 bust 未处于 SLA 重开冷却节流。';
  const countdownSec = cooled ? Math.max(1, Math.ceil(remainMs / 1000)) : 0;
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M79',
    throttled: cooled,
    cooled,
    cooldownMs,
    remainMs,
    countdownSec,
    countdownLabelZh: cooled ? `冷却倒计时 ${countdownSec}s` : '无冷却倒计时',
    countdownTipZh: cooled
      ? `建议 bust 冷却倒计时：${countdownSec} 秒后可执行（干跑）。force=true 可跳过。倒计时归零可自动复探针；失败则串联 SLA 自愈（仅干跑）。`
      : '建议 bust 当前可执行，无倒计时；可立即干跑复探针；失败串联 SLA。',
    sinceLastMs: Number.isFinite(sinceLast) ? sinceLast : null,
    tipZh,
    toastZh: cooled ? `建议 bust 冷却节流 · 倒计时 ${countdownSec}s` : '建议 bust 可执行',
    labelZh: '建议 bust ↔ SLA 冷却节流',
    autoReprobeOnCountdownEnd: true,
    autoReprobeOnCountdownEndLabelZh: '倒计时结束自动复探针（干跑·失败串联SLA）',
    autoReprobeOnCountdownEndTipZh:
      '冷却倒计时归零后可选自动复探针：失败则串联已有 SLA 干跑自愈；仅干跑通知，无外发；运营台可开关。',
    reprobeFailSlaChainLabelZh: '复探针失败 → SLA 干跑自愈串联',
    autoReprobePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/suggested-bust/countdown-end-auto-reprobe',
  };
}


/** M78：倒计时归零后可选自动复探针（干跑通知 only，无外发） */
export function countdownEndAutoReprobeDryRun(
  tenantId: string | null | undefined,
  opts: {
    force?: boolean;
    notifyDryRun?: boolean;
    notifyDispatch?: ((payload: any) => any) | null;
  } = {},
) {
  const tid = tenantId || 'default';
  const throttle = suggestedBustThrottledBySlaCooldown(tid, {
    force: opts.force === true,
    ignoreCooldown: opts.force === true,
  });
  const countdownDone = !throttle.throttled || throttle.countdownSec <= 0 || opts.force === true;
  if (!countdownDone) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M79',
      autoReprobe: false,
      deferred: true,
      countdownSec: throttle.countdownSec,
      tipZh: `倒计时未归零（剩 ${throttle.countdownSec}s），暂不自动复探针。干跑、无外发。`,
      toastZh: `等待倒计时 ${throttle.countdownSec}s`,
      labelZh: '倒计时结束自动复探针',
      throttle,
    };
  }
  // 干跑：读壳健康 + 可选探针；失败则串联已有 SLA 自愈路径；notify 仅草稿
  const health = readInboxShellHealth(tid);
  const summary = inboxShellSuggestedBustSummary(health);
  const shells = (summary.shells || []).map(String).filter(Boolean);
  let hitProbe: ReturnType<typeof probeInboxDeltaHitAfterHeal> | null = null;
  let reprobeFailed = false;
  try {
    hitProbe = probeInboxDeltaHitAfterHeal({
      shells: shells.length ? shells : ['enterprise', 'park'],
      rounds: 3,
      tenantId: tid,
      afterRebust: false,
    });
    const hitRate =
      hitProbe && (hitProbe as any).hitRatePct != null
        ? Number((hitProbe as any).hitRatePct)
        : hitProbe?.totals
          ? (() => {
              const t = hitProbe!.totals;
              const den = (t.HIT || 0) + (t.MISS || 0) + (t.NOT_MODIFIED || 0) + (t.BYPASS || 0);
              return den ? Math.round(((t.HIT || 0) / den) * 1000) / 10 : null;
            })()
          : null;
    reprobeFailed =
      (hitProbe as any)?.probeFailed === true ||
      (hitRate != null && hitRate < 35) ||
      ((hitProbe?.totals?.MISS || 0) > (hitProbe?.totals?.HIT || 0) &&
        (hitProbe?.totals?.MISS || 0) + (hitProbe?.totals?.HIT || 0) >= 2);
    if (hitProbe && hitRate != null && (hitProbe as any).hitRatePct == null) {
      (hitProbe as any).hitRatePct = hitRate;
    }
    if (hitProbe && (hitProbe as any).probeFailed == null) {
      (hitProbe as any).probeFailed = reprobeFailed;
    }
  } catch (_) {
    reprobeFailed = true;
    hitProbe = {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M79',
      shells,
      rounds: 0,
      samples: [],
      totals: { HIT: 0, MISS: 0, NOT_MODIFIED: 0, BYPASS: 0 },
      tipZh: '自动复探针异常，视为失败。',
      toastZh: '复探针失败',
      summaryZh: '自动复探针失败',
      probeFailed: true,
    } as any;
  }

  let slaChainSelfHeal: ReturnType<typeof maybeChainSlaOverdueSelfHealAfterProbeFail> | null = null;
  if (reprobeFailed) {
    slaChainSelfHeal = maybeChainSlaOverdueSelfHealAfterProbeFail({
      tenantId: tid,
      shells: shells.length ? shells : null,
      hitProbe: hitProbe as any,
      notifyDryRun: opts.notifyDryRun !== false,
      notifyDispatch: opts.notifyDispatch || null,
      reProbe: true,
      force: opts.force === true,
    });
  }

  let notifyDraft: any = null;
  if (opts.notifyDryRun !== false) {
    const payload = {
      dryRun: true,
      noEgress: true,
      channel: 'ops-toast',
      titleZh: reprobeFailed
        ? '倒计时结束 · 自动复探针失败 · 已串联 SLA 自愈（干跑）'
        : '倒计时结束 · 自动复探针（干跑）',
      bodyZh:
        `冷却倒计时已归零；建议壳 ${summary.shells?.join('、') || '无'}。` +
        (reprobeFailed
          ? `复探针偏低/失败；${slaChainSelfHeal?.chained ? '已串联 SLA 干跑自愈。' : slaChainSelfHeal?.tipZh || '未串联自愈。'}`
          : '复探针正常。') +
        '本通知仅干跑，无外发。',
      wave: 'M79',
      at: new Date().toISOString(),
    };
    try {
      notifyDraft = opts.notifyDispatch ? opts.notifyDispatch(payload) : { drafted: true, ...payload };
    } catch (_) {
      notifyDraft = { drafted: true, ...payload };
    }
  }
  const toastZh = reprobeFailed
    ? slaChainSelfHeal?.chained
      ? '复探针失败 · 已串联 SLA 自愈（干跑）'
      : '复探针失败 · 已尝试串联 SLA（干跑）'
    : '倒计时结束 · 自动复探针（干跑）';
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M79',
    autoReprobe: true,
    deferred: false,
    countdownSec: 0,
    shells: summary.shells || [],
    suggestedBustSummary: summary,
    shellHealth: health,
    hitProbe,
    reprobeFailed,
    slaChainSelfHeal,
    reprobeFailSlaChainLabelZh: '复探针失败 → SLA 干跑自愈串联',
    notifyDraft,
    tipZh:
      `倒计时归零：已自动复探针（干跑）· 建议壳 ${summary.shells?.length || 0} 个` +
      (reprobeFailed
        ? ` · 复探针失败` +
          (slaChainSelfHeal?.chained
            ? ` · 已串联 SLA 自愈：${slaChainSelfHeal.toastZh || slaChainSelfHeal.tipZh || ''}`
            : ` · ${slaChainSelfHeal?.tipZh || '未串联'}`)
        : ' · 复探针正常') +
      '；仅干跑通知，无外发。',
    toastZh,
    labelZh: '倒计时结束自动复探针（失败串联 SLA）',
    throttle,
  };
}

/** M71：一键执行建议 bust（干跑：定向 bust + 双通道 notify 草稿路径，无外发） */
export function executeSuggestedBustDryRun(
  tenantId: string | null | undefined,
  opts: {
    shells?: string[] | null;
    notifyDryRun?: boolean;
    notifyDispatch?: ((payload: any) => any) | null;
    /** M72：bust 后自动 HIT 探针；默认开 */
    autoHitProbe?: boolean;
    probeRounds?: number;
    /** M76：与 SLA 重开冷却联动节流；force 可跳过 */
    force?: boolean;
    ignoreCooldown?: boolean;
  } = {},
) {
  const tid = tenantId || 'default';
  const throttle = suggestedBustThrottledBySlaCooldown(tid, {
    force: opts.force === true,
    ignoreCooldown: opts.ignoreCooldown === true,
  });
  if (throttle.throttled) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M77',
      countdownSec: throttle.countdownSec,
      countdownLabelZh: throttle.countdownLabelZh,
      remainMs: throttle.remainMs,
      shells: [] as string[],
      busted: 0,
      bustResults: [] as any[],
      throttled: true,
      cooled: true,
      cooldownMs: throttle.cooldownMs,
      tipZh: throttle.tipZh,
      toastZh: throttle.toastZh,
      slaCooldownThrottle: throttle,
      hitProbe: null,
      autoHitProbe: false,
      slaChainSelfHeal: null,
      shellHealth: readInboxShellHealth(tid),
      suggestedBustSummary: inboxShellSuggestedBustSummary(readInboxShellHealth(tid)),
    };
  }
  const health = readInboxShellHealth(tid);
  const summary = inboxShellSuggestedBustSummary(health);
  const shells = [
    ...new Set(
      (opts.shells && opts.shells.length ? opts.shells : summary.shells).map(String).filter(Boolean),
    ),
  ];
  const now = new Date().toISOString();
  const bustResults = shells.map((shell) => bustInboxDeltaCache({ shell, tenantId: tid }));
  const busted = bustResults.filter((r: any) => r && r.ok !== false).length;
  let notify: any = null;
  if (opts.notifyDryRun !== false) {
    const tip =
      shells.length
        ? `【建议 bust 一键干跑】已对壳「${shells.join('、')}」执行定向 bust（${busted}/${shells.length}）。无外发。`
        : '【建议 bust 一键干跑】当前无建议 bust 壳；未执行 bust。';
    if (typeof opts.notifyDispatch === 'function') {
      try {
        notify = opts.notifyDispatch({
          force: true,
          inflectionZh: tip,
          recoveryZh: summary.recoverySlaZh,
          inflectionAlerting: shells.length > 0,
        });
      } catch (_) {
        notify = { ok: true, dryRun: true, draftOnly: true, tipZh: tip };
      }
    } else {
      notify = { ok: true, dryRun: true, noEgress: true, draftOnly: true, tipZh: tip, wave: 'M73' };
    }
  }
  health.lastSuggestedBust = {
    ...(health.lastSuggestedBust || { shells, tipZh: summary.tipZh, toastZh: summary.toastZh }),
    at: now,
    shells: shells.length ? shells : health.lastSuggestedBust?.shells || [],
    tipZh: shells.length
      ? `建议 bust 已一键干跑执行：${shells.join('、')}`
      : health.lastSuggestedBust?.tipZh || summary.tipZh,
    toastZh: shells.length ? `建议 bust 已干跑 · ${shells.join('、')}` : '无建议 bust 可执行',
    executedAt: now,
    executedDryRun: true,
  } as any;
  for (const shell of shells) {
    const prev = health.byShell[shell] || { hitRatePct: null, healthScore: null, lastProbeAt: now };
    health.byShell[shell] = {
      ...prev,
      suggestedBustExecutedAt: now,
      suggestedBustExecutedDryRun: true,
    } as any;
  }
  health.updatedAt = now;
  health.wave = 'M72';
  try {
    const p = shellHealthPath(tid);
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  // M72：建议 bust / 自愈后自动 HIT 探针闭环（复用 M66 路径，干跑无外发）
  const autoProbeOn = opts.autoHitProbe !== false && String(process.env.INBOX_SHELL_POST_BUST_AUTO_HIT_PROBE ?? '1') !== '0';
  const probeRounds = Math.max(
    2,
    Math.min(6, Number(opts.probeRounds ?? (Number(process.env.INBOX_SHELL_POST_BUST_HIT_PROBE_ROUNDS || 3) || 3)) || 3),
  );
  let hitProbe: ReturnType<typeof probeInboxDeltaHitAfterHeal> | null = null;
  if (autoProbeOn && shells.length) {
    hitProbe = probeInboxDeltaHitAfterHeal({
      shells,
      rounds: probeRounds,
      tenantId: tid,
      afterRebust: false,
    });
  } else if (autoProbeOn && !shells.length) {
    hitProbe = {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M73',
      shells: [],
      rounds: 0,
      samples: [],
      totals: { HIT: 0, MISS: 0, NOT_MODIFIED: 0, BYPASS: 0 },
      tipZh: '无壳可探测；跳过 bust 后 HIT 探针。',
      toastZh: '无壳，跳过 HIT 探测',
      summaryZh: 'bust 后 HIT 探测：无壳。',
    } as any;
  }
  // M73：探针失败且 SLA 临近/逾期 → 串联一次干跑自愈
  let slaChainSelfHeal: ReturnType<typeof maybeChainSlaOverdueSelfHealAfterProbeFail> | null = null;
  const chainOn =
    String(process.env.INBOX_SHELL_PROBE_FAIL_CHAIN_SLA_SELF_HEAL ?? '1') !== '0';
  if (chainOn && hitProbe && shells.length) {
    slaChainSelfHeal = maybeChainSlaOverdueSelfHealAfterProbeFail({
      tenantId: tid,
      shells,
      hitProbe,
      notifyDryRun: opts.notifyDryRun !== false,
      notifyDispatch: opts.notifyDispatch,
      reProbe: true,
    });
  }
  const tipZh = shells.length
    ? `建议 bust 一键干跑：已 bust「${shells.join('、')}」（${busted}/${shells.length}）· 通知草稿路径已就绪 · 无外发` +
      (hitProbe ? ' · ' + (hitProbe.summaryZh || hitProbe.tipZh) : '') +
      (slaChainSelfHeal?.chained ? ' · ' + slaChainSelfHeal.tipZh : slaChainSelfHeal?.tipZh && (hitProbe as any)?.probeFailed ? ' · ' + slaChainSelfHeal.tipZh : '')
    : '建议 bust 一键干跑：暂无建议壳；可先跑自愈产生拐点建议。';
  const toastZh = shells.length
    ? `建议 bust 已干跑 · ${shells.join('、')}` +
      (hitProbe?.toastZh ? ' · ' + hitProbe.toastZh : '') +
      (slaChainSelfHeal?.chained ? ' · ' + slaChainSelfHeal.toastZh : '')
    : '无建议 bust';
  health.lastSuggestedBust = {
    ...(health.lastSuggestedBust || {}),
    autoHitProbeAt: hitProbe ? new Date().toISOString() : null,
    autoHitProbeToastZh: hitProbe?.toastZh || null,
    slaChainSelfHealAt: slaChainSelfHeal?.chained ? new Date().toISOString() : null,
    slaChainSelfHealToastZh: slaChainSelfHeal?.chained ? slaChainSelfHeal.toastZh : null,
  } as any;
  health.wave = 'M73';
  try {
    const p2 = shellHealthPath(tid);
    const dir2 = join(p2, '..');
    if (!existsSync(dir2)) mkdirSync(dir2, { recursive: true });
    writeFileSync(p2, JSON.stringify(health, null, 0), 'utf8');
  } catch (_) {}
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M77',
    shells,
    busted,
    bustResults,
    notifyDryRun: notify,
    shellHealth: readInboxShellHealth(tid),
    suggestedBustSummary: inboxShellSuggestedBustSummary(readInboxShellHealth(tid)),
    hitProbe,
    autoHitProbe: Boolean(hitProbe),
    slaChainSelfHeal,
    throttled: false,
    cooled: false,
    slaCooldownThrottle: throttle,
    tipZh,
    toastZh,
  };
}

/** M73：HIT 探针失败且回升 SLA 临近/逾期时，串联一次干跑自愈（bust + 可选复探针）；无外发 */
export function maybeChainSlaOverdueSelfHealAfterProbeFail(
  opts: {
    tenantId?: string | null;
    shells?: string[] | null;
    hitProbe?: {
      hitRatePct?: number | null;
      probeFailed?: boolean;
      sustainedMiss?: boolean;
      totals?: { HIT: number; MISS: number; NOT_MODIFIED: number; BYPASS: number };
    } | null;
    notifyDryRun?: boolean;
    notifyDispatch?: ((payload: any) => any) | null;
    reProbe?: boolean;
    force?: boolean;
  } = {},
) {
  const tid = opts.tenantId || 'default';
  const chainOn = String(process.env.INBOX_SHELL_PROBE_FAIL_CHAIN_SLA_SELF_HEAL ?? '1') !== '0';
  if (!chainOn && opts.force !== true) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M74',
      chained: false,
      skipped: true,
      tipZh: '探针失败串联 SLA 自愈关闭（INBOX_SHELL_PROBE_FAIL_CHAIN_SLA_SELF_HEAL=0）。',
      toastZh: '串联自愈已关闭',
    };
  }
  const probe = opts.hitProbe || {};
  const probeBad =
    opts.force === true ||
    probe.probeFailed === true ||
    probe.sustainedMiss === true ||
    (probe.hitRatePct != null && Number(probe.hitRatePct) < 35);
  if (!probeBad) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M74',
      chained: false,
      tipZh: 'HIT 探针健康尚可，无需串联 SLA 自愈。',
      toastZh: '探针正常，未串联自愈',
    };
  }
  const slaRemind = remindRecoverySlaApproaching(tid);
  const slaHot =
    (slaRemind.overdueCount || 0) > 0 || (slaRemind.approachingCount || 0) > 0;
  if (!slaHot && opts.force !== true) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M74',
      chained: false,
      probeFailed: true,
      recoverySlaReminder: slaRemind,
      tipZh:
        'HIT 探针偏低，但回升 SLA 尚未临近/逾期；未自动串联自愈。可稍后再干跑或等 SLA 提醒。',
      toastZh: '探针偏低 · SLA 未临近，未串联',
    };
  }
  const health = readInboxShellHealth(tid);
  const lastChainAt = (health as any).lastSlaChainSelfHealAt
    ? Date.parse((health as any).lastSlaChainSelfHealAt)
    : NaN;
  if (Number.isFinite(lastChainAt) && Date.now() - lastChainAt < 8 * 60 * 1000 && opts.force !== true) {
    return {
      ok: true,
      dryRun: true,
      noEgress: true,
      wave: 'M74',
      chained: false,
      skippedRecent: true,
      recoverySlaReminder: slaRemind,
      tipZh: '近 8 分钟已做过 SLA 串联自愈，跳过重复干跑。',
      toastZh: '串联自愈已跳过（近期做过）',
    };
  }
  const hotShells = [
    ...new Set(
      [
        ...(opts.shells || []),
        ...slaRemind.reminders
          .filter((r) => r.level === 'overdue' || r.level === 'approaching')
          .map((r) => r.shell),
      ]
        .map(String)
        .filter(Boolean),
    ),
  ];
  const heal = selfHealInboxDeltaAlertingShells({
    shells: hotShells.length ? hotShells : opts.shells || null,
    rewriteCurveSample: true,
  });
  let reProbe: ReturnType<typeof probeInboxDeltaHitAfterHeal> | null = null;
  const doReprobe =
    opts.reProbe !== false &&
    String(process.env.INBOX_SHELL_PROBE_FAIL_CHAIN_REPROBE ?? '1') !== '0' &&
    heal.shells.length > 0;
  if (doReprobe) {
    reProbe = probeInboxDeltaHitAfterHeal({
      shells: heal.shells,
      rounds: Math.max(
        2,
        Math.min(6, Number(process.env.INBOX_SHELL_POST_BUST_HIT_PROBE_ROUNDS || 3) || 3),
      ),
      tenantId: tid,
      afterRebust: true,
    });
  }
  let notify: any = null;
  const tipCore =
    `【M74 串联自愈】HIT 探针失败且回升 SLA ${slaRemind.overdueCount ? '逾期' : '临近'}：` +
    `已干跑 bust「${(heal.shells || []).join('、') || '—'}」` +
    (reProbe ? ' · 已复探针' : '') +
    '。干跑、无外发。';
  if (opts.notifyDryRun !== false) {
    if (typeof opts.notifyDispatch === 'function') {
      try {
        notify = opts.notifyDispatch({
          force: true,
          inflectionZh: tipCore,
          recoveryZh: slaRemind.tipZh,
          inflectionAlerting: true,
        });
      } catch (_) {
        notify = { ok: true, dryRun: true, draftOnly: true, tipZh: tipCore };
      }
    } else {
      notify = { ok: true, dryRun: true, noEgress: true, draftOnly: true, tipZh: tipCore, wave: 'M73' };
    }
  }
  const now = new Date().toISOString();
  try {
    const cur = readInboxShellHealth(tid);
    (cur as any).lastSlaChainSelfHealAt = now;
    (cur as any).lastSlaChainSelfHeal = {
      at: now,
      shells: heal.shells,
      tipZh: tipCore,
      toastZh: `探针失败·SLA${slaRemind.overdueCount ? '逾期' : '临近'}·已串联自愈`,
      probeHitRatePct: probe.hitRatePct ?? null,
      overdueCount: slaRemind.overdueCount,
      approachingCount: slaRemind.approachingCount,
    };
    cur.wave = 'M74';
    cur.updatedAt = now;
    const p = shellHealthPath(tid);
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(cur, null, 0), 'utf8');
  } catch (_) {}
  // M74/M75：串联自愈后重开/重置回升 SLA 窗口（force 绕过冷却，本路径是合法自愈闭环）
  const slaReopen = reopenRecoverySlaAfterChainHeal(tid, {
    shells: heal.shells?.length ? heal.shells : hotShells,
    force: true,
    annotateSpark: true,
  });
  const toastZh =
    `探针失败串联自愈：${(heal.shells || []).join('、') || '无壳'}` +
    (reProbe?.toastZh ? ' · ' + reProbe.toastZh : '') +
    (slaReopen.shells.length ? ' · ' + slaReopen.toastZh : '');
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M74',
    chained: true,
    shells: heal.shells,
    heal,
    reProbe,
    notifyDryRun: notify,
    recoverySlaReminder: slaRemind,
    recoverySlaReopen: slaReopen,
    tipZh:
      tipCore +
      (reProbe ? ' · ' + (reProbe.summaryZh || reProbe.tipZh) : '') +
      ' · ' +
      slaRemind.tipZh +
      (slaReopen.shells.length ? ' · ' + slaReopen.tipZh : ''),
    toastZh,
  };
}

/** M71：回升 SLA 临近 / 逾期中文提醒（干跑，无外发） */
export function remindRecoverySlaApproaching(
  tenantId: string | null | undefined,
  opts: { warnMs?: number; nowMs?: number } = {},
) {
  const tid = tenantId || 'default';
  const health = readInboxShellHealth(tid);
  const nowMs = opts.nowMs ?? Date.now();
  const defaultWindow =
    Number(process.env.INBOX_SHELL_RECOVERY_SLA_MS || 15 * 60_000) || 15 * 60_000;
  const warnMs = Math.max(
    30_000,
    Number(
      opts.warnMs ??
        process.env.INBOX_SHELL_RECOVERY_SLA_WARN_MS ??
        Math.min(3 * 60_000, Math.round(defaultWindow * 0.2)),
    ) || Math.min(3 * 60_000, Math.round(defaultWindow * 0.2)),
  );
  const reminders: Array<{
    shell: string;
    status: string;
    remainingMs: number | null;
    deadlineAt: string | null;
    level: 'approaching' | 'overdue' | 'ok' | 'idle';
    tipZh: string;
  }> = [];
  for (const [shell, row] of Object.entries(health.byShell || {})) {
    const sla = row?.recoverySla;
    if (!sla || sla.status === 'idle' || !sla.deadlineAt) {
      if (row?.suggestedBust && (!sla || sla.status === 'idle')) {
        reminders.push({
          shell,
          status: sla?.status || 'idle',
          remainingMs: null,
          deadlineAt: null,
          level: 'idle',
          tipZh: `${shell}：有建议 bust，但回升 SLA 未开。`,
        });
      }
      continue;
    }
    const deadline = Date.parse(sla.deadlineAt);
    if (!Number.isFinite(deadline)) continue;
    const remainingMs = deadline - nowMs;
    if (sla.status === 'recovered') {
      reminders.push({
        shell,
        status: 'recovered',
        remainingMs: sla.timeToRecoverMs ?? null,
        deadlineAt: sla.deadlineAt,
        level: 'ok',
        tipZh: `${shell}：回升 SLA 已达成` + (sla.timeToRecoverMs != null ? `（${Math.round(sla.timeToRecoverMs / 1000)}s）` : ''),
      });
      continue;
    }
    if (sla.status === 'breached' || remainingMs < 0) {
      reminders.push({
        shell,
        status: 'breached',
        remainingMs,
        deadlineAt: sla.deadlineAt,
        level: 'overdue',
        tipZh: `${shell}：回升 SLA 已逾期（截止 ${sla.deadlineAt}），请再干跑自愈或一键建议 bust。`,
      });
      continue;
    }
    if (remainingMs <= warnMs || sla.status === 'pending') {
      const level = remainingMs <= warnMs ? 'approaching' : 'ok';
      reminders.push({
        shell,
        status: sla.status,
        remainingMs,
        deadlineAt: sla.deadlineAt,
        level,
        tipZh:
          level === 'approaching'
            ? `${shell}：回升 SLA 临近（剩约 ${Math.max(1, Math.round(remainingMs / 1000))}s，截止 ${sla.deadlineAt}）`
            : `${shell}：回升 SLA 进行中（剩约 ${Math.round(remainingMs / 1000)}s）`,
      });
    }
  }
  const approaching = reminders.filter((r) => r.level === 'approaching');
  const overdue = reminders.filter((r) => r.level === 'overdue');
  const tipZh =
    overdue.length || approaching.length
      ? [
          overdue.length ? `逾期 ${overdue.length}：` + overdue.map((r) => r.shell).join('、') : '',
          approaching.length
            ? `临近 ${approaching.length}：` + approaching.map((r) => r.shell).join('、')
            : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '回升 SLA：暂无临近/逾期提醒。';
  const toastZh = overdue.length
    ? `回升 SLA 逾期 · ${overdue.map((r) => r.shell).join('、')}`
    : approaching.length
      ? `回升 SLA 临近 · ${approaching.map((r) => r.shell).join('、')}`
      : '回升 SLA 正常';
  return {
    ok: true,
    dryRun: true,
    noEgress: true,
    wave: 'M74',
    warnMs,
    reminders,
    approachingCount: approaching.length,
    overdueCount: overdue.length,
    tipZh,
    toastZh,
    shellHealth: health,
  };
}

export { listAnomalyChainResumeCards } from './anomaly-chain-job';
