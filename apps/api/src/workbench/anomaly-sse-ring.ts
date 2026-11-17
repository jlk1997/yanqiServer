/**
 * M85：异常串联 EventSource 事件环 + Last-Event-ID 断线续订 + 分项 expected/actual 对照。
 * 干跑无外发；不扩张配额子系统。
 */
import type { AnomalyItemizedPhase } from './anomaly-chain-job';

export type AnomalySseEvent = {
  id: number;
  at: string;
  event: 'progress' | 'end' | 'error' | 'resume';
  payload: any;
};

const rings = new Map<string, AnomalySseEvent[]>();
const seqByTenant = new Map<string, number>();
const MAX = 48;

function tid(t?: string | null) {
  return String(t || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

export function nextAnomalySseEventId(tenantId?: string | null): number {
  const k = tid(tenantId);
  const n = (seqByTenant.get(k) || 0) + 1;
  seqByTenant.set(k, n);
  return n;
}

export function pushAnomalySseEvent(
  tenantId: string | null | undefined,
  event: 'progress' | 'end' | 'error' | 'resume',
  payload: any,
): AnomalySseEvent {
  const k = tid(tenantId);
  const id = nextAnomalySseEventId(k);
  const row: AnomalySseEvent = {
    id,
    at: new Date().toISOString(),
    event,
    payload: { ...payload, eventId: id, lastEventId: id },
  };
  const arr = rings.get(k) || [];
  arr.push(row);
  while (arr.length > MAX) arr.shift();
  rings.set(k, arr);
  return row;
}

/** 返回 lastEventId 之后的事件（不含 lastEventId 本身） */
export function replayAnomalySseAfter(
  tenantId: string | null | undefined,
  lastEventId?: number | string | null,
): AnomalySseEvent[] {
  const k = tid(tenantId);
  const arr = rings.get(k) || [];
  const n = lastEventId == null || lastEventId === '' ? 0 : Number(lastEventId);
  if (!Number.isFinite(n) || n <= 0) return [];
  return arr.filter((e) => e.id > n);
}

export function peekAnomalySseRing(tenantId?: string | null) {
  const k = tid(tenantId);
  const arr = rings.get(k) || [];
  return {
    ok: true,
    wave: 'M87' as const,
    labelZh: '异常 EventSource 事件环',
    tipZh: `环内 ${arr.length} 条 · 最新 id=${arr.length ? arr[arr.length - 1].id : 0}`,
    count: arr.length,
    latestId: arr.length ? arr[arr.length - 1].id : 0,
    events: arr.slice(-12),
    dryRun: true as const,
    noEgress: true as const,
  };
}

const EXPECTED_PHASES: Array<{ id: AnomalyItemizedPhase['id']; labelZh: string; expectedStatus: AnomalyItemizedPhase['status'] }> = [
  { id: 'attribution', labelZh: '异常归因', expectedStatus: 'done' },
  { id: 'bust', labelZh: '建议 bust', expectedStatus: 'done' },
  { id: 'reprobe', labelZh: 'HIT 复探针', expectedStatus: 'done' },
  { id: 'heal', labelZh: 'SLA 自愈', expectedStatus: 'done' },
];

/** 分项阶段 expected vs actual 对照表 */
export function buildAnomalyItemizedPhaseContrast(
  itemizedPhases?: AnomalyItemizedPhase[] | null,
  jobStatus?: string | null,
): {
  ok: true;
  wave: 'M87';
  labelZh: string;
  tipZh: string;
  toastZh: string;
  busyZh: string;
  dryRun: true;
  noEgress: true;
  rows: Array<{
    id: string;
    labelZh: string;
    expected: string;
    expectedZh: string;
    actual: string;
    actualZh: string;
    match: boolean;
    detailZh?: string;
    rerunAvailable: boolean;
    rerunLabelZh: string;
    rerunPath: string;
    rerunBody: { phase: string; dryRun: true };
  }>;
  contrastRowRerunPath: string;
  contrastRowRerunLabelZh: string;
  matchCount: number;
  mismatchCount: number;
  summaryZh: string;
} {
  const byId = new Map((itemizedPhases || []).map((p) => [p.id, p]));
  const statusZh: Record<string, string> = {
    pending: '等待中',
    running: '进行中',
    done: '已完成',
    cancelled: '已取消',
    skipped: '已跳过',
  };
  const rows = EXPECTED_PHASES.map((ex) => {
    const act = byId.get(ex.id);
    let expectedStatus = ex.expectedStatus;
    // 任务仍在跑：当前及之后期望 running/pending
    if (jobStatus === 'running' || jobStatus === 'queued' || jobStatus === 'cancelling') {
      if (!act || act.status === 'pending') expectedStatus = 'pending';
      else if (act.status === 'running') expectedStatus = 'running';
    }
    if (jobStatus === 'cancelled' && act?.status === 'cancelled') expectedStatus = 'cancelled';
    if (act?.status === 'skipped') expectedStatus = 'skipped';
    const actual = act?.status || 'pending';
    const match = actual === expectedStatus || (expectedStatus === 'done' && actual === 'skipped');
    return {
      id: ex.id,
      labelZh: ex.labelZh,
      expected: expectedStatus,
      expectedZh: statusZh[expectedStatus] || expectedStatus,
      actual,
      actualZh: statusZh[actual] || actual,
      match,
      detailZh: act?.detailZh,
      rerunAvailable: true,
      rerunLabelZh: `一键重跑「${ex.labelZh}」（干跑）`,
      rerunPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/rerun-row',
      rerunBody: { phase: ex.id, dryRun: true as const },
    };
  });
  const matchCount = rows.filter((r) => r.match).length;
  const mismatchCount = rows.length - matchCount;
  const summaryZh =
    mismatchCount === 0
      ? `分项对照全部对齐（${matchCount}/${rows.length}）`
      : `分项对照 ${mismatchCount} 项偏差（对齐 ${matchCount}/${rows.length}）`;
  return {
    ok: true,
    wave: 'M87',
    labelZh: '异常串联分项 expected×actual 对照',
    tipZh: summaryZh + ' · 对照行可一键/批量重跑 bust/复探针（干跑）· 断线可用 Last-Event-ID 续订',
    toastZh: mismatchCount ? `对照偏差 ${mismatchCount}` : '分项对照对齐',
    busyZh: '生成分项对照…',
    dryRun: true,
    noEgress: true,
    rows,
    matchCount,
    mismatchCount,
    summaryZh,
    contrastRowRerunPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/rerun-row',
    contrastRowRerunLabelZh: '对照行一键重跑（干跑）',
  };
}

/** M86：从对照行一键重跑指定阶段（dry-run，无外发） */
export function anomalyContrastRowRerunMeta(phase: string) {
  const map: Record<string, { labelZh: string; tipZh: string }> = {
    attribution: { labelZh: '异常归因', tipZh: '将干跑重跑异常归因阶段' },
    bust: { labelZh: '建议 bust', tipZh: '将干跑重跑建议 bust（定向清壳短缓存）' },
    reprobe: { labelZh: 'HIT 复探针', tipZh: '将干跑重跑 HIT 复探针' },
    heal: { labelZh: 'SLA 自愈', tipZh: '将干跑重跑 SLA 自愈串联' },
  };
  const m = map[phase] || { labelZh: phase || '未知阶段', tipZh: '未知阶段' };
  return {
    ok: true as const,
    wave: 'M87' as const,
    phase: phase || null,
    labelZh: `对照行一键重跑「${m.labelZh}」`,
    tipZh: m.tipZh + ' · 无外发 · 取消/续跑仍在',
    toastZh: `已触发重跑 · ${m.labelZh}`,
    busyZh: `对照行重跑 ${m.labelZh}…`,
    dryRun: true as const,
    noEgress: true as const,
    cancelResumeIntact: true as const,
  };
}



/** M90：按阶段过滤批重跑/异常 SSE 环事件（中文进度） */
export function peekAnomalySseRingPhaseFiltered(
  tenantId?: string | null,
  opts: { phase?: string | null; phases?: string[] | null; kind?: string | null; limit?: number } = {},
) {
  const base = peekAnomalySseRing(tenantId);
  const wantPhases = new Set(
    [
      ...(opts.phase ? [String(opts.phase).trim()] : []),
      ...((Array.isArray(opts.phases) ? opts.phases : []) as string[]).map((p) => String(p || '').trim()),
    ].filter(Boolean),
  );
  const wantKind = opts.kind ? String(opts.kind).trim() : 'batch-rerun';
  const limit = Math.max(1, Math.min(Number(opts.limit) || 16, 48));
  const filtered = (base.events || [])
    .concat([])
    .reverse()
    .filter((e: AnomalySseEvent) => {
      const p = e?.payload || {};
      if (wantKind && p.kind && p.kind !== wantKind && wantKind !== '*') return false;
      if (!wantPhases.size) return true;
      const phase = String(p.phase || p?.job?.phase || '').trim();
      return wantPhases.has(phase);
    })
    .slice(0, limit);

  // 取完整环再过滤（peek 只返近 12；这里再读一次全量）
  const k = tid(tenantId);
  const all = rings.get(k) || [];
  const fullFiltered = all
    .slice()
    .reverse()
    .filter((e) => {
      const p = e?.payload || {};
      if (wantKind && wantKind !== '*' && p.kind && p.kind !== wantKind) return false;
      if (!wantPhases.size) return wantKind === '*' || !wantKind || p.kind === wantKind || !p.kind;
      const phase = String(p.phase || p?.job?.phase || '').trim();
      return wantPhases.has(phase);
    })
    .slice(0, limit);

  const use = fullFiltered.length ? fullFiltered : filtered;
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  const progressZh = use.length
    ? use
        .slice(0, 5)
        .map((e) => {
          const p = e.payload || {};
          const ph = String(p.phase || p?.job?.phase || '—');
          return `#${e.id} ${(phaseZhMap[ph] || ph)} · ${p.toastZh || p.tipZh || e.event} · ${p.percent != null ? p.percent + '%' : ''}`.trim();
        })
        .join('；')
    : '无匹配阶段事件';

  return {
    ok: true as const,
    wave: 'M90' as const,
    labelZh: '批重跑 SSE 阶段过滤',
    tipZh: wantPhases.size
      ? `已按阶段 [${[...wantPhases].join(',')}] 过滤 · ${use.length} 条 · ${progressZh} · 软取消仍在`
      : `未指定阶段 · 展示近 ${use.length} 条（kind=${wantKind || '*'}）· ${progressZh}`,
    toastZh: use.length ? `SSE 阶段过滤 · ${use.length}` : '阶段过滤空',
    busyZh: '过滤批重跑 SSE…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    phaseFilter: [...wantPhases],
    kindFilter: wantKind,
    count: use.length,
    latestId: use.length ? use[0].id : base.latestId,
    events: use,
    progressZh,
    chineseProgress: true as const,
    sseRingPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/sse-ring',
    phaseFilterPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/sse-ring/phase-filter',
  };
}


/** M91：把阶段过滤结果绑定到异常任务卡进度条（中文） */
export function bindAnomalySsePhaseFilterToTaskCardProgress(
  tenantId?: string | null,
  opts: { phase?: string | null; phases?: string[] | null; kind?: string | null; limit?: number } = {},
) {
  const filtered = peekAnomalySseRingPhaseFiltered(tenantId, opts);
  const events = (filtered as any).events || [];
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  let latestPercent: number | null = null;
  let latestPhase: string | null = null;
  let latestStatus: string | null = null;
  for (const e of events) {
    const p = e?.payload || {};
    if (p.percent != null && latestPercent == null) latestPercent = Number(p.percent);
    if (!latestPhase) latestPhase = String(p.phase || p?.job?.phase || '').trim() || null;
    if (!latestStatus) latestStatus = String(p.status || p?.job?.status || e.event || '').trim() || null;
    if (latestPercent != null && latestPhase) break;
  }
  const pct = latestPercent != null && Number.isFinite(latestPercent) ? Math.max(0, Math.min(100, Math.round(latestPercent))) : events.length ? 40 : 0;
  const phaseFilter = (filtered as any).phaseFilter || [];
  const barSegments = (phaseFilter.length ? phaseFilter : ['bust', 'reprobe', 'heal']).map((ph: string, i: number, arr: string[]) => {
    const done = latestPhase ? arr.indexOf(latestPhase) > i || (latestPhase === ph && pct >= 100) : false;
    const active = latestPhase === ph;
    return {
      phase: ph,
      phaseZh: phaseZhMap[ph] || ph,
      weight: Math.round(100 / Math.max(1, arr.length)),
      done,
      active,
      fillPct: done ? 100 : active ? pct : 0,
    };
  });
  const progressBarZh = barSegments
    .map((s: any) => `${s.phaseZh}${s.done ? '✓' : s.active ? `(${s.fillPct}%)` : '·'}`)
    .join(' → ');
  const drillBase =
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/sse-ring/phase-filter/task-card-progress/drill';
  const barSegmentsWithDrill = barSegments.map((s: any) => ({
    ...s,
    drillLabelZh: `点钻「${s.phaseZh}」单阶段 SSE`,
    drillPath: `${drillBase}?phase=${encodeURIComponent(s.phase)}`,
    drillHintZh: '从任务卡进度条点入该阶段过滤事件',
  }));
  const taskCardProgress = {
    bound: true as const,
    labelZh: '异常任务卡进度条（SSE 阶段过滤绑定）',
    percent: pct,
    phase: latestPhase,
    phaseZh: latestPhase ? phaseZhMap[latestPhase] || latestPhase : '—',
    status: latestStatus,
    progressZh: (filtered as any).progressZh || '',
    progressBarZh,
    barSegments: barSegmentsWithDrill,
    drillable: true as const,
    drillPath: drillBase,
    drillLabelZh: '点钻任务卡进度条 → 单阶段 SSE 事件',
    tipZh: `阶段过滤已绑定任务卡进度 · ${pct}% · ${progressBarZh} · 可点钻单阶段 · 软取消仍在`,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };
  return {
    ...filtered,
    wave: 'M92' as const,
    labelZh: '批重跑 SSE 阶段过滤 · 绑定任务卡进度',
    tipZh: ((filtered as any).tipZh || '') + ' · ' + taskCardProgress.tipZh,
    toastZh: `SSE→任务卡 · ${pct}%`,
    busyZh: '绑定 SSE 阶段过滤到任务卡…',
    chineseProgress: true as const,
    taskCardProgress,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };
}

/** M92/M93：从任务卡进度条点钻到单阶段 SSE；M93 可跳到批重跑队列项并支持单阶段暂停/续跑 */
export function drillTaskCardProgressIntoPhaseSse(
  tenantId?: string | null,
  opts: { phase?: string | null; kind?: string | null; limit?: number; jumpQueueItem?: boolean } = {},
) {
  const phase = String(opts.phase || '').trim() || 'bust';
  const filtered = peekAnomalySseRingPhaseFiltered(tenantId, {
    phase,
    kind: opts.kind || 'batch-rerun',
    limit: opts.limit ?? 24,
  });
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  const events = (filtered as any).events || [];
  const eventLines = events.slice(0, 12).map((e: any) => {
    const p = e?.payload || {};
    return `#${e.id} ${p.toastZh || p.tipZh || e.event || '—'} · ${p.percent != null ? p.percent + '%' : ''}`.trim();
  });
  // M93：从 SSE 事件里抽 itemId，跳到批重跑队列项
  let queueItemJump: any = null;
  let matchedItemId: string | null = null;
  for (const e of events) {
    const p = e?.payload || {};
    if (p.itemId) {
      matchedItemId = String(p.itemId);
      break;
    }
  }
  try {
    const batch = require('./anomaly-contrast-batch-rerun') as typeof import('./anomaly-contrast-batch-rerun');
    const found = batch.findAnomalyBatchRerunQueueItem(tenantId, {
      phase,
      itemId: matchedItemId,
    });
    queueItemJump = {
      ...found,
      jumpLabelZh: '跳到批重跑队列项',
      pausePhaseLabelZh: '暂停该单阶段',
      resumePhaseLabelZh: '续跑该单阶段',
      pausePhasePath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/pause',
      resumePhasePath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume',
      queueItemPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/queue-item',
    };
  } catch (_) {
    queueItemJump = null;
  }
  return {
    ...filtered,
    wave: 'M93' as const,
    labelZh: '任务卡进度点钻 · 单阶段 SSE → 批重跑队列项',
    tipZh:
      `已点钻阶段「${phaseZhMap[phase] || phase}」· ${events.length} 条 SSE` +
      (eventLines.length ? ' · ' + eventLines.slice(0, 3).join('；') : '') +
      (queueItemJump?.item ? ` · 已跳到队列项 ${queueItemJump.item.id}` : ' · 可跳批重跑队列项') +
      ' · 可暂停/续跑单阶段 · 软取消仍在 · 干跑无外发',
    toastZh: `点钻→队列 · ${phaseZhMap[phase] || phase} · ${events.length}`,
    busyZh: `点钻任务卡进度 · ${phaseZhMap[phase] || phase}…`,
    drilledPhase: phase,
    drilledPhaseZh: phaseZhMap[phase] || phase,
    eventLines,
    chineseProgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
    fromTaskCardProgress: true as const,
    jumpedToQueueItem: Boolean(queueItemJump?.item),
    matchedItemId,
    queueItemJump,
    pauseResumeSinglePhase: true as const,
    drillPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/sse-ring/phase-filter/task-card-progress/drill',
    jumpQueueItemPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/sse-ring/phase-filter/task-card-progress/drill/jump-queue-item',
  };
}
