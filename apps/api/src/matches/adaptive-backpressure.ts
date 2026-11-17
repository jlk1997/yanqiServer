/**
 * M66–M68：匹配打分并发 / 写库分片自适应背压。
 * M67：打分块耗时纳入背压（score-latency 联动并行）；写片仍看分片耗时。
 * M68：召回/候选拉取耗时纳入背压；与 demand 嵌入 lookahead 协同（软取消两边同停）。
 * MATCH_ADAPTIVE_BP=0 可关闭（仍返回基线 knobs）。
 */

export type AdaptiveBpKnobs = {
  enabled: boolean;
  parallelBase: number;
  parallelMin: number;
  parallelMax: number;
  writeShardBase: number;
  writeShardMin: number;
  writeShardMax: number;
  slowMs: number;
  fastMs: number;
  scoreSlowMs: number;
  scoreFastMs: number;
  recallSlowMs: number;
  recallFastMs: number;
  window: number;
};

export type AdaptiveBpAdjustment = {
  at: number;
  parallel: number;
  writeShard: number;
  avgShardMs: number | null;
  avgScoreMs: number | null;
  avgRecallMs: number | null;
  reasonZh: string;
  direction: 'shrink' | 'expand' | 'hold';
  source: 'write' | 'score' | 'recall' | 'hold';
};

export type AdaptiveBpState = {
  parallel: number;
  writeShard: number;
  avgShardMs: number | null;
  avgScoreMs: number | null;
  avgRecallMs: number | null;
  samples: number;
  scoreSamples: number;
  recallSamples: number;
  adjustments: AdaptiveBpAdjustment[];
  lastDirection: 'shrink' | 'expand' | 'hold' | null;
  knobs: AdaptiveBpKnobs;
  tipZh: string;
  wave: string;
  scoreLatencyInBp: boolean;
  recallLatencyInBp: boolean;
  /** M82：背压方向可喂给 ANN 冷却，防 thrash */
  annCooldownLink: boolean;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function readAdaptiveBpKnobs(): AdaptiveBpKnobs {
  const parallelBase = clamp(Number(process.env.MATCH_DEMAND_PARALLEL || 2) || 2, 1, 4);
  const writeShardBase = clamp(Number(process.env.MATCH_WRITE_SHARD || 25) || 25, 5, 80);
  const parallelMin = clamp(Number(process.env.MATCH_PARALLEL_MIN || 1) || 1, 1, parallelBase);
  const parallelMax = clamp(Number(process.env.MATCH_PARALLEL_MAX || 4) || 4, parallelBase, 4);
  const writeShardMin = clamp(Number(process.env.MATCH_WRITE_SHARD_MIN || 5) || 5, 5, writeShardBase);
  const writeShardMax = clamp(Number(process.env.MATCH_WRITE_SHARD_MAX || 80) || 80, writeShardBase, 80);
  const slowMs = Math.max(50, Number(process.env.MATCH_BP_SLOW_MS || 400) || 400);
  const fastMs = Math.max(10, Math.min(slowMs - 1, Number(process.env.MATCH_BP_FAST_MS || 80) || 80));
  const scoreSlowMs = Math.max(
    50,
    Number(process.env.MATCH_BP_SCORE_SLOW_MS || process.env.MATCH_BP_SLOW_MS || 350) || 350,
  );
  const scoreFastMs = Math.max(
    10,
    Math.min(
      scoreSlowMs - 1,
      Number(process.env.MATCH_BP_SCORE_FAST_MS || process.env.MATCH_BP_FAST_MS || 60) || 60,
    ),
  );
  const recallSlowMs = Math.max(
    50,
    Number(process.env.MATCH_BP_RECALL_SLOW_MS || process.env.MATCH_BP_SCORE_SLOW_MS || 300) || 300,
  );
  const recallFastMs = Math.max(
    10,
    Math.min(
      recallSlowMs - 1,
      Number(process.env.MATCH_BP_RECALL_FAST_MS || process.env.MATCH_BP_SCORE_FAST_MS || 50) || 50,
    ),
  );
  const window = clamp(Number(process.env.MATCH_BP_WINDOW || 6) || 6, 2, 16);
  const enabled = String(process.env.MATCH_ADAPTIVE_BP ?? '1') !== '0';
  return {
    enabled,
    parallelBase,
    parallelMin,
    parallelMax,
    writeShardBase,
    writeShardMin,
    writeShardMax,
    slowMs,
    fastMs,
    scoreSlowMs,
    scoreFastMs,
    recallSlowMs,
    recallFastMs,
    window,
  };
}

export type AdaptiveBpAdjustListener = (adj: AdaptiveBpAdjustment) => void;

export function createAdaptiveBackpressure(knobs?: AdaptiveBpKnobs): {
  state: AdaptiveBpState;
  noteShardLatency: (ms: number) => AdaptiveBpState;
  noteScoreLatency: (ms: number) => AdaptiveBpState;
  noteRecallLatency: (ms: number) => AdaptiveBpState;
  snapshot: () => AdaptiveBpState;
  progressZh: () => string;
  lastAdjustment: () => AdaptiveBpAdjustment | null;
  onAdjust: (fn: AdaptiveBpAdjustListener) => () => void;
} {
  const k = knobs || readAdaptiveBpKnobs();
  const writeLatencies: number[] = [];
  const scoreLatencies: number[] = [];
  const recallLatencies: number[] = [];
  const listeners: AdaptiveBpAdjustListener[] = [];
  const state: AdaptiveBpState = {
    parallel: k.parallelBase,
    writeShard: k.writeShardBase,
    avgShardMs: null,
    avgScoreMs: null,
    avgRecallMs: null,
    samples: 0,
    scoreSamples: 0,
    recallSamples: 0,
    adjustments: [],
    lastDirection: null,
    knobs: k,
    tipZh: k.enabled
      ? `自适应背压已开：并行 ${k.parallelBase}（${k.parallelMin}–${k.parallelMax}）· 写片 ${k.writeShardBase}（${k.writeShardMin}–${k.writeShardMax}）· 写慢>${k.slowMs}ms / 打分慢>${k.scoreSlowMs}ms / 召回慢>${k.recallSlowMs}ms 收缩 · M83 可联动 ANN 冷却（滞回防 flip-flop）`
      : `自适应背压关闭（MATCH_ADAPTIVE_BP=0）；固定并行 ${k.parallelBase} · 写片 ${k.writeShardBase}`,
    wave: 'M83',
    scoreLatencyInBp: true,
    recallLatencyInBp: true,
    annCooldownLink: true,
  };

  const avgOf = (arr: number[]) => {
    if (!arr.length) return null;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  };

  const pushAdj = (
    direction: 'shrink' | 'expand' | 'hold',
    reasonZh: string,
    source: 'write' | 'score' | 'recall' | 'hold',
  ) => {
    if (direction === 'hold') return;
    const adj: AdaptiveBpAdjustment = {
      at: Date.now(),
      parallel: state.parallel,
      writeShard: state.writeShard,
      avgShardMs: state.avgShardMs,
      avgScoreMs: state.avgScoreMs,
      avgRecallMs: state.avgRecallMs,
      reasonZh,
      direction,
      source,
    };
    state.adjustments.push(adj);
    if (state.adjustments.length > 24) state.adjustments.shift();
    state.lastDirection = direction;
    state.tipZh = reasonZh;
    for (const fn of listeners) {
      try {
        fn(adj);
      } catch (_) {}
    }
  };

  const noteShardLatency = (ms: number) => {
    const safe = Math.max(0, Number(ms) || 0);
    writeLatencies.push(safe);
    while (writeLatencies.length > k.window) writeLatencies.shift();
    state.samples = writeLatencies.length;
    state.avgShardMs = avgOf(writeLatencies);
    if (!k.enabled || state.samples < 2 || state.avgShardMs == null) return snapshot();

    const avg = state.avgShardMs;
    let direction: 'shrink' | 'expand' | 'hold' = 'hold';
    let reasonZh = `写片均耗 ${avg}ms，保持并行 ${state.parallel} / 写片 ${state.writeShard}`;

    if (avg >= k.slowMs) {
      const nextShard = Math.max(k.writeShardMin, state.writeShard - 5);
      let nextPar = state.parallel;
      if (nextShard === state.writeShard || nextShard <= k.writeShardMin) {
        nextPar = Math.max(k.parallelMin, state.parallel - 1);
      }
      if (nextShard !== state.writeShard || nextPar !== state.parallel) {
        direction = 'shrink';
        reasonZh =
          `写片均耗 ${avg}ms ≥ 慢阈 ${k.slowMs}ms，收缩写片 ${state.writeShard}→${nextShard}` +
          (nextPar !== state.parallel ? ` · 并行 ${state.parallel}→${nextPar}` : '');
        state.writeShard = nextShard;
        state.parallel = nextPar;
      }
    } else if (avg <= k.fastMs) {
      const nextShard = Math.min(k.writeShardMax, state.writeShard + 5);
      let nextPar = state.parallel;
      if (nextShard === state.writeShard || nextShard >= k.writeShardMax) {
        nextPar = Math.min(k.parallelMax, state.parallel + 1);
      }
      if (nextShard !== state.writeShard || nextPar !== state.parallel) {
        direction = 'expand';
        reasonZh =
          `写片均耗 ${avg}ms ≤ 快阈 ${k.fastMs}ms，扩张写片 ${state.writeShard}→${nextShard}` +
          (nextPar !== state.parallel ? ` · 并行 ${state.parallel}→${nextPar}` : '');
        state.writeShard = nextShard;
        state.parallel = nextPar;
      }
    }

    pushAdj(direction, reasonZh, 'write');
    return snapshot();
  };

  /** M67：打分块/需求打分耗时 → 优先调并行（写片仍由 noteShardLatency 管） */
  const noteScoreLatency = (ms: number) => {
    const safe = Math.max(0, Number(ms) || 0);
    scoreLatencies.push(safe);
    while (scoreLatencies.length > k.window) scoreLatencies.shift();
    state.scoreSamples = scoreLatencies.length;
    state.avgScoreMs = avgOf(scoreLatencies);
    if (!k.enabled || state.scoreSamples < 2 || state.avgScoreMs == null) return snapshot();

    const avg = state.avgScoreMs;
    let direction: 'shrink' | 'expand' | 'hold' = 'hold';
    let reasonZh = `打分均耗 ${avg}ms，保持并行 ${state.parallel}`;

    if (avg >= k.scoreSlowMs) {
      const nextPar = Math.max(k.parallelMin, state.parallel - 1);
      if (nextPar !== state.parallel) {
        direction = 'shrink';
        reasonZh = `打分均耗 ${avg}ms ≥ 慢阈 ${k.scoreSlowMs}ms，收缩并行 ${state.parallel}→${nextPar}`;
        state.parallel = nextPar;
      }
    } else if (avg <= k.scoreFastMs) {
      const nextPar = Math.min(k.parallelMax, state.parallel + 1);
      if (nextPar !== state.parallel) {
        direction = 'expand';
        reasonZh = `打分均耗 ${avg}ms ≤ 快阈 ${k.scoreFastMs}ms，扩张并行 ${state.parallel}→${nextPar}`;
        state.parallel = nextPar;
      }
    }

    pushAdj(direction, reasonZh, 'score');
    return snapshot();
  };

  /** M68：召回/候选拉取耗时 → 优先调并行（与打分背压同向，不改写片） */
  const noteRecallLatency = (ms: number) => {
    const safe = Math.max(0, Number(ms) || 0);
    recallLatencies.push(safe);
    while (recallLatencies.length > k.window) recallLatencies.shift();
    state.recallSamples = recallLatencies.length;
    state.avgRecallMs = avgOf(recallLatencies);
    if (!k.enabled || state.recallSamples < 2 || state.avgRecallMs == null) return snapshot();

    const avg = state.avgRecallMs;
    let direction: 'shrink' | 'expand' | 'hold' = 'hold';
    let reasonZh = `召回均耗 ${avg}ms，保持并行 ${state.parallel}`;

    if (avg >= k.recallSlowMs) {
      const nextPar = Math.max(k.parallelMin, state.parallel - 1);
      if (nextPar !== state.parallel) {
        direction = 'shrink';
        reasonZh = `召回均耗 ${avg}ms ≥ 慢阈 ${k.recallSlowMs}ms，收缩并行 ${state.parallel}→${nextPar}`;
        state.parallel = nextPar;
      }
    } else if (avg <= k.recallFastMs) {
      const nextPar = Math.min(k.parallelMax, state.parallel + 1);
      if (nextPar !== state.parallel) {
        direction = 'expand';
        reasonZh = `召回均耗 ${avg}ms ≤ 快阈 ${k.recallFastMs}ms，扩张并行 ${state.parallel}→${nextPar}`;
        state.parallel = nextPar;
      }
    }

    pushAdj(direction, reasonZh, 'recall');
    return snapshot();
  };

  const snapshot = (): AdaptiveBpState => ({
    ...state,
    adjustments: [...state.adjustments],
    knobs: { ...k },
  });

  const progressZh = () =>
    `自适应背压：并行 ${state.parallel}/${k.parallelMax} · 写片 ${state.writeShard}` +
    (state.avgShardMs != null ? ` · 写近均 ${state.avgShardMs}ms` : '') +
    (state.avgScoreMs != null ? ` · 打分近均 ${state.avgScoreMs}ms` : '') +
    (state.avgRecallMs != null ? ` · 召回近均 ${state.avgRecallMs}ms` : '');

  const lastAdjustment = () =>
    state.adjustments.length ? state.adjustments[state.adjustments.length - 1] : null;

  const onAdjust = (fn: AdaptiveBpAdjustListener) => {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  };

  return {
    state,
    noteShardLatency,
    noteScoreLatency,
    noteRecallLatency,
    snapshot,
    progressZh,
    lastAdjustment,
    onAdjust,
  };
}

export function adaptiveBpKnobsDocZh(): string[] {
  return [
    'MATCH_ADAPTIVE_BP=1|0（默认 1）开启/关闭自适应背压',
    'MATCH_DEMAND_PARALLEL 基线并行（默认 2，上限 4）',
    'MATCH_PARALLEL_MIN / MATCH_PARALLEL_MAX 并行可调上下限',
    'MATCH_WRITE_SHARD 基线写库分片（默认 25）',
    'MATCH_WRITE_SHARD_MIN / MATCH_WRITE_SHARD_MAX 写片可调上下限',
    'MATCH_BP_SLOW_MS 写片慢阈（默认 400）：近均 ≥ 此值收缩写片',
    'MATCH_BP_FAST_MS 写片快阈（默认 80）：近均 ≤ 此值扩张写片',
    'MATCH_BP_SCORE_SLOW_MS 打分慢阈（默认 350）：近均 ≥ 此值收缩并行',
    'MATCH_BP_SCORE_FAST_MS 打分快阈（默认 60）：近均 ≤ 此值扩张并行',
    'MATCH_BP_RECALL_SLOW_MS 召回慢阈（默认 300）：近均 ≥ 此值收缩并行',
    'MATCH_BP_RECALL_FAST_MS 召回快阈（默认 50）：近均 ≤ 此值扩张并行',
    'MATCH_BP_WINDOW 滑动窗口样本数（默认 6）',
    'MATCH_SCORE_CHUNK 打分块大小（块间可软取消；M67 块耗时进背压）',
    'MATCH_SUPPLY_SCORE_OVERLAP=1|0（默认 1）供给缺失嵌入与打分重叠',
    'MATCH_DEMAND_EMBED_LOOKAHEAD=1|0（默认 1）下一条需求嵌入与当前打分重叠',
    'MATCH_DEMAND_EMBED_LOOKAHEAD_N 预取条数（默认 2，上限 4）',
    'MATCH_ANN_BP_COOLDOWN_LINK=1|0（默认 1）背压收缩/扩张联动 ANN 冷却防 thrash',
    'MATCH_ANN_BP_HYSTERESIS=1|0（默认 1）BP×ANN 冷却滞回带防 flip-flop',
    'MATCH_ANN_BP_HYSTERESIS_BAND_MS（默认 2500）滞回带宽毫秒',
  ];
}
