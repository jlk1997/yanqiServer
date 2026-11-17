/**
 * M84：按近期背压方向翻转率自适应滞回带宽。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type HysteresisAdaptState = {
  enabled: boolean;
  baseBandMs: number;
  liveBandMs: number;
  flipEvents: number[];
  flipRatePerMin: number;
  adaptedWiden: number;
  adaptedNarrow: number;
  tipZh: string;
  labelZh: string;
  wave: 'M84';
};

export function createHysteresisAdaptState(baseBandMs: number, enabled = true): HysteresisAdaptState {
  const band = Math.max(500, Number(baseBandMs) || 2500);
  return {
    enabled,
    baseBandMs: band,
    liveBandMs: band,
    flipEvents: [],
    flipRatePerMin: 0,
    adaptedWiden: 0,
    adaptedNarrow: 0,
    tipZh: enabled
      ? `滞回带自适应：基准 ${band}ms，按 BP 翻转率加宽/收窄`
      : '滞回带自适应关闭',
    labelZh: 'BP×ANN 滞回带自适应',
    wave: 'M84',
  };
}

/** 记录一次方向翻转，返回是否应扩大 band 后的 liveBandMs */
export function noteBpFlipAndAdapt(
  state: HysteresisAdaptState,
  nowMs = Date.now(),
): HysteresisAdaptState {
  if (!state.enabled) return state;
  const windowMs = Math.max(
    30_000,
    Number(process.env.MATCH_ANN_BP_HYSTERESIS_ADAPT_WINDOW_MS || 120_000) || 120_000,
  );
  state.flipEvents.push(nowMs);
  state.flipEvents = state.flipEvents.filter((t) => nowMs - t <= windowMs);
  const perMin = (state.flipEvents.length / Math.max(1, windowMs)) * 60_000;
  state.flipRatePerMin = Math.round(perMin * 100) / 100;
  const widenAt = Number(process.env.MATCH_ANN_BP_HYSTERESIS_FLIP_WIDEN || 2.5) || 2.5;
  const narrowAt = Number(process.env.MATCH_ANN_BP_HYSTERESIS_FLIP_NARROW || 0.6) || 0.6;
  const maxBand = Math.max(state.baseBandMs * 3, Number(process.env.MATCH_ANN_BP_HYSTERESIS_BAND_MAX_MS || 8000) || 8000);
  const minBand = Math.max(500, Math.round(state.baseBandMs * 0.6));
  let next = state.liveBandMs;
  if (state.flipRatePerMin >= widenAt) {
    next = Math.min(maxBand, Math.round(state.liveBandMs * 1.25 + 250));
    if (next !== state.liveBandMs) state.adaptedWiden += 1;
  } else if (state.flipRatePerMin <= narrowAt && state.liveBandMs > state.baseBandMs) {
    next = Math.max(minBand, Math.round(state.liveBandMs * 0.9));
    if (next !== state.liveBandMs) state.adaptedNarrow += 1;
  } else if (state.flipRatePerMin < narrowAt && state.liveBandMs > state.baseBandMs) {
    next = Math.max(state.baseBandMs, Math.round(state.liveBandMs * 0.95));
  }
  state.liveBandMs = next;
  state.tipZh =
    `滞回带 ${state.liveBandMs}ms（基准 ${state.baseBandMs}ms）· 翻转率 ${state.flipRatePerMin}/min` +
    (state.adaptedWiden || state.adaptedNarrow
      ? ` · 加宽${state.adaptedWiden}/收窄${state.adaptedNarrow}`
      : '');
  return state;
}

/** M85：滞回带自适应 ↔ 写库分片联动 */
export type HysteresisWriteShardLink = {
  enabled: boolean;
  writeShardBefore: number;
  writeShardAfter: number;
  delta: number;
  reasonZh: string;
  tipZh: string;
  labelZh: string;
  wave: 'M85' | 'M86' | 'M87';
};

/**
 * 滞回带加宽（翻转频繁）→ 收紧写片；收窄 → 允许略扩写片。
 * 不改 knobs 上下限，只在当前 writeShard 上做有界步进。
 */
export function linkHysteresisAdaptToWriteShard(
  hyst: HysteresisAdaptState,
  writeShard: number,
  opts: { min?: number; max?: number; enabled?: boolean } = {},
): { writeShard: number; link: HysteresisWriteShardLink } {
  const enabled = opts.enabled !== false && String(process.env.MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_LINK ?? '1') !== '0';
  const min = Math.max(5, Number(opts.min ?? process.env.MATCH_WRITE_SHARD_MIN ?? 5) || 5);
  const max = Math.max(min, Number(opts.max ?? process.env.MATCH_WRITE_SHARD_MAX ?? 80) || 80);
  const before = Math.max(min, Math.min(max, Number(writeShard) || 25));
  if (!enabled || !hyst.enabled) {
    return {
      writeShard: before,
      link: {
        enabled: false,
        writeShardBefore: before,
        writeShardAfter: before,
        delta: 0,
        reasonZh: '滞回×写片联动关闭',
        tipZh: 'MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_LINK=0 或滞回自适应关闭',
        labelZh: '滞回自适应×写库分片联动',
        wave: 'M85',
      },
    };
  }
  let after = before;
  let reasonZh = `写片保持 ${before}（滞回带 ${hyst.liveBandMs}ms · 翻转 ${hyst.flipRatePerMin}/min）`;
  // 带宽明显高于基准 → 收紧写片，降低 flip 时的写库抖动面
  if (hyst.liveBandMs >= hyst.baseBandMs * 1.15 || hyst.adaptedWiden > hyst.adaptedNarrow) {
    after = Math.max(min, before - 5);
    if (after !== before) {
      reasonZh = `滞回加宽/翻转偏多 → 收紧写片 ${before}→${after}（带 ${hyst.liveBandMs}ms）`;
    }
  } else if (
    hyst.liveBandMs <= hyst.baseBandMs * 1.02 &&
    hyst.flipRatePerMin <= Number(process.env.MATCH_ANN_BP_HYSTERESIS_FLIP_NARROW || 0.6)
  ) {
    after = Math.min(max, before + 5);
    if (after !== before) {
      reasonZh = `滞回收窄且翻转低 → 略扩写片 ${before}→${after}（带 ${hyst.liveBandMs}ms）`;
    }
  }
  return {
    writeShard: after,
    link: {
      enabled: true,
      writeShardBefore: before,
      writeShardAfter: after,
      delta: after - before,
      reasonZh,
      tipZh: reasonZh + ' · 软取消仍在',
      labelZh: '滞回自适应×写库分片联动',
      wave: 'M85',
    },
  };
}

/** M86：写片联动冷却防抖状态（避免 shard  thrash） */
export type HysteresisWriteShardLinkDebounce = {
  enabled: boolean;
  cooldownMs: number;
  lastLinkAt: number | null;
  lastAppliedDelta: number;
  suppressed: number;
  tipZh: string;
  labelZh: string;
  wave: 'M86' | 'M87';
};

export function createWriteShardLinkDebounce(
  cooldownMs?: number,
): HysteresisWriteShardLinkDebounce {
  const cd = Math.max(
    0,
    Number(
      cooldownMs ??
        process.env.MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_LINK_COOLDOWN_MS ??
        8000,
    ) || 8000,
  );
  return {
    enabled: String(process.env.MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_LINK_DEBOUNCE ?? '1') !== '0',
    cooldownMs: cd,
    lastLinkAt: null,
    lastAppliedDelta: 0,
    suppressed: 0,
    tipZh: cd
      ? `写片联动冷却 ${Math.round(cd / 1000)}s 防抖（避免分片 thrash）`
      : '写片联动冷却关闭',
    labelZh: '滞回×写片联动冷却防抖',
    wave: 'M86',
  };
}

/**
 * M86：带冷却的滞回×写片联动。冷却窗内二次联动被抑制，写片保持不变。
 */
export function linkHysteresisAdaptToWriteShardDebounced(
  hyst: HysteresisAdaptState,
  writeShard: number,
  debounce: HysteresisWriteShardLinkDebounce,
  opts: { min?: number; max?: number; enabled?: boolean; nowMs?: number } = {},
): {
  writeShard: number;
  link: HysteresisWriteShardLink & {
    debounced?: boolean;
    debounceRemainMs?: number;
    debounce?: HysteresisWriteShardLinkDebounce;
    wave: 'M85' | 'M86' | 'M87';
  };
  debounce: HysteresisWriteShardLinkDebounce;
} {
  const now = opts.nowMs ?? Date.now();
  const raw = linkHysteresisAdaptToWriteShard(hyst, writeShard, opts);
  if (!raw.link.enabled || !raw.link.delta) {
    return {
      writeShard: raw.writeShard,
      link: { ...raw.link, debounced: false, debounceRemainMs: 0, debounce, wave: 'M86' },
      debounce,
    };
  }
  const debOn = debounce.enabled !== false;
  const remain =
    debOn && debounce.lastLinkAt != null
      ? Math.max(0, debounce.cooldownMs - (now - debounce.lastLinkAt))
      : 0;
  if (debOn && remain > 0) {
    debounce.suppressed += 1;
    debounce.tipZh = `写片联动冷却中 · 剩余 ${Math.ceil(remain / 1000)}s · 已抑制 ${debounce.suppressed} 次 · 保持写片 ${writeShard}`;
    return {
      writeShard,
      link: {
        ...raw.link,
        writeShardBefore: writeShard,
        writeShardAfter: writeShard,
        delta: 0,
        reasonZh: `冷却防抖：抑制写片 ${raw.link.writeShardBefore}→${raw.link.writeShardAfter}（剩余 ${Math.ceil(remain / 1000)}s）`,
        tipZh: debounce.tipZh + ' · 软取消仍在',
        labelZh: '滞回自适应×写库分片联动（冷却防抖）',
        wave: 'M86',
        debounced: true,
        debounceRemainMs: remain,
        debounce: { ...debounce },
      },
      debounce,
    };
  }
  debounce.lastLinkAt = now;
  debounce.lastAppliedDelta = raw.link.delta;
  debounce.tipZh = `写片联动已应用 ${raw.link.writeShardBefore}→${raw.link.writeShardAfter} · 冷却 ${Math.round(debounce.cooldownMs / 1000)}s`;
  return {
    writeShard: raw.writeShard,
    link: {
      ...raw.link,
      tipZh: raw.link.tipZh + ` · 冷却防抖 ${Math.round(debounce.cooldownMs / 1000)}s`,
      labelZh: '滞回自适应×写库分片联动（冷却防抖）',
      wave: 'M86',
      debounced: false,
      debounceRemainMs: 0,
      debounce: { ...debounce },
    },
    debounce,
  };
}

/** M87：写片冷却与近期 BP 延迟分位数联动 */
export type BpLatencyPercentiles = {
  writeP50: number | null;
  writeP90: number | null;
  scoreP50: number | null;
  scoreP90: number | null;
  recallP50: number | null;
  recallP90: number | null;
  sampleN: number;
};

function pctile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function computeBpLatencyPercentiles(samples: {
  writeMs?: number[];
  scoreMs?: number[];
  recallMs?: number[];
}): BpLatencyPercentiles {
  const sort = (a: number[] | undefined) =>
    (Array.isArray(a) ? a.map((n) => Math.max(0, Number(n) || 0)) : []).slice().sort((x, y) => x - y);
  const w = sort(samples.writeMs);
  const s = sort(samples.scoreMs);
  const r = sort(samples.recallMs);
  return {
    writeP50: pctile(w, 50),
    writeP90: pctile(w, 90),
    scoreP50: pctile(s, 50),
    scoreP90: pctile(s, 90),
    recallP50: pctile(r, 50),
    recallP90: pctile(r, 90),
    sampleN: w.length + s.length + r.length,
  };
}

/**
 * M87：按 BP 写片/打分 p90 相对慢阈，拉长或缩短写片联动冷却。
 * p90 越靠近/超过慢阈 → 冷却加长；越快 → 冷却缩短。
 */
export function adaptWriteShardCooldownByBpPercentile(
  debounce: HysteresisWriteShardLinkDebounce,
  pct: BpLatencyPercentiles,
  opts: {
    writeSlowMs?: number;
    writeFastMs?: number;
    scoreSlowMs?: number;
    baseCooldownMs?: number;
  } = {},
): HysteresisWriteShardLinkDebounce & {
  bpPercentileLink: {
    enabled: boolean;
    beforeMs: number;
    afterMs: number;
    reasonZh: string;
    percentiles: BpLatencyPercentiles;
    wave: 'M87';
    labelZh: string;
    tipZh: string;
  };
} {
  const enabled = String(process.env.MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_COOLDOWN_BP_PCTILE ?? '1') !== '0';
  const base =
    (opts.baseCooldownMs != null
      ? Number(opts.baseCooldownMs)
      : Number(process.env.MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_LINK_COOLDOWN_MS || debounce.cooldownMs || 8000)) ||
    8000;
  const writeSlow = (opts.writeSlowMs != null ? Number(opts.writeSlowMs) : Number(process.env.MATCH_BP_SLOW_MS || 400)) || 400;
  const writeFast = (opts.writeFastMs != null ? Number(opts.writeFastMs) : Number(process.env.MATCH_BP_FAST_MS || 80)) || 80;
  const scoreSlow = (opts.scoreSlowMs != null ? Number(opts.scoreSlowMs) : Number(process.env.MATCH_BP_SCORE_SLOW_MS || 350)) || 350;
  const before = debounce.cooldownMs;
  let after = before;
  let reasonZh = `冷却保持 ${before}ms（BP 分位样 ${pct.sampleN}）`;
  if (enabled && pct.sampleN > 0) {
    const p90 = pct.writeP90 ?? pct.scoreP90 ?? null;
    const scoreP90 = pct.scoreP90;
    if (p90 != null && p90 >= writeSlow) {
      after = Math.min(Math.round(base * 2.5), Math.round(before * 1.35 + 1500));
      reasonZh = `写片 p90=${p90}ms ≥ 慢阈 ${writeSlow}ms → 冷却 ${before}→${after}ms`;
    } else if (scoreP90 != null && scoreP90 >= scoreSlow) {
      after = Math.min(Math.round(base * 2), Math.round(before * 1.2 + 800));
      reasonZh = `打分 p90=${scoreP90}ms ≥ 慢阈 ${scoreSlow}ms → 冷却 ${before}→${after}ms`;
    } else if (p90 != null && p90 <= writeFast) {
      after = Math.max(Math.round(base * 0.5), Math.round(before * 0.85));
      reasonZh = `写片 p90=${p90}ms ≤ 快阈 ${writeFast}ms → 冷却 ${before}→${after}ms`;
    } else {
      after = Math.round(base);
      reasonZh = `BP 分位平稳（写 p90=${pct.writeP90 ?? '—'} · 打分 p90=${pct.scoreP90 ?? '—'}）→ 冷却回基准 ${after}ms`;
    }
  } else if (!enabled) {
    reasonZh = '写片冷却×BP 分位联动关闭';
  }
  debounce.cooldownMs = after;
  debounce.tipZh = reasonZh + (debounce.suppressed ? ` · 已抑制 ${debounce.suppressed}` : '');
  debounce.wave = 'M87' as any;
  return Object.assign(debounce, {
    bpPercentileLink: {
      enabled,
      beforeMs: before,
      afterMs: after,
      reasonZh,
      percentiles: pct,
      wave: 'M87' as const,
      labelZh: '写片冷却×BP 延迟分位联动',
      tipZh: reasonZh + ' · 软取消仍在',
    },
  });
}


/** M88：写片冷却×BP 分位火花图（轻量落盘，干跑友好） */
export type WriteShardCooldownSparkPoint = {
  at: string;
  cooldownMs: number;
  writeP90: number | null;
  scoreP90: number | null;
  writeP50: number | null;
  scoreP50: number | null;
  sampleN: number;
  reasonZh?: string;
};

function sparkTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function sparkPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', sparkTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'write-shard-cooldown-bp-pctile-sparkline.json');
}

export function recordWriteShardCooldownSparkPoint(
  tenantId: string | null | undefined,
  point: {
    cooldownMs: number;
    percentiles?: BpLatencyPercentiles | null;
    reasonZh?: string;
  },
): WriteShardCooldownSparkPoint {
  const tid = sparkTenant(tenantId);
  const pth = sparkPath(tid);
  let arr: WriteShardCooldownSparkPoint[] = [];
  try {
    if (existsSync(pth)) {
      const raw = JSON.parse(readFileSync(pth, 'utf8'));
      arr = Array.isArray(raw?.points) ? raw.points : Array.isArray(raw) ? raw : [];
    }
  } catch (_) {
    arr = [];
  }
  const pct = point.percentiles || null;
  const row: WriteShardCooldownSparkPoint = {
    at: new Date().toISOString(),
    cooldownMs: Math.max(0, Number(point.cooldownMs) || 0),
    writeP90: pct?.writeP90 ?? null,
    scoreP90: pct?.scoreP90 ?? null,
    writeP50: pct?.writeP50 ?? null,
    scoreP50: pct?.scoreP50 ?? null,
    sampleN: pct?.sampleN ?? 0,
    reasonZh: point.reasonZh || undefined,
  };
  arr.push(row);
  while (arr.length > 48) arr.shift();
  writeFileSync(pth, JSON.stringify({ points: arr, wave: 'M89', updatedAt: row.at }, null, 0), 'utf8');
  return row;
}

function sparkBars(values: number[], width = 24): string {
  if (!values.length) return '—';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const chars = '▁▂▃▄▅▆▇█';
  return values
    .slice(-width)
    .map((v) => {
      if (max <= min) return chars[0];
      const t = (v - min) / (max - min);
      return chars[Math.min(chars.length - 1, Math.max(0, Math.round(t * (chars.length - 1))))];
    })
    .join('');
}

export function readWriteShardCooldownBpPctileSparkline(
  tenantId?: string | null,
  opts: { seed?: boolean } = {},
) {
  const tid = sparkTenant(tenantId);
  const pth = sparkPath(tid);
  let arr: WriteShardCooldownSparkPoint[] = [];
  try {
    if (existsSync(pth)) {
      const raw = JSON.parse(readFileSync(pth, 'utf8'));
      arr = Array.isArray(raw?.points) ? raw.points : Array.isArray(raw) ? raw : [];
    }
  } catch (_) {
    arr = [];
  }
  if (opts.seed || !arr.length) {
    const base = 8000;
    const seeds: WriteShardCooldownSparkPoint[] = [];
    for (let i = 0; i < 12; i++) {
      const writeP90 = 60 + i * 35 + (i % 3) * 20;
      const scoreP90 = 50 + i * 28;
      let cooldownMs = base;
      if (writeP90 >= 400) cooldownMs = Math.round(base * 1.8);
      else if (writeP90 <= 80) cooldownMs = Math.round(base * 0.6);
      else cooldownMs = Math.round(base * (0.9 + i * 0.05));
      seeds.push({
        at: new Date(Date.now() - (12 - i) * 60_000).toISOString(),
        cooldownMs,
        writeP90,
        scoreP90,
        writeP50: Math.round(writeP90 * 0.55),
        scoreP50: Math.round(scoreP90 * 0.55),
        sampleN: 8 + i,
        reasonZh: `干跑样点 #${i + 1}`,
      });
    }
    if (!arr.length || opts.seed) {
      arr = opts.seed ? seeds : seeds;
      writeFileSync(
        pth,
        JSON.stringify({ points: arr, wave: 'M89', seeded: true, updatedAt: new Date().toISOString() }, null, 0),
        'utf8',
      );
    }
  }
  const cool = arr.map((p) => p.cooldownMs);
  const wp90 = arr.map((p) => (p.writeP90 != null ? p.writeP90 : 0));
  const sp90 = arr.map((p) => (p.scoreP90 != null ? p.scoreP90 : 0));
  const last = arr.length ? arr[arr.length - 1] : null;
  const tipZh = last
    ? `写片冷却火花 ${arr.length} 点 · 末冷却 ${last.cooldownMs}ms · 写p90=${last.writeP90 ?? '—'} · 打分p90=${last.scoreP90 ?? '—'}`
    : '写片冷却×BP 分位火花图为空（可 seed 干跑样）';
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '写片冷却×BP 延迟分位火花图',
    tipZh: tipZh + ' · 软取消仍在 · 干跑无外发',
    toastZh: last ? `冷却火花 · ${last.cooldownMs}ms` : '冷却火花空',
    busyZh: '加载写片冷却分位火花图…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    points: arr.slice(-24),
    count: arr.length,
    sparkline: {
      cooldownZh: sparkBars(cool),
      writeP90Zh: sparkBars(wp90),
      scoreP90Zh: sparkBars(sp90),
      legendZh: '上：冷却ms · 中：写片p90 · 下：打分p90',
    },
    latest: last,
    dayDrillLabelZh: '写片冷却火花日点钻取',
    dayDrillPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill',
    dayDrillTipZh: '点击火花日点可钻取冷却×BP 分位明细',
  };
}


/** M89：写片冷却×BP 火花图日点钻取 */
export function drillWriteShardCooldownSparkDayPoint(
  tenantId?: string | null,
  opts: { day?: string | null; index?: number | null; at?: string | null } = {},
) {
  const board = readWriteShardCooldownBpPctileSparkline(tenantId, { seed: true });
  const points = board.points || [];
  let hit: WriteShardCooldownSparkPoint | null = null;
  let hitIndex = -1;
  const wantAt = opts.at ? String(opts.at) : null;
  const wantDay = opts.day ? String(opts.day).slice(0, 10) : null;
  const wantIdx = opts.index != null ? Number(opts.index) : null;

  if (wantAt) {
    hitIndex = points.findIndex((p) => p.at === wantAt);
    if (hitIndex < 0) hitIndex = points.findIndex((p) => String(p.at).startsWith(wantAt.slice(0, 16)));
  } else if (wantDay) {
    hitIndex = points.findIndex((p) => String(p.at).slice(0, 10) === wantDay);
  } else if (wantIdx != null && Number.isFinite(wantIdx)) {
    hitIndex = Math.max(0, Math.min(points.length - 1, wantIdx));
  } else if (points.length) {
    hitIndex = points.length - 1;
  }
  if (hitIndex >= 0 && hitIndex < points.length) hit = points[hitIndex];

  // 同日邻点
  const dayKey = hit ? String(hit.at).slice(0, 10) : wantDay;
  const sameDay = dayKey
    ? points
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => String(p.at).slice(0, 10) === dayKey)
    : [];

  const alertZh =
    hit && hit.writeP90 != null && hit.writeP90 >= 400
      ? '写片 p90 偏高 · 冷却已加长'
      : hit && hit.cooldownMs <= 5000
        ? '冷却偏短 · 写片延迟较低'
        : hit
          ? '冷却与分位处于常态'
          : '无日点可钻';

  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '写片冷却×BP 火花日点钻取',
    tipZh: hit
      ? `日点 #${hitIndex + 1}/${points.length} · ${String(hit.at).slice(0, 19)} · 冷却 ${hit.cooldownMs}ms · 写p90=${hit.writeP90 ?? '—'} · 打分p90=${hit.scoreP90 ?? '—'} · ${alertZh} · 软取消仍在`
      : '火花图无日点；可先 seed 干跑样',
    toastZh: hit ? `冷却日点 · ${hit.cooldownMs}ms` : '日点空',
    busyZh: '钻取写片冷却火花日点…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    day: dayKey || null,
    index: hitIndex >= 0 ? hitIndex : null,
    point: hit,
    sameDayCount: sameDay.length,
    sameDayIndexes: sameDay.map(({ i }) => i),
    alertZh,
    neighbors: sameDay.slice(0, 8).map(({ p, i }) => ({
      index: i,
      at: p.at,
      cooldownMs: p.cooldownMs,
      writeP90: p.writeP90,
      scoreP90: p.scoreP90,
      reasonZh: p.reasonZh || null,
    })),
    sparkline: board.sparkline,
    boardTipZh: board.tipZh,
    drillPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill',
  };
}


/** M90：冷却日点 → 建议 bust+reprobe 串联（干跑计划，无外发） */
export function suggestBustChainFromCooldownSparkDay(
  tenantId?: string | null,
  opts: {
    day?: string | null;
    index?: number | null;
    at?: string | null;
    executeDryRun?: boolean;
  } = {},
) {
  const drill = drillWriteShardCooldownSparkDayPoint(tenantId, opts);
  const hit = drill.point;
  const writeP90 = hit?.writeP90 != null ? Number(hit.writeP90) : null;
  const cooldownMs = hit?.cooldownMs != null ? Number(hit.cooldownMs) : null;
  const scoreP90 = hit?.scoreP90 != null ? Number(hit.scoreP90) : null;

  const reasons: string[] = [];
  let severity: 'low' | 'mid' | 'high' = 'low';
  if (writeP90 != null && writeP90 >= 500) {
    reasons.push(`写片 p90=${writeP90} 偏高`);
    severity = 'high';
  } else if (writeP90 != null && writeP90 >= 400) {
    reasons.push(`写片 p90=${writeP90} 略高`);
    severity = 'mid';
  }
  if (cooldownMs != null && cooldownMs >= 20000) {
    reasons.push(`冷却 ${cooldownMs}ms 偏长`);
    if (severity === 'low') severity = 'mid';
  }
  if (scoreP90 != null && scoreP90 >= 400) {
    reasons.push(`打分 p90=${scoreP90} 偏高`);
    if (severity === 'low') severity = 'mid';
  }
  if (!reasons.length) {
    reasons.push(drill.alertZh || '日点处于常态 · 仍可干跑串联验证');
  }

  const phases =
    severity === 'high'
      ? ['attribution', 'bust', 'reprobe', 'heal']
      : severity === 'mid'
        ? ['bust', 'reprobe']
        : ['bust'];

  const chainPlan = {
    labelZh: '冷却日点建议 bust 串联',
    severity,
    severityZh: severity === 'high' ? '高' : severity === 'mid' ? '中' : '低',
    reasonsZh: reasons,
    phases,
    phasesZh: phases.map((p) =>
      p === 'bust'
        ? '建议 bust'
        : p === 'reprobe'
          ? 'HIT 复探针'
          : p === 'attribution'
            ? '异常归因'
            : p === 'heal'
              ? 'SLA 自愈'
              : p,
    ),
    enqueuePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun',
    chainPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain',
    dryRun: true as const,
    noEgress: true as const,
    tipZh: `建议串联 ${phases.join('→')}（${reasons.join('；')}）· 干跑无外发 · 软取消仍在`,
  };

  return {
    ...drill,
    wave: 'M90' as const,
    labelZh: '冷却日点 → 建议 bust 串联',
    tipZh: (drill.tipZh || '') + ' · ' + chainPlan.tipZh,
    toastZh: hit ? `日点串联建议 · ${chainPlan.severityZh}` : '日点空',
    busyZh: '冷却日点建议 bust 串联…',
    suggestedBustChain: chainPlan,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
  };
}


/** M91：冷却日点建议 bust 串联失败归因卡（中文；干跑无外发） */
export function attributeSuggestBustChainFailure(
  tenantId?: string | null,
  opts: {
    day?: string | null;
    index?: number | null;
    at?: string | null;
    enqueueResult?: any;
    tickResult?: any;
    simulateFail?: boolean;
    failPhase?: string | null;
    failReasonZh?: string | null;
  } = {},
) {
  const plan = suggestBustChainFromCooldownSparkDay(tenantId, {
    day: opts.day,
    index: opts.index,
    at: opts.at,
  });
  const chain = (plan as any).suggestedBustChain || {};
  const enq = opts.enqueueResult || null;
  const tick = opts.tickResult || null;
  const failPhase = String(opts.failPhase || tick?.failedPhase || enq?.failedPhase || '').trim() || null;
  const reasons: Array<{ code: string; zh: string; severity: 'low' | 'mid' | 'high' }> = [];

  if (opts.simulateFail || opts.failReasonZh) {
    reasons.push({
      code: 'simulated',
      zh: opts.failReasonZh || `模拟失败于阶段 ${failPhase || chain.phases?.[0] || 'bust'}`,
      severity: 'high',
    });
  }
  if (enq && enq.ok === false) {
    reasons.push({
      code: 'enqueue_rejected',
      zh: enq.tipZh || enq.toastZh || '批重跑入队被拒',
      severity: 'high',
    });
  }
  if (tick) {
    const failedItems = (tick.queue?.items || tick.items || []).filter(
      (i: any) => i?.status === 'failed',
    );
    for (const it of failedItems.slice(0, 6)) {
      reasons.push({
        code: 'phase_failed',
        zh: `阶段「${it.phase || '?'}」失败${it.tipZh ? ' · ' + it.tipZh : ''}${it.failSimulated ? '（模拟）' : ''}`,
        severity: 'high',
      });
    }
    if (tick.ok === false) {
      reasons.push({
        code: 'tick_failed',
        zh: tick.tipZh || tick.toastZh || '批重跑 tick 失败',
        severity: 'mid',
      });
    }
  }
  if (!(plan as any).point) {
    reasons.push({
      code: 'no_day_point',
      zh: '冷却火花无日点可钻 · 无法生成可靠串联',
      severity: 'mid',
    });
  }
  if (!reasons.length) {
    reasons.push({
      code: 'none',
      zh: '当前无失败 · 串联计划可干跑验证',
      severity: 'low',
    });
  }

  const top = reasons[0];
  const attributionCard = {
    titleZh: '冷却串联失败归因',
    bodyZh:
      top.code === 'none'
        ? '未检测到失败。可继续干跑 bust→reprobe 验证。'
        : `失败主因：${top.zh}。请核对冷却日点与批重跑队列后重试。`,
    severity: top.severity,
    severityZh: top.severity === 'high' ? '高' : top.severity === 'mid' ? '中' : '低',
    reasonsZh: reasons.map((r) => r.zh),
    reasons,
    failPhase: failPhase || (top.code === 'phase_failed' ? String(reasons[0]?.zh || '').match(/「([^」]+)」/)?.[1] || null : null),
    suggestedNextZh:
      top.code === 'no_day_point'
        ? '先 seed 冷却火花再日点钻取'
        : top.code === 'enqueue_rejected'
          ? '检查批重跑队列是否已满/已取消，再入队'
          : top.code === 'none'
            ? '可 enqueue 干跑串联'
            : '对失败阶段单独重试或提高 retryBudget',
    oneClickRetryLabelZh: '一键重试失败阶段（干跑）',
    oneClickRetryPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase',
    oneClickRetryPhase: failPhase || (top.code === 'phase_failed' ? String(reasons[0]?.zh || '').match(/「([^」]+)」/)?.[1] || 'bust' : top.code === 'none' ? null : 'bust'),
    midPageCancelIntact: true,
    dryRun: true,
    noEgress: true,
    wave: 'M92',
  };

  return {
    ...plan,
    wave: 'M92' as const,
    labelZh: '冷却串联失败归因卡',
    tipZh: ((plan as any).tipZh || '') + ' · ' + attributionCard.bodyZh + ' · 可一键重试失败阶段 · 软取消仍在',
    toastZh: top.code === 'none' ? '串联无失败' : `串联失败归因 · ${attributionCard.severityZh}`,
    busyZh: '生成冷却串联失败归因…',
    failed: top.code !== 'none',
    attributionCard,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
    attributionPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution',
    retryFailedPhasePath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase',
  };
}

/** M92/M93：从失败归因卡一键重试失败阶段（干跑、无外发）；M93 并入串联异常任务卡 */
export function wrapRetryFailedPhaseFromAttribution(
  attribution: any,
  stepResult: any,
  opts: { phase?: string | null; dryRun?: boolean; foldIntoChainTaskCard?: boolean; tenantId?: string | null } = {},
) {
  const card = attribution?.attributionCard || {};
  const phase =
    String(opts.phase || card.oneClickRetryPhase || card.failPhase || 'bust').trim() || 'bust';
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  let chainTaskCard: any = null;
  let folded = false;
  if (opts.foldIntoChainTaskCard !== false) {
    try {
      // lazy require 避免循环依赖
      const chain = require('../workbench/anomaly-chain-job') as typeof import('../workbench/anomaly-chain-job');
      const inbox = require('../workbench/inbox-delta-cache') as typeof import('../workbench/inbox-delta-cache');
      const tid = opts.tenantId || null;
      const phaseForChain =
        phase === 'heal' || phase === 'reprobe' || phase === 'bust' || phase === 'attribution'
          ? (phase as any)
          : 'bust';
      const detailZh =
        `冷却归因一键重试「${phaseZhMap[phase] || phase}」` +
        (stepResult?.tipZh ? ' · ' + String(stepResult.tipZh).slice(0, 120) : '');
      const job = chain.markAnomalyChainPhase(tid, {
        phase: phaseForChain,
        tipZh: detailZh + ' · 已并入串联任务卡 · 干跑无外发 · 软取消仍在',
        toastZh: `归因重试并入任务卡 · ${phaseZhMap[phase] || phase}`,
        busyZh: `串联任务卡 · 重试 ${phaseZhMap[phase] || phase}…`,
        lastResult: { from: 'cooldown-attr-retry', phase, step: stepResult || null, wave: 'M93' },
        itemizedDetail: { [phaseForChain]: detailZh } as any,
      });
      chainTaskCard = inbox.getAnomalyChainJobCard(tid);
      chainTaskCard = {
        ...chainTaskCard,
        wave: 'M93',
        foldedFromAttrRetry: true,
        foldedPhase: phase,
        foldedPhaseZh: phaseZhMap[phase] || phase,
        tipZh: (chainTaskCard?.tipZh || '') + ' · ' + detailZh,
        toastZh: `重试已并入串联任务卡 · ${phaseZhMap[phase] || phase}`,
        job,
      };
      folded = true;
    } catch (_) {
      folded = false;
      chainTaskCard = null;
    }
  }
  return {
    ok: true as const,
    wave: 'M93' as const,
    labelZh: folded ? '冷却归因一键重试失败阶段（已并入串联任务卡）' : '冷却归因一键重试失败阶段',
    tipZh:
      `已对失败阶段「${phaseZhMap[phase] || phase}」干跑重试` +
      (stepResult?.tipZh ? ' · ' + stepResult.tipZh : '') +
      (folded ? ' · 已并入串联异常任务卡' : '') +
      ' · 无外发 · 软取消仍在',
    toastZh: folded
      ? `一键重试并入任务卡 · ${phaseZhMap[phase] || phase}`
      : `一键重试 · ${phaseZhMap[phase] || phase}`,
    busyZh: `重试失败阶段「${phaseZhMap[phase] || phase}」…`,
    dryRun: opts.dryRun !== false,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    retriedPhase: phase,
    retriedPhaseZh: phaseZhMap[phase] || phase,
    attributionCard: card,
    step: stepResult || null,
    retryFromAttribution: true as const,
    foldedIntoChainTaskCard: folded,
    chainTaskCard,
    foldIntoChainTaskCardPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card',
    retryPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase',
  };
}
