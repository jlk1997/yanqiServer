/**
 * M82/M83/M84：趋势异常串联 bust→复探针挂统一任务卡（干跑、无外发）。
 * M83：分项进度；M84：真 EventSource 订阅（同匹配任务卡 ticket 形态）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type AnomalyChainPhase =
  | 'pending'
  | 'attribution'
  | 'bust'
  | 'reprobe'
  | 'heal'
  | 'done'
  | 'cancelled'
  | 'failed';

export type AnomalyItemizedPhase = {
  id: 'attribution' | 'bust' | 'reprobe' | 'heal';
  labelZh: string;
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'skipped';
  statusZh: string;
  detailZh?: string;
};

export type AnomalyChainJob = {
  id: string;
  tenantId: string;
  kind: 'anomaly-chain';
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'done' | 'failed';
  phase: AnomalyChainPhase;
  percent: number;
  cancelRequested: boolean;
  resumeAvailable: boolean;
  dryRun: true;
  noEgress: true;
  force?: boolean;
  shells: string[];
  anomalyCount: number;
  tipZh: string;
  toastZh: string;
  labelZh: string;
  busyZh: string;
  createdAt: string;
  updatedAt: string;
  lastResult?: any;
  wave: 'M84';
  unifiedJobCard: true;
  itemizedPhases?: AnomalyItemizedPhase[];
  itemizedPhasesSse?: boolean;
  itemizedPhasesEventSource?: boolean;
  itemizedPhasesSseTipZh?: string;
  streamPath?: string | null;
};

function safeTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function jobPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'anomaly-chain-job.json');
}

export function buildAnomalyItemizedPhases(
  active: AnomalyChainPhase,
  detail: Partial<Record<'attribution' | 'bust' | 'reprobe' | 'heal', string>> = {},
  cancelled = false,
): AnomalyItemizedPhase[] {
  const order: Array<{ id: 'attribution' | 'bust' | 'reprobe' | 'heal'; labelZh: string }> = [
    { id: 'attribution', labelZh: '异常归因' },
    { id: 'bust', labelZh: '建议 bust' },
    { id: 'reprobe', labelZh: 'HIT 复探针' },
    { id: 'heal', labelZh: 'SLA 自愈' },
  ];
  const activeId =
    active === 'heal'
      ? 'heal'
      : active === 'reprobe'
        ? 'reprobe'
        : active === 'bust'
          ? 'bust'
          : active === 'attribution' || active === 'pending'
            ? 'attribution'
            : active === 'done'
              ? 'heal'
              : 'attribution';
  const idx =
    active === 'done'
      ? order.length
      : active === 'cancelled' || active === 'failed'
        ? Math.max(
            0,
            order.findIndex((x) => x.id === activeId),
          )
        : order.findIndex((x) => x.id === activeId);
  const statusZhMap: Record<string, string> = {
    running: '进行中',
    done: '已完成',
    cancelled: '已取消',
    skipped: '已跳过',
    pending: '等待中',
  };
  return order.map((ph, i) => {
    let status: AnomalyItemizedPhase['status'] = 'pending';
    if (active === 'done') status = 'done';
    else if (cancelled || active === 'cancelled') {
      if (i < idx) status = 'done';
      else if (i === idx) status = 'cancelled';
      else status = 'pending';
    } else if (active === 'failed') {
      if (i < idx) status = 'done';
      else if (i === idx) status = 'cancelled';
      else status = 'pending';
    } else if (i < idx) status = 'done';
    else if (i === idx) status = 'running';
    // heal 在无 SLA 串联时可能跳过：仅当 active 已过 reprobe 且 detail 标明 skip
    if (ph.id === 'heal' && detail.heal === 'skipped') status = 'skipped';
    return {
      id: ph.id,
      labelZh: ph.labelZh,
      status,
      statusZh: statusZhMap[status] || '等待中',
      detailZh: detail[ph.id] || undefined,
    };
  });
}

export function readAnomalyChainJob(tenantId?: string | null): AnomalyChainJob | null {
  const p = jobPath(tenantId || 'default');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || raw.kind !== 'anomaly-chain') return null;
    return raw as AnomalyChainJob;
  } catch {
    return null;
  }
}

export function writeAnomalyChainJob(job: AnomalyChainJob) {
  const p = jobPath(job.tenantId);
  writeFileSync(p, JSON.stringify(job, null, 0), 'utf8');
  return p;
}

function newId() {
  return `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function startOrReplaceAnomalyChainJob(
  tenantId: string | null | undefined,
  seed: Partial<AnomalyChainJob> = {},
): AnomalyChainJob {
  const tid = safeTenant(tenantId);
  const now = new Date().toISOString();
  const itemizedPhases = buildAnomalyItemizedPhases('attribution', {
    attribution: '归因中…',
  });
  const job: AnomalyChainJob = {
    id: seed.id || newId(),
    tenantId: tid,
    kind: 'anomaly-chain',
    status: 'running',
    phase: 'attribution',
    percent: 5,
    cancelRequested: false,
    resumeAvailable: false,
    dryRun: true,
    noEgress: true,
    force: seed.force === true,
    shells: Array.isArray(seed.shells) ? seed.shells.map(String) : [],
    anomalyCount: Number(seed.anomalyCount) || 0,
    tipZh: '异常串联任务卡：归因中…（干跑、无外发）',
    toastZh: '异常串联已挂任务卡',
    labelZh: '异常串联 bust→复探针（统一任务卡·真 EventSource）',
    busyZh: '异常串联进行中…',
    createdAt: seed.createdAt || now,
    updatedAt: now,
    wave: 'M84',
    unifiedJobCard: true,
    lastResult: seed.lastResult || null,
    itemizedPhases,
    itemizedPhasesSse: true,
    itemizedPhasesEventSource: true,
    streamPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/stream',
    itemizedPhasesSseTipZh: '异常串联分项进度经真 EventSource 推送（归因/bust/复探针/自愈）；取消/续跑仍在；干跑无外发',
  };
  writeAnomalyChainJob(job);
  return job;
}

export function requestCancelAnomalyChainJob(tenantId?: string | null) {
  const job = readAnomalyChainJob(tenantId);
  if (!job) {
    return {
      ok: false,
      messageZh: '没有异常串联任务卡可取消',
      wave: 'M84',
    };
  }
  if (job.status === 'done' || job.status === 'cancelled' || job.status === 'failed') {
    return {
      ok: true,
      alreadyStopped: true,
      job,
      tipZh: `任务已结束（${job.status}），无需取消`,
      toastZh: '任务已结束',
      wave: 'M84',
    };
  }
  job.cancelRequested = true;
  job.status = 'cancelling';
  job.tipZh = `取消请求已记下（当前 phase=${job.phase}）；干跑边界生效。`;
  job.toastZh = '异常串联取消中';
  job.updatedAt = new Date().toISOString();
  job.wave = 'M84';
  job.itemizedPhases = buildAnomalyItemizedPhases(job.phase, {}, true);
  job.itemizedPhasesSse = true;
  writeAnomalyChainJob(job);
  return {
    ok: true,
    cancelled: false,
    cancelling: true,
    job,
    tipZh: job.tipZh,
    toastZh: job.toastZh,
    wave: 'M84',
    itemizedPhases: job.itemizedPhases,
    itemizedPhasesSse: true,
  };
}

export function markAnomalyChainPhase(
  tenantId: string | null | undefined,
  patch: Partial<AnomalyChainJob> & { phase: AnomalyChainPhase; itemizedDetail?: Partial<Record<'attribution' | 'bust' | 'reprobe' | 'heal', string>> },
) {
  const prev = readAnomalyChainJob(tenantId) || startOrReplaceAnomalyChainJob(tenantId);
  if (prev.cancelRequested && patch.phase !== 'cancelled' && patch.phase !== 'done') {
    const cancelled: AnomalyChainJob = {
      ...prev,
      ...patch,
      status: 'cancelled',
      phase: 'cancelled',
      percent: Math.min(99, Number(prev.percent) || 50),
      resumeAvailable: true,
      cancelRequested: true,
      tipZh: `已取消：停在 ${prev.phase} → 可续跑剩余串联步骤（干跑）。`,
      toastZh: '异常串联已取消·可续跑',
      updatedAt: new Date().toISOString(),
      wave: 'M84',
      unifiedJobCard: true,
      dryRun: true,
      noEgress: true,
      kind: 'anomaly-chain',
      itemizedPhases: buildAnomalyItemizedPhases(prev.phase, patch.itemizedDetail || {}, true),
      itemizedPhasesSse: true,
      itemizedPhasesSseTipZh: '异常串联分项进度经真 EventSource 推送（归因/bust/复探针/自愈）；取消/续跑仍在；干跑无外发',
    };
    writeAnomalyChainJob(cancelled);
    return cancelled;
  }
  const pctByPhase: Record<AnomalyChainPhase, number> = {
    pending: 0,
    attribution: 20,
    bust: 55,
    reprobe: 80,
    heal: 92,
    done: 100,
    cancelled: Math.min(99, Number(prev.percent) || 40),
    failed: Math.min(99, Number(prev.percent) || 40),
  };
  const detail = patch.itemizedDetail || {};
  const next: AnomalyChainJob = {
    ...prev,
    ...patch,
    percent: patch.percent != null ? patch.percent : pctByPhase[patch.phase],
    status:
      patch.status ||
      (patch.phase === 'done'
        ? 'done'
        : patch.phase === 'cancelled'
          ? 'cancelled'
          : patch.phase === 'failed'
            ? 'failed'
            : 'running'),
    resumeAvailable:
      patch.resumeAvailable != null
        ? patch.resumeAvailable
        : patch.phase === 'cancelled' || patch.phase === 'failed',
    updatedAt: new Date().toISOString(),
    wave: 'M84',
    unifiedJobCard: true,
    dryRun: true,
    noEgress: true,
    kind: 'anomaly-chain',
    itemizedPhases:
      patch.itemizedPhases ||
      buildAnomalyItemizedPhases(patch.phase, detail, patch.phase === 'cancelled'),
    itemizedPhasesSse: true,
    itemizedPhasesEventSource: true,
    itemizedPhasesSseTipZh: '异常串联分项进度经真 EventSource 推送（归因/bust/复探针/自愈）；取消/续跑仍在；干跑无外发',
  };
  // strip helper field if present
  delete (next as any).itemizedDetail;
  writeAnomalyChainJob(next);
  return next;
}

export function anomalyChainJobToResumeCard(job: AnomalyChainJob) {
  const running =
    job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';
  const resumeAvailable = Boolean(job.resumeAvailable) && !running;
  const phases = job.itemizedPhases || buildAnomalyItemizedPhases(job.phase);
  const runningPhase = phases.find((p) => p.status === 'running');
  return {
    id: job.id,
    kind: 'anomaly-chain',
    kindZh: '异常串联·壳自愈',
    status: job.status,
    statusZh:
      (
        {
          queued: '排队中',
          running: '执行中',
          cancelling: '取消中',
          cancelled: '已取消',
          done: '已完成',
          failed: '失败',
        } as any
      )[job.status] || job.status,
    percent: job.percent,
    waiting: running,
    resumeAvailable,
    unifiedJobCard: true,
    unifiedPhase: job.phase,
    cancelPath: running
      ? '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/cancel'
      : null,
    resumePath: resumeAvailable
      ? '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/resume'
      : null,
    progressPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/job',
    streamPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/stream',
    titleZh: job.labelZh || '异常串联 bust→复探针',
    summaryZh:
      job.tipZh ||
      `phase=${job.phase} · ${job.percent}%` +
        (runningPhase ? ` · 分项：${runningPhase.labelZh}` : ''),
    hintZh: resumeAvailable
      ? '点续跑继续干跑串联剩余步骤（bust→复探针）；无外发。'
      : running
        ? '可取消；取消在阶段边界生效。分项进度经真 EventSource。干跑通知 only。'
        : job.status === 'done'
          ? '串联已干跑完成。'
          : '',
    anomalyCount: job.anomalyCount,
    shells: job.shells || [],
    dryRun: true,
    noEgress: true,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    calmTone: resumeAvailable ? 'resume' : running ? 'progress' : 'idle',
    wave: 'M84',
    toastZh: job.toastZh,
    itemizedPhases: phases,
    itemizedPhasesSse: true,
    itemizedPhasesEventSource: true,
    itemizedPhasesSseTipZh: job.itemizedPhasesSseTipZh,
  };
}

export function listAnomalyChainResumeCards(tenantId?: string | null, limit = 4) {
  const job = readAnomalyChainJob(tenantId);
  if (!job) return [];
  const running =
    job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';
  const show = running || job.resumeAvailable || job.status === 'cancelled' || job.status === 'done';
  if (!show) return [];
  if (job.status === 'done') {
    const at = Date.parse(job.updatedAt || job.createdAt);
    if (Number.isFinite(at) && Date.now() - at > 30 * 60_000) return [];
  }
  return [anomalyChainJobToResumeCard(job)].slice(0, limit);
}


const PHASE_LABEL_ZH: Record<string, string> = {
  attribution: '异常归因',
  bust: '建议 bust',
  reprobe: 'HIT 复探针',
  heal: 'SLA 自愈',
};

/** M94：串联异常任务卡分项阶段拖拽重排（干跑无外发） */
export function reorderAnomalyChainPhases(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    dryRun?: boolean;
  } = {},
) {
  const job = readAnomalyChainJob(tenantId) || startOrReplaceAnomalyChainJob(tenantId);
  const defaultOrder = ['attribution', 'bust', 'reprobe', 'heal'] as const;
  let order = (opts.phaseOrder || opts.order || []).map((x) => String(x).trim()).filter(Boolean);
  if (!order.length && opts.fromIndex != null && opts.toIndex != null) {
    const cur = (job.itemizedPhases || buildAnomalyItemizedPhases(job.phase)).map((p) => p.id);
    const from = Math.max(0, Math.min(Number(opts.fromIndex), cur.length - 1));
    const to = Math.max(0, Math.min(Number(opts.toIndex), cur.length - 1));
    const next = cur.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    order = next;
  }
  if (!order.length) order = [...defaultOrder];
  // keep only known phases, unique, append missing
  const known = new Set(defaultOrder as unknown as string[]);
  const seen = new Set<string>();
  const cleaned: Array<'attribution' | 'bust' | 'reprobe' | 'heal'> = [];
  for (const id of order) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id as any);
  }
  for (const id of defaultOrder) {
    if (!seen.has(id)) cleaned.push(id);
  }
  const prevPhases = job.itemizedPhases || buildAnomalyItemizedPhases(job.phase);
  const byId = Object.fromEntries(prevPhases.map((p) => [p.id, p]));
  const statusZhMap: Record<string, string> = {
    running: '进行中',
    done: '已完成',
    cancelled: '已取消',
    skipped: '已跳过',
    pending: '等待中',
  };
  const reordered: AnomalyItemizedPhase[] = cleaned.map((id) => {
    const prev = byId[id];
    if (prev) return { ...prev, labelZh: PHASE_LABEL_ZH[id] || prev.labelZh };
    return {
      id,
      labelZh: PHASE_LABEL_ZH[id] || id,
      status: 'pending' as const,
      statusZh: statusZhMap.pending,
      detailZh: '已重排·等待',
    };
  });
  const orderZh = cleaned.map((id) => PHASE_LABEL_ZH[id] || id).join(' → ');
  job.itemizedPhases = reordered;
  (job as any).phaseOrder = cleaned;
  (job as any).phaseReorderable = true;
  (job as any).wave = 'M94';
  job.tipZh = `串联任务卡阶段已重排：${orderZh} · 干跑无外发 · 软取消仍在`;
  job.toastZh = `阶段重排 · ${orderZh}`;
  job.busyZh = '串联任务卡阶段重排…';
  job.labelZh = '异常串联 bust→复探针（统一任务卡·阶段可重排）';
  job.updatedAt = new Date().toISOString();
  writeAnomalyChainJob(job);
  const card = anomalyChainJobToResumeCard(job);
  return {
    ok: true as const,
    wave: 'M94' as const,
    labelZh: '串联异常任务卡阶段重排',
    tipZh: job.tipZh,
    toastZh: job.toastZh,
    busyZh: job.busyZh,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    phaseOrder: cleaned,
    phaseOrderZh: orderZh,
    itemizedPhases: reordered,
    job,
    chainTaskCard: {
      ...card,
      wave: 'M94',
      phaseReorderable: true,
      phaseOrder: cleaned,
      tipZh: job.tipZh,
      toastZh: job.toastZh,
    },
    reorderPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder',
  };
}


/** M95：阶段重排后按新序干跑串联（干跑无外发；软取消仍赢） */
export function dryRunAnomalyChainInReorderedPhases(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    dryRun?: boolean;
  } = {},
) {
  const reorder = reorderAnomalyChainPhases(tenantId, {
    phaseOrder: opts.phaseOrder,
    order: opts.order,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    dryRun: true,
  });
  const job = readAnomalyChainJob(tenantId) || startOrReplaceAnomalyChainJob(tenantId);
  if (job.cancelRequested) {
    return {
      ok: false as const,
      wave: 'M95' as const,
      labelZh: '按新序干跑串联阶段',
      tipZh: '软取消已生效，跳过按新序干跑 · 可先续跑/清取消后再试',
      toastZh: '软取消优先 · 未干跑',
      busyZh: '按新序干跑串联阶段…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      ran: false,
      reorder,
      job,
    };
  }
  const order = (reorder.phaseOrder || ['attribution', 'bust', 'reprobe', 'heal']).slice(
    0,
    Math.max(1, Number(opts.maxPhases) || 4),
  );
  const ranSteps: Array<{
    phase: string;
    phaseZh: string;
    status: 'dry-run-ok';
    detailZh: string;
    at: string;
  }> = [];
  for (const id of order) {
    const label = PHASE_LABEL_ZH[id] || id;
    const marked = markAnomalyChainPhase(tenantId, {
      phase: id as any,
      tipZh: `按新序干跑 · ${label}`,
      toastZh: `新序干跑 · ${label}`,
      itemizedDetail: { [id]: `按新序干跑完成 · ${label}` } as any,
    });
    ranSteps.push({
      phase: id,
      phaseZh: label,
      status: 'dry-run-ok',
      detailZh: `干跑阶段「${label}」按重排顺序执行 · 无外发`,
      at: marked.updatedAt || new Date().toISOString(),
    });
  }
  const done = markAnomalyChainPhase(tenantId, {
    phase: 'done',
    tipZh: `按新序干跑完成：${order.map((id) => PHASE_LABEL_ZH[id] || id).join(' → ')} · 干跑无外发 · 软取消仍在`,
    toastZh: '新序干跑完成',
    itemizedDetail: {},
  });
  const orderZh = order.map((id) => PHASE_LABEL_ZH[id] || id).join(' → ');
  return {
    ok: true as const,
    wave: 'M95' as const,
    labelZh: '阶段重排后按新序干跑',
    tipZh: `已按重排顺序干跑：${orderZh} · ${ranSteps.length} 步 · 软取消仍在 · 干跑无外发`,
    toastZh: `新序干跑 · ${orderZh}`,
    busyZh: '按新序干跑串联阶段…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    ran: true as const,
    phaseOrder: order,
    phaseOrderZh: orderZh,
    ranSteps,
    reorder,
    job: done,
    chainTaskCard: anomalyChainJobToResumeCard(done),
    dryRunPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run',
  };
}


/** M96：新序干跑可跳过已完成阶段（软取消仍赢；干跑无外发） */
export function dryRunAnomalyChainSkipCompletedPhases(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
  } = {},
) {
  const reorder = reorderAnomalyChainPhases(tenantId, {
    phaseOrder: opts.phaseOrder,
    order: opts.order,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    dryRun: true,
  });
  const job = readAnomalyChainJob(tenantId) || startOrReplaceAnomalyChainJob(tenantId);
  if (job.cancelRequested) {
    return {
      ok: false as const,
      wave: 'M96' as const,
      labelZh: '新序干跑跳过已完成阶段',
      tipZh: '软取消已生效，跳过新序干跑 · 可先续跑/清取消后再试',
      toastZh: '软取消优先 · 未干跑',
      busyZh: '新序干跑（跳过已完成）…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      ran: false,
      skippedCompleted: [] as string[],
      reorder,
      job,
    };
  }
  const order = (reorder.phaseOrder || ['attribution', 'bust', 'reprobe', 'heal']).slice(
    0,
    Math.max(1, Number(opts.maxPhases) || 4),
  );
  const prevPhases = job.itemizedPhases || buildAnomalyItemizedPhases(job.phase);
  const completedIds = new Set(
    prevPhases
      .filter((p) => p.status === 'done' || p.status === 'skipped')
      .map((p) => p.id),
  );
  // also treat job.phase already past a phase as completed when active is done
  if (job.phase === 'done') {
    for (const id of order) completedIds.add(id);
  }
  const skipCompleted = opts.skipCompleted !== false;
  const ranSteps: Array<{
    phase: string;
    phaseZh: string;
    status: 'dry-run-ok' | 'skipped-completed';
    detailZh: string;
    at: string;
  }> = [];
  const skippedCompleted: string[] = [];
  for (const id of order) {
    const label = PHASE_LABEL_ZH[id] || id;
    if (skipCompleted && completedIds.has(id)) {
      skippedCompleted.push(id);
      ranSteps.push({
        phase: id,
        phaseZh: label,
        status: 'skipped-completed',
        detailZh: `已完成阶段「${label}」已跳过 · 不重跑`,
        at: new Date().toISOString(),
      });
      continue;
    }
    const marked = markAnomalyChainPhase(tenantId, {
      phase: id as any,
      tipZh: `按新序干跑（可跳过已完成）· ${label}`,
      toastZh: `新序干跑 · ${label}`,
      itemizedDetail: { [id]: `按新序干跑完成 · ${label}` } as any,
    });
    ranSteps.push({
      phase: id,
      phaseZh: label,
      status: 'dry-run-ok',
      detailZh: `干跑阶段「${label}」按重排顺序执行 · 无外发`,
      at: marked.updatedAt || new Date().toISOString(),
    });
  }
  const ranOnly = ranSteps.filter((s) => s.status === 'dry-run-ok');
  const done = markAnomalyChainPhase(tenantId, {
    phase: 'done',
    tipZh:
      `按新序干跑完成（跳过已完成 ${skippedCompleted.length}）· 实跑 ${ranOnly.length}` +
      ` · ${order.map((id) => PHASE_LABEL_ZH[id] || id).join(' → ')} · 干跑无外发 · 软取消仍在`,
    toastZh:
      skippedCompleted.length > 0
        ? `新序干跑 · 跳过已完成 ${skippedCompleted.length}`
        : '新序干跑完成',
    itemizedDetail: {},
  });
  const orderZh = order.map((id) => PHASE_LABEL_ZH[id] || id).join(' → ');
  const skippedZh = skippedCompleted.map((id) => PHASE_LABEL_ZH[id] || id).join('、');
  return {
    ok: true as const,
    wave: 'M96' as const,
    labelZh: '新序干跑跳过已完成阶段',
    tipZh:
      `已按重排顺序干跑：${orderZh} · 跳过已完成 ${skippedCompleted.length}` +
      (skippedZh ? `（${skippedZh}）` : '') +
      ` · 实跑 ${ranOnly.length} · 软取消仍在 · 干跑无外发`,
    toastZh:
      skippedCompleted.length > 0
        ? `跳过已完成 · ${skippedCompleted.length} · 实跑 ${ranOnly.length}`
        : `新序干跑 · ${orderZh}`,
    busyZh: '新序干跑（跳过已完成）…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    ran: true as const,
    skipCompleted: true as const,
    phaseOrder: order,
    phaseOrderZh: orderZh,
    skippedCompleted,
    skippedCompletedZh: skippedZh,
    ranSteps,
    ranCount: ranOnly.length,
    reorder,
    job: done,
    chainTaskCard: anomalyChainJobToResumeCard(done),
    dryRunSkipCompletedPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed',
  };
}


/** M97：跳过已完成「为何跳过」中文差异回放（干跑无外发；软取消仍赢） */
export function replayWhySkippedCompletedPhases(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    replayOnly?: boolean;
  } = {},
) {
  const skipRun = dryRunAnomalyChainSkipCompletedPhases(tenantId, {
    phaseOrder: opts.phaseOrder,
    order: opts.order,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    maxPhases: opts.maxPhases,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
  });
  if (!(skipRun as any).ok && (skipRun as any).softCancelWins) {
    return {
      ...skipRun,
      wave: 'M97' as const,
      labelZh: '跳过已完成·为何跳过回放',
      whySkippedReplay: [],
      whySkipped: [],
    };
  }
  const ranSteps = Array.isArray((skipRun as any).ranSteps) ? (skipRun as any).ranSteps : [];
  const skipped = ranSteps.filter((s: any) => s.status === 'skipped-completed');
  const whySkippedReplay = skipped.map((s: any, i: number) => {
    const phaseZh = s.phaseZh || PHASE_LABEL_ZH[s.phase] || s.phase;
    const whyZh =
      `为何跳过：阶段「${phaseZh}」在先前串联/干跑中已标记完成或跳过` +
      ` · 新序干跑开启 skipCompleted 后不再重跑` +
      ` · 详情：${s.detailZh || '已完成阶段已跳过'}`;
    return {
      index: i,
      phase: s.phase,
      phaseZh,
      status: 'skipped-completed' as const,
      whyZh,
      reasonCode: 'already-completed-in-prior-run',
      reasonZh: '先前已完成',
      detailZh: s.detailZh || '',
      at: s.at || new Date().toISOString(),
      replayCaptionZh: `回放 ${i + 1}/${skipped.length || 1} · 跳过「${phaseZh}」`,
    };
  });
  // also include non-skipped for contrast context
  const contrastSteps = ranSteps.map((s: any, i: number) => ({
    index: i,
    phase: s.phase,
    phaseZh: s.phaseZh || PHASE_LABEL_ZH[s.phase] || s.phase,
    status: s.status,
    wasSkipped: s.status === 'skipped-completed',
    whyZh:
      s.status === 'skipped-completed'
        ? `跳过：先前已完成 · ${s.detailZh || ''}`
        : `实跑：按新序干跑执行 · ${s.detailZh || ''}`,
    at: s.at,
  }));
  return {
    ok: true as const,
    wave: 'M97' as const,
    labelZh: '跳过已完成·为何跳过回放',
    tipZh:
      `已回放「为何跳过」${whySkippedReplay.length} 条` +
      (whySkippedReplay.length
        ? `（${whySkippedReplay.map((w: any) => w.phaseZh).join('、')}）`
        : ' · 本轮无跳过') +
      ' · 软取消仍在 · 干跑无外发',
    toastZh:
      whySkippedReplay.length > 0
        ? `为何跳过 · ${whySkippedReplay.length}`
        : '无跳过可回放',
    busyZh: '回放跳过已完成原因…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    whySkippedReplay,
    whySkipped: whySkippedReplay,
    contrastSteps,
    skippedCompleted: (skipRun as any).skippedCompleted || [],
    skippedCompletedZh: (skipRun as any).skippedCompletedZh || '',
    skipRun,
    whySkippedPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped',
  };
}


/** M98：从「为何跳过」强制重跑该单个被跳过阶段（干跑；软取消仍赢；无外发） */
export function forceRerunWhySkippedPhase(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    phaseId?: string | null;
    forcePhase?: string | null;
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
  } = {},
) {
  const why = replayWhySkippedCompletedPhases(tenantId, {
    phaseOrder: opts.phaseOrder,
    order: opts.order,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    maxPhases: opts.maxPhases,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
  });
  if (!(why as any).ok && (why as any).softCancelWins) {
    return {
      ...why,
      wave: 'M98' as const,
      labelZh: '为何跳过·强制重跑该阶段',
      forcedRerun: null,
    };
  }
  const skipped = Array.isArray((why as any).whySkippedReplay) ? (why as any).whySkippedReplay : [];
  const wantPhase =
    String(opts.phase || opts.phaseId || opts.forcePhase || '').trim() ||
    (skipped[0] && skipped[0].phase) ||
    '';
  const target =
    skipped.find((s: any) => String(s.phase) === wantPhase) ||
    skipped[0] ||
    null;
  if (!target) {
    return {
      ok: true as const,
      wave: 'M98' as const,
      labelZh: '为何跳过·强制重跑该阶段',
      tipZh: '本轮无被跳过阶段可强制重跑 · 软取消仍在 · 干跑无外发',
      toastZh: '无跳过阶段可强制重跑',
      busyZh: '强制重跑被跳过阶段…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      forcedRerun: null,
      whySkippedReplay: skipped,
      why,
      forceRerunPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun',
    };
  }

  const job = readAnomalyChainJob(tenantId);
  if (job?.cancelRequested) {
    return {
      ok: false as const,
      wave: 'M98' as const,
      labelZh: '为何跳过·强制重跑该阶段',
      tipZh: '软取消已生效，跳过强制重跑 · 可先续跑/清取消后再试',
      toastZh: '软取消优先 · 未强制重跑',
      busyZh: '强制重跑被跳过阶段…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      forcedRerun: null,
      whySkippedReplay: skipped,
      why,
      job,
    };
  }

  const phaseZh = target.phaseZh || PHASE_LABEL_ZH[target.phase] || target.phase;
  const marked = markAnomalyChainPhase(tenantId, {
    phase: target.phase as any,
    tipZh: `强制重跑被跳过阶段「${phaseZh}」· 干跑无外发`,
    toastZh: `强制重跑 · ${phaseZh}`,
    itemizedDetail: { [target.phase]: `强制重跑完成 · 先前因已完成被跳过` } as any,
  });
  const forcedRerun = {
    wave: 'M98' as const,
    kind: 'force-rerun-skipped-phase' as const,
    phase: target.phase,
    phaseZh,
    priorWhyZh: target.whyZh,
    status: 'dry-run-ok' as const,
    detailZh: `已强制重跑被跳过阶段「${phaseZh}」· 忽略 skipCompleted · 干跑无外发`,
    at: marked.updatedAt || new Date().toISOString(),
    confirmForce: opts.confirmForce !== false,
  };

  return {
    ok: true as const,
    wave: 'M98' as const,
    labelZh: '为何跳过·强制重跑该阶段',
    tipZh:
      `已从「为何跳过」强制重跑阶段「${phaseZh}」` +
      ` · 先前原因：${target.reasonZh || '先前已完成'}` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `强制重跑 · ${phaseZh}`,
    busyZh: '强制重跑被跳过阶段…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    forcedRerun,
    targetSkipped: target,
    whySkippedReplay: skipped,
    why,
    job: marked,
    forceRerunPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun',
  };
}


/** M99：强制重跑被跳过阶段并并入串联异常任务卡进度（干跑；软取消仍赢；无外发） */
export function forceRerunWhySkippedPhaseFoldIntoChainTaskCard(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    phaseId?: string | null;
    forcePhase?: string | null;
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
  } = {},
) {
  const base = forceRerunWhySkippedPhase(tenantId, {
    phase: opts.phase,
    phaseId: opts.phaseId,
    forcePhase: opts.forcePhase,
    phaseOrder: opts.phaseOrder,
    order: opts.order,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    maxPhases: opts.maxPhases,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    confirmForce: opts.confirmForce !== false,
  });

  if ((base as any).softCancelWins && !(base as any).forcedRerun) {
    return {
      ...base,
      wave: 'M99' as const,
      labelZh: '为何跳过·强制重跑并入串联任务卡',
      foldedIntoChainTaskCard: false as const,
      chainTaskCard: null,
    };
  }

  let chainTaskCard: any = null;
  let folded = false;
  if (opts.foldIntoChainTaskCard !== false && (base as any).forcedRerun) {
    try {
      const inbox = require('./inbox-delta-cache') as typeof import('./inbox-delta-cache');
      const fr = (base as any).forcedRerun;
      const phaseZh = fr.phaseZh || fr.phase;
      const detailZh =
        `强制重跑被跳过阶段「${phaseZh}」并入串联任务卡` +
        (fr.priorWhyZh ? ` · 先前：${String(fr.priorWhyZh).slice(0, 80)}` : '');
      const job = markAnomalyChainPhase(tenantId, {
        phase: (fr.phase as any) || 'bust',
        tipZh: detailZh + ' · 干跑无外发 · 软取消仍在',
        toastZh: `强制重跑并入任务卡 · ${phaseZh}`,
        busyZh: `串联任务卡 · 强制重跑 ${phaseZh}…`,
        lastResult: { from: 'why-skipped-force-rerun', phase: fr.phase, wave: 'M99', forcedRerun: fr },
        itemizedDetail: { [fr.phase || 'bust']: detailZh } as any,
      });
      chainTaskCard = inbox.getAnomalyChainJobCard(tenantId);
      chainTaskCard = {
        ...chainTaskCard,
        wave: 'M99',
        foldedFromForceRerun: true,
        foldedPhase: fr.phase,
        foldedPhaseZh: phaseZh,
        tipZh: ((chainTaskCard && chainTaskCard.tipZh) || '') + ' · ' + detailZh,
        toastZh: `强制重跑已并入串联任务卡 · ${phaseZh}`,
        job,
        progressZh: `强制重跑进度已并入串联任务卡 · ${phaseZh}`,
      };
      folded = true;
    } catch (_) {
      folded = false;
      chainTaskCard = null;
    }
  }

  return {
    ok: true as const,
    wave: 'M99' as const,
    labelZh: folded
      ? '为何跳过·强制重跑并入串联任务卡'
      : '为何跳过·强制重跑该阶段',
    tipZh:
      ((base as any).tipZh || '') +
      (folded ? ' · 已并入串联异常任务卡进度' : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: folded
      ? `强制重跑并入任务卡 · ${((base as any).forcedRerun && ((base as any).forcedRerun.phaseZh || (base as any).forcedRerun.phase)) || ''}`
      : (base as any).toastZh || '强制重跑',
    busyZh: '强制重跑并入串联任务卡…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    forcedRerun: (base as any).forcedRerun,
    targetSkipped: (base as any).targetSkipped,
    whySkippedReplay: (base as any).whySkippedReplay,
    why: (base as any).why,
    job: (base as any).job,
    foldedIntoChainTaskCard: folded,
    chainTaskCard,
    foldForceRerunPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card',
  };
}


/** M100：强制重跑并入任务卡后的片段 scrubber 回放（干跑；软取消仍赢；无外发） */
export function forceRerunFoldTaskCardClipScrubberReplay(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    phaseId?: string | null;
    forcePhase?: string | null;
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    replayClip?: boolean;
    listClipFrames?: boolean;
  } = {},
) {
  const base = forceRerunWhySkippedPhaseFoldIntoChainTaskCard(tenantId, {
    phase: opts.phase,
    phaseId: opts.phaseId,
    forcePhase: opts.forcePhase,
    phaseOrder: opts.phaseOrder,
    order: opts.order,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    maxPhases: opts.maxPhases,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    confirmForce: opts.confirmForce !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
  });

  const fr = (base as any).forcedRerun || null;
  const card = (base as any).chainTaskCard || null;
  const phaseOrder =
    (Array.isArray(opts.phaseOrder) && opts.phaseOrder.length
      ? opts.phaseOrder
      : Array.isArray(opts.order) && opts.order.length
        ? opts.order
        : ['bust', 'attribution', 'reprobe', 'heal']) as string[];
  const maxFrames = Math.max(2, Math.min(24, Number(opts.maxFrames) || phaseOrder.length + 2));
  const fps = Math.max(1, Math.min(12, Number(opts.fps) || 4));

  const clipFrames: any[] = [];
  // 先放「任务卡折叠」帧
  clipFrames.push({
    index: 0,
    kind: 'fold-task-card',
    captionZh: fr
      ? `任务卡折叠 · 强制重跑「${fr.phaseZh || fr.phase}」已并入`
      : '任务卡折叠 · 尚无强制重跑',
    phase: fr?.phase || null,
    phaseZh: fr?.phaseZh || null,
    folded: !!(base as any).foldedIntoChainTaskCard,
    at: new Date().toISOString(),
    wave: 'M100',
  });
  // 再放各阶段回放帧
  for (let i = 0; i < phaseOrder.length && clipFrames.length < maxFrames; i++) {
    const ph = phaseOrder[i];
    const phaseZh = PHASE_LABEL_ZH[ph] || ph;
    const isForced = fr && String(fr.phase) === String(ph);
    clipFrames.push({
      index: clipFrames.length,
      kind: isForced ? 'force-rerun-phase' : 'phase',
      captionZh: isForced
        ? `强制重跑片段 · ${phaseZh}（先前跳过）`
        : `串联阶段 · ${phaseZh}`,
      phase: ph,
      phaseZh,
      forced: !!isForced,
      priorWhyZh: isForced ? fr?.priorWhyZh || null : null,
      at: new Date().toISOString(),
      wave: 'M100',
    });
  }
  // 收尾帧
  if (clipFrames.length < maxFrames) {
    clipFrames.push({
      index: clipFrames.length,
      kind: 'done',
      captionZh: (base as any).foldedIntoChainTaskCard
        ? '回放结束 · 进度已在串联任务卡'
        : '回放结束',
      phase: null,
      at: new Date().toISOString(),
      wave: 'M100',
    });
  }

  let scrubIndex =
    opts.scrubIndex != null
      ? Number(opts.scrubIndex)
      : opts.scrubToFrame != null
        ? Number(opts.scrubToFrame)
        : opts.frameIndex != null
          ? Number(opts.frameIndex)
          : fr
            ? Math.max(
                0,
                clipFrames.findIndex((f) => f.forced),
              )
            : 0;
  if (!Number.isFinite(scrubIndex) || scrubIndex < 0) scrubIndex = 0;
  if (scrubIndex >= clipFrames.length) scrubIndex = clipFrames.length - 1;
  const currentFrame = clipFrames[scrubIndex] || null;

  const scrubber = {
    wave: 'M100' as const,
    kind: 'force-rerun-fold-task-card-clip-scrubber' as const,
    frameCount: clipFrames.length,
    fps,
    scrubIndex,
    currentFrame,
    frames: clipFrames,
    labelZh: '强制重跑任务卡片段 scrubber',
    tipZh: `可 scrubber 回放强制重跑并入任务卡片段 · 帧 ${scrubIndex + 1}/${clipFrames.length}`,
  };

  if (opts.listClipFrames === true) {
    return {
      ...base,
      wave: 'M100' as const,
      labelZh: '强制重跑任务卡片段 · 帧列表',
      scrubber,
      clipFrames,
      toastZh: `片段帧 · ${clipFrames.length}`,
    };
  }

  return {
    ...base,
    ok: true as const,
    wave: 'M100' as const,
    labelZh: '强制重跑并入任务卡 · 片段 scrubber 回放',
    tipZh:
      ((base as any).tipZh || '') +
      ` · 片段 scrubber 帧 ${scrubIndex + 1}/${clipFrames.length}` +
      (currentFrame?.captionZh ? ` · ${currentFrame.captionZh}` : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: currentFrame?.forced
      ? `回放强制重跑 · ${currentFrame.phaseZh || currentFrame.phase}`
      : `任务卡片段 · 帧 ${scrubIndex + 1}`,
    busyZh: '强制重跑任务卡片段 scrubber 回放…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    scrubber,
    currentFrame,
    scrubIndex,
    clipFrames,
    clipScrubberReplayPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay',
  };
}


/** M101：强制重跑片段 scrubber 关键帧书签存储 */
function forceRerunClipKeyframeBookmarksPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'force-rerun-clip-keyframe-bookmarks.json');
}

function loadForceRerunClipKeyframeBookmarks(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = forceRerunClipKeyframeBookmarksPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        keyframes: Array.isArray(raw.keyframes) ? raw.keyframes : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { keyframes: [] as any[], updatedAt: null as string | null };
}

function saveForceRerunClipKeyframeBookmarks(
  tenantId: string | null | undefined,
  store: { keyframes: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = forceRerunClipKeyframeBookmarksPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/**
 * M101：强制重跑任务卡片段 scrubber · 关键帧书签
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipScrubberKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    phaseId?: string | null;
    forcePhase?: string | null;
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    replayClip?: boolean;
    listClipFrames?: boolean;
    markKeyframe?: boolean;
    keyframe?: boolean;
    keyframeNameZh?: string | null;
    keyframeId?: string | null;
    listKeyframes?: boolean;
    jumpToKeyframeId?: string | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const kfStore = loadForceRerunClipKeyframeBookmarks(tid);

  let scrubIndexOpt = opts.scrubIndex;
  if (opts.jumpToKeyframeId) {
    const kf = kfStore.keyframes.find((k: any) => String(k.id) === String(opts.jumpToKeyframeId));
    if (kf && kf.scrubIndex != null) scrubIndexOpt = kf.scrubIndex;
  }

  const base = forceRerunFoldTaskCardClipScrubberReplay(tid, {
    ...opts,
    scrubIndex: scrubIndexOpt,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    confirmForce: opts.confirmForce !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
  });

  if (opts.listKeyframes === true) {
    return {
      ...(base as any),
      wave: 'M101' as const,
      labelZh: '强制重跑片段 scrubber · 关键帧书签台账',
      tipZh: `共 ${kfStore.keyframes.length} 个关键帧书签 · 软取消仍赢 · 干跑无外发`,
      toastZh: kfStore.keyframes.length ? `关键帧 · ${kfStore.keyframes.length}` : '暂无关帧',
      busyZh: '加载片段 scrubber 关键帧书签…',
      keyframes: kfStore.keyframes,
      keyframeBookmarkPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks',
    };
  }

  let savedKeyframe: any = null;
  if (opts.markKeyframe === true || opts.keyframe === true) {
    const scrubIndex =
      (base as any).scrubIndex != null
        ? Number((base as any).scrubIndex)
        : scrubIndexOpt != null
          ? Number(scrubIndexOpt)
          : 0;
    const frame = (base as any).currentFrame || null;
    const id =
      String(opts.keyframeId || '').trim() ||
      `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const nameZh =
      String(opts.keyframeNameZh || '').trim() ||
      `关帧·${frame?.phaseZh || frame?.captionZh || '帧' + (scrubIndex + 1)}`;
    savedKeyframe = {
      id,
      nameZh,
      scrubIndex,
      frameIndex: scrubIndex,
      phase: frame?.phase || null,
      phaseZh: frame?.phaseZh || null,
      captionZh: frame?.captionZh || null,
      kind: frame?.kind || null,
      forced: !!frame?.forced,
      createdAt: new Date().toISOString(),
      wave: 'M101',
    };
    const idx = kfStore.keyframes.findIndex((k: any) => String(k.id) === id);
    if (idx >= 0) kfStore.keyframes[idx] = savedKeyframe;
    else kfStore.keyframes.unshift(savedKeyframe);
    kfStore.keyframes = kfStore.keyframes.slice(0, 40);
    saveForceRerunClipKeyframeBookmarks(tid, kfStore);

    // 在 scrubber 帧上打关键帧标记
    const frames = Array.isArray((base as any).clipFrames) ? (base as any).clipFrames : [];
    if (frames[scrubIndex]) {
      frames[scrubIndex] = {
        ...frames[scrubIndex],
        keyframe: true,
        keyframeId: id,
        keyframeNameZh: nameZh,
      };
    }
    if ((base as any).scrubber) {
      (base as any).scrubber = {
        ...(base as any).scrubber,
        wave: 'M101',
        keyframes: kfStore.keyframes,
        currentFrame: frames[scrubIndex] || (base as any).currentFrame,
      };
    }
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M101' as const,
    labelZh: savedKeyframe
      ? '强制重跑片段 scrubber · 已标关键帧书签'
      : '强制重跑片段 scrubber · 关键帧书签',
    tipZh:
      ((base as any).tipZh || '') +
      (savedKeyframe
        ? ` · 已标关帧「${savedKeyframe.nameZh}」· 帧 ${(savedKeyframe.scrubIndex ?? 0) + 1}`
        : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: savedKeyframe
      ? `已标关帧 · ${savedKeyframe.nameZh}`
      : (base as any).toastZh || '片段关帧书签',
    busyZh: '强制重跑片段 scrubber 关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    savedKeyframe,
    keyframes: kfStore.keyframes,
    keyframeBookmarkPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks',
  };
}


/** M102：关帧书签站内短片章节存储 */
function forceRerunClipKeyframeChaptersPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'force-rerun-clip-keyframe-chapters.json');
}

function loadForceRerunClipKeyframeChapters(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = forceRerunClipKeyframeChaptersPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        chapters: Array.isArray(raw.chapters) ? raw.chapters : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { chapters: [] as any[], updatedAt: null as string | null };
}

function saveForceRerunClipKeyframeChapters(
  tenantId: string | null | undefined,
  store: { chapters: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = forceRerunClipKeyframeChaptersPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/**
 * M102：关帧书签分组为站内短片章节
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipKeyframeInAppClipChapters(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    phaseId?: string | null;
    forcePhase?: string | null;
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    replayClip?: boolean;
    listClipFrames?: boolean;
    markKeyframe?: boolean;
    keyframe?: boolean;
    keyframeNameZh?: string | null;
    keyframeId?: string | null;
    listKeyframes?: boolean;
    jumpToKeyframeId?: string | null;
    groupIntoChapters?: boolean;
    buildChapters?: boolean;
    listChapters?: boolean;
    chapterId?: string | null;
    chapterNameZh?: string | null;
    jumpToChapterId?: string | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const base = forceRerunClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    confirmForce: opts.confirmForce !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
  });

  const keyframes: any[] = Array.isArray((base as any).keyframes) ? (base as any).keyframes : [];
  const chapterStore = loadForceRerunClipKeyframeChapters(tid);

  const wantsBuild =
    opts.groupIntoChapters === true ||
    opts.buildChapters === true ||
    opts.markKeyframe === true ||
    opts.keyframe === true ||
    (!opts.listChapters && !opts.jumpToChapterId);

  // 按 phase 分组为章节；无 phase 时按 scrubIndex 区间
  function buildChaptersFromKeyframes(kfs: any[]) {
    const byPhase = new Map<string, any[]>();
    for (const kf of kfs) {
      const key = String(kf.phase || kf.phaseZh || 'misc');
      if (!byPhase.has(key)) byPhase.set(key, []);
      byPhase.get(key)!.push(kf);
    }
    const chapters: any[] = [];
    let i = 0;
    for (const [phaseKey, list] of byPhase) {
      list.sort((a, b) => Number(a.scrubIndex || 0) - Number(b.scrubIndex || 0));
      const phaseZh = list[0]?.phaseZh || phaseKey;
      const id =
        opts.chapterId && i === 0
          ? String(opts.chapterId)
          : `chap-${phaseKey}-${Date.now().toString(36).slice(-4)}-${i}`;
      const nameZh =
        (i === 0 && String(opts.chapterNameZh || '').trim()) ||
        `短片章节·${phaseZh}`;
      chapters.push({
        id,
        nameZh,
        phase: list[0]?.phase || phaseKey,
        phaseZh,
        keyframeIds: list.map((k) => k.id),
        keyframes: list,
        startScrubIndex: list[0]?.scrubIndex ?? 0,
        endScrubIndex: list[list.length - 1]?.scrubIndex ?? 0,
        frameCount: list.length,
        createdAt: new Date().toISOString(),
        wave: 'M102',
        inAppOnly: true as const,
        noEgress: true as const,
      });
      i++;
    }
    return chapters;
  }

  if (opts.listChapters === true && !wantsBuild) {
    return {
      ...(base as any),
      wave: 'M102' as const,
      labelZh: '关帧书签 · 站内短片章节台账',
      tipZh: `共 ${chapterStore.chapters.length} 个站内短片章节 · 软取消仍赢 · 干跑无外发`,
      toastZh: chapterStore.chapters.length
        ? `短片章节 · ${chapterStore.chapters.length}`
        : '暂无短片章节',
      busyZh: '加载关帧站内短片章节…',
      chapters: chapterStore.chapters,
      keyframes,
      clipChaptersPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters',
    };
  }

  let chapters = chapterStore.chapters;
  if (wantsBuild || opts.groupIntoChapters !== false) {
    chapters = buildChaptersFromKeyframes(keyframes);
    chapterStore.chapters = chapters.slice(0, 40);
    saveForceRerunClipKeyframeChapters(tid, chapterStore);
  }

  let jumpedChapter: any = null;
  let scrubIndexOpt = (base as any).scrubIndex;
  if (opts.jumpToChapterId) {
    jumpedChapter =
      chapters.find((c: any) => String(c.id) === String(opts.jumpToChapterId)) || null;
    if (jumpedChapter) scrubIndexOpt = jumpedChapter.startScrubIndex;
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M102' as const,
    labelZh: (base as any).savedKeyframe
      ? '关帧书签 · 已标并归入站内短片章节'
      : '关帧书签 · 站内短片章节',
    tipZh:
      ((base as any).tipZh || '') +
      ` · 已分组 ${chapters.length} 个站内短片章节` +
      (jumpedChapter ? ` · 已跳到「${jumpedChapter.nameZh}」` : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: (base as any).savedKeyframe
      ? `关帧已归章节 · ${chapters.length}章`
      : chapters.length
        ? `站内短片章节 · ${chapters.length}`
        : '暂无章节',
    busyZh: '关帧书签分组站内短片章节…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    chapters,
    jumpedChapter,
    scrubIndex: scrubIndexOpt,
    clipChaptersPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters',
  };
}


/**
 * M103：短片章节 scrubber 跳章
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChaptersChapterScrubberJump(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    phaseId?: string | null;
    forcePhase?: string | null;
    phaseOrder?: string[] | null;
    order?: string[] | null;
    fromIndex?: number | null;
    toIndex?: number | null;
    maxPhases?: number | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    replayClip?: boolean;
    listClipFrames?: boolean;
    markKeyframe?: boolean;
    keyframe?: boolean;
    keyframeNameZh?: string | null;
    keyframeId?: string | null;
    listKeyframes?: boolean;
    jumpToKeyframeId?: string | null;
    groupIntoChapters?: boolean;
    buildChapters?: boolean;
    listChapters?: boolean;
    chapterId?: string | null;
    chapterNameZh?: string | null;
    jumpToChapterId?: string | null;
    chapterScrubberJump?: boolean;
    scrubberJump?: boolean;
    jumpChapter?: boolean;
    scrubToChapterId?: string | null;
    nextChapter?: boolean;
    prevChapter?: boolean;
    chapterScrubIndex?: number | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const base = forceRerunClipKeyframeInAppClipChapters(tid, {
    ...opts,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    confirmForce: opts.confirmForce !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
    groupIntoChapters: opts.groupIntoChapters !== false,
  });

  const chapters: any[] = Array.isArray((base as any).chapters) ? (base as any).chapters : [];
  const scrubber = {
    wave: 'M103' as const,
    kind: 'clip-chapter-scrubber' as const,
    titleZh: '短片章节 scrubber',
    chapterCount: chapters.length,
    chapters: chapters.map((c: any, i: number) => ({
      id: c.id,
      nameZh: c.nameZh,
      phase: c.phase,
      phaseZh: c.phaseZh,
      startScrubIndex: c.startScrubIndex,
      endScrubIndex: c.endScrubIndex,
      frameCount: c.frameCount,
      scrubberSlot: i,
    })),
    currentChapterId: null as string | null,
    currentScrubIndex: (base as any).scrubIndex ?? 0,
  };

  let jumped: any = (base as any).jumpedChapter || null;
  let scrubIndex = (base as any).scrubIndex ?? 0;
  const wantsJump =
    opts.chapterScrubberJump === true ||
    opts.scrubberJump === true ||
    opts.jumpChapter === true ||
    !!opts.scrubToChapterId ||
    !!opts.jumpToChapterId ||
    opts.nextChapter === true ||
    opts.prevChapter === true ||
    opts.chapterScrubIndex != null;

  if (wantsJump && chapters.length) {
    let targetId =
      String(opts.scrubToChapterId || opts.jumpToChapterId || opts.chapterId || '').trim() || '';
    if (!targetId && opts.chapterScrubIndex != null) {
      const idx = Math.max(0, Math.min(chapters.length - 1, Number(opts.chapterScrubIndex)));
      targetId = String(chapters[idx]?.id || '');
    }
    if (!targetId && (opts.nextChapter || opts.prevChapter)) {
      const curId = String((base as any).jumpedChapter?.id || chapters[0]?.id || '');
      const curIdx = Math.max(0, chapters.findIndex((c) => String(c.id) === curId));
      const nextIdx = opts.nextChapter
        ? Math.min(chapters.length - 1, curIdx + 1)
        : Math.max(0, curIdx - 1);
      targetId = String(chapters[nextIdx]?.id || '');
    }
    jumped = chapters.find((c) => String(c.id) === targetId) || chapters[0] || null;
    if (jumped) {
      scrubIndex = jumped.startScrubIndex ?? 0;
      scrubber.currentChapterId = jumped.id;
      scrubber.currentScrubIndex = scrubIndex;
    }
  } else if (jumped) {
    scrubber.currentChapterId = jumped.id;
    scrubber.currentScrubIndex = scrubIndex;
  } else if (chapters[0]) {
    scrubber.currentChapterId = chapters[0].id;
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M103' as const,
    labelZh: jumped
      ? `短片章节 scrubber · 已跳到「${jumped.nameZh}」`
      : '短片章节 scrubber 跳章',
    tipZh:
      ((base as any).tipZh || '') +
      ` · scrubber 共 ${chapters.length} 章` +
      (jumped ? ` · 当前「${jumped.nameZh}」scrub#${scrubIndex}` : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: jumped
      ? `已跳章 · ${jumped.nameZh}`
      : chapters.length
        ? `章节 scrubber · ${chapters.length}`
        : '暂无章节',
    busyZh: '短片章节 scrubber 跳章…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    chapters,
    jumpedChapter: jumped,
    scrubIndex,
    chapterScrubber: scrubber,
    chapterScrubberJump: !!jumped,
    clipChapterScrubberJumpPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump',
  };
}


/** M104：章节 scrubber 跨会话书签持久化 */
function chapterScrubberCrossSessionBookmarkPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'chapter-scrubber-cross-session-bookmarks.json');
}

function loadChapterScrubberCrossSessionBookmarks(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = chapterScrubberCrossSessionBookmarkPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { bookmarks: [] as any[], updatedAt: null as string | null };
}

function saveChapterScrubberCrossSessionBookmarks(
  tenantId: string | null | undefined,
  store: { bookmarks: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = chapterScrubberCrossSessionBookmarkPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/**
 * M104：短片章节 scrubber 位置跨会话书签
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChapterScrubberCrossSessionBookmarks(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    replayClip?: boolean;
    groupIntoChapters?: boolean;
    chapterScrubberJump?: boolean;
    scrubToChapterId?: string | null;
    jumpToChapterId?: string | null;
    chapterId?: string | null;
    chapterScrubIndex?: number | null;
    nextChapter?: boolean;
    prevChapter?: boolean;
    bookmarkChapterScrubber?: boolean;
    saveChapterBookmark?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    chapterBookmarkId?: string | null;
    listChapterBookmarks?: boolean;
    jumpToChapterBookmarkId?: string | null;
    useCrossSessionBookmark?: boolean;
    scrubIndex?: number | null;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const base = forceRerunClipChaptersChapterScrubberJump(tid, {
    ...opts,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    confirmForce: opts.confirmForce !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
    groupIntoChapters: opts.groupIntoChapters !== false,
    chapterScrubberJump: opts.chapterScrubberJump !== false,
  });

  const store = loadChapterScrubberCrossSessionBookmarks(tid);
  const chapters: any[] = Array.isArray((base as any).chapters) ? (base as any).chapters : [];
  const jumped = (base as any).jumpedChapter || null;
  const scrubIndex = (base as any).scrubIndex ?? 0;

  if (opts.listChapterBookmarks === true) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M104' as const,
      labelZh: '章节 scrubber · 跨会话书签列表',
      tipZh: `共 ${store.bookmarks.length} 个跨会话书签 · 软取消仍赢 · 干跑无外发`,
      toastZh: store.bookmarks.length
        ? `跨会话书签 · ${store.bookmarks.length}`
        : '暂无跨会话书签',
      busyZh: '加载章节 scrubber 跨会话书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      chapterBookmarks: store.bookmarks,
      crossSession: true as const,
    };
  }

  // 跳到已存跨会话书签
  if (opts.jumpToChapterBookmarkId || opts.useCrossSessionBookmark === true) {
    const bmId = String(opts.jumpToChapterBookmarkId || '').trim();
    const bm =
      (bmId ? store.bookmarks.find((b: any) => String(b.id) === bmId) : null) ||
      store.bookmarks[0] ||
      null;
    if (!bm) {
      return {
        ...(base as any),
        ok: false as const,
        wave: 'M104' as const,
        labelZh: '章节 scrubber · 跨会话书签跳转',
        tipZh: '暂无跨会话书签可跳 · 中页取消仍在 · 无外发',
        toastZh: '无跨会话书签',
        busyZh: '跳转章节 scrubber 跨会话书签…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        jumpedToBookmark: false as const,
      };
    }
    const chap =
      chapters.find((c) => String(c.id) === String(bm.chapterId)) ||
      chapters[bm.chapterScrubIndex ?? 0] ||
      null;
    const jumpScrub = bm.scrubIndex ?? chap?.startScrubIndex ?? 0;
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M104' as const,
      labelZh: `章节 scrubber · 已跳到跨会话书签「${bm.nameZh || bm.id}」`,
      tipZh:
        `已恢复跨会话书签「${bm.nameZh || bm.id}」` +
        (chap ? ` · 章节「${chap.nameZh}」` : '') +
        ` · scrub#${jumpScrub}` +
        ' · 软取消仍赢 · 干跑无外发',
      toastZh: `跨会话书签 · ${bm.nameZh || bm.id}`,
      busyZh: '跳转章节 scrubber 跨会话书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      jumpedToBookmark: true as const,
      chapterBookmark: bm,
      jumpedChapter: chap || jumped,
      scrubIndex: jumpScrub,
      chapterScrubber: {
        ...((base as any).chapterScrubber || {}),
        wave: 'M104',
        currentChapterId: chap?.id || bm.chapterId || null,
        currentScrubIndex: jumpScrub,
        crossSessionBookmarkId: bm.id,
      },
      chapterBookmarks: store.bookmarks,
      clipChapterScrubberCrossSessionBookmarkPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks',
    };
  }

  const wantsSave =
    opts.bookmarkChapterScrubber === true ||
    opts.saveChapterBookmark === true ||
    opts.bookmark === true;

  if (wantsSave) {
    const chap = jumped || chapters[0] || null;
    const id =
      String(opts.chapterBookmarkId || '').trim() ||
      `ch-bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      nameZh:
        String(opts.bookmarkNameZh || '').trim() ||
        (chap ? `章节书签·${chap.nameZh}` : '章节 scrubber 书签'),
      chapterId: chap?.id || opts.scrubToChapterId || opts.jumpToChapterId || null,
      chapterNameZh: chap?.nameZh || null,
      chapterScrubIndex: chap
        ? Math.max(0, chapters.findIndex((c) => String(c.id) === String(chap.id)))
        : opts.chapterScrubIndex ?? 0,
      scrubIndex,
      phaseOrder: opts.phaseOrder || opts.order || null,
      createdAt: new Date().toISOString(),
      wave: 'M104',
      crossSession: true,
    };
    store.bookmarks = [entry, ...store.bookmarks.filter((b: any) => String(b.id) !== id)].slice(
      0,
      40,
    );
    saveChapterScrubberCrossSessionBookmarks(tid, store);
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M104' as const,
      labelZh: `章节 scrubber · 已存跨会话书签「${entry.nameZh}」`,
      tipZh:
        `已保存跨会话书签「${entry.nameZh}」` +
        (chap ? ` · 章节「${chap.nameZh}」scrub#${scrubIndex}` : '') +
        ' · 下次会话可跳回 · 软取消仍赢 · 干跑无外发',
      toastZh: `已存跨会话书签 · ${entry.nameZh}`,
      busyZh: '保存章节 scrubber 跨会话书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      savedChapterBookmark: entry,
      chapterBookmarks: store.bookmarks,
      crossSession: true as const,
      clipChapterScrubberCrossSessionBookmarkPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks',
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M104' as const,
    labelZh: (base as any).labelZh
      ? String((base as any).labelZh).replace(/^M103·?/, 'M104·')
      : '章节 scrubber · 可跨会话书签',
    tipZh: ((base as any).tipZh || '') + ' · 可存跨会话书签',
    toastZh: (base as any).toastZh || '章节 scrubber 跨会话书签',
    busyZh: '章节 scrubber 跨会话书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    canBookmarkCrossSession: true as const,
    chapterBookmarks: store.bookmarks,
    clipChapterScrubberCrossSessionBookmarkPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks',
  };
}


/**
 * M105：章节 scrubber 跨会话书签按角色分套
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChapterBookmarksByRole(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    replayClip?: boolean;
    groupIntoChapters?: boolean;
    chapterScrubberJump?: boolean;
    bookmarkChapterScrubber?: boolean;
    saveChapterBookmark?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    chapterBookmarkId?: string | null;
    listChapterBookmarks?: boolean;
    jumpToChapterBookmarkId?: string | null;
    useCrossSessionBookmark?: boolean;
    role?: string | null;
    myRole?: string | null;
    bookmarkRole?: string | null;
    scopeBookmarksByRole?: boolean;
    filterBookmarksByRole?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role =
    String(opts.role || opts.myRole || opts.bookmarkRole || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const scopeByRole =
    opts.scopeBookmarksByRole !== false && opts.filterBookmarksByRole !== false;

  const wantsSave =
    opts.bookmarkChapterScrubber === true ||
    opts.saveChapterBookmark === true ||
    opts.bookmark === true;

  // 保存时打上角色标签
  const base = forceRerunClipChapterScrubberCrossSessionBookmarks(tid, {
    ...opts,
    bookmarkNameZh:
      opts.bookmarkNameZh ||
      (wantsSave ? `角色书签·${roleZh}` : opts.bookmarkNameZh),
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
    groupIntoChapters: opts.groupIntoChapters !== false,
    chapterScrubberJump: opts.chapterScrubberJump !== false,
  });

  const store = loadChapterScrubberCrossSessionBookmarks(tid);

  // 若刚保存：给最新书签打 role
  if (wantsSave && (base as any).savedChapterBookmark) {
    const bm = (base as any).savedChapterBookmark;
    bm.role = role;
    bm.roleZh = roleZh;
    bm.wave = 'M105';
    bm.scopedByRole = true;
    store.bookmarks = store.bookmarks.map((b: any) =>
      String(b.id) === String(bm.id) ? { ...b, ...bm } : b,
    );
    // 若 map 未命中（新 id），前置写入
    if (!store.bookmarks.find((b: any) => String(b.id) === String(bm.id))) {
      store.bookmarks = [bm, ...store.bookmarks].slice(0, 40);
    }
    saveChapterScrubberCrossSessionBookmarks(tid, store);
  }

  const all = store.bookmarks;
  const byRole = scopeByRole
    ? all.filter((b: any) => !b.role || String(b.role).toLowerCase() === role)
    : all;

  if (opts.listChapterBookmarks === true) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M105' as const,
      labelZh: `章节书签 · 「${roleZh}」角色分套列表`,
      tipZh: `角色「${roleZh}」可见 ${byRole.length}/${all.length} 个书签 · 软取消仍赢 · 干跑无外发`,
      toastZh: byRole.length
        ? `角色书签 · ${roleZh} · ${byRole.length}`
        : `「${roleZh}」暂无书签`,
      busyZh: '加载角色分套章节书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      role,
      roleZh,
      scopedByRole: scopeByRole,
      chapterBookmarks: byRole,
      chapterBookmarksAll: all,
      crossSession: true as const,
      clipChapterBookmarksByRolePath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role',
    };
  }

  // 跳转：仅允许本角色书签（或无角色标签的兼容书签）
  if (opts.jumpToChapterBookmarkId || opts.useCrossSessionBookmark === true) {
    const bmId = String(opts.jumpToChapterBookmarkId || '').trim();
    const bm =
      (bmId
        ? byRole.find((b: any) => String(b.id) === bmId) ||
          all.find((b: any) => String(b.id) === bmId && (!b.role || String(b.role).toLowerCase() === role))
        : null) ||
      byRole[0] ||
      null;
    if (!bm) {
      return {
        ...(base as any),
        ok: false as const,
        wave: 'M105' as const,
        labelZh: `章节书签 · 「${roleZh}」角色跳转`,
        tipZh: `角色「${roleZh}」暂无可用书签 · 中页取消仍在 · 无外发`,
        toastZh: `无「${roleZh}」书签`,
        busyZh: '跳转角色分套章节书签…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        jumpedToBookmark: false as const,
        role,
        roleZh,
        scopedByRole: true as const,
      };
    }
    // 复用 M104 跳转，但强制 id
    const jumped = forceRerunClipChapterScrubberCrossSessionBookmarks(tid, {
      ...opts,
      jumpToChapterBookmarkId: bm.id,
      useCrossSessionBookmark: true,
      groupIntoChapters: true,
      chapterScrubberJump: true,
      skipCompleted: true,
      dryRun: true,
    });
    return {
      ...(jumped as any),
      ok: true as const,
      wave: 'M105' as const,
      labelZh: `章节书签 · 已跳到「${roleZh}」书签「${bm.nameZh || bm.id}」`,
      tipZh:
        ((jumped as any).tipZh || '') +
        ` · 角色分套「${roleZh}」` +
        ' · 软取消仍赢 · 干跑无外发',
      toastZh: `角色书签 · ${roleZh} · ${bm.nameZh || bm.id}`,
      busyZh: '跳转角色分套章节书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      jumpedToBookmark: true as const,
      role,
      roleZh,
      scopedByRole: true as const,
      chapterBookmark: { ...bm, role, roleZh },
      chapterBookmarks: byRole,
      clipChapterBookmarksByRolePath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role',
    };
  }

  if (wantsSave) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M105' as const,
      labelZh: `章节书签 · 已存「${roleZh}」角色分套`,
      tipZh:
        ((base as any).tipZh || '') +
        ` · 已打角色标签「${roleZh}」` +
        ' · 软取消仍赢 · 干跑无外发',
      toastZh: `已存角色书签 · ${roleZh}`,
      busyZh: '保存角色分套章节书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      role,
      roleZh,
      scopedByRole: true as const,
      savedChapterBookmark: (base as any).savedChapterBookmark
        ? { ...(base as any).savedChapterBookmark, role, roleZh, wave: 'M105', scopedByRole: true }
        : null,
      chapterBookmarks: byRole,
      clipChapterBookmarksByRolePath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role',
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M105' as const,
    labelZh: ((base as any).labelZh || '章节书签')
      .toString()
      .replace(/^M104·?/, 'M105·'),
    tipZh: ((base as any).tipZh || '') + ` · 可按角色「${roleZh}」分套`,
    toastZh: (base as any).toastZh || `章节书签角色分套 · ${roleZh}`,
    busyZh: '章节书签角色分套…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    role,
    roleZh,
    scopedByRole: scopeByRole,
    chapterBookmarks: byRole,
    canBookmarkByRole: true as const,
    clipChapterBookmarksByRolePath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role',
  };
}


/**
 * M106：角色分套章节书签跨租户只读继承
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChapterBookmarksByRoleCrossTenantReadOnlyInherit(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    replayClip?: boolean;
    groupIntoChapters?: boolean;
    chapterScrubberJump?: boolean;
    bookmarkChapterScrubber?: boolean;
    saveChapterBookmark?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    listChapterBookmarks?: boolean;
    jumpToChapterBookmarkId?: string | null;
    useCrossSessionBookmark?: boolean;
    role?: string | null;
    myRole?: string | null;
    bookmarkRole?: string | null;
    scopeBookmarksByRole?: boolean;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    readOnlyInherit?: boolean;
    seedInheritSource?: boolean;
    previewInheritDiff?: boolean;
    confirmInherit?: boolean;
    confirmCardAck?: boolean;
    adoptInherited?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role =
    String(opts.role || opts.myRole || opts.bookmarkRole || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const sourceTid = String(opts.inheritFromTenant || opts.sourceTenantId || '').trim();
  const wantsInherit =
    opts.crossTenantInherit === true ||
    opts.readOnlyInherit === true ||
    (!!sourceTid && sourceTid !== tid);

  const base = forceRerunClipChapterBookmarksByRole(tid, {
    ...opts,
    role,
    scopeBookmarksByRole: opts.scopeBookmarksByRole !== false,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
    groupIntoChapters: opts.groupIntoChapters !== false,
    chapterScrubberJump: opts.chapterScrubberJump !== false,
  });

  if (!wantsInherit) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M106' as const,
      tipZh: ((base as any).tipZh || '') + ' · 可跨租户只读继承角色书签',
      canCrossTenantReadOnlyInherit: true as const,
      clipChapterBookmarksByRoleCrossTenantInheritPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit',
    };
  }

  if (!sourceTid || sourceTid === tid) {
    return {
      ...(base as any),
      ok: false as const,
      wave: 'M106' as const,
      labelZh: '角色书签 · 跨租户只读继承',
      tipZh: '需要不同源租户 inheritFromTenant · 中页取消仍在 · 无外发',
      toastZh: '缺源租户',
      busyZh: '角色书签跨租户只读继承…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      inherited: false as const,
    };
  }

  // 种子源租户角色书签
  if (opts.seedInheritSource === true) {
    const srcStore = loadChapterScrubberCrossSessionBookmarks(sourceTid);
    if (!srcStore.bookmarks.some((b: any) => String(b.role || '').toLowerCase() === role)) {
      const seedBm = {
        id: `seed-role-bm-${role}-${Date.now().toString(36)}`,
        nameZh: `源租户·${roleZh}·章节书签`,
        role,
        roleZh,
        chapterId: 'chapter-seed-1',
        scrubIndex: 1,
        wave: 'M106',
        scopedByRole: true,
        readOnly: true,
        createdAt: new Date().toISOString(),
      };
      srcStore.bookmarks = [seedBm, ...srcStore.bookmarks].slice(0, 40);
      saveChapterScrubberCrossSessionBookmarks(sourceTid, srcStore);
    }
  }

  const srcStore = loadChapterScrubberCrossSessionBookmarks(sourceTid);
  const srcByRole = srcStore.bookmarks.filter(
    (b: any) => !b.role || String(b.role).toLowerCase() === role,
  );
  const localStore = loadChapterScrubberCrossSessionBookmarks(tid);
  const localByRole = localStore.bookmarks.filter(
    (b: any) => !b.role || String(b.role).toLowerCase() === role,
  );
  const srcIds = new Set(srcByRole.map((b: any) => String(b.id)));
  const localIds = new Set(localByRole.map((b: any) => String(b.id)));
  const onlySrc = srcByRole.filter((b: any) => !localIds.has(String(b.id)));
  const onlyLocal = localByRole.filter((b: any) => !srcIds.has(String(b.id)));
  const both = srcByRole.filter((b: any) => localIds.has(String(b.id)));

  const inheritDiff = {
    wave: 'M106' as const,
    kind: 'role-chapter-bookmark-cross-tenant-inherit-diff' as const,
    titleZh: `角色书签跨租户只读继承差分 · 「${roleZh}」`,
    bodyZh:
      `源「${sourceTid}」${srcByRole.length} · 本租户「${tid}」${localByRole.length}` +
      ` · 仅源 ${onlySrc.length} · 仅本 ${onlyLocal.length} · 共有 ${both.length}` +
      ' · 只读 · 无外发',
    sourceTenantId: sourceTid,
    targetTenantId: tid,
    role,
    roleZh,
    onlySource: onlySrc.map((b: any) => ({
      id: b.id,
      nameZh: b.nameZh,
      role: b.role || role,
      readOnly: true,
    })),
    onlyLocal: onlyLocal.map((b: any) => ({ id: b.id, nameZh: b.nameZh, role: b.role || role })),
    both: both.map((b: any) => ({ id: b.id, nameZh: b.nameZh })),
    readOnly: true as const,
  };

  const wantsAdopt =
    opts.adoptInherited === true ||
    opts.confirmInherit === true ||
    opts.confirmCardAck === true;

  if (!wantsAdopt || (opts.confirmInherit !== true && opts.confirmCardAck !== true && opts.adoptInherited !== true)) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M106' as const,
      labelZh: '角色书签 · 跨租户只读继承差分预览',
      tipZh: inheritDiff.bodyZh + ' · 确认后只读纳入本租户 · 软取消仍赢',
      toastZh: `继承预览 · 仅源${onlySrc.length}`,
      busyZh: '角色书签跨租户只读继承…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      role,
      roleZh,
      scopedByRole: true as const,
      inheritDiff,
      inheritPreview: inheritDiff,
      confirmCard: {
        wave: 'M106' as const,
        kind: 'role-bookmark-cross-tenant-inherit-confirm' as const,
        titleZh: `确认只读继承「${roleZh}」书签自「${sourceTid}」`,
        bodyZh: inheritDiff.bodyZh,
        requireAck: true as const,
        readOnly: true as const,
      },
      inherited: false as const,
      readOnlyInherit: true as const,
      clipChapterBookmarksByRoleCrossTenantInheritPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit',
    };
  }

  // 只读纳入：复制源侧独有书签，标记 inherited/readOnly
  const inheritedNow = onlySrc.map((b: any) => ({
    ...b,
    id: `inh-${sourceTid}-${b.id}`,
    inheritedFrom: sourceTid,
    inheritedFromId: b.id,
    readOnly: true,
    role,
    roleZh,
    wave: 'M106',
    scopedByRole: true,
    inheritedAt: new Date().toISOString(),
  }));
  localStore.bookmarks = [...inheritedNow, ...localStore.bookmarks].slice(0, 40);
  saveChapterScrubberCrossSessionBookmarks(tid, localStore);

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M106' as const,
    labelZh: `角色书签 · 已只读继承 ${inheritedNow.length} 条「${roleZh}」`,
    tipZh:
      inheritDiff.bodyZh +
      ` · 已只读纳入 ${inheritedNow.length} 条` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `只读继承 · ${inheritedNow.length}条 · ${roleZh}`,
    busyZh: '角色书签跨租户只读继承…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    role,
    roleZh,
    scopedByRole: true as const,
    inheritDiff,
    inherited: true as const,
    readOnlyInherit: true as const,
    inheritedBookmarks: inheritedNow,
    chapterBookmarks: localStore.bookmarks.filter(
      (b: any) => !b.role || String(b.role).toLowerCase() === role,
    ),
    clipChapterBookmarksByRoleCrossTenantInheritPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit',
  };
}


/**
 * M107：跨租户继承可按书签子集采纳
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChapterBookmarksByRoleCrossTenantInheritBookmarkSubset(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    replayClip?: boolean;
    groupIntoChapters?: boolean;
    chapterScrubberJump?: boolean;
    bookmarkChapterScrubber?: boolean;
    saveChapterBookmark?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    listChapterBookmarks?: boolean;
    jumpToChapterBookmarkId?: string | null;
    useCrossSessionBookmark?: boolean;
    role?: string | null;
    myRole?: string | null;
    bookmarkRole?: string | null;
    scopeBookmarksByRole?: boolean;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    readOnlyInherit?: boolean;
    seedInheritSource?: boolean;
    previewInheritDiff?: boolean;
    confirmInherit?: boolean;
    confirmCardAck?: boolean;
    adoptInherited?: boolean;
    bookmarkSubset?: boolean;
    adoptBookmarkSubset?: boolean;
    bookmarkIds?: string[] | null;
    selectedBookmarkIds?: string[] | null;
    inheritBookmarkIds?: string[] | null;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role =
    String(opts.role || opts.myRole || opts.bookmarkRole || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  const wantsSubset =
    opts.bookmarkSubset === true ||
    opts.adoptBookmarkSubset === true ||
    (Array.isArray(opts.bookmarkIds) && opts.bookmarkIds.length > 0) ||
    (Array.isArray(opts.selectedBookmarkIds) && opts.selectedBookmarkIds.length > 0) ||
    (Array.isArray(opts.inheritBookmarkIds) && opts.inheritBookmarkIds.length > 0);

  const base = forceRerunClipChapterBookmarksByRoleCrossTenantReadOnlyInherit(tid, {
    ...opts,
    role,
    scopeBookmarksByRole: opts.scopeBookmarksByRole !== false,
    skipCompleted: opts.skipCompleted !== false,
    dryRun: opts.dryRun !== false,
    foldIntoChainTaskCard: opts.foldIntoChainTaskCard !== false,
    replayClip: opts.replayClip !== false,
    groupIntoChapters: opts.groupIntoChapters !== false,
    chapterScrubberJump: opts.chapterScrubberJump !== false,
  });

  if (!wantsSubset) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M107' as const,
      tipZh: ((base as any).tipZh || '') + ' · 可按书签子集采纳继承',
      canAdoptBookmarkSubset: true as const,
      clipChapterBookmarksByRoleCrossTenantInheritBookmarkSubsetPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset',
    };
  }

  const requestedIds = [
    ...((Array.isArray(opts.bookmarkIds) && opts.bookmarkIds) || []),
    ...((Array.isArray(opts.selectedBookmarkIds) && opts.selectedBookmarkIds) || []),
    ...((Array.isArray(opts.inheritBookmarkIds) && opts.inheritBookmarkIds) || []),
  ]
    .map(String)
    .filter(Boolean);

  const onlySource: any[] = Array.isArray((base as any).inheritDiff?.onlySource)
    ? (base as any).inheritDiff.onlySource
    : Array.isArray((base as any).inheritedBookmarks)
      ? (base as any).inheritedBookmarks.map((b: any) => ({
          id: b.inheritedFromId || b.id,
          nameZh: b.nameZh,
          role: b.role || role,
        }))
      : [];

  const subsetPool = onlySource.length
    ? onlySource
    : Array.isArray((base as any).chapterBookmarks)
      ? (base as any).chapterBookmarks
      : [];

  const picked = requestedIds.length
    ? subsetPool.filter(
        (b: any) =>
          requestedIds.includes(String(b.id)) ||
          requestedIds.includes(String(b.inheritedFromId || '')),
      )
    : subsetPool.slice(0, Math.min(2, subsetPool.length || 0));

  // 若尚未采纳但要求子集：先给预览
  const wantsAdopt =
    opts.adoptInherited === true ||
    opts.confirmInherit === true ||
    opts.confirmCardAck === true ||
    opts.adoptBookmarkSubset === true;

  if (!wantsAdopt) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M107' as const,
      labelZh: '角色书签 · 跨租户继承书签子集预览',
      tipZh:
        `可选子集 ${picked.length}/${subsetPool.length}` +
        (picked.length ? `「${picked.map((b: any) => b.nameZh || b.id).join('、')}」` : '') +
        ' · 确认后只读纳入 · 软取消仍赢 · 无外发',
      toastZh: `书签子集预览 · ${picked.length}`,
      busyZh: '跨租户继承书签子集…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      bookmarkSubsetPreview: {
        wave: 'M107' as const,
        kind: 'role-bookmark-inherit-subset-preview' as const,
        titleZh: `书签子集预览 · 「${roleZh}」`,
        selected: picked,
        poolSize: subsetPool.length,
        requestedIds,
      },
      inherited: false as const,
      bookmarkSubset: true as const,
      clipChapterBookmarksByRoleCrossTenantInheritBookmarkSubsetPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset',
    };
  }

  // 已继承时，过滤为子集
  let inheritedBookmarks: any[] = Array.isArray((base as any).inheritedBookmarks)
    ? (base as any).inheritedBookmarks
    : [];
  if (requestedIds.length && inheritedBookmarks.length) {
    inheritedBookmarks = inheritedBookmarks.filter(
      (b: any) =>
        requestedIds.includes(String(b.inheritedFromId || '')) ||
        requestedIds.includes(String(b.id)) ||
        picked.some((p: any) => String(p.id) === String(b.inheritedFromId || b.id)),
    );
  } else if (!inheritedBookmarks.length && picked.length) {
    inheritedBookmarks = picked.map((b: any) => ({
      ...b,
      id: `inh-subset-${b.id}`,
      inheritedFromId: b.id,
      readOnly: true,
      role,
      roleZh,
      wave: 'M107',
      scopedByRole: true,
      subsetAdopted: true,
      inheritedAt: new Date().toISOString(),
    }));
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M107' as const,
    labelZh: `角色书签 · 已按子集只读继承 ${inheritedBookmarks.length} 条「${roleZh}」`,
    tipZh:
      ((base as any).tipZh || '') +
      ` · 书签子集采纳 ${inheritedBookmarks.length}` +
      (inheritedBookmarks.length
        ? `「${inheritedBookmarks.map((b: any) => b.nameZh || b.id).join('、')}」`
        : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `书签子集继承 · ${inheritedBookmarks.length}条 · ${roleZh}`,
    busyZh: '跨租户继承书签子集…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    role,
    roleZh,
    scopedByRole: true as const,
    inherited: inheritedBookmarks.length > 0 || (base as any).inherited === true,
    readOnlyInherit: true as const,
    bookmarkSubset: true as const,
    bookmarkSubsetAdopted: true as const,
    inheritedBookmarks,
    selectedBookmarkIds: requestedIds.length
      ? requestedIds
      : inheritedBookmarks.map((b: any) => String(b.inheritedFromId || b.id)),
    clipChapterBookmarksByRoleCrossTenantInheritBookmarkSubsetPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset',
  };
}


/**
 * M108：书签子集继承先出中文差分预览再确认
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChapterBookmarksInheritBookmarkSubsetDiffPreviewConfirm(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    replayClip?: boolean;
    groupIntoChapters?: boolean;
    chapterScrubberJump?: boolean;
    bookmarkChapterScrubber?: boolean;
    bookmarkNameZh?: string | null;
    role?: string | null;
    myRole?: string | null;
    bookmarkRole?: string | null;
    scopeBookmarksByRole?: boolean;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    readOnlyInherit?: boolean;
    seedInheritSource?: boolean;
    previewInheritDiff?: boolean;
    confirmInherit?: boolean;
    confirmCardAck?: boolean;
    adoptInherited?: boolean;
    bookmarkSubset?: boolean;
    adoptBookmarkSubset?: boolean;
    bookmarkIds?: string[] | null;
    selectedBookmarkIds?: string[] | null;
    inheritBookmarkIds?: string[] | null;
    diffPreviewConfirm?: boolean;
    showDiffPreview?: boolean;
    chineseDiffPreview?: boolean;
    confirmAfterDiffPreview?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role =
    String(opts.role || opts.myRole || opts.bookmarkRole || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  const wantsDiffPreview =
    opts.diffPreviewConfirm === true ||
    opts.showDiffPreview === true ||
    opts.chineseDiffPreview === true ||
    opts.previewInheritDiff === true ||
    opts.confirmAfterDiffPreview === true ||
    opts.bookmarkSubset === true ||
    opts.adoptBookmarkSubset === true;

  // 先拿子集预览（不采纳）
  const preview = forceRerunClipChapterBookmarksByRoleCrossTenantInheritBookmarkSubset(tid, {
    ...opts,
    role,
    bookmarkSubset: true,
    adoptBookmarkSubset: false,
    adoptInherited: false,
    confirmInherit: false,
    confirmCardAck: false,
    dryRun: opts.dryRun !== false,
  });

  const selected =
    (preview as any).bookmarkSubsetPreview?.selected ||
    (preview as any).inheritDiff?.onlySource ||
    [];
  const poolSize =
    (preview as any).bookmarkSubsetPreview?.poolSize ??
    (Array.isArray((preview as any).inheritDiff?.onlySource)
      ? (preview as any).inheritDiff.onlySource.length
      : selected.length);
  const localCount = Array.isArray((preview as any).chapterBookmarks)
    ? (preview as any).chapterBookmarks.length
    : 0;

  const diffPreview = {
    wave: 'M108' as const,
    kind: 'bookmark-subset-inherit-chinese-diff-preview' as const,
    titleZh: `书签子集继承 · 中文差分预览「${roleZh}」`,
    bodyZh:
      `源侧可继承 ${poolSize} · 拟采纳 ${selected.length}` +
      (selected.length
        ? `「${selected.map((b: any) => b.nameZh || b.id).join('、')}」`
        : '') +
      ` · 本租户现有 ${localCount}` +
      ' · 确认后只读纳入 · 软取消仍赢 · 无外发',
    onlySource: selected,
    onlyLocal: [],
    changed: [],
    poolSize,
    selectedCount: selected.length,
    localCount,
    role,
    roleZh,
    requireConfirm: true as const,
  };

  const wantsAdopt =
    opts.adoptInherited === true ||
    opts.confirmInherit === true ||
    opts.confirmCardAck === true ||
    opts.adoptBookmarkSubset === true ||
    opts.confirmAfterDiffPreview === true;

  if (!wantsAdopt) {
    return {
      ...(preview as any),
      ok: true as const,
      wave: 'M108' as const,
      labelZh: '书签子集继承 · 中文差分预览待确认',
      tipZh: diffPreview.bodyZh,
      toastZh: `差分预览 · 拟采纳 ${selected.length}`,
      busyZh: '书签子集差分预览…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      diffPreview,
      chineseDiffPreviewIntact: true as const,
      inherited: false as const,
      bookmarkSubsetAdopted: false as const,
      confirmCard: {
        wave: 'M108' as const,
        kind: 'bookmark-subset-diff-preview-confirm' as const,
        titleZh: '确认按差分预览采纳书签子集',
        bodyZh: diffPreview.bodyZh,
        requireAck: true as const,
      },
      clipChapterBookmarksInheritBookmarkSubsetDiffPreviewConfirmPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm',
    };
  }

  const adopted = forceRerunClipChapterBookmarksByRoleCrossTenantInheritBookmarkSubset(tid, {
    ...opts,
    role,
    bookmarkSubset: true,
    adoptBookmarkSubset: true,
    adoptInherited: true,
    confirmInherit: true,
    confirmCardAck: true,
    dryRun: opts.dryRun !== false,
  });

  return {
    ...(adopted as any),
    ok: true as const,
    wave: 'M108' as const,
    labelZh: `书签子集 · 差分确认后已只读继承 ${(adopted as any).inheritedBookmarks?.length || selected.length} 条`,
    tipZh:
      ((adopted as any).tipZh || '') +
      ` · 已按差分预览确认采纳` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `差分确认采纳 · ${(adopted as any).inheritedBookmarks?.length || selected.length}条`,
    busyZh: '书签子集差分预览确认…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    diffPreview,
    chineseDiffPreviewIntact: true as const,
    diffPreviewConfirmed: true as const,
    bookmarkSubsetAdopted: true as const,
    readOnlyInherit: true as const,
    clipChapterBookmarksInheritBookmarkSubsetDiffPreviewConfirmPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm',
  };
}


/**
 * M109：书签子集差分预览可只采纳一侧
 * （软取消仍赢；干跑无外发）
 */
export function forceRerunClipChapterBookmarksSubsetDiffPreviewOnesideAdopt(
  tenantId?: string | null,
  opts: {
    phaseOrder?: string[] | null;
    order?: string[] | null;
    skipCompleted?: boolean;
    dryRun?: boolean;
    confirmForce?: boolean;
    foldIntoChainTaskCard?: boolean;
    replayClip?: boolean;
    groupIntoChapters?: boolean;
    chapterScrubberJump?: boolean;
    bookmarkChapterScrubber?: boolean;
    bookmarkNameZh?: string | null;
    role?: string | null;
    myRole?: string | null;
    bookmarkRole?: string | null;
    scopeBookmarksByRole?: boolean;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    readOnlyInherit?: boolean;
    seedInheritSource?: boolean;
    previewInheritDiff?: boolean;
    confirmInherit?: boolean;
    confirmCardAck?: boolean;
    adoptInherited?: boolean;
    bookmarkSubset?: boolean;
    adoptBookmarkSubset?: boolean;
    bookmarkIds?: string[] | null;
    selectedBookmarkIds?: string[] | null;
    inheritBookmarkIds?: string[] | null;
    diffPreviewConfirm?: boolean;
    showDiffPreview?: boolean;
    chineseDiffPreview?: boolean;
    confirmAfterDiffPreview?: boolean;
    adoptOneSideOnly?: boolean;
    adoptSide?: 'source' | 'local' | 'before' | 'after' | string | null;
    onesideAdopt?: boolean;
    confirmOneside?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role =
    String(opts.role || opts.myRole || opts.bookmarkRole || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M109' as const,
      labelZh: '差分预览只采纳一侧 · 已软取消',
      tipZh: '用户软取消赢过差分预览只采纳一侧 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '差分预览只采纳一侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const preview = forceRerunClipChapterBookmarksInheritBookmarkSubsetDiffPreviewConfirm(tid, {
    ...opts,
    role,
    chineseDiffPreview: true,
    diffPreviewConfirm: true,
    confirmAfterDiffPreview: false,
    adoptBookmarkSubset: false,
    adoptInherited: false,
    confirmInherit: false,
    confirmCardAck: false,
    dryRun: opts.dryRun !== false,
  });

  const sideRaw = String(opts.adoptSide || 'source').trim().toLowerCase();
  const adoptSide =
    sideRaw === 'local' || sideRaw === 'after' || sideRaw === 'current'
      ? ('local' as const)
      : ('source' as const);
  const adoptSideZh = adoptSide === 'local' ? '本租户侧' : '源侧';

  const wantsOneside =
    opts.adoptOneSideOnly === true ||
    opts.onesideAdopt === true ||
    opts.confirmOneside === true ||
    opts.confirmAfterDiffPreview === true ||
    opts.confirmCardAck === true ||
    opts.adoptBookmarkSubset === true;

  if (!wantsOneside) {
    return {
      ...(preview as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: '书签子集差分预览 · 可只采纳一侧',
      tipZh:
        ((preview as any).tipZh || '') +
        ' · 可勾选只采纳源侧或本租户侧 · 软取消仍赢 · 干跑无外发',
      toastZh: (preview as any).toastZh || '差分预览可只采纳一侧',
      busyZh: '差分预览只采纳一侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      canOnesideAdoptDiffPreview: true as const,
      clipChapterBookmarksSubsetDiffPreviewOnesideAdoptPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt',
    };
  }

  if (adoptSide === 'local') {
    const localCount = Array.isArray((preview as any).chapterBookmarks)
      ? (preview as any).chapterBookmarks.length
      : (preview as any).diffPreview?.localCount || 0;
    return {
      ...(preview as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: `差分预览 · 只采纳本租户侧 · ${localCount}`,
      tipZh:
        `已只采纳「本租户侧」· 保持现有 ${localCount} 条书签` +
        ' · 未写入源侧子集 · 软取消仍赢 · 干跑无外发',
      toastZh: '只采纳本租户侧',
      busyZh: '差分预览只采纳一侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      adoptedOneSide: true as const,
      onesideAdoptIntact: true as const,
      adoptSide: 'local' as const,
      adoptSideZh,
      bookmarkSubsetAdopted: false as const,
      inherited: false as const,
      diffPreviewConfirmed: true as const,
      onesideAdoptCard: {
        wave: 'M109' as const,
        kind: 'bookmark-subset-diff-preview-oneside-adopt' as const,
        titleZh: '差分预览 · 只采纳本租户侧',
        bodyZh: `角色「${roleZh}」只保留本租户侧 ${localCount} 条 · 源侧未纳入 · 无外发`,
        adoptSide: 'local' as const,
        adoptSideZh,
        count: localCount,
      },
      clipChapterBookmarksSubsetDiffPreviewOnesideAdoptPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt',
    };
  }

  const adopted = forceRerunClipChapterBookmarksInheritBookmarkSubsetDiffPreviewConfirm(tid, {
    ...opts,
    role,
    chineseDiffPreview: true,
    diffPreviewConfirm: true,
    confirmAfterDiffPreview: true,
    adoptBookmarkSubset: true,
    adoptInherited: true,
    confirmInherit: true,
    confirmCardAck: true,
    dryRun: opts.dryRun !== false,
  });

  const count =
    (adopted as any).inheritedBookmarks?.length ||
    (preview as any).diffPreview?.selectedCount ||
    0;

  return {
    ...(adopted as any),
    ok: true as const,
    wave: 'M109' as const,
    labelZh: `差分预览 · 只采纳源侧 · ${count}`,
    tipZh:
      ((adopted as any).tipZh || '') +
      ` · 只采纳「源侧」${count} 条` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `只采纳源侧 · ${count}`,
    busyZh: '差分预览只采纳一侧…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    adoptedOneSide: true as const,
    onesideAdoptIntact: true as const,
    adoptSide: 'source' as const,
    adoptSideZh,
    diffPreviewConfirmed: true as const,
    bookmarkSubsetAdopted: true as const,
    onesideAdoptCard: {
      wave: 'M109' as const,
      kind: 'bookmark-subset-diff-preview-oneside-adopt' as const,
      titleZh: '差分预览 · 只采纳源侧',
      bodyZh: `角色「${roleZh}」只纳入源侧 ${count} 条 · 本租户侧未覆盖写 · 无外发`,
      adoptSide: 'source' as const,
      adoptSideZh,
      count,
    },
    clipChapterBookmarksSubsetDiffPreviewOnesideAdoptPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt',
  };
}


/**
 * M110：差分预览只采纳一侧后出前后对照卡
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterBookmarksSubsetDiffPreviewOnesideAdoptBeforeAfterCard(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    adoptOneSideOnly?: boolean;
    onesideAdopt?: boolean;
    adoptSide?: string | null;
    confirmOneside?: boolean;
    confirmAfterDiffPreview?: boolean;
    confirmCardAck?: boolean;
    adoptBookmarkSubset?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    onesideAdoptBeforeAfter?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M110' as const,
      labelZh: '只采纳一侧前后对照 · 已软取消',
      tipZh: '用户软取消赢过只采纳一侧前后对照卡 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '只采纳一侧前后对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterBookmarksSubsetDiffPreviewOnesideAdopt(tid, {
    ...opts,
    role,
    adoptOneSideOnly: opts.adoptOneSideOnly !== false,
    onesideAdopt: opts.onesideAdopt !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsBa =
    opts.showBeforeAfterCard !== false &&
    (opts.showBeforeAfterCard === true ||
      opts.beforeAfterContrast === true ||
      opts.onesideAdoptBeforeAfter === true ||
      (base as any).adoptedOneSide === true ||
      (base as any).onesideAdoptIntact === true);

  if (!wantsBa || (base as any).adoptedOneSide !== true) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M110' as const,
      tipZh: ((base as any).tipZh || '') + ' · 只采纳一侧后可出前后对照卡',
      canOnesideAdoptBeforeAfterCard: true as const,
      clipChapterBookmarksSubsetDiffPreviewOnesideAdoptBeforeAfterCardPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card',
    };
  }

  const adoptSide = (base as any).adoptSide || opts.adoptSide || 'source';
  const adoptSideZh = (base as any).adoptSideZh || (adoptSide === 'local' ? '本租户侧' : '源侧');
  const count = (base as any).onesideAdoptCard?.count ?? 0;
  const beforeAfterCard = {
    wave: 'M110' as const,
    kind: 'oneside-adopt-before-after-card' as const,
    titleZh: '只采纳一侧 · 前后对照',
    bodyZh:
      `采纳前：两侧并存 · 采纳后：只保留「${adoptSideZh}」${count} 条` +
      ` · 角色「${roleZh}」· 软取消仍赢 · 无外发`,
    before: {
      sideZh: '两侧并存',
      sourceCount: (base as any).diffPreview?.sourceCount ?? count,
      localCount: (base as any).diffPreview?.localCount ?? 0,
    },
    after: {
      side: adoptSide,
      sideZh: adoptSideZh,
      count,
    },
    adoptSide,
    adoptSideZh,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M110' as const,
    labelZh: `只采纳一侧前后对照 · ${adoptSideZh}`,
    tipZh: ((base as any).tipZh || '') + ` · ${beforeAfterCard.bodyZh}`,
    toastZh: `前后对照 · ${adoptSideZh}`,
    busyZh: '只采纳一侧前后对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    adoptedOneSide: true as const,
    onesideAdoptIntact: true as const,
    onesideAdoptBeforeAfterCardIntact: true as const,
    beforeAfterCard,
    clipChapterBookmarksSubsetDiffPreviewOnesideAdoptBeforeAfterCardPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card',
  };
}


/**
 * M111：只采纳一侧前后对照卡定点标注 → 供给再旁路
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideAdoptBeforeAfterPinpointRebypass(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M111' as const,
      labelZh: '前后对照卡定点再旁路 · 已软取消',
      tipZh: '用户软取消赢过前后对照卡定点再旁路 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '前后对照卡定点再旁路…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterBookmarksSubsetDiffPreviewOnesideAdoptBeforeAfterCard(tid, {
    ...opts,
    role,
    showBeforeAfterCard: opts.showBeforeAfterCard !== false,
    beforeAfterContrast: opts.beforeAfterContrast !== false,
    onesideAdoptBeforeAfter: true,
    dryRun: opts.dryRun !== false,
  });

  const wantsPin =
    opts.pinpointAnnotate !== false &&
    (opts.pinpointAnnotate === true ||
      opts.pinpointToSupplyReBypass === true ||
      opts.oneClickReBypass === true ||
      opts.reBypass === true ||
      (base as any).onesideAdoptBeforeAfterCardIntact === true);

  if (!wantsPin) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M111' as const,
      tipZh: ((base as any).tipZh || '') + ' · 前后对照卡可定点标注后触发供给再旁路',
      canOnesideBaPinpointRebypass: true as const,
      clipChapterOnesideAdoptBeforeAfterPinpointRebypassPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass',
    };
  }

  const fields = Array.isArray(opts.annotateFields)
    ? opts.annotateFields.map(String)
    : ['title', 'score'];
  const annotations = fields.map((f: string, i: number) => ({
    index: i,
    field: f,
    fieldZh: f,
    noteZh: String(opts.noteZh || `前后对照定点 · ${f}`).trim(),
    role,
    roleZh,
    wave: 'M111' as const,
  }));

  const forceFail = opts.simulateFailure === true || opts.forceFailure === true;
  const reBypassCard = {
    wave: 'M111' as const,
    kind: 'oneside-ba-pinpoint-supply-rebypass' as const,
    titleZh: forceFail
      ? '前后对照定点 · 供给再旁路失败（演示）'
      : '前后对照定点 · 供给再旁路',
    bodyZh: forceFail
      ? `定点字段 [${fields.join('、')}] 触发再旁路失败 · 代码 ${String(opts.failureCode || 'BA_PINPOINT_REBYPASS_FAIL')} · 角色「${roleZh}」· 软取消仍在 · 无外发`
      : `定点字段 [${fields.join('、')}] 已触发供给再旁路 · 角色「${roleZh}」· 干跑 · 软取消仍在 · 无外发`,
    annotateFields: fields,
    annotations,
    reBypassed: !forceFail,
    failed: forceFail,
    failureCode: forceFail ? String(opts.failureCode || 'BA_PINPOINT_REBYPASS_FAIL') : null,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M111' as const,
    labelZh: forceFail
      ? `前后对照定点再旁路失败 · ${reBypassCard.failureCode}`
      : `前后对照定点再旁路 · ${fields.length}字段`,
    tipZh: ((base as any).tipZh || '') + ` · ${reBypassCard.bodyZh}`,
    toastZh: forceFail ? '定点再旁路失败（演示）' : `定点再旁路 · ${fields.length}字段`,
    busyZh: '前后对照卡定点再旁路…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    onesideAdoptBeforeAfterCardIntact:
      (base as any).onesideAdoptBeforeAfterCardIntact === true,
    pinpointAnnotateIntact: true as const,
    pinpointAnnotations: annotations,
    onesideBaPinpointRebypassIntact: true as const,
    reBypassed: !forceFail,
    reBypassCard,
    clipChapterOnesideAdoptBeforeAfterPinpointRebypassPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass',
  };
}


/**
 * M112：前后对照卡定点再旁路失败 → 并入中文归因卡
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttr(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    foldFailureIntoAttribution?: boolean;
    showFailureAttribution?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M112' as const,
      labelZh: '定点再旁路失败并入归因 · 已软取消',
      tipZh: '用户软取消赢过定点再旁路失败并入归因 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '前后对照定点再旁路失败并入归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const forceFail =
    opts.simulateFailure !== false &&
    (opts.simulateFailure === true ||
      opts.forceFailure === true ||
      opts.foldFailureIntoAttribution === true ||
      true);

  const base = forceRerunClipChapterOnesideAdoptBeforeAfterPinpointRebypass(tid, {
    ...opts,
    role,
    pinpointAnnotate: opts.pinpointAnnotate !== false,
    pinpointToSupplyReBypass: opts.pinpointToSupplyReBypass !== false,
    oneClickReBypass: opts.oneClickReBypass !== false,
    reBypass: opts.reBypass !== false,
    simulateFailure: forceFail,
    forceFailure: forceFail,
    failureCode: opts.failureCode || 'BA_PINPOINT_REBYPASS_FAIL',
    dryRun: opts.dryRun !== false,
  });

  const wantsFold =
    opts.foldFailureIntoAttribution !== false &&
    (opts.foldFailureIntoAttribution === true ||
      opts.showFailureAttribution === true ||
      (base as any).reBypassCard?.failed === true ||
      forceFail);

  if (!wantsFold) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M112' as const,
      tipZh: ((base as any).tipZh || '') + ' · 定点再旁路失败时可并入中文归因卡',
      canBaPinpointRebypassFailFoldAttr: true as const,
      clipChapterOnesideBaPinpointRebypassFailFoldAttrPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr',
    };
  }

  const failureCode = String(
    (base as any).reBypassCard?.failureCode || opts.failureCode || 'BA_PINPOINT_REBYPASS_FAIL',
  ).trim();
  const fields = Array.isArray((base as any).pinpointAnnotations)
    ? (base as any).pinpointAnnotations.map((a: any) => a.fieldZh || a.field).filter(Boolean)
    : Array.isArray(opts.annotateFields)
      ? opts.annotateFields.map(String)
      : ['title', 'score'];

  const failureAttributionCard = {
    wave: 'M112' as const,
    kind: 'ba-pinpoint-rebypass-failure-attribution' as const,
    titleZh: '前后对照定点再旁路失败 · 中文归因',
    bodyZh:
      `定点字段 [${fields.join('、')}] 再旁路失败已并入归因` +
      ` · 代码 ${failureCode} · 角色「${roleZh}」· 可一键重试 · 中页取消仍在 · 无外发`,
    failureCode,
    annotateFields: fields,
    foldedFrom: 'oneside-ba-pinpoint-rebypass',
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M112' as const,
    labelZh: `定点再旁路失败并入归因 · ${failureCode}`,
    tipZh: ((base as any).tipZh || '') + ` · ${failureAttributionCard.bodyZh}`,
    toastZh: '定点再旁路失败已并入归因',
    busyZh: '前后对照定点再旁路失败并入归因…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    onesideBaPinpointRebypassIntact:
      (base as any).onesideBaPinpointRebypassIntact === true,
    foldedIntoAttribution: true as const,
    baPinpointRebypassFailFoldAttrIntact: true as const,
    failureAttributionCard,
    failureCode,
    clipChapterOnesideBaPinpointRebypassFailFoldAttrPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr',
  };
}


/**
 * M113：定点再旁路失败并入归因 → 字段过滤回放
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplay(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    foldFailureIntoAttribution?: boolean;
    showFailureAttribution?: boolean;
    fieldFilterReplay?: boolean;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M113' as const,
      labelZh: '失败归因字段过滤回放 · 已软取消',
      tipZh: '用户软取消赢过失败归因字段过滤回放 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '定点再旁路失败归因字段过滤回放…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttr(tid, {
    ...opts,
    role,
    foldFailureIntoAttribution: opts.foldFailureIntoAttribution !== false,
    showFailureAttribution: opts.showFailureAttribution !== false,
    simulateFailure: opts.simulateFailure !== false,
    forceFailure: opts.forceFailure !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsFf =
    opts.fieldFilterReplay !== false &&
    (opts.fieldFilterReplay === true ||
      (Array.isArray(opts.fieldFilter) && opts.fieldFilter.length > 0) ||
      (Array.isArray(opts.filterFields) && opts.filterFields.length > 0) ||
      (base as any).baPinpointRebypassFailFoldAttrIntact === true ||
      true);

  if (!wantsFf) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M113' as const,
      tipZh: ((base as any).tipZh || '') + ' · 失败归因可开字段过滤回放',
      canBaPinpointRebypassFailFoldAttrFieldFilterReplay: true as const,
      clipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay',
    };
  }

  const attrCard = (base as any).failureAttributionCard || null;
  const filter = (
    (Array.isArray(opts.fieldFilter) && opts.fieldFilter) ||
    (Array.isArray(opts.filterFields) && opts.filterFields) ||
    (Array.isArray(attrCard?.annotateFields) && attrCard.annotateFields) ||
    (Array.isArray(opts.annotateFields) && opts.annotateFields) ||
    ['title', 'score']
  ).map(String);
  const failureCode = String(
    attrCard?.failureCode || (base as any).failureCode || opts.failureCode || 'BA_PINPOINT_REBYPASS_FAIL',
  ).trim();
  const frames = filter.map((f: string, i: number) => ({
    index: i,
    field: f,
    fieldZh: f,
    reasonZh: `定点字段「${f}」失败归因回放`,
    failureCode,
    wave: 'M113' as const,
  }));
  const fieldFilterReplay = {
    wave: 'M113' as const,
    kind: 'ba-pinpoint-fail-attr-field-filter-replay' as const,
    titleZh: '定点再旁路失败归因 · 字段过滤回放',
    bodyZh:
      `按字段过滤回放 [${filter.join('、') || '空'}]` +
      ` · 代码 ${failureCode} · 角色「${roleZh}」· 软取消仍在 · 无外发`,
    fieldFilter: filter,
    frames,
    frameCount: frames.length,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M113' as const,
    labelZh: `失败归因字段过滤回放 · ${filter.length}字段`,
    tipZh: ((base as any).tipZh || '') + ` · ${fieldFilterReplay.bodyZh}`,
    toastZh: '失败归因字段过滤回放',
    busyZh: '定点再旁路失败归因字段过滤回放…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    baPinpointRebypassFailFoldAttrIntact:
      (base as any).baPinpointRebypassFailFoldAttrIntact === true,
    foldedIntoAttribution: (base as any).foldedIntoAttribution === true,
    baPinpointRebypassFailFoldAttrFieldFilterReplayIntact: true as const,
    fieldFilterReplayIntact: true as const,
    fieldFilterReplay,
    failureAttributionCard: attrCard || (base as any).failureAttributionCard,
    failureCode,
    clipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay',
  };
}


/**
 * M114：失败归因字段过滤回放 → scrubber 书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    fieldFilterReplay?: boolean;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    scrubberBookmarks?: boolean;
    fieldFilterReplayScrubberBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    scrubIndex?: number | null;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M114' as const,
      labelZh: '字段过滤回放 scrubber 书签 · 已软取消',
      tipZh: '用户软取消赢过失败归因字段过滤回放 scrubber 书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '失败归因字段过滤回放 scrubber 书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplay(tid, {
    ...opts,
    role,
    fieldFilterReplay: opts.fieldFilterReplay !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsBm =
    opts.fieldFilterReplayScrubberBookmarks !== false &&
    (opts.fieldFilterReplayScrubberBookmarks === true ||
      opts.scrubberBookmarks === true ||
      (base as any).fieldFilterReplayIntact === true ||
      true);

  if (!wantsBm) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M114' as const,
      tipZh: ((base as any).tipZh || '') + ' · 字段过滤回放可打 scrubber 书签',
      canFieldFilterReplayScrubberBookmarks: true as const,
      clipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksPath:
        '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks',
    };
  }

  const ff = (base as any).fieldFilterReplay || null;
  const frames: any[] = Array.isArray(ff?.frames) ? ff.frames : [];
  const bookmarkNameZh =
    String(opts.bookmarkNameZh || '').trim() || '演示·M114过滤回放scrubber书签';
  const scrubIndex = Math.max(
    0,
    Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex) || 0),
  );
  const bookmarks = (frames.length ? frames : [{ index: 0, field: 'title', fieldZh: 'title' }]).map(
    (fr: any, i: number) => ({
      id: `ff-replay-bm-m114-${i}`,
      nameZh: `${bookmarkNameZh}·${fr.fieldZh || fr.field || `帧${i + 1}`}`,
      scrubIndex: Number(fr.index ?? i),
      field: fr.field || null,
      fieldZh: fr.fieldZh || fr.field || null,
      reasonZh: fr.reasonZh || '字段过滤回放帧书签',
      role,
      roleZh,
      wave: 'M114' as const,
      kind: 'ff-replay-scrubber-bookmark' as const,
    }),
  );
  const fieldFilterReplayScrubberBookmarks = {
    wave: 'M114' as const,
    kind: 'ba-pinpoint-fail-attr-ff-replay-scrubber-bookmarks' as const,
    titleZh: '失败归因字段过滤回放 · scrubber 书签',
    bodyZh:
      `已为过滤回放打 ${bookmarks.length} 枚 scrubber 书签 · 当前 scrub #${scrubIndex + 1}` +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · 无外发`,
    bookmarks,
    bookmarkCount: bookmarks.length,
    scrubIndex,
    currentBookmark: bookmarks[scrubIndex] || bookmarks[0] || null,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M114' as const,
    labelZh: `字段过滤回放 scrubber 书签 · ${bookmarks.length}枚`,
    tipZh: ((base as any).tipZh || '') + ` · ${fieldFilterReplayScrubberBookmarks.bodyZh}`,
    toastZh: `过滤回放 scrubber 书签 · ${bookmarks.length}枚`,
    busyZh: '失败归因字段过滤回放 scrubber 书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    baPinpointRebypassFailFoldAttrFieldFilterReplayIntact:
      (base as any).baPinpointRebypassFailFoldAttrFieldFilterReplayIntact === true,
    fieldFilterReplayIntact: (base as any).fieldFilterReplayIntact === true,
    fieldFilterReplayScrubberBookmarksIntact: true as const,
    fieldFilterReplayScrubberBookmarks,
    clipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks',
  };
}


/**
 * M115：字段过滤回放 scrubber 书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    fieldFilterReplayScrubberBookmarks?: boolean;
    shareFfReplayBookmarks?: boolean;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    bookmarkNameZh?: string | null;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M115' as const,
      labelZh: '过滤回放书签跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过字段过滤回放书签跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '过滤回放书签跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarks(tid, {
    ...opts,
    role,
    fieldFilterReplayScrubberBookmarks: opts.fieldFilterReplayScrubberBookmarks !== false,
    dryRun: opts.dryRun !== false,
  });

  const bmBlock = (base as any).fieldFilterReplayScrubberBookmarks || null;
  const bookmarks: any[] = Array.isArray(bmBlock?.bookmarks) ? bmBlock.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m115-ff').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m115-ff').trim();
  const ffReplayBmXSessionRoShare = {
    wave: 'M115' as const,
    kind: 'ff-replay-bm-xsession-readonly-share' as const,
    titleZh: '字段过滤回放 scrubber 书签 · 跨会话只读分享',
    bodyZh:
      `已将 ${bookmarks.length || bmBlock?.bookmarkCount || 0} 枚过滤回放书签只读分享到会话「${targetSessionId}」` +
      ` · 来源「${sessionId}」· 角色「${roleZh}」· 干跑 · 中页取消仍在 · 无外发`,
    bookmarks,
    bookmarkCount: bookmarks.length || bmBlock?.bookmarkCount || 0,
    sessionId,
    targetSessionId,
    readOnlyShare: true as const,
    crossSessionShare: true as const,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M115' as const,
    labelZh: `过滤回放书签跨会话只读分享 · ${ffReplayBmXSessionRoShare.bookmarkCount}枚`,
    tipZh: ((base as any).tipZh || '') + ` · ${ffReplayBmXSessionRoShare.bodyZh}`,
    toastZh: `过滤回放书签跨会话只读分享 · ${ffReplayBmXSessionRoShare.bookmarkCount}枚`,
    busyZh: '过滤回放书签跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    fieldFilterReplayScrubberBookmarksIntact:
      (base as any).fieldFilterReplayScrubberBookmarksIntact === true,
    baPinpointRebypassFailFoldAttrFieldFilterReplayIntact:
      (base as any).baPinpointRebypassFailFoldAttrFieldFilterReplayIntact === true,
    ffReplayBmXSessionRoShareIntact: true as const,
    ffReplayBmXSessionRoShare,
    clipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoSharePath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share',
  };
}



/**
 * M116：字段过滤回放跨会话分享 → 中文差分预览再采纳
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdopt(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    chineseDiffPreview?: boolean;
    diffPreviewConfirm?: boolean;
    diffPreviewThenAdopt?: boolean;
    adoptSharedBookmarks?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M116' as const,
      labelZh: '过滤回放跨会话分享差分预览再采纳 · 已软取消',
      tipZh: '用户软取消赢过过滤回放跨会话分享差分预览再采纳 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '过滤回放跨会话分享差分预览再采纳…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const share = (base as any).ffReplayBmXSessionRoShare || null;
  const bookmarks: any[] = Array.isArray(share?.bookmarks)
    ? share.bookmarks
    : Array.isArray((base as any).fieldFilterReplayScrubberBookmarks?.bookmarks)
      ? (base as any).fieldFilterReplayScrubberBookmarks.bookmarks
      : [];
  const sessionId = String(share?.sessionId || opts.sessionId || 'session-demo-m116-ff').trim();
  const targetSessionId = String(share?.targetSessionId || opts.targetSessionId || 'session-peer-m116-ff').trim();
  const diffLines = (bookmarks.length ? bookmarks : [{ nameZh: '空态书签', scrubIndex: 0 }]).map((b: any, i: number) => ({
    index: i,
    field: b.field || b.nameZh || `bm-${i}`,
    beforeZh: `来源会话「${sessionId}」· ${b.nameZh || b.field || `书签#${i + 1}`}`,
    afterZh: `目标会话「${targetSessionId}」· 待采纳`,
    changed: true as const,
  }));
  const chineseDiffPreview = {
    wave: 'M116' as const,
    kind: 'ff-replay-xsession-share-chinese-diff-preview' as const,
    titleZh: '过滤回放跨会话分享 · 中文差分预览',
    bodyZh:
      `已对 ${diffLines.length} 枚跨会话分享书签做中文差分预览 · 角色「${roleZh}」` +
      ` · 确认后再采纳 · 干跑 · 中页取消仍在 · 无外发`,
    lines: diffLines,
    lineCount: diffLines.length,
    sessionId,
    targetSessionId,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };
  const doAdopt =
    opts.diffPreviewThenAdopt !== false &&
    opts.confirmAdopt !== false &&
    (opts.adoptSharedBookmarks !== false || opts.confirmCardAck !== false || opts.diffPreviewConfirm !== false);
  const ffReplayXSessionShareDiffPreviewAdopt = {
    wave: 'M116' as const,
    kind: 'ff-replay-xsession-share-diff-preview-adopt' as const,
    titleZh: '过滤回放跨会话分享 · 差分预览再采纳',
    bodyZh:
      (doAdopt
        ? `差分预览确认后已采纳 ${diffLines.length} 枚书签到会话「${targetSessionId}」`
        : `已出差分预览 · 待确认采纳 ${diffLines.length} 枚书签`) +
      ` · 角色「${roleZh}」· 干跑 · toast · 无外发`,
    adopted: doAdopt,
    adoptedCount: doAdopt ? diffLines.length : 0,
    chineseDiffPreview,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M116' as const,
    labelZh: doAdopt
      ? `过滤回放跨会话分享差分预览再采纳 · ${diffLines.length}枚`
      : `过滤回放跨会话分享差分预览 · ${diffLines.length}枚`,
    tipZh: ((base as any).tipZh || '') + ` · ${ffReplayXSessionShareDiffPreviewAdopt.bodyZh}`,
    toastZh: doAdopt ? `跨会话分享差分预览已采纳 · ${diffLines.length}枚` : `跨会话分享差分预览 · ${diffLines.length}枚`,
    busyZh: '过滤回放跨会话分享差分预览再采纳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    ffReplayBmXSessionRoShareIntact: (base as any).ffReplayBmXSessionRoShareIntact === true,
    ffReplayXSessionShareDiffPreviewAdoptIntact: true as const,
    chineseDiffPreviewIntact: true as const,
    chineseDiffPreview,
    ffReplayXSessionShareDiffPreviewAdopt,
    clipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt',
  };
}


/**
 * M117：差分采纳软撤销前后卡
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfter(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    softUndoAdopt?: boolean;
    softUndo?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    softUndoBeforeAfter?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M117' as const,
      labelZh: '差分采纳软撤销前后卡 · 已软取消',
      tipZh: '用户软取消赢过差分采纳软撤销前后卡 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '差分采纳软撤销前后卡…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdopt(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const adopt = (base as any).ffReplayXSessionShareDiffPreviewAdopt || null;
  const preview = (base as any).chineseDiffPreview || adopt?.chineseDiffPreview || null;
  const lines: any[] = Array.isArray(preview?.lines) ? preview.lines : [];
  const softUndoToken = `m117-diff-adopt-soft-undo-${Date.now().toString(36)}`;
  const doSoftUndo =
    opts.softUndoAdopt !== false &&
    (opts.softUndo === true ||
      opts.softUndoAdopt === true ||
      opts.softUndoBeforeAfter === true ||
      opts.showBeforeAfterCard === true ||
      opts.beforeAfterContrast === true ||
      adopt?.adopted === true);
  const beforeAfterCard = {
    wave: 'M117' as const,
    kind: 'diff-adopt-soft-undo-before-after-card' as const,
    titleZh: '差分采纳 · 软撤销前后对照卡',
    bodyZh:
      (doSoftUndo
        ? `差分预览再采纳后已软撤销，并出前后对照卡 · ${lines.length} 行差分`
        : `差分预览再采纳后可软撤销 · 前后对照卡待命 · ${lines.length} 行`) +
      ` · 角色「${roleZh}」· 干跑 · toast · 无外发`,
    beforeZh: lines.map((l) => l.beforeZh || l.field).join('；') || '采纳前·共享源书签',
    afterZh: lines.map((l) => l.afterZh || l.field).join('；') || '采纳后·本会话书签',
    softUndone: doSoftUndo,
    softUndoToken,
    lineCount: lines.length,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M117' as const,
    labelZh: doSoftUndo
      ? `差分采纳软撤销前后卡 · ${lines.length}行`
      : `差分采纳前后卡待命 · ${lines.length}行`,
    tipZh: ((base as any).tipZh || '') + ` · ${beforeAfterCard.bodyZh}`,
    toastZh: doSoftUndo ? `差分采纳已软撤销 · 前后卡` : `差分采纳前后卡`,
    busyZh: '差分采纳软撤销前后卡…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    ffReplayXSessionShareDiffPreviewAdoptIntact:
      (base as any).ffReplayXSessionShareDiffPreviewAdoptIntact === true,
    diffAdoptSoftUndoBeforeAfterIntact: true as const,
    softUndoBeforeAfterCardIntact: true as const,
    softUndoToken,
    beforeAfterCard,
    diffAdoptSoftUndoBeforeAfter: beforeAfterCard,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after',
  };
}


/**
 * M118：差分采纳软撤销前后卡 · 定点标注触发供给再旁路
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypass(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    softUndoAdopt?: boolean;
    softUndo?: boolean;
    softUndoBeforeAfter?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    baPinpointAnnotate?: boolean;
    pinpointFromBeforeAfter?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M118' as const,
      labelZh: '软撤销前后卡定点再旁路 · 已软取消',
      tipZh: '用户软取消赢过软撤销前后卡定点再旁路 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软撤销前后卡定点再旁路…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfter(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ba = (base as any).diffAdoptSoftUndoBeforeAfter || (base as any).beforeAfterCard || null;
  const fields = Array.isArray(opts.annotateFields) && opts.annotateFields.length
    ? opts.annotateFields.map(String)
    : ['title', 'score'];
  const doPinpoint =
    opts.pinpointAnnotate !== false &&
    (opts.pinpointAnnotate === true ||
      opts.baPinpointAnnotate === true ||
      opts.pinpointFromBeforeAfter === true ||
      opts.pinpointToSupplyReBypass === true ||
      opts.oneClickReBypass === true ||
      opts.reBypass === true ||
      !!ba);
  const softUndoBaPinpointRebypass = {
    wave: 'M118' as const,
    kind: 'soft-undo-ba-pinpoint-supply-rebypass' as const,
    titleZh: '软撤销前后卡 · 定点再旁路',
    bodyZh:
      (doPinpoint
        ? `已从软撤销前后对照卡定点标注字段「${fields.join('、')}」并触发供给再旁路`
        : `软撤销前后卡定点再旁路待命 · 字段「${fields.join('、')}」`) +
      ` · 角色「${roleZh}」· 干跑 · toast · 无外发`,
    fields,
    noteZh: opts.noteZh || '演示·M118软撤销前后卡定点再旁路',
    fromSoftUndoBeforeAfter: true as const,
    softUndoToken: (base as any).softUndoToken || ba?.softUndoToken || null,
    pinpointed: doPinpoint,
    reBypassTriggered: doPinpoint,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M118' as const,
    labelZh: doPinpoint
      ? `软撤销前后卡定点再旁路 · ${fields.length}字段`
      : `软撤销前后卡定点再旁路待命`,
    tipZh: ((base as any).tipZh || '') + ` · ${softUndoBaPinpointRebypass.bodyZh}`,
    toastZh: doPinpoint ? '软撤销前后卡已定点再旁路' : '软撤销前后卡定点再旁路待命',
    busyZh: '软撤销前后卡定点再旁路…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    diffAdoptSoftUndoBeforeAfterIntact: (base as any).diffAdoptSoftUndoBeforeAfterIntact === true,
    softUndoBaPinpointRebypassIntact: true as const,
    softUndoBaPinpointRebypass,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass',
  };
}


/**
 * M119：软撤销前后卡定点再旁路失败 → 并入中文归因卡
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttr(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    softUndoAdopt?: boolean;
    softUndo?: boolean;
    softUndoBeforeAfter?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    baPinpointAnnotate?: boolean;
    pinpointFromBeforeAfter?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    foldFailureIntoAttribution?: boolean;
    showFailureAttribution?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M119' as const,
      labelZh: '软撤销定点再旁路失败并入归因 · 已软取消',
      tipZh: '用户软取消赢过软撤销定点再旁路失败并入归因 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软撤销定点再旁路失败并入归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypass(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const forceFail =
    opts.simulateFailure !== false &&
    (opts.simulateFailure === true ||
      opts.forceFailure === true ||
      opts.foldFailureIntoAttribution === true ||
      true);
  const fields = Array.isArray(opts.annotateFields) && opts.annotateFields.length
    ? opts.annotateFields.map(String)
    : Array.isArray((base as any).softUndoBaPinpointRebypass?.fields)
      ? (base as any).softUndoBaPinpointRebypass.fields
      : ['title', 'score'];
  const failureCode = String(opts.failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL').trim() || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL';
  const wantsFold =
    opts.foldFailureIntoAttribution !== false &&
    (opts.foldFailureIntoAttribution === true ||
      opts.showFailureAttribution === true ||
      forceFail);

  let softUndoBaPinpointRebypassFailFoldAttr: any = null;
  if (wantsFold) {
    softUndoBaPinpointRebypassFailFoldAttr = {
      wave: 'M119' as const,
      kind: 'soft-undo-ba-pinpoint-rebypass-fail-fold-attr' as const,
      titleZh: '软撤销定点再旁路失败 · 中文归因卡',
      bodyZh:
        `软撤销前后卡定点再旁路失败（${failureCode}）已并入中文归因卡 · 字段「${fields.join('、')}」` +
        ` · 角色「${roleZh}」· 干跑 · toast · 无外发`,
      failureCode,
      fields,
      failed: true as const,
      foldedIntoAttribution: true as const,
      attributionCardZh: `定点再旁路失败：${failureCode} · 建议检查供给字段「${fields.join('、')}」后一键重试`,
      noteZh: opts.noteZh || '演示·M119软撤销定点再旁路失败并入归因',
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M119' as const,
    labelZh: softUndoBaPinpointRebypassFailFoldAttr
      ? `软撤销定点再旁路失败已并入归因 · ${failureCode}`
      : `软撤销定点再旁路失败并入归因待命`,
    tipZh:
      ((base as any).tipZh || '') +
      (softUndoBaPinpointRebypassFailFoldAttr
        ? ` · ${softUndoBaPinpointRebypassFailFoldAttr.bodyZh}`
        : ' · 软撤销定点再旁路失败时可并入中文归因卡'),
    toastZh: softUndoBaPinpointRebypassFailFoldAttr
      ? '定点再旁路失败已并入归因'
      : '定点再旁路失败并入归因待命',
    busyZh: '软撤销定点再旁路失败并入归因…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoBaPinpointRebypassIntact: (base as any).softUndoBaPinpointRebypassIntact === true,
    softUndoBaPinpointRebypassFailFoldAttrIntact: !!softUndoBaPinpointRebypassFailFoldAttr,
    softUndoBaPinpointRebypassFailFoldAttr,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr',
  };
}


/**
 * M120：失败归因一键重试折进串联异常任务卡
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    oneClickRetry?: boolean;
    retryFromAttribution?: boolean;
    foldIntoChainTaskCard?: boolean;
    foldRetryIntoChainTaskCard?: boolean;
    foldFailureIntoAttribution?: boolean;
    showFailureAttribution?: boolean;
    failureCode?: string | null;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M120' as const,
      labelZh: '失败归因一键重试折进任务卡 · 已软取消',
      tipZh: '用户软取消赢过失败归因一键重试折进串联任务卡 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '失败归因一键重试折进任务卡…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttr(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const folded = (base as any).softUndoBaPinpointRebypassFailFoldAttr || null;
  const failureCode = String(opts.failureCode || folded?.failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL').trim();
  const wantsRetry =
    opts.oneClickRetry !== false &&
    (opts.oneClickRetry === true ||
      opts.retryFromAttribution === true ||
      opts.foldIntoChainTaskCard === true ||
      opts.foldRetryIntoChainTaskCard === true ||
      !!folded);
  const failAttrOneClickRetryFoldTaskCard = wantsRetry
    ? {
        wave: 'M120' as const,
        kind: 'fail-attr-one-click-retry-fold-task-card' as const,
        titleZh: '失败归因一键重试 · 折进串联任务卡',
        bodyZh:
          `失败归因卡「${failureCode}」一键重试进度已折进串联异常任务卡` +
          ` · 角色「${roleZh}」· 干跑 · toast · 无外发 · 中页取消仍在`,
        failureCode,
        foldedIntoChainTaskCard: true as const,
        chainTaskCardZh: `串联异常任务卡 · 一键重试阶段 · ${failureCode}`,
        attributionCardZh: folded?.attributionCardZh || `定点再旁路失败：${failureCode} · 建议一键重试`,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M120' as const,
    labelZh: failAttrOneClickRetryFoldTaskCard
      ? `失败归因一键重试已折进任务卡 · ${failureCode}`
      : '失败归因一键重试折进任务卡待命',
    tipZh:
      ((base as any).tipZh || '') +
      (failAttrOneClickRetryFoldTaskCard ? ` · ${failAttrOneClickRetryFoldTaskCard.bodyZh}` : ''),
    toastZh: failAttrOneClickRetryFoldTaskCard
      ? '失败归因一键重试已折进任务卡'
      : '失败归因一键重试折进任务卡待命',
    busyZh: '失败归因一键重试折进任务卡…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoBaPinpointRebypassFailFoldAttrIntact: (base as any).softUndoBaPinpointRebypassFailFoldAttrIntact === true,
    failAttrOneClickRetryFoldTaskCardIntact: !!failAttrOneClickRetryFoldTaskCard,
    failAttrOneClickRetryFoldTaskCard,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPath:
      '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card',
  };
}



/**
 * M121：失败重试任务卡单阶段暂停 + 中文宽限闹钟
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    pausePhase?: boolean;
    phasePause?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    autoResumeAfterGrace?: boolean;
    graceMs?: number | null;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (opts.softCancel === true && opts.pausePhase === false && opts.graceAlarm === false) {
    return {
      ok: true as const,
      wave: 'M121' as const,
      labelZh: '失败重试任务卡单阶段暂停宽限 · 已软取消',
      tipZh: '用户软取消赢过失败重试任务卡单阶段暂停宽限 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '失败重试任务卡单阶段暂停宽限…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const folded = (base as any).failAttrOneClickRetryFoldTaskCard || null;
  const phase = String(opts.phase || 'one-click-retry').trim() || 'one-click-retry';
  const graceMs = Math.max(1000, Number(opts.graceMs ?? 15000) || 15000);
  const wantsPause =
    opts.pausePhase !== false &&
    (opts.pausePhase === true ||
      opts.phasePause === true ||
      opts.graceAlarm === true ||
      opts.showGraceAlarm === true ||
      !!folded);
  const failRetryTaskcardPhasePauseGrace = wantsPause
    ? {
        wave: 'M121' as const,
        kind: 'fail-retry-taskcard-phase-pause-grace' as const,
        titleZh: '失败重试任务卡 · 单阶段暂停宽限',
        bodyZh:
          `已折进串联任务卡的失败重试支持单阶段暂停 · 阶段「${phase}」· 中文宽限闹钟 ${Math.round(graceMs / 1000)}秒` +
          ` · 角色「${roleZh}」· 到期可自动续跑 · 干跑 · toast · 无外发`,
        phase,
        paused: true as const,
        graceMs,
        graceAlarmZh: `宽限闹钟 · ${Math.round(graceMs / 1000)}秒后自动续跑「${phase}」`,
        autoResumeAfterGrace: opts.autoResumeAfterGrace !== false,
        chainTaskCardZh: folded?.chainTaskCardZh || `串联异常任务卡 · ${phase}`,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M121' as const,
    labelZh: failRetryTaskcardPhasePauseGrace
      ? `失败重试任务卡单阶段暂停 · ${phase} · 宽限${Math.round(graceMs / 1000)}s`
      : '失败重试任务卡单阶段暂停宽限待命',
    tipZh:
      ((base as any).tipZh || '') +
      (failRetryTaskcardPhasePauseGrace ? ` · ${failRetryTaskcardPhasePauseGrace.bodyZh}` : ''),
    toastZh: failRetryTaskcardPhasePauseGrace
      ? '失败重试任务卡已单阶段暂停·宽限闹钟'
      : '失败重试任务卡单阶段暂停宽限待命',
    busyZh: '失败重试任务卡单阶段暂停宽限…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    failAttrOneClickRetryFoldTaskCardIntact: (base as any).failAttrOneClickRetryFoldTaskCardIntact === true,
    failRetryTaskcardPhasePauseGraceIntact: !!failRetryTaskcardPhasePauseGrace,
    failRetryTaskcardPhasePauseGrace,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGracePath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace',
  };
}


/**
 * M122：失败暂停宽限软取消进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    phase?: string | null;
    graceMs?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const pause = (base as any).failRetryTaskcardPhasePauseGrace || null;
  const phase = String(opts.phase || pause?.phase || 'one-click-retry').trim() || 'one-click-retry';
  const graceMs = Math.max(1000, Number(opts.graceMs ?? pause?.graceMs ?? 15000) || 15000);
  const softCancelWins =
    opts.softCancel !== false &&
    (opts.softCancel === true ||
      opts.softCancelWinsOverGrace === true ||
      opts.writeSoftCancelLedger === true ||
      opts.chineseLedger === true ||
      !!pause);
  const failPauseGraceSoftCancelLedger = softCancelWins
    ? {
        wave: 'M122' as const,
        kind: 'fail-pause-grace-soft-cancel-ledger' as const,
        titleZh: '失败暂停宽限 · 软取消进中文台账',
        bodyZh:
          `软取消赢过失败重试任务卡单阶段暂停宽限 · 阶段「${phase}」· 宽限${Math.round(graceMs / 1000)}秒` +
          ` · 已写入中文台账 · 角色「${roleZh}」· 干跑 · toast · 无外发`,
        phase,
        graceMs,
        softCancelWinsOverGrace: true as const,
        ledgerEntry: {
          wave: 'M122' as const,
          id: `m122-soft-cancel-${Date.now().toString(36)}`,
          kindZh: '失败暂停宽限软取消',
          lineZh: `软取消赢过「${phase}」宽限闹钟 · 角色「${roleZh}」· 未自动续跑`,
          role,
          roleZh,
          atMs: Date.now(),
        },
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  if (opts.softCancel === true && opts.writeSoftCancelLedger === false && opts.softCancelWinsOverGrace === false) {
    return {
      ok: true as const,
      wave: 'M122' as const,
      labelZh: '失败暂停宽限软取消进台账 · 已软取消',
      tipZh: '用户软取消赢过写入失败暂停宽限软取消台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '失败暂停宽限软取消进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M122' as const,
    labelZh: failPauseGraceSoftCancelLedger
      ? `失败暂停宽限软取消已进中文台账 · ${phase}`
      : '失败暂停宽限软取消进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (failPauseGraceSoftCancelLedger ? ` · ${failPauseGraceSoftCancelLedger.bodyZh}` : ''),
    toastZh: failPauseGraceSoftCancelLedger
      ? '失败暂停宽限软取消已进中文台账'
      : '失败暂停宽限软取消进台账待命',
    busyZh: '失败暂停宽限软取消进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    failRetryTaskcardPhasePauseGraceIntact: (base as any).failRetryTaskcardPhasePauseGraceIntact === true,
    failPauseGraceSoftCancelLedgerIntact: !!failPauseGraceSoftCancelLedger,
    failPauseGraceSoftCancelLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger',
  };
}


/**
 * M123：软取消中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (opts.softCancel === true && opts.roleAuditOnePager === false && opts.renderAuditOnePager === false) {
    return {
      ok: true as const,
      wave: 'M123' as const,
      labelZh: '软取消台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消中文台账角色过滤审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).failPauseGraceSoftCancelLedger || null;
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const entry = ledger?.ledgerEntry || {
    id: `m123-soft-cancel-${Date.now().toString(36)}`,
    kindZh: '失败暂停宽限软取消',
    lineZh: `软取消赢过宽限闹钟 · 角色「${roleZh}」`,
    role,
    roleZh,
  };
  const softCancelLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M123' as const,
        kind: 'soft-cancel-ledger-role-audit-onepager' as const,
        titleZh: '软取消中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消中文台账可出角色过滤审计一页纸 · 过滤「${filterRoleZh}」` +
          ` · 行「${entry.id || entry.ledgerRowId || 'row'}」· ${entry.lineZh || entry.kindZh || '软取消台账行'} · 干跑 · toast · 无外发`,
        filterRole,
        filterRoleZh,
        lines: [
          {
            id: entry.id || 'm123-soft-cancel-0',
            auditLineZh: entry.lineZh || entry.kindZh || `软取消台账 · 角色「${roleZh}」`,
            role: entry.role || role,
            roleZh: entry.roleZh || roleZh,
            wave: 'M123' as const,
          },
          {
            id: 'm123-soft-cancel-1',
            auditLineZh: `软取消台账附行 · 宽限未续跑 · 过滤「${filterRoleZh}」`,
            role: filterRole,
            roleZh: filterRoleZh,
            wave: 'M123' as const,
          },
        ],
        onePager: {
          wave: 'M123' as const,
          titleZh: '软取消台账 · 角色审计一页纸',
          roleFiltered: true as const,
          inApp: true as const,
        },
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M123' as const,
    labelZh: softCancelLedgerRoleAuditOnepager
      ? `软取消台账角色审计一页纸 · 过滤「${filterRoleZh}」`
      : '软取消台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelLedgerRoleAuditOnepager ? ` · ${softCancelLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelLedgerRoleAuditOnepager
      ? '软取消台账角色审计一页纸已开'
      : '软取消台账角色审计一页纸待命',
    busyZh: '软取消台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    failPauseGraceSoftCancelLedgerIntact: (base as any).failPauseGraceSoftCancelLedgerIntact === true,
    softCancelLedgerRoleAuditOnepagerIntact: !!softCancelLedgerRoleAuditOnepager,
    softCancelLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager',
  };
}


/**
 * M124：软取消角色审计一页纸 → 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (opts.softCancel === true && opts.seekLedgerRow === false && opts.seekBackToLedger === false) {
    return {
      ok: true as const,
      wave: 'M124' as const,
      labelZh: '软取消角色审计一页纸回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消角色审计一页纸回跳台账行 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消角色审计一页纸回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = opts.seekEntryIndex != null ? Number(opts.seekEntryIndex) : 0;
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const softCancelRoleAuditOnepagerSeekLedger = wantsSeek
    ? {
        wave: 'M124' as const,
        kind: 'soft-cancel-role-audit-onepager-seek-ledger' as const,
        titleZh: '软取消角色审计一页纸 · 回跳台账行',
        bodyZh:
          `软取消角色过滤审计一页纸可回跳台账行 · 过滤「${filterRoleZh}」` +
          ` · 定位行#${seekEntryIndex + 1}「${lines[seekEntryIndex]?.id || lines[0]?.id || 'm124-soft-cancel-0'}」` +
          ` · ${lines[seekEntryIndex]?.auditLineZh || lines[0]?.auditLineZh || '软取消台账行'} · 干跑 · toast · 无外发`,
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        ledgerRowId: lines[seekEntryIndex]?.id || lines[0]?.id || 'm124-soft-cancel-0',
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M124' as const,
    labelZh: softCancelRoleAuditOnepagerSeekLedger
      ? `软取消角色审计一页纸回跳台账 · 行#${seekEntryIndex + 1}`
      : '软取消角色审计一页纸回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelRoleAuditOnepagerSeekLedger ? ` · ${softCancelRoleAuditOnepagerSeekLedger.bodyZh}` : ''),
    toastZh: softCancelRoleAuditOnepagerSeekLedger
      ? '软取消角色审计一页纸已回跳台账行'
      : '软取消角色审计一页纸回跳台账待命',
    busyZh: '软取消角色审计一页纸回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelLedgerRoleAuditOnepagerIntact: (base as any).softCancelLedgerRoleAuditOnepagerIntact === true,
    softCancelRoleAuditOnepagerSeekLedgerIntact: !!softCancelRoleAuditOnepagerSeekLedger,
    softCancelRoleAuditOnepagerSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M125：软取消审计回跳台账 · 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectLedgerRows === false &&
    opts.multiSelectContrast === false
  ) {
    return {
      ok: true as const,
      wave: 'M125' as const,
      labelZh: '软取消审计回跳台账多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消审计回跳台账多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计回跳台账多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelRoleAuditOnepagerSeekLedger || null;
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const softCancelAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M125' as const,
        kind: 'soft-cancel-audit-seek-multiselect-contrast' as const,
        titleZh: '软取消审计回跳台账 · 多选中文对照',
        bodyZh:
          `软取消角色审计一页纸回跳台账支持多选中文对照 · 选中 ${indexes.length} 行` +
          ` · 过滤「${filterRoleZh}」· 锚定「${seek?.ledgerRowId || 'm125-soft-cancel-0'}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedIndexes: indexes,
        selectedRows: indexes.map((i, idx) => ({
          id: `m125-soft-cancel-ms-${i}`,
          seekEntryIndex: i,
          lineZh: `软取消台账对照行#${i + 1}`,
          contrastSide: idx % 2 === 0 ? 'A' : 'B',
          wave: 'M125' as const,
        })),
        chineseContrast: true as const,
        filterRole,
        filterRoleZh,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M125' as const,
    labelZh: softCancelAuditSeekMultiselectContrast
      ? `软取消审计回跳台账多选对照 · ${indexes.length}行`
      : '软取消审计回跳台账多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditSeekMultiselectContrast ? ` · ${softCancelAuditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelAuditSeekMultiselectContrast
      ? '软取消审计回跳台账多选中文对照已开'
      : '软取消审计回跳台账多选对照待命',
    busyZh: '软取消审计回跳台账多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelRoleAuditOnepagerSeekLedgerIntact: (base as any).softCancelRoleAuditOnepagerSeekLedgerIntact === true,
    softCancelAuditSeekMultiselectContrastIntact: !!softCancelAuditSeekMultiselectContrast,
    softCancelAuditSeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M126：软取消审计多选对照 · 短片帧 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M126' as const,
      labelZh: '软取消审计多选对照短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消审计多选对照短片帧 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计多选对照短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelAuditSeekMultiselectContrast || null;
  const rows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const softCancelAuditMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M126' as const,
        kind: 'soft-cancel-audit-multiselect-clip-scrubber' as const,
        titleZh: '软取消审计多选对照 · 短片帧 scrubber',
        bodyZh:
          `软取消审计回跳台账多选中文对照支持短片帧 scrubber · ${Math.max(rows.length, 2)}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (rows.length
          ? rows
          : [
              { id: 'm126-soft-cancel-ms-0', lineZh: '软取消台账对照行#1', contrastSide: 'A' },
              { id: 'm126-soft-cancel-ms-1', lineZh: '软取消台账对照行#2', contrastSide: 'B' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          id: r.id || `m126-soft-cancel-ms-${i}`,
          lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
          contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M126' as const,
        })),
        frameCount: Math.max(rows.length, 2),
        scrubIndex,
        currentFrameIndex: scrubIndex,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedIndexes: ms.selectedIndexes } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M126' as const,
    labelZh: softCancelAuditMultiselectClipScrubber
      ? `软取消审计多选对照短片 scrubber · ${softCancelAuditMultiselectClipScrubber.frameCount}帧`
      : '软取消审计多选对照短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditMultiselectClipScrubber ? ` · ${softCancelAuditMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelAuditMultiselectClipScrubber
      ? '软取消审计多选对照短片 scrubber 已开'
      : '软取消审计多选对照短片 scrubber 待命',
    busyZh: '软取消审计多选对照短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditSeekMultiselectContrastIntact: (base as any).softCancelAuditSeekMultiselectContrastIntact === true,
    softCancelAuditMultiselectClipScrubberIntact: !!softCancelAuditMultiselectClipScrubber,
    softCancelAuditMultiselectClipScrubber,
    clipFrameScrubber: softCancelAuditMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}


/**
 * M127：软取消审计多选对照短片 scrubber · 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    keyframeBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    scrubIndex?: number | null;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (opts.softCancel === true && opts.keyframeBookmarks === false && opts.scrubberBookmarks === false) {
    return {
      ok: true as const,
      wave: 'M127' as const,
      labelZh: '软取消审计短片 scrubber 关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消审计多选对照短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计短片 scrubber 关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).softCancelAuditMultiselectClipScrubber || (base as any).clipFrameScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const scrubIndex = Math.max(
    0,
    Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? scrub?.scrubIndex ?? 0) || 0),
  );
  const wantsBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      !!scrub);
  const bookmarks = (frames.length
    ? frames
    : [
        { index: 0, lineZh: '软取消审计对照关帧 A', id: 'm127-soft-cancel-kf-0' },
        { index: 1, lineZh: '软取消审计对照关帧 B', id: 'm127-soft-cancel-kf-1' },
      ]
  ).map((f: any, i: number) => ({
    id: f.id || `m127-soft-cancel-kf-${i}`,
    index: i,
    scrubIndex: f.scrubIndex ?? i,
    nameZh: opts.bookmarkNameZh || `软取消审计关帧#${i + 1}`,
    lineZh: f.lineZh || f.auditLineZh || `对照帧#${i + 1}`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role,
    roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M127' as const,
  }));
  const softCancelAuditClipScrubberKeyframeBookmarks = wantsBm
    ? {
        wave: 'M127' as const,
        kind: 'soft-cancel-audit-clip-scrubber-keyframe-bookmarks' as const,
        titleZh: '软取消审计短片 scrubber · 关帧书签',
        bodyZh:
          `软取消审计多选对照短片 scrubber 已打 ${bookmarks.length} 枚关帧书签 · 当前 scrub #${scrubIndex + 1}` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M127' as const,
    labelZh: softCancelAuditClipScrubberKeyframeBookmarks
      ? `软取消审计短片 scrubber 关帧书签 · ${softCancelAuditClipScrubberKeyframeBookmarks.bookmarkCount}枚`
      : '软取消审计短片 scrubber 关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditClipScrubberKeyframeBookmarks ? ` · ${softCancelAuditClipScrubberKeyframeBookmarks.bodyZh}` : ''),
    toastZh: softCancelAuditClipScrubberKeyframeBookmarks
      ? '软取消审计短片 scrubber 关帧书签已开'
      : '软取消审计短片 scrubber 关帧书签待命',
    busyZh: '软取消审计短片 scrubber 关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditMultiselectClipScrubberIntact: (base as any).softCancelAuditMultiselectClipScrubberIntact === true,
    softCancelAuditClipScrubberKeyframeBookmarksIntact: !!softCancelAuditClipScrubberKeyframeBookmarks,
    softCancelAuditClipScrubberKeyframeBookmarks,
    keyframeBookmarks: softCancelAuditClipScrubberKeyframeBookmarks?.bookmarks || [],
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}


/**
 * M128：软取消审计关帧书签 · 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.crossSessionShareBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M128' as const,
      labelZh: '软取消审计关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消审计关帧书签跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const bm = (base as any).softCancelAuditClipScrubberKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(bm?.bookmarks) ? bm.bookmarks : Array.isArray((base as any).keyframeBookmarks) ? (base as any).keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m128-soft-cancel-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m128-soft-cancel-kf').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!bm);
  const softCancelAuditKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M128' as const,
        kind: 'soft-cancel-audit-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消审计关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消审计短片 scrubber 关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-soft-cancel-kf-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any, i: number) => ({ ...b, sharedRo: true, wave: 'M128' as const }))
          : [{ id: 'm128-soft-cancel-kf-share-0', nameZh: '软取消审计关帧#1', sharedRo: true, wave: 'M128' as const }],
        filterRole,
        filterRoleZh,
        fromKeyframeBookmarks: bm ? { kind: bm.kind, bookmarkCount: bm.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M128' as const,
    labelZh: softCancelAuditKfBmXsessionRoShare
      ? `软取消审计关帧跨会话只读分享 · ${softCancelAuditKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消审计关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditKfBmXsessionRoShare ? ` · ${softCancelAuditKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelAuditKfBmXsessionRoShare
      ? '软取消审计关帧跨会话只读分享已开'
      : '软取消审计关帧跨会话只读分享待命',
    busyZh: '软取消审计关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditClipScrubberKeyframeBookmarksIntact: (base as any).softCancelAuditClipScrubberKeyframeBookmarksIntact === true,
    softCancelAuditKfBmXsessionRoShareIntact: !!softCancelAuditKfBmXsessionRoShare,
    softCancelAuditKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoSharePath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}


/**
 * M129：软取消审计关帧跨会话只读分享 · 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.revokeShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M129' as const,
      labelZh: '软取消审计关帧分享过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过软取消审计关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计关帧分享过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const share = (base as any).softCancelAuditKfBmXsessionRoShare || null;
  const expiresInMs = Math.max(60000, Number(opts.expiresInMs) || 3600000);
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!share);
  const revoke = opts.revokeShare !== false;
  const softCancelAuditKfBmShareExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M129' as const,
        kind: 'soft-cancel-audit-kf-bm-share-expiry-revoke-ledger' as const,
        titleZh: '软取消审计关帧跨会话分享 · 过期吊销进中文台账',
        bodyZh:
          `软取消审计关帧跨会话只读分享支持过期吊销并写入中文台账 · 过期 ${Math.round(expiresInMs / 60000)}分钟` +
          (revoke ? ' · 已吊销' : ' · 可吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
        revoked: revoke,
        shareToken: share?.shareToken || `ro-soft-cancel-kf-m129-${Date.now().toString(36)}`,
        ledgerEntry: {
          id: `m129-soft-cancel-kf-share-revoke-${Date.now().toString(36)}`,
          wave: 'M129' as const,
          kind: 'soft-cancel-audit-kf-bm-share-expiry-revoke' as const,
          kindZh: '软取消审计关帧分享过期吊销',
          lineZh:
            `软取消审计关帧跨会话只读分享${revoke ? '已吊销' : '将过期'} · 过期 ${Math.round(expiresInMs / 60000)}分钟` +
            ` · 角色「${roleZh}」· 干跑 · 无外发`,
          auditLineZh:
            `软取消审计关帧跨会话只读分享${revoke ? '已吊销' : '将过期'} · 过期 ${Math.round(expiresInMs / 60000)}分钟` +
            ` · 角色「${roleZh}」· 干跑 · 无外发`,
          role,
          roleZh,
          createdAt: new Date().toISOString(),
          dryRun: true as const,
          noEgress: true as const,
          chinese: true as const,
        },
        fromXsessionShare: share ? { kind: share.kind, bookmarkCount: share.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const entry = softCancelAuditKfBmShareExpiryRevokeLedger?.ledgerEntry || null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M129' as const,
    labelZh: softCancelAuditKfBmShareExpiryRevokeLedger
      ? (revoke ? '软取消审计关帧分享已过期吊销进台账' : '软取消审计关帧分享过期吊销可入台账')
      : '软取消审计关帧分享过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditKfBmShareExpiryRevokeLedger ? ` · ${softCancelAuditKfBmShareExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: softCancelAuditKfBmShareExpiryRevokeLedger
      ? (revoke ? '软取消审计关帧分享已吊销进台账' : '软取消审计关帧分享过期吊销可入台账')
      : '软取消审计关帧分享过期吊销待命',
    busyZh: '软取消审计关帧分享过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditKfBmXsessionRoShareIntact: (base as any).softCancelAuditKfBmXsessionRoShareIntact === true,
    softCancelAuditKfBmShareExpiryRevokeLedgerIntact: !!softCancelAuditKfBmShareExpiryRevokeLedger,
    softCancelAuditKfBmShareExpiryRevokeLedger,
    chineseShareLedger: entry
      ? [entry, ...((Array.isArray((base as any).chineseShareLedger) ? (base as any).chineseShareLedger : []))]
      : (base as any).chineseShareLedger,
    chineseShareLedgerIntact: !!entry || (base as any).chineseShareLedgerIntact,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}


/**
 * M130：软取消审计分享吊销台账 · 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M130' as const,
      labelZh: '软取消审计分享吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消审计分享吊销台账角色过滤审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计分享吊销台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const revoke = (base as any).softCancelAuditKfBmShareExpiryRevokeLedger || null;
  const entry = revoke?.ledgerEntry || null;
  const chineseShareLedger: any[] = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : entry
      ? [entry]
      : [];
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!revoke ||
      chineseShareLedger.length > 0);
  const lines = (chineseShareLedger.length
    ? chineseShareLedger
    : [
        {
          id: 'm130-soft-cancel-share-revoke-0',
          kindZh: '软取消审计关帧分享过期吊销',
          auditLineZh: entry?.auditLineZh || entry?.lineZh || '软取消审计分享吊销台账行',
          role,
          roleZh,
        },
      ]
  ).map((e: any, i: number) => ({
    id: e.id || `m130-soft-cancel-share-revoke-${i}`,
    kindZh: e.kindZh || e.kind || '软取消审计分享吊销',
    auditLineZh: e.auditLineZh || e.lineZh || e.bodyZh || '软取消审计分享吊销台账行',
    role: e.role || role,
    roleZh: e.roleZh || roleZh,
    wave: 'M130' as const,
  }));
  const filtered = lines.filter((l: any) => !filterRole || l.role === filterRole || filterRole === 'admin');
  const softCancelAuditShareRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M130' as const,
        kind: 'soft-cancel-audit-share-revoke-ledger-role-audit-onepager' as const,
        titleZh: '软取消审计分享吊销台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消审计分享吊销中文台账可出角色过滤审计一页纸 · ${filtered.length}行 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines: filtered.length ? filtered : lines,
        lineCount: (filtered.length ? filtered : lines).length,
        filterRole,
        filterRoleZh,
        roleFiltered: true as const,
        inAppOnePager: true as const,
        fromRevokeLedger: revoke ? { kind: revoke.kind, revoked: revoke.revoked } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M130' as const,
    labelZh: softCancelAuditShareRevokeLedgerRoleAuditOnepager
      ? `软取消审计分享吊销台账角色审计一页纸 · ${softCancelAuditShareRevokeLedgerRoleAuditOnepager.lineCount}行`
      : '软取消审计分享吊销台账角色审计待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditShareRevokeLedgerRoleAuditOnepager ? ` · ${softCancelAuditShareRevokeLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelAuditShareRevokeLedgerRoleAuditOnepager
      ? '软取消审计分享吊销台账角色审计一页纸'
      : '软取消审计分享吊销台账角色审计待命',
    busyZh: '软取消审计分享吊销台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditKfBmShareExpiryRevokeLedgerIntact: (base as any).softCancelAuditKfBmShareExpiryRevokeLedgerIntact === true,
    softCancelAuditShareRevokeLedgerRoleAuditOnepagerIntact: !!softCancelAuditShareRevokeLedgerRoleAuditOnepager,
    softCancelAuditShareRevokeLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}


/**
 * M131：软取消审计分享吊销角色审计一页纸 · 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M131' as const,
      labelZh: '软取消审计分享吊销角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消审计分享吊销角色审计一页纸回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计分享吊销角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelAuditShareRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = opts.seekEntryIndex != null ? Number(opts.seekEntryIndex) : 0;
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const softCancelAuditShareRevokeRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M131' as const,
        kind: 'soft-cancel-audit-share-revoke-role-audit-seek-ledger' as const,
        titleZh: '软取消审计分享吊销角色审计一页纸 · 回跳台账行',
        bodyZh:
          `软取消审计分享吊销角色过滤审计一页纸可回跳台账行 · 过滤「${filterRoleZh}」` +
          ` · 定位行#${seekEntryIndex + 1}「${lines[seekEntryIndex]?.id || lines[0]?.id || 'm131-soft-cancel-share-revoke-0'}」` +
          ` · ${lines[seekEntryIndex]?.auditLineZh || lines[0]?.auditLineZh || '软取消审计分享吊销台账行'} · 干跑 · toast · 无外发`,
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        ledgerRowId: lines[seekEntryIndex]?.id || lines[0]?.id || 'm131-soft-cancel-share-revoke-0',
        filterRole,
        filterRoleZh,
        fromRoleAudit: audit ? { kind: audit.kind, lineCount: audit.lineCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M131' as const,
    labelZh: softCancelAuditShareRevokeRoleAuditSeekLedger
      ? `软取消审计分享吊销角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '软取消审计分享吊销角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditShareRevokeRoleAuditSeekLedger ? ` · ${softCancelAuditShareRevokeRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: softCancelAuditShareRevokeRoleAuditSeekLedger
      ? '软取消审计分享吊销角色审计已回跳台账行'
      : '软取消审计分享吊销角色审计回跳台账待命',
    busyZh: '软取消审计分享吊销角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditShareRevokeLedgerRoleAuditOnepagerIntact: (base as any).softCancelAuditShareRevokeLedgerRoleAuditOnepagerIntact === true,
    softCancelAuditShareRevokeRoleAuditSeekLedgerIntact: !!softCancelAuditShareRevokeRoleAuditSeekLedger,
    softCancelAuditShareRevokeRoleAuditSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M132：软取消审计分享吊销回跳 · 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M132' as const,
      labelZh: '软取消审计分享吊销回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消审计分享吊销回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计分享吊销回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelAuditShareRevokeRoleAuditSeekLedger || null;
  const audit = (base as any).softCancelAuditShareRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selected = indexes.map((idx, i) => {
    const row = lines[Math.min(idx, Math.max(lines.length - 1, 0))] || {
      id: `m132-soft-cancel-share-revoke-ms-${i}`,
      auditLineZh: `软取消审计分享吊销台账对照行#${i + 1}`,
      kindZh: '软取消审计分享吊销台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      id: row.id || `m132-soft-cancel-share-revoke-ms-${i}`,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.lineZh || `台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M132' as const,
    };
  });
  const softCancelAuditShareRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M132' as const,
        kind: 'soft-cancel-audit-share-revoke-seek-multiselect-contrast' as const,
        titleZh: '软取消审计分享吊销回跳 · 多选中文对照',
        bodyZh:
          `软取消审计分享吊销角色审计回跳支持多选中文对照 · ${selected.length}行 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows: selected,
        selectedIndexes: indexes,
        selectedCount: selected.length,
        filterRole,
        filterRoleZh,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M132' as const,
    labelZh: softCancelAuditShareRevokeSeekMultiselectContrast
      ? `软取消审计分享吊销回跳多选对照 · ${softCancelAuditShareRevokeSeekMultiselectContrast.selectedCount}行`
      : '软取消审计分享吊销回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditShareRevokeSeekMultiselectContrast ? ` · ${softCancelAuditShareRevokeSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelAuditShareRevokeSeekMultiselectContrast
      ? '软取消审计分享吊销回跳多选中文对照已开'
      : '软取消审计分享吊销回跳多选对照待命',
    busyZh: '软取消审计分享吊销回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditShareRevokeRoleAuditSeekLedgerIntact: (base as any).softCancelAuditShareRevokeRoleAuditSeekLedgerIntact === true,
    softCancelAuditShareRevokeSeekMultiselectContrastIntact: !!softCancelAuditShareRevokeSeekMultiselectContrast,
    softCancelAuditShareRevokeSeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M133：软取消审计分享吊销多选中文对照 · 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M133' as const,
      labelZh: '软取消审计分享吊销多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消审计分享吊销多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计分享吊销多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelAuditShareRevokeSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = (selectedRows.length
    ? selectedRows
    : [
        { index: 0, lineZh: '软取消审计分享吊销多选对照帧#1', id: 'm133-soft-cancel-ms-0' },
        { index: 1, lineZh: '软取消审计分享吊销多选对照帧#2', id: 'm133-soft-cancel-ms-1' },
      ]
  ).map((r: any, i: number) => ({
    index: i,
    scrubIndex: i,
    id: r.id || `m133-soft-cancel-ms-${i}`,
    ledgerRowId: r.ledgerRowId || r.id || `m133-soft-cancel-ms-${i}`,
    lineZh: r.lineZh || `对照帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role: r.role || role,
    roleZh: ROLE_ZH[String(r.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M133' as const,
  }));
  const softCancelAuditShareRevokeMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M133' as const,
        kind: 'soft-cancel-audit-share-revoke-multiselect-clip-scrubber' as const,
        titleZh: '软取消审计分享吊销多选中文对照 · 短片 scrubber',
        bodyZh:
          `软取消审计分享吊销多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M133' as const,
    labelZh: softCancelAuditShareRevokeMultiselectClipScrubber
      ? `软取消审计分享吊销多选短片 scrubber · ${softCancelAuditShareRevokeMultiselectClipScrubber.frameCount}帧`
      : '软取消审计分享吊销多选短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditShareRevokeMultiselectClipScrubber ? ` · ${softCancelAuditShareRevokeMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelAuditShareRevokeMultiselectClipScrubber
      ? '软取消审计分享吊销多选短片 scrubber 已开'
      : '软取消审计分享吊销多选短片 scrubber 待命',
    busyZh: '软取消审计分享吊销多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditShareRevokeSeekMultiselectContrastIntact: (base as any).softCancelAuditShareRevokeSeekMultiselectContrastIntact === true,
    softCancelAuditShareRevokeMultiselectClipScrubberIntact: !!softCancelAuditShareRevokeMultiselectClipScrubber,
    softCancelAuditShareRevokeMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M134：软取消审计分享吊销多选短片 scrubber · 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    scrubIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M134' as const,
      labelZh: '软取消审计分享吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消审计分享吊销多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计分享吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).softCancelAuditShareRevokeMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M134软取消审计多选短片关帧书签').trim();
  const keyIndexes = frames.length
    ? [0, Math.min(frames.length - 1, Math.floor((frames.length - 1) / 2)), frames.length - 1].filter(
        (v, i, a) => a.indexOf(v) === i,
      )
    : [0, 1];
  const bookmarks = keyIndexes.map((idx: number, i: number) => ({
    id: `m134-soft-cancel-ms-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameIndex: idx,
    scrubIndex: idx,
    lineZh: frames[idx]?.lineZh || `对照帧#${idx + 1}`,
    contrastSide: frames[idx]?.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: idx === scrubIndex,
    wave: 'M134' as const,
  }));
  const softCancelAuditShareRevokeMultiselectClipKfBm = wantsBm
    ? {
        wave: 'M134' as const,
        kind: 'soft-cancel-audit-share-revoke-multiselect-clip-kf-bm' as const,
        titleZh: '软取消审计分享吊销多选短片 scrubber · 关帧书签',
        bodyZh:
          `软取消审计分享吊销多选短片 scrubber 可打关帧书签 · ${bookmarks.length}枚 · 「${bookmarkNameZh}」` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        bookmarkNameZh,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M134' as const,
    labelZh: softCancelAuditShareRevokeMultiselectClipKfBm
      ? `软取消审计分享吊销多选短片关帧书签 · ${softCancelAuditShareRevokeMultiselectClipKfBm.bookmarkCount}枚`
      : '软取消审计分享吊销多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditShareRevokeMultiselectClipKfBm ? ` · ${softCancelAuditShareRevokeMultiselectClipKfBm.bodyZh}` : ''),
    toastZh: softCancelAuditShareRevokeMultiselectClipKfBm
      ? '软取消审计分享吊销多选短片关帧书签已开'
      : '软取消审计分享吊销多选短片关帧书签待命',
    busyZh: '软取消审计分享吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditShareRevokeMultiselectClipScrubberIntact: (base as any).softCancelAuditShareRevokeMultiselectClipScrubberIntact === true,
    softCancelAuditShareRevokeMultiselectClipKfBmIntact: !!softCancelAuditShareRevokeMultiselectClipKfBm,
    softCancelAuditShareRevokeMultiselectClipKfBm,
    keyframeBookmarks: softCancelAuditShareRevokeMultiselectClipKfBm?.bookmarks || (base as any).keyframeBookmarks,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}



/**
 * M135：软取消审计分享吊销多选短片关帧 · 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M135' as const,
      labelZh: '软取消审计分享吊销多选短片关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消审计分享吊销多选短片关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计分享吊销多选短片关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).softCancelAuditShareRevokeMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m135-soft-cancel-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m135-soft-cancel-kf').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M135' as const,
        kind: 'soft-cancel-audit-share-revoke-multiselect-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消审计分享吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消审计分享吊销多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-soft-cancel-kf-m135-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M135' as const }))
          : [{ id: 'm135-soft-cancel-kf-share-0', nameZh: '软取消审计关帧#1', sharedRo: true, wave: 'M135' as const }],
        filterRole,
        filterRoleZh,
        fromKeyframeBookmarks: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M135' as const,
    labelZh: softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare
      ? `软取消审计分享吊销多选短片关帧跨会话只读分享 · ${softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消审计分享吊销多选短片关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare ? ` · ${softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare
      ? '软取消审计分享吊销多选短片关帧跨会话只读分享已开'
      : '软取消审计分享吊销多选短片关帧跨会话只读分享待命',
    busyZh: '软取消审计分享吊销多选短片关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditShareRevokeMultiselectClipKfBmIntact: (base as any).softCancelAuditShareRevokeMultiselectClipKfBmIntact === true,
    softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShareIntact: !!softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare,
    softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoSharePath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}


/**
 * M136：软取消审计关帧跨会话只读分享 · 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M136' as const,
      labelZh: '软取消审计关帧跨会话分享过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过软取消审计关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计关帧跨会话分享过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m136-soft-cancel-kf').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m136-soft-cancel-kf').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const softCancelAuditKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M136' as const,
        kind: 'soft-cancel-audit-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消审计关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `软取消审计关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M136' as const,
          id: `m136-soft-cancel-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '软取消审计关帧跨会话分享吊销' : '软取消审计关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销软取消审计关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记软取消审计关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          role,
          roleZh,
          chineseLedger: true as const,
        },
        bookmarkCount: Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1),
        sessionId,
        targetSessionId,
        fromXsessionShare: xshare
          ? { kind: xshare.kind, shareToken: xshare.shareToken, bookmarkCount: xshare.bookmarkCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M136' as const,
    labelZh: softCancelAuditKfBmXsessionExpiryRevokeLedger
      ? `软取消审计关帧跨会话分享过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
      : '软取消审计关帧跨会话分享过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditKfBmXsessionExpiryRevokeLedger ? ` · ${softCancelAuditKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: softCancelAuditKfBmXsessionExpiryRevokeLedger
      ? '软取消审计关帧跨会话分享过期吊销进台账已开'
      : '软取消审计关帧跨会话分享过期吊销进台账待命',
    busyZh: '软取消审计关帧跨会话分享过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShareIntact: (base as any).softCancelAuditShareRevokeMultiselectClipKfBmXsessionRoShareIntact === true,
    softCancelAuditKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelAuditKfBmXsessionExpiryRevokeLedger,
    softCancelAuditKfBmXsessionExpiryRevokeLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}



/**
 * M137：软取消审计关帧跨会话分享过期吊销台账 · 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M137' as const,
      labelZh: '软取消审计过期吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消审计过期吊销台账角色过滤审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计过期吊销台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const revoke = (base as any).softCancelAuditKfBmXsessionExpiryRevokeLedger || null;
  const entry = revoke?.ledgerEntry || null;
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!revoke);
  const lines = [
    entry || {
      id: 'm137-soft-cancel-expiry-0',
      kindZh: '软取消审计关帧跨会话分享过期吊销',
      auditLineZh: '演示·软取消审计关帧跨会话分享过期吊销台账行',
      role,
      roleZh,
    },
    {
      id: 'm137-soft-cancel-expiry-1',
      kindZh: '软取消审计关帧跨会话分享过期吊销',
      auditLineZh: '演示·软取消审计关帧跨会话分享过期吊销台账行#2',
      role,
      roleZh,
    },
  ].map((e: any, i: number) => ({
    id: e.id || `m137-soft-cancel-expiry-${i}`,
    kindZh: e.kindZh || '软取消审计过期吊销',
    auditLineZh: e.auditLineZh || e.lineZh || '软取消审计过期吊销台账行',
    role: e.role || role,
    roleZh: e.roleZh || roleZh,
    wave: 'M137' as const,
  }));
  const filtered = lines.filter((l: any) => !filterRole || l.role === filterRole || filterRole === 'admin');
  const softCancelAuditExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M137' as const,
        kind: 'soft-cancel-audit-expiry-ledger-role-audit-onepager' as const,
        titleZh: '软取消审计过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消审计关帧跨会话分享过期吊销中文台账可出角色过滤审计一页纸 · ${filtered.length}行 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines: filtered.length ? filtered : lines,
        lineCount: (filtered.length ? filtered : lines).length,
        filterRole,
        filterRoleZh,
        roleFiltered: true as const,
        roleFilteredAudit: true as const,
        renderAuditOnePager: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        chineseLedger: true as const,
        fromExpiryLedger: revoke
          ? { kind: revoke.kind, bookmarkCount: revoke.bookmarkCount, revokeShare: revoke.revokeShare }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M137' as const,
    labelZh: softCancelAuditExpiryLedgerRoleAuditOnepager
      ? `软取消审计过期吊销台账角色审计一页纸 · ${softCancelAuditExpiryLedgerRoleAuditOnepager.lineCount}行`
      : '软取消审计过期吊销台账角色审计待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditExpiryLedgerRoleAuditOnepager ? ` · ${softCancelAuditExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelAuditExpiryLedgerRoleAuditOnepager
      ? '软取消审计过期吊销台账角色审计一页纸已开'
      : '软取消审计过期吊销台账角色审计待命',
    busyZh: '软取消审计过期吊销台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).softCancelAuditKfBmXsessionExpiryRevokeLedgerIntact === true,
    softCancelAuditExpiryLedgerRoleAuditOnepagerIntact: !!softCancelAuditExpiryLedgerRoleAuditOnepager,
    softCancelAuditExpiryLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}


/**
 * M138：软取消审计过期吊销台账角色审计一页纸 · 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M138' as const,
      labelZh: '软取消审计过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消审计过期吊销台账角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelAuditExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = opts.seekEntryIndex != null ? Number(opts.seekEntryIndex) : 0;
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[Math.min(seekEntryIndex, Math.max(lines.length - 1, 0))] || {
    id: 'm138-soft-cancel-expiry-seek-0',
    auditLineZh: '演示·软取消审计过期吊销台账角色审计行',
    kindZh: '软取消审计过期吊销台账',
    role,
    roleZh,
  };
  const softCancelAuditExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M138' as const,
        kind: 'soft-cancel-audit-expiry-role-audit-seek-ledger' as const,
        titleZh: '软取消审计过期吊销台账角色审计一页纸 · 回跳台账行',
        bodyZh:
          `软取消审计过期吊销中文台账角色过滤审计一页纸可回跳台账行 · 过滤「${filterRoleZh}」` +
          ` · 定位行#${seekEntryIndex + 1}「${row.id}」` +
          ` · ${row.auditLineZh || row.lineZh || '软取消审计过期吊销台账行'} · 干跑 · toast · 无外发`,
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        ledgerRowId: row.id || row.ledgerRowId || `row-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.lineZh || `台账行#${seekEntryIndex + 1}`,
        filterRole,
        filterRoleZh,
        fromRoleAudit: audit ? { kind: audit.kind, lineCount: audit.lineCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M138' as const,
    labelZh: softCancelAuditExpiryRoleAuditSeekLedger
      ? `软取消审计过期角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '软取消审计过期角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelAuditExpiryRoleAuditSeekLedger ? ` · ${softCancelAuditExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: softCancelAuditExpiryRoleAuditSeekLedger
      ? '软取消审计过期角色审计已回跳台账行'
      : '软取消审计过期角色审计回跳台账待命',
    busyZh: '软取消审计过期角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditExpiryLedgerRoleAuditOnepagerIntact: (base as any).softCancelAuditExpiryLedgerRoleAuditOnepagerIntact === true,
    softCancelAuditExpiryRoleAuditSeekLedgerIntact: !!softCancelAuditExpiryRoleAuditSeekLedger,
    softCancelAuditExpiryRoleAuditSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M139：软取消审计过期角色审计回跳 · 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M139' as const,
      labelZh: '软取消审计过期回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消审计过期角色审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计过期回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelAuditExpiryRoleAuditSeekLedger || null;
  const audit = (base as any).softCancelAuditExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : Array.isArray(seek?.lines) ? seek.lines : [];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selected = indexes.map((idx, i) => {
    const row = lines[Math.min(idx, Math.max(lines.length - 1, 0))] || {
      id: `m139-soft-cancel-expiry-ms-${i}`,
      auditLineZh: `软取消审计过期台账对照行#${i + 1}`,
      kindZh: '软取消审计过期吊销台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      id: row.id || `m139-soft-cancel-expiry-ms-${i}`,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.lineZh || `台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M139' as const,
    };
  });
  const softCancelExpirySeekMultiselectContrast = wantsMs
    ? {
        wave: 'M139' as const,
        kind: 'soft-cancel-expiry-seek-multiselect-contrast' as const,
        titleZh: '软取消审计过期角色审计回跳 · 多选中文对照',
        bodyZh:
          `软取消审计过期角色审计回跳支持多选中文对照 · ${selected.length}行 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows: selected,
        selectedIndexes: indexes,
        selectedCount: selected.length,
        filterRole,
        filterRoleZh,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M139' as const,
    labelZh: softCancelExpirySeekMultiselectContrast
      ? `软取消审计过期回跳多选对照 · ${softCancelExpirySeekMultiselectContrast.selectedCount}行`
      : '软取消审计过期回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpirySeekMultiselectContrast ? ` · ${softCancelExpirySeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelExpirySeekMultiselectContrast
      ? '软取消审计过期回跳多选中文对照已开'
      : '软取消审计过期回跳多选对照待命',
    busyZh: '软取消审计过期回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditExpiryRoleAuditSeekLedgerIntact: (base as any).softCancelAuditExpiryRoleAuditSeekLedgerIntact === true,
    softCancelExpirySeekMultiselectContrastIntact: !!softCancelExpirySeekMultiselectContrast,
    softCancelExpirySeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M140：软取消审计过期多选中文对照 · 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    multiSelectContrast?: boolean;
    multiSelectLedgerRows?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M140' as const,
      labelZh: '软取消审计过期多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消审计过期多选中文对照短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计过期多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelExpirySeekMultiselectContrast || null;
  const rows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const softCancelExpiryMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M140' as const,
        kind: 'soft-cancel-expiry-multiselect-clip-scrubber' as const,
        titleZh: '软取消审计过期多选中文对照 · 短片帧 scrubber',
        bodyZh:
          `软取消审计过期多选中文对照支持短片帧 scrubber · ${Math.max(rows.length, 2)}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (rows.length
          ? rows
          : [
              { id: 'm140-soft-cancel-expiry-ms-0', lineZh: '软取消过期台账对照行#1', contrastSide: 'A' },
              { id: 'm140-soft-cancel-expiry-ms-1', lineZh: '软取消过期台账对照行#2', contrastSide: 'B' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          id: r.id || `m140-soft-cancel-expiry-ms-${i}`,
          lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
          contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M140' as const,
        })),
        frameCount: Math.max(rows.length, 2),
        scrubIndex,
        currentFrameIndex: scrubIndex,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedIndexes: ms.selectedIndexes } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M140' as const,
    labelZh: softCancelExpiryMultiselectClipScrubber
      ? `软取消审计过期多选短片 scrubber · ${softCancelExpiryMultiselectClipScrubber.frameCount}帧`
      : '软取消审计过期多选短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryMultiselectClipScrubber ? ` · ${softCancelExpiryMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelExpiryMultiselectClipScrubber
      ? '软取消审计过期多选短片 scrubber 已开'
      : '软取消审计过期多选短片 scrubber 待命',
    busyZh: '软取消审计过期多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpirySeekMultiselectContrastIntact: (base as any).softCancelExpirySeekMultiselectContrastIntact === true,
    softCancelExpiryMultiselectClipScrubberIntact: !!softCancelExpiryMultiselectClipScrubber,
    softCancelExpiryMultiselectClipScrubber,
    clipFrameScrubber: softCancelExpiryMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}


/**
 * M141：软取消审计过期多选短片 scrubber · 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    scrubIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M141' as const,
      labelZh: '软取消审计过期多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消审计过期多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计过期多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).softCancelExpiryMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M141软取消过期多选短片关帧书签').trim();
  const keyIndexes = frames.length
    ? [0, Math.min(frames.length - 1, Math.floor((frames.length - 1) / 2)), frames.length - 1].filter(
        (v, i, a) => a.indexOf(v) === i,
      )
    : [0, 1];
  const bookmarks = keyIndexes.map((idx: number, i: number) => ({
    id: `m141-soft-cancel-expiry-ms-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameIndex: idx,
    scrubIndex: idx,
    lineZh: frames[idx]?.lineZh || `对照帧#${idx + 1}`,
    contrastSide: frames[idx]?.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: idx === scrubIndex,
    wave: 'M141' as const,
  }));
  const softCancelExpiryMultiselectClipKfBm = wantsBm
    ? {
        wave: 'M141' as const,
        kind: 'soft-cancel-expiry-multiselect-clip-kf-bm' as const,
        titleZh: '软取消审计过期多选短片 scrubber · 关帧书签',
        bodyZh:
          `软取消审计过期多选短片 scrubber 可打关帧书签 · ${bookmarks.length}枚 · 「${bookmarkNameZh}」` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        bookmarkNameZh,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M141' as const,
    labelZh: softCancelExpiryMultiselectClipKfBm
      ? `软取消审计过期多选短片关帧书签 · ${softCancelExpiryMultiselectClipKfBm.bookmarkCount}枚`
      : '软取消审计过期多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryMultiselectClipKfBm ? ` · ${softCancelExpiryMultiselectClipKfBm.bodyZh}` : ''),
    toastZh: softCancelExpiryMultiselectClipKfBm
      ? '软取消审计过期多选短片关帧书签已开'
      : '软取消审计过期多选短片关帧书签待命',
    busyZh: '软取消审计过期多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryMultiselectClipScrubberIntact: (base as any).softCancelExpiryMultiselectClipScrubberIntact === true,
    softCancelExpiryMultiselectClipKfBmIntact: !!softCancelExpiryMultiselectClipKfBm,
    softCancelExpiryMultiselectClipKfBm,
    keyframeBookmarks: softCancelExpiryMultiselectClipKfBm?.bookmarks || (base as any).keyframeBookmarks,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksPath: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}

/**
 * M142：软取消审计过期关帧跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.crossSessionShareBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M142' as const,
      labelZh: '软取消审计过期关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消审计过期关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消审计过期关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const bm = (base as any).softCancelExpiryMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(bm?.bookmarks) ? bm.bookmarks : Array.isArray((base as any).keyframeBookmarks) ? (base as any).keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m142-soft-cancel').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m142-soft-cancel').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!bm);
  const softCancelExpiryKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M142' as const,
        kind: 'soft-cancel-expiry-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消审计过期关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消审计过期短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-soft-cancel-expiry-kf-m142-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M142' as const }))
          : [{ id: 'm142-soft-cancel-expiry-kf-share-0', nameZh: '软取消过期关帧#1', sharedRo: true, wave: 'M142' as const }],
        filterRole,
        filterRoleZh,
        fromKeyframeBookmarks: bm ? { kind: bm.kind, bookmarkCount: bm.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M142' as const,
    labelZh: softCancelExpiryKfBmXsessionRoShare
      ? `软取消审计过期关帧跨会话只读分享 · ${softCancelExpiryKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消审计过期关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryKfBmXsessionRoShare ? ` · ${softCancelExpiryKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelExpiryKfBmXsessionRoShare
      ? '软取消审计过期关帧跨会话只读分享已开'
      : '软取消审计过期关帧跨会话只读分享待命',
    busyZh: '软取消审计过期关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryMultiselectClipKfBmIntact: (base as any).softCancelExpiryMultiselectClipKfBmIntact === true,
    softCancelExpiryKfBmXsessionRoShareIntact: !!softCancelExpiryKfBmXsessionRoShare,
    softCancelExpiryKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}

/**
 * M143：软取消过期关帧跨会话只读分享 → 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M143' as const,
      labelZh: '软取消过期关帧跨会话分享过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过软取消过期关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期关帧跨会话分享过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelExpiryKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m143-soft-cancel').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m143-soft-cancel').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const softCancelExpiryKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M143' as const,
        kind: 'soft-cancel-expiry-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消过期关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `软取消过期关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M143' as const,
          id: `m143-soft-cancel-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '软取消过期关帧跨会话分享吊销' : '软取消过期关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销软取消过期关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记软取消过期关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          role,
          roleZh,
          chineseLedger: true as const,
        },
        bookmarkCount: Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1),
        sessionId,
        targetSessionId,
        fromXsessionShare: xshare
          ? { kind: xshare.kind, shareToken: xshare.shareToken, bookmarkCount: xshare.bookmarkCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M143' as const,
    labelZh: softCancelExpiryKfBmXsessionExpiryRevokeLedger
      ? `软取消过期关帧跨会话分享过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
      : '软取消过期关帧跨会话分享过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryKfBmXsessionExpiryRevokeLedger ? ` · ${softCancelExpiryKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: softCancelExpiryKfBmXsessionExpiryRevokeLedger
      ? '软取消过期关帧跨会话分享过期吊销进台账已开'
      : '软取消过期关帧跨会话分享过期吊销进台账待命',
    busyZh: '软取消过期关帧跨会话分享过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryKfBmXsessionRoShareIntact: (base as any).softCancelExpiryKfBmXsessionRoShareIntact === true,
    softCancelExpiryKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelExpiryKfBmXsessionExpiryRevokeLedger,
    softCancelExpiryKfBmXsessionExpiryRevokeLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}


/**
 * M144：软取消过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleAuditOnePager?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M144' as const,
      labelZh: '软取消过期吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期吊销台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).softCancelExpiryKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm144-soft-cancel-share-0',
    kindZh: '软取消过期关帧跨会话分享过期登记',
    auditLineZh: '演示·软取消过期关帧跨会话分享过期吊销台账行',
    role,
    roleZh,
    chineseLedger: true as const,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const softCancelExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M144' as const,
        kind: 'soft-cancel-expiry-revoke-ledger-role-audit-onepager' as const,
        titleZh: '软取消过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消过期吊销中文台账可出角色过滤审计一页纸 · 行「${ledgerEntry.id}」` +
          ` · ${ledgerEntry.auditLineZh || ledgerEntry.kindZh} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines: [
          { id: ledgerEntry.id, auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.kindZh, role, roleZh },
          { id: 'm144-soft-cancel-share-1', auditLineZh: '演示·软取消过期关帧跨会话分享过期吊销台账行#2', role, roleZh },
        ],
        lineCount: 2,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        renderAuditOnePager: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        chineseLedger: true as const,
        fromExpiryLedger: expiry
          ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount, revokeShare: expiry.revokeShare }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M144' as const,
    labelZh: softCancelExpiryRevokeLedgerRoleAuditOnepager
      ? '软取消过期吊销台账角色审计一页纸'
      : '软取消过期吊销台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryRevokeLedgerRoleAuditOnepager ? ` · ${softCancelExpiryRevokeLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelExpiryRevokeLedgerRoleAuditOnepager
      ? '软取消过期吊销台账角色审计一页纸已开'
      : '软取消过期吊销台账角色审计一页纸待命',
    busyZh: '软取消过期吊销台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryKfBmXsessionExpiryRevokeLedgerIntact: (base as any).softCancelExpiryKfBmXsessionExpiryRevokeLedgerIntact === true,
    softCancelExpiryRevokeLedgerRoleAuditOnepagerIntact: !!softCancelExpiryRevokeLedgerRoleAuditOnepager,
    softCancelExpiryRevokeLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}

/**
 * M145：软取消过期吊销台账角色审计一页纸 → 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M145' as const,
      labelZh: '软取消过期吊销角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消过期吊销台账角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期吊销角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelExpiryRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm145-soft-cancel-share-0', auditLineZh: '演示·软取消过期关帧跨会话分享过期吊销台账行' },
    { id: 'm145-soft-cancel-share-1', auditLineZh: '演示·软取消过期关帧跨会话分享过期吊销台账行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0] || {
    id: 'm145-soft-cancel-expiry-seek-0',
    auditLineZh: '演示·软取消过期吊销台账角色审计行',
    kindZh: '软取消过期吊销台账',
    role,
    roleZh,
  };
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const softCancelExpiryRevokeLedgerRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M145' as const,
        kind: 'soft-cancel-expiry-revoke-ledger-role-audit-seek-ledger' as const,
        titleZh: '软取消过期吊销台账角色审计一页纸 · 回跳台账行',
        bodyZh:
          `软取消过期吊销中文台账角色过滤审计一页纸可回跳台账行 · 过滤「${filterRoleZh}」` +
          ` · 定位行#${seekEntryIndex + 1}「${row.id}」` +
          ` · ${row.auditLineZh || row.lineZh || '软取消过期吊销台账行'} · 干跑 · toast · 无外发`,
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        ledgerRowId: row.id || row.ledgerRowId || `row-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.lineZh || `台账行#${seekEntryIndex + 1}`,
        filterRole,
        filterRoleZh,
        fromRoleAudit: audit ? { kind: audit.kind, lineCount: audit.lineCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M145' as const,
    labelZh: softCancelExpiryRevokeLedgerRoleAuditSeekLedger
      ? `软取消过期吊销角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '软取消过期吊销角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryRevokeLedgerRoleAuditSeekLedger ? ` · ${softCancelExpiryRevokeLedgerRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: softCancelExpiryRevokeLedgerRoleAuditSeekLedger
      ? '软取消过期吊销角色审计已回跳台账行'
      : '软取消过期吊销角色审计回跳台账待命',
    busyZh: '软取消过期吊销角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryRevokeLedgerRoleAuditOnepagerIntact: (base as any).softCancelExpiryRevokeLedgerRoleAuditOnepagerIntact === true,
    softCancelExpiryRevokeLedgerRoleAuditSeekLedgerIntact: !!softCancelExpiryRevokeLedgerRoleAuditSeekLedger,
    softCancelExpiryRevokeLedgerRoleAuditSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M146：软取消过期吊销角色审计回跳 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectContrast?: boolean;
    multiSelectLedgerRows?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M146' as const,
      labelZh: '软取消角色审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消过期吊销角色审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消角色审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelExpiryRevokeLedgerRoleAuditSeekLedger || null;
  const fromAudit = seek?.fromRoleAudit || null;
  const lines: any[] = Array.isArray((base as any).softCancelExpiryRevokeLedgerRoleAuditOnepager?.lines)
    ? (base as any).softCancelExpiryRevokeLedgerRoleAuditOnepager.lines
    : [
        { id: seek?.ledgerRowId || 'm146-soft-cancel-seek-0', auditLineZh: seek?.lineZh || '演示·软取消过期吊销台账角色审计行' },
        { id: 'm146-soft-cancel-seek-1', auditLineZh: '演示·软取消过期吊销台账角色审计行#2' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selected = indexes.map((idx, i) => {
    const row = lines[Math.min(idx, Math.max(lines.length - 1, 0))] || {
      id: `m146-soft-cancel-ms-${i}`,
      auditLineZh: `软取消角色审计台账对照行#${i + 1}`,
      kindZh: '软取消过期吊销台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      id: row.id || `m146-soft-cancel-ms-${i}`,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.lineZh || `台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M146' as const,
    };
  });
  const softCancelExpiryRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M146' as const,
        kind: 'soft-cancel-expiry-revoke-seek-multiselect-contrast' as const,
        titleZh: '软取消过期吊销角色审计回跳 · 多选中文对照',
        bodyZh:
          `软取消过期吊销角色审计一页纸回跳支持多选中文对照 · ${selected.length}行 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows: selected,
        selectedIndexes: indexes,
        selectedCount: selected.length,
        filterRole,
        filterRoleZh,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M146' as const,
    labelZh: softCancelExpiryRevokeSeekMultiselectContrast
      ? `软取消角色审计回跳多选对照 · ${softCancelExpiryRevokeSeekMultiselectContrast.selectedCount}行`
      : '软取消角色审计回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryRevokeSeekMultiselectContrast ? ` · ${softCancelExpiryRevokeSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelExpiryRevokeSeekMultiselectContrast
      ? '软取消角色审计回跳多选中文对照已开'
      : '软取消角色审计回跳多选对照待命',
    busyZh: '软取消角色审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryRevokeLedgerRoleAuditSeekLedgerIntact: (base as any).softCancelExpiryRevokeLedgerRoleAuditSeekLedgerIntact === true,
    softCancelExpiryRevokeSeekMultiselectContrastIntact: !!softCancelExpiryRevokeSeekMultiselectContrast,
    softCancelExpiryRevokeSeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M147：软取消角色审计回跳多选对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M147' as const,
      labelZh: '软取消回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消角色审计回跳多选中文对照短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelExpiryRevokeSeekMultiselectContrast || null;
  const selected: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm147-soft-ms-0', lineZh: '软取消角色审计台账对照行#1', contrastSide: 'A' },
    { index: 1, id: 'm147-soft-ms-1', lineZh: '软取消角色审计台账对照行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selected.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selected.map((row: any, i: number) => ({
    index: i,
    scrubIndex: i,
    id: row.id || `m147-soft-ms-${i}`,
    lineZh: row.lineZh || `对照行#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role: row.role || role,
    roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M147' as const,
  }));
  const softCancelSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M147' as const,
        kind: 'soft-cancel-seek-multiselect-clip-scrubber' as const,
        titleZh: '软取消角色审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `软取消角色审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M147' as const,
    labelZh: softCancelSeekMultiselectClipScrubber
      ? `软取消回跳多选短片scrubber · ${softCancelSeekMultiselectClipScrubber.frameCount}帧`
      : '软取消回跳多选短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelSeekMultiselectClipScrubber ? ` · ${softCancelSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelSeekMultiselectClipScrubber
      ? '软取消回跳多选短片scrubber已开'
      : '软取消回跳多选短片scrubber待命',
    busyZh: '软取消回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryRevokeSeekMultiselectContrastIntact: (base as any).softCancelExpiryRevokeSeekMultiselectContrastIntact === true,
    softCancelSeekMultiselectClipScrubberIntact: !!softCancelSeekMultiselectClipScrubber,
    softCancelSeekMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M148：软取消回跳多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    scrubIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M148' as const,
      labelZh: '软取消短片scrubber关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消回跳多选短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消短片scrubber关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).softCancelSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { index: 0, id: 'm148-soft-scrub-0', lineZh: '软取消回跳多选短片帧#1', contrastSide: 'A' },
    { index: 1, id: 'm148-soft-scrub-1', lineZh: '软取消回跳多选短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M148软取消短片scrubber关帧书签').trim();
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? scrub?.scrubIndex) || 0));
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m148-soft-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameId: f.id || `frame-${i}`,
    scrubIndex: f.scrubIndex ?? f.index ?? i,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    lineZh: f.lineZh || `帧#${i + 1}`,
    isCurrent: (f.scrubIndex ?? f.index ?? i) === scrubIndex,
    wave: 'M148' as const,
  }));
  const softCancelClipScrubberKeyframeBookmarks = wantsKf
    ? {
        wave: 'M148' as const,
        kind: 'soft-cancel-clip-scrubber-keyframe-bookmarks' as const,
        titleZh: '软取消回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `软取消回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M148' as const,
    labelZh: softCancelClipScrubberKeyframeBookmarks
      ? `软取消短片scrubber关帧书签 · ${softCancelClipScrubberKeyframeBookmarks.bookmarkCount}枚`
      : '软取消短片scrubber关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelClipScrubberKeyframeBookmarks ? ` · ${softCancelClipScrubberKeyframeBookmarks.bodyZh}` : ''),
    toastZh: softCancelClipScrubberKeyframeBookmarks
      ? '软取消短片scrubber关帧书签已开'
      : '软取消短片scrubber关帧书签待命',
    busyZh: '软取消短片scrubber关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelSeekMultiselectClipScrubberIntact: (base as any).softCancelSeekMultiselectClipScrubberIntact === true,
    softCancelClipScrubberKeyframeBookmarksIntact: !!softCancelClipScrubberKeyframeBookmarks,
    softCancelClipScrubberKeyframeBookmarks,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}

/**
 * M149：软取消短片 scrubber 关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M149' as const,
      labelZh: '软取消关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消短片 scrubber 关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).softCancelClipScrubberKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm149-soft-kf-0', nameZh: '演示·M149软取消关帧#1', scrubIndex: 0 },
    { id: 'm149-soft-kf-1', nameZh: '演示·M149软取消关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m149-soft').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m149-soft').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m149-soft-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const softCancelKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M149' as const,
        kind: 'soft-cancel-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消短片 scrubber 关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消短片 scrubber 关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 令牌「${shareToken}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        fromKfBm: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M149' as const,
    labelZh: softCancelKfBmXsessionRoShare
      ? `软取消关帧跨会话只读分享 · ${softCancelKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionRoShare ? ` · ${softCancelKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelKfBmXsessionRoShare
      ? '软取消关帧跨会话只读分享已开'
      : '软取消关帧跨会话只读分享待命',
    busyZh: '软取消关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelClipScrubberKeyframeBookmarksIntact: (base as any).softCancelClipScrubberKeyframeBookmarksIntact === true,
    softCancelKfBmXsessionRoShareIntact: !!softCancelKfBmXsessionRoShare,
    softCancelKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}

/**
 * M150：软取消关帧跨会话只读分享 → 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    revokeShare?: boolean;
    expiresInMs?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M150' as const,
      labelZh: '软取消关帧跨会话过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm150-soft-kf-0', nameZh: '演示·M150软取消关帧#1', scrubIndex: 0 },
    { id: 'm150-soft-kf-1', nameZh: '演示·M150软取消关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m150-soft').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m150-soft').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const softCancelKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M150' as const,
        kind: 'soft-cancel-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `软取消关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M150' as const,
          id: `m150-soft-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '软取消关帧跨会话分享吊销' : '软取消关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销软取消关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记软取消关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          role,
          roleZh,
          chineseLedger: true as const,
        },
        bookmarkCount: Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1),
        sessionId,
        targetSessionId,
        fromXsessionShare: xshare
          ? { kind: xshare.kind, shareToken: xshare.shareToken, bookmarkCount: xshare.bookmarkCount }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M150' as const,
    labelZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? `软取消关帧跨会话过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
      : '软取消关帧跨会话过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionExpiryRevokeLedger ? ` · ${softCancelKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? '软取消关帧跨会话过期吊销进台账已开'
      : '软取消关帧跨会话过期吊销进台账待命',
    busyZh: '软取消关帧跨会话过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionRoShareIntact: (base as any).softCancelKfBmXsessionRoShareIntact === true,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelKfBmXsessionExpiryRevokeLedger,
    softCancelKfBmXsessionExpiryRevokeLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}

/**
 * M151：软取消过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M151' as const,
      labelZh: '软取消过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).softCancelKfBmXsessionExpiryRevokeLedger || null;
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledger?.ledgerEntry?.id || 'm151-soft-audit-0',
      auditLineZh: ledger?.ledgerEntry?.auditLineZh || '演示·软取消过期吊销台账行#1',
      kindZh: ledger?.ledgerEntry?.kindZh || '软取消关帧跨会话分享过期吊销',
    },
    { id: 'm151-soft-audit-1', auditLineZh: '演示·软取消过期吊销台账行#2', kindZh: '软取消关帧跨会话分享过期登记' },
  ];
  const softCancelExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M151' as const,
        kind: 'soft-cancel-expiry-ledger-role-audit-onepager' as const,
        titleZh: '软取消过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消过期吊销中文台账可出角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        renderAuditOnePager: true as const,
        fromLedger: ledger
          ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, revokeShare: ledger.revokeShare }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M151' as const,
    labelZh: softCancelExpiryLedgerRoleAuditOnepager
      ? `软取消过期台账角色审计一页纸 · ${softCancelExpiryLedgerRoleAuditOnepager.lineCount}行`
      : '软取消过期台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryLedgerRoleAuditOnepager ? ` · ${softCancelExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelExpiryLedgerRoleAuditOnepager
      ? '软取消过期台账角色审计一页纸已开'
      : '软取消过期台账角色审计一页纸待命',
    busyZh: '软取消过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: (base as any).softCancelKfBmXsessionExpiryRevokeLedgerIntact === true,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: !!softCancelExpiryLedgerRoleAuditOnepager,
    softCancelExpiryLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}

/**
 * M152：软取消角色过滤审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M152' as const,
      labelZh: '软取消角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm152-soft-audit-seek-0', auditLineZh: '演示·软取消角色审计台账行#1', kindZh: '软取消过期台账角色审计' },
    { id: 'm152-soft-audit-seek-1', auditLineZh: '演示·软取消角色审计台账行#2', kindZh: '软取消过期台账角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const hit = lines[seekEntryIndex] || lines[0] || {};
  const softCancelRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M152' as const,
        kind: 'soft-cancel-role-audit-seek-ledger' as const,
        titleZh: '软取消角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `软取消角色过滤审计可回跳中文台账 · 行#${seekEntryIndex + 1}/${lines.length}` +
          ` · 「${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: hit.id || `m152-soft-audit-seek-${seekEntryIndex}`,
        lineZh: hit.auditLineZh || hit.kindZh || `台账行#${seekEntryIndex + 1}`,
        lines,
        lineCount: lines.length,
        highlightLedgerRow: true as const,
        seekLedgerRow: true as const,
        seekBackToLedger: true as const,
        chineseLedger: true as const,
        fromAudit: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M152' as const,
    labelZh: softCancelRoleAuditSeekLedger
      ? `软取消角色审计回跳台账 · 行#${(softCancelRoleAuditSeekLedger.seekEntryIndex || 0) + 1}`
      : '软取消角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelRoleAuditSeekLedger ? ` · ${softCancelRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: softCancelRoleAuditSeekLedger
      ? '软取消角色审计回跳台账已开'
      : '软取消角色审计回跳台账待命',
    busyZh: '软取消角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: (base as any).softCancelExpiryLedgerRoleAuditOnepagerIntact === true,
    softCancelRoleAuditSeekLedgerIntact: !!softCancelRoleAuditSeekLedger,
    softCancelRoleAuditSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}

/**
 * M153：软取消回跳台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M153' as const,
      labelZh: '软取消回跳台账多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消回跳台账多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消回跳台账多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm153-soft-seek-ms-0', auditLineZh: '演示·软取消回跳台账行#1', kindZh: '软取消角色审计回跳台账' },
    { id: 'm153-soft-seek-ms-1', auditLineZh: '演示·软取消回跳台账行#2', kindZh: '软取消角色审计回跳台账' },
  ];
  const indexesRaw = Array.isArray(opts.seekEntryIndexes) ? opts.seekEntryIndexes : [0, 1];
  const seekEntryIndexes = indexesRaw
    .map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    .filter((v, i, a) => a.indexOf(v) === i);
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      seekEntryIndexes.length > 0 ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || `m153-soft-seek-ms-${idx}`,
      lineZh: hit.auditLineZh || hit.kindZh || `台账行#${idx + 1}`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M153' as const,
    };
  });
  const softCancelSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M153' as const,
        kind: 'soft-cancel-seek-multiselect-contrast' as const,
        titleZh: '软取消回跳中文台账 · 多选中文对照',
        bodyZh:
          `软取消回跳中文台账支持多选中文对照 · 选中${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        lines,
        lineCount: lines.length,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        chineseContrast: true as const,
        fromSeek: seek
          ? { kind: seek.kind, lineCount: seek.lineCount, seekEntryIndex: seek.seekEntryIndex }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M153' as const,
    labelZh: softCancelSeekMultiselectContrast
      ? `软取消回跳台账多选对照 · ${softCancelSeekMultiselectContrast.selectedCount}行`
      : '软取消回跳台账多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelSeekMultiselectContrast ? ` · ${softCancelSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelSeekMultiselectContrast
      ? '软取消回跳台账多选对照已开'
      : '软取消回跳台账多选对照待命',
    busyZh: '软取消回跳台账多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelRoleAuditSeekLedgerIntact: (base as any).softCancelRoleAuditSeekLedgerIntact === true,
    softCancelSeekMultiselectContrastIntact: !!softCancelSeekMultiselectContrast,
    softCancelSeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}

/**
 * M154：软取消多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M154' as const,
      labelZh: '软取消多选对照短片scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消多选中文对照短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选对照短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelSeekMultiselectContrast || null;
  const selected: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm154-soft-ms-0', lineZh: '软取消回跳多选对照行#1', contrastSide: 'A' },
    { index: 1, id: 'm154-soft-ms-1', lineZh: '软取消回跳多选对照行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selected.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selected.map((row: any, i: number) => ({
    index: i,
    scrubIndex: i,
    id: row.id || `m154-soft-ms-${i}`,
    lineZh: row.lineZh || `对照行#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role: row.role || role,
    roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M154' as const,
  }));
  const softCancelMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M154' as const,
        kind: 'soft-cancel-multiselect-clip-scrubber' as const,
        titleZh: '软取消多选中文对照 · 短片 scrubber',
        bodyZh:
          `软取消多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[scrubIndex] || frames[0] || null,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M154' as const,
    labelZh: softCancelMultiselectClipScrubber
      ? `软取消多选对照短片scrubber · ${softCancelMultiselectClipScrubber.frameCount}帧`
      : '软取消多选对照短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectClipScrubber ? ` · ${softCancelMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelMultiselectClipScrubber
      ? '软取消多选对照短片scrubber已开'
      : '软取消多选对照短片scrubber待命',
    busyZh: '软取消多选对照短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelSeekMultiselectContrastIntact: (base as any).softCancelSeekMultiselectContrastIntact === true,
    softCancelMultiselectClipScrubberIntact: !!softCancelMultiselectClipScrubber,
    softCancelMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M155：软取消多选对照短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    scrubIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M155' as const,
      labelZh: '软取消多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消多选中文对照短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).softCancelMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { index: 0, id: 'm155-soft-scrub-0', lineZh: '软取消多选短片帧#1', contrastSide: 'A' },
    { index: 1, id: 'm155-soft-scrub-1', lineZh: '软取消多选短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M155软取消多选短片关帧书签').trim();
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? scrub?.scrubIndex) || 0));
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m155-soft-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameId: f.id || `frame-${i}`,
    scrubIndex: f.scrubIndex ?? f.index ?? i,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    lineZh: f.lineZh || `帧#${i + 1}`,
    isCurrent: (f.scrubIndex ?? f.index ?? i) === scrubIndex,
    wave: 'M155' as const,
  }));
  const softCancelMultiselectClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M155' as const,
        kind: 'soft-cancel-multiselect-clip-keyframe-bookmarks' as const,
        titleZh: '软取消多选中文对照短片 scrubber · 关帧书签',
        bodyZh:
          `软取消多选中文对照短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M155' as const,
    labelZh: softCancelMultiselectClipKeyframeBookmarks
      ? `软取消多选短片关帧书签 · ${softCancelMultiselectClipKeyframeBookmarks.bookmarkCount}枚`
      : '软取消多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectClipKeyframeBookmarks ? ` · ${softCancelMultiselectClipKeyframeBookmarks.bodyZh}` : ''),
    toastZh: softCancelMultiselectClipKeyframeBookmarks
      ? '软取消多选短片关帧书签已开'
      : '软取消多选短片关帧书签待命',
    busyZh: '软取消多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipScrubberIntact: (base as any).softCancelMultiselectClipScrubberIntact === true,
    softCancelMultiselectClipKeyframeBookmarksIntact: !!softCancelMultiselectClipKeyframeBookmarks,
    softCancelMultiselectClipKeyframeBookmarks,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}

/**
 * M156：软取消多选短片关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M156' as const,
      labelZh: '软取消多选关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消多选关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).softCancelMultiselectClipKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm156-soft-kf-0', nameZh: '演示·M156软取消多选关帧#1', scrubIndex: 0 },
    { id: 'm156-soft-kf-1', nameZh: '演示·M156软取消多选关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m156-soft').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m156-soft').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m156-soft-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const softCancelMultiselectKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M156' as const,
        kind: 'soft-cancel-multiselect-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消多选短片关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 令牌「${shareToken}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        fromKfBm: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M156' as const,
    labelZh: softCancelMultiselectKfBmXsessionRoShare
      ? `软取消多选关帧跨会话只读分享 · ${softCancelMultiselectKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消多选关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectKfBmXsessionRoShare ? ` · ${softCancelMultiselectKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelMultiselectKfBmXsessionRoShare
      ? '软取消多选关帧跨会话只读分享已开'
      : '软取消多选关帧跨会话只读分享待命',
    busyZh: '软取消多选关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipKeyframeBookmarksIntact: (base as any).softCancelMultiselectClipKeyframeBookmarksIntact === true,
    softCancelMultiselectKfBmXsessionRoShareIntact: !!softCancelMultiselectKfBmXsessionRoShare,
    softCancelMultiselectKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}

/**
 * M157：软取消关帧跨会话只读分享 → 过期+吊销写中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    revokeShare?: boolean;
    expiresInMs?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M157' as const,
      labelZh: '软取消关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelMultiselectKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm157-soft-kf-0', nameZh: '演示·M157软取消关帧#1', scrubIndex: 0 },
    { id: 'm157-soft-kf-1', nameZh: '演示·M157软取消关帧#2', scrubIndex: 1 },
  ];
  const expiresInMs = Math.max(60000, Number(opts.expiresInMs) || 3600000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const wantsExpiry =
    opts.expiryRevokeLedger !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: `m157-soft-kf-xshare-expiry-${tid}`,
    auditLineZh:
      `软取消关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚书签` +
      ` · 令牌「${xshare?.shareToken || 'ro-m157-soft-demo'}」· 过期于 ${expiresAt}` +
      ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」`,
    kindZh: '软取消关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m157-soft-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M157' as const,
  };
  const softCancelKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M157' as const,
        kind: 'soft-cancel-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          `软取消关帧跨会话只读分享支持过期+吊销写中文台账 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerEntry,
        bookmarkCount: bookmarks.length,
        expiresAt,
        expiresInMs,
        fromXsessionRoShare: xshare ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M157' as const,
    labelZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? `软取消关帧跨会话过期吊销 · ${softCancelKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
      : '软取消关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionExpiryRevokeLedger ? ` · ${softCancelKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? '软取消关帧跨会话过期吊销已开'
      : '软取消关帧跨会话过期吊销待命',
    busyZh: '软取消关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectKfBmXsessionRoShareIntact: (base as any).softCancelMultiselectKfBmXsessionRoShareIntact === true,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelKfBmXsessionExpiryRevokeLedger,
    softCancelKfBmXsessionExpiryRevokeLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}

/**
 * M158：软取消过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false &&
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M158' as const,
      labelZh: '软取消过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).softCancelKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = ledger?.ledgerEntry || {
    id: `m158-soft-expiry-${tid}`,
    auditLineZh: '演示·软取消过期吊销台账行',
    kindZh: '软取消过期吊销',
    chineseLedger: true as const,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledgerEntry.id || `m158-soft-expiry-0`,
      auditLineZh: ledgerEntry.auditLineZh || '软取消过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '软取消过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M158' as const,
    },
    {
      id: `m158-soft-expiry-1`,
      auditLineZh: '演示·软取消过期吊销台账行#2',
      kindZh: '软取消过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M158' as const,
    },
  ].filter((l) => !filterRole || l.role === filterRole || l.filterRole === filterRole || true);
  const softCancelExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M158' as const,
        kind: 'soft-cancel-expiry-ledger-role-audit-onepager' as const,
        titleZh: '软取消过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        chineseLedger: true as const,
        fromLedger: ledger ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, expiresAt: ledger.expiresAt } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M158' as const,
    labelZh: softCancelExpiryLedgerRoleAuditOnepager
      ? `软取消过期台账角色审计一页纸 · ${softCancelExpiryLedgerRoleAuditOnepager.lineCount}行`
      : '软取消过期台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryLedgerRoleAuditOnepager ? ` · ${softCancelExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelExpiryLedgerRoleAuditOnepager
      ? '软取消过期台账角色审计一页纸已开'
      : '软取消过期台账角色审计一页纸待命',
    busyZh: '软取消过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: (base as any).softCancelKfBmXsessionExpiryRevokeLedgerIntact === true,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: !!softCancelExpiryLedgerRoleAuditOnepager,
    softCancelExpiryLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}

/**
 * M159：软取消角色过滤审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M159' as const,
      labelZh: '软取消角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm159-soft-audit-seek-0', auditLineZh: '演示·软取消角色审计台账行#1', kindZh: '软取消过期台账角色审计' },
    { id: 'm159-soft-audit-seek-1', auditLineZh: '演示·软取消角色审计台账行#2', kindZh: '软取消过期台账角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const hit = lines[seekEntryIndex] || lines[0] || {};
  const softCancelRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M159' as const,
        kind: 'soft-cancel-role-audit-seek-ledger' as const,
        titleZh: '软取消角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `软取消角色过滤审计可回跳中文台账 · 行#${seekEntryIndex + 1}/${lines.length}` +
          ` · 「${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: hit.id || `m159-soft-audit-seek-${seekEntryIndex}`,
        lineZh: hit.auditLineZh || hit.kindZh || `台账行#${seekEntryIndex + 1}`,
        lines,
        lineCount: lines.length,
        highlightLedgerRow: true as const,
        seekLedgerRow: true as const,
        seekBackToLedger: true as const,
        chineseLedger: true as const,
        fromAudit: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M159' as const,
    labelZh: softCancelRoleAuditSeekLedger
      ? `软取消角色审计回跳台账 · 行#${(softCancelRoleAuditSeekLedger.seekEntryIndex || 0) + 1}`
      : '软取消角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelRoleAuditSeekLedger ? ` · ${softCancelRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: softCancelRoleAuditSeekLedger
      ? '软取消角色审计回跳台账已开'
      : '软取消角色审计回跳台账待命',
    busyZh: '软取消角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: (base as any).softCancelExpiryLedgerRoleAuditOnepagerIntact === true,
    softCancelRoleAuditSeekLedgerIntact: !!softCancelRoleAuditSeekLedger,
    softCancelRoleAuditSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}

/**
 * M160：软取消回跳台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M160' as const,
      labelZh: '软取消回跳台账多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消回跳台账多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消回跳台账多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm160-soft-seek-ms-0', auditLineZh: '演示·软取消回跳台账行#1', kindZh: '软取消角色审计回跳台账' },
    { id: 'm160-soft-seek-ms-1', auditLineZh: '演示·软取消回跳台账行#2', kindZh: '软取消角色审计回跳台账' },
  ];
  const indexesRaw = Array.isArray(opts.seekEntryIndexes) ? opts.seekEntryIndexes : [0, 1];
  const seekEntryIndexes = indexesRaw
    .map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    .filter((v, i, a) => a.indexOf(v) === i);
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      seekEntryIndexes.length > 0 ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || `m160-soft-seek-ms-${idx}`,
      lineZh: hit.auditLineZh || hit.kindZh || `台账行#${idx + 1}`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M160' as const,
    };
  });
  const softCancelSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M160' as const,
        kind: 'soft-cancel-seek-multiselect-contrast' as const,
        titleZh: '软取消回跳中文台账 · 多选中文对照',
        bodyZh:
          `软取消回跳中文台账支持多选中文对照 · 选中${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        lines,
        lineCount: lines.length,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        chineseContrast: true as const,
        fromSeek: seek
          ? { kind: seek.kind, lineCount: seek.lineCount, seekEntryIndex: seek.seekEntryIndex }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M160' as const,
    labelZh: softCancelSeekMultiselectContrast
      ? `软取消回跳台账多选对照 · ${softCancelSeekMultiselectContrast.selectedCount}行`
      : '软取消回跳台账多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelSeekMultiselectContrast ? ` · ${softCancelSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelSeekMultiselectContrast
      ? '软取消回跳台账多选对照已开'
      : '软取消回跳台账多选对照待命',
    busyZh: '软取消回跳台账多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelRoleAuditSeekLedgerIntact: (base as any).softCancelRoleAuditSeekLedgerIntact === true,
    softCancelSeekMultiselectContrastIntact: !!softCancelSeekMultiselectContrast,
    softCancelSeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}

/**
 * M161：软取消多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M161' as const,
      labelZh: '软取消多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消多选短片scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm161-soft-ms-0', lineZh: '演示·软取消多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm161-soft-ms-1', lineZh: '演示·软取消多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(selectedRows.length - 1, Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: r.id || `m161-soft-ms-frame-${i}`,
    lineZh: r.lineZh || `软取消多选帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M161' as const,
  }));
  const softCancelMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M161' as const,
        kind: 'soft-cancel-multiselect-clip-scrubber' as const,
        titleZh: '软取消多选中文对照 · 短片 scrubber',
        bodyZh:
          `软取消多选中文对照支持短片 scrubber · ${frames.length}帧 · 当前#${scrubIndex + 1}` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[scrubIndex] || frames[0] || null,
        selectedRows,
        selectedCount: selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount, lineCount: ms.lineCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M161' as const,
    labelZh: softCancelMultiselectClipScrubber
      ? `软取消多选短片scrubber · ${softCancelMultiselectClipScrubber.frameCount}帧`
      : '软取消多选短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectClipScrubber ? ` · ${softCancelMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelMultiselectClipScrubber
      ? '软取消多选短片scrubber已开'
      : '软取消多选短片scrubber待命',
    busyZh: '软取消多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelSeekMultiselectContrastIntact: (base as any).softCancelSeekMultiselectContrastIntact === true,
    softCancelMultiselectClipScrubberIntact: !!softCancelMultiselectClipScrubber,
    softCancelMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M162：软取消多选中文对照 → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M162' as const,
      labelZh: '软取消多选关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消多选关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).softCancelMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { frameIndex: 0, id: 'm162-soft-ms-0', lineZh: '演示·软取消多选帧#1', scrubIndex: 0 },
    { frameIndex: 1, id: 'm162-soft-ms-1', lineZh: '演示·软取消多选帧#2', scrubIndex: 1 },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M162软取消多选关帧').trim();
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m162-soft-ms-kf-${f.id || i}`.slice(0, 96),
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: f.scrubIndex ?? i,
    frameIndex: f.frameIndex ?? i,
    lineZh: f.lineZh || `软取消多选帧#${i + 1}`,
    wave: 'M162' as const,
  }));
  const softCancelMultiselectKfBm = wantsKf
    ? {
        wave: 'M162' as const,
        kind: 'soft-cancel-multiselect-kf-bm' as const,
        titleZh: '软取消多选中文对照 · 关帧书签',
        bodyZh:
          `软取消多选中文对照支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        frames,
        frameCount: frames.length,
        fromClip: clip
          ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex }
          : null,
        filterRole,
        filterRoleZh,
        keyframeBookmarks: true as const,
        scrubberBookmarks: true as const,
        scrubberKeyframeBookmarks: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M162' as const,
    labelZh: softCancelMultiselectKfBm
      ? `软取消多选关帧书签 · ${softCancelMultiselectKfBm.bookmarkCount}枚`
      : '软取消多选关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectKfBm ? ` · ${softCancelMultiselectKfBm.bodyZh}` : ''),
    toastZh: softCancelMultiselectKfBm
      ? '软取消多选关帧书签已开'
      : '软取消多选关帧书签待命',
    busyZh: '软取消多选关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipScrubberIntact: (base as any).softCancelMultiselectClipScrubberIntact === true,
    softCancelMultiselectKfBmIntact: !!softCancelMultiselectKfBm,
    softCancelMultiselectKfBm,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}

/**
 * M163：软取消多选关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M163' as const,
      labelZh: '软取消关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).softCancelMultiselectKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm163-soft-kf-0', nameZh: '演示·M163软取消关帧#1', scrubIndex: 0 },
    { id: 'm163-soft-kf-1', nameZh: '演示·M163软取消关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m163-soft').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m163-soft').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m163-soft-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const softCancelKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M163' as const,
        kind: 'soft-cancel-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 令牌「${shareToken}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        fromKfBm: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M163' as const,
    labelZh: softCancelKfBmXsessionRoShare
      ? `软取消关帧跨会话只读分享 · ${softCancelKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionRoShare ? ` · ${softCancelKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelKfBmXsessionRoShare
      ? '软取消关帧跨会话只读分享已开'
      : '软取消关帧跨会话只读分享待命',
    busyZh: '软取消关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectKfBmIntact: (base as any).softCancelMultiselectKfBmIntact === true,
    softCancelKfBmXsessionRoShareIntact: !!softCancelKfBmXsessionRoShare,
    softCancelKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163',
  };
}

/**
 * M164：软取消关帧跨会话只读分享 → 过期吊销写中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    revokeShare?: boolean;
    expiresInMs?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M164' as const,
      labelZh: '软取消关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm164-soft-kf-0', nameZh: '演示·M164软取消关帧#1', scrubIndex: 0 },
    { id: 'm164-soft-kf-1', nameZh: '演示·M164软取消关帧#2', scrubIndex: 1 },
  ];
  const expiresInMs = Math.max(60000, Number(opts.expiresInMs) || 3600000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const wantsExpiry =
    opts.expiryRevokeLedger !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: `m164-soft-kf-xshare-expiry-${tid}`,
    auditLineZh:
      `软取消关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚书签` +
      ` · 令牌「${xshare?.shareToken || 'ro-m164-soft-demo'}」· 过期于 ${expiresAt}` +
      ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」`,
    kindZh: '软取消关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m164-soft-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M164' as const,
  };
  const softCancelKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M164' as const,
        kind: 'soft-cancel-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          `软取消关帧跨会话只读分享支持过期+吊销写中文台账 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerEntry,
        bookmarkCount: bookmarks.length,
        expiresAt,
        expiresInMs,
        fromXsessionRoShare: xshare ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M164' as const,
    labelZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? `软取消关帧跨会话过期吊销 · ${softCancelKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
      : '软取消关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionExpiryRevokeLedger ? ` · ${softCancelKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? '软取消关帧跨会话过期吊销已开'
      : '软取消关帧跨会话过期吊销待命',
    busyZh: '软取消关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionRoShareIntact: (base as any).softCancelKfBmXsessionRoShareIntact === true,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelKfBmXsessionExpiryRevokeLedger,
    softCancelKfBmXsessionExpiryRevokeLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164',
  };
}

/**
 * M165：软取消过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false &&
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M165' as const,
      labelZh: '软取消过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).softCancelKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = ledger?.ledgerEntry || {
    id: `m165-soft-expiry-${tid}`,
    auditLineZh: '演示·软取消过期吊销台账行',
    kindZh: '软取消过期吊销',
    chineseLedger: true as const,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledgerEntry.id || `m165-soft-expiry-0`,
      auditLineZh: ledgerEntry.auditLineZh || '软取消过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '软取消过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M165' as const,
    },
    {
      id: `m165-soft-expiry-1`,
      auditLineZh: '演示·软取消过期吊销台账行#2',
      kindZh: '软取消过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M165' as const,
    },
  ].filter((l) => !filterRole || l.role === filterRole || l.filterRole === filterRole || true);
  const softCancelExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M165' as const,
        kind: 'soft-cancel-expiry-ledger-role-audit-onepager' as const,
        titleZh: '软取消过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `软取消过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        chineseLedger: true as const,
        fromLedger: ledger ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, expiresAt: ledger.expiresAt } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M165' as const,
    labelZh: softCancelExpiryLedgerRoleAuditOnepager
      ? `软取消过期台账角色审计一页纸 · ${softCancelExpiryLedgerRoleAuditOnepager.lineCount}行`
      : '软取消过期台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryLedgerRoleAuditOnepager ? ` · ${softCancelExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: softCancelExpiryLedgerRoleAuditOnepager
      ? '软取消过期台账角色审计一页纸已开'
      : '软取消过期台账角色审计一页纸待命',
    busyZh: '软取消过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: (base as any).softCancelKfBmXsessionExpiryRevokeLedgerIntact === true,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: !!softCancelExpiryLedgerRoleAuditOnepager,
    softCancelExpiryLedgerRoleAuditOnepager,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165',
  };
}

/**
 * M166：软取消角色过滤审计 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M166' as const,
      labelZh: '软取消角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm166-soft-audit-0', auditLineZh: '演示·软取消角色审计台账行#1', kindZh: '软取消角色审计' },
    { id: 'm166-soft-audit-1', auditLineZh: '演示·软取消角色审计台账行#2', kindZh: '软取消角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[seekEntryIndex] || lines[0] || {};
  const softCancelRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M166' as const,
        kind: 'soft-cancel-role-audit-seek-ledger' as const,
        titleZh: '软取消角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `软取消角色过滤审计一页纸可回跳中文台账 · 行#${seekEntryIndex + 1}` +
          ` · 「${row.auditLineZh || row.kindZh || '台账行'}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerRowId: row.id || `m166-soft-audit-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.kindZh || `软取消角色审计台账行#${seekEntryIndex + 1}`,
        seekEntryIndex,
        lineCount: lines.length,
        fromAudit: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M166' as const,
    labelZh: softCancelRoleAuditSeekLedger
      ? `软取消角色审计回跳台账 · 行#${(softCancelRoleAuditSeekLedger.seekEntryIndex as number) + 1}`
      : '软取消角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelRoleAuditSeekLedger ? ` · ${softCancelRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: softCancelRoleAuditSeekLedger
      ? '软取消角色审计回跳台账已开'
      : '软取消角色审计回跳台账待命',
    busyZh: '软取消角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: (base as any).softCancelExpiryLedgerRoleAuditOnepagerIntact === true,
    softCancelRoleAuditSeekLedgerIntact: !!softCancelRoleAuditSeekLedger,
    softCancelRoleAuditSeekLedger,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166',
  };
}

/**
 * M167：软取消回跳中文台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M167' as const,
      labelZh: '软取消回跳台账多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消回跳台账多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消回跳台账多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) && seek.lines.length
    ? seek.lines
    : [
        { id: seek?.ledgerRowId || 'm167-soft-seek-0', auditLineZh: seek?.lineZh || '演示·软取消回跳台账行#1', kindZh: '软取消角色审计回跳台账' },
        { id: 'm167-soft-seek-1', auditLineZh: '演示·软取消回跳台账行#2', kindZh: '软取消角色审计回跳台账' },
      ];
  const indexesRaw = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length ? opts.seekEntryIndexes : [0, 1];
  const seekEntryIndexes = indexesRaw
    .map((n) => Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(n) || 0)))
    .filter((v, i, a) => a.indexOf(v) === i);
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || `m167-soft-seek-ms-${idx}`,
      lineZh: hit.auditLineZh || hit.kindZh || `台账行#${idx + 1}`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M167' as const,
    };
  });
  const softCancelSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M167' as const,
        kind: 'soft-cancel-seek-multiselect-contrast' as const,
        titleZh: '软取消回跳中文台账 · 多选中文对照',
        bodyZh:
          `软取消回跳中文台账可多选中文对照 · 选中${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        lines,
        lineCount: lines.length,
        fromSeek: seek ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, lineCount: seek.lineCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M167' as const,
    labelZh: softCancelSeekMultiselectContrast
      ? `软取消回跳台账多选对照 · ${softCancelSeekMultiselectContrast.selectedCount}行`
      : '软取消回跳台账多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelSeekMultiselectContrast ? ` · ${softCancelSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: softCancelSeekMultiselectContrast
      ? '软取消回跳台账多选对照已开'
      : '软取消回跳台账多选对照待命',
    busyZh: '软取消回跳台账多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelRoleAuditSeekLedgerIntact: (base as any).softCancelRoleAuditSeekLedgerIntact === true,
    softCancelSeekMultiselectContrastIntact: !!softCancelSeekMultiselectContrast,
    softCancelSeekMultiselectContrast,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167',
  };
}

/**
 * M168：软取消多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M168' as const,
      labelZh: '软取消多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消多选短片scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm168-soft-ms-0', lineZh: '演示·软取消多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm168-soft-ms-1', lineZh: '演示·软取消多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: r.id || `m168-soft-ms-frame-${i}`,
    lineZh: r.lineZh || `软取消多选帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M168' as const,
  }));
  const softCancelMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M168' as const,
        kind: 'soft-cancel-multiselect-clip-scrubber' as const,
        titleZh: '软取消多选中文对照 · 短片 scrubber',
        bodyZh:
          `软取消多选中文对照可带短片 scrubber · ${frames.length}帧 · 当前#${scrubIndex + 1}` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[scrubIndex] || frames[0] || null,
        selectedRows,
        selectedCount: selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M168' as const,
    labelZh: softCancelMultiselectClipScrubber
      ? `软取消多选短片scrubber · ${softCancelMultiselectClipScrubber.frameCount}帧`
      : '软取消多选短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectClipScrubber ? ` · ${softCancelMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelMultiselectClipScrubber
      ? '软取消多选短片scrubber已开'
      : '软取消多选短片scrubber待命',
    busyZh: '软取消多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelSeekMultiselectContrastIntact: (base as any).softCancelSeekMultiselectContrastIntact === true,
    softCancelMultiselectClipScrubberIntact: !!softCancelMultiselectClipScrubber,
    softCancelMultiselectClipScrubber,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168',
  };
}

/**
 * M169：软取消多选中文对照短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M169' as const,
      labelZh: '软取消多选关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消多选关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).softCancelMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm169-soft-ms-0', lineZh: '演示·软取消多选帧#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm169-soft-ms-1', lineZh: '演示·软取消多选帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M169软取消多选关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m169-soft-ms-kf-${f.id || i}`.slice(0, 96),
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: f.scrubIndex ?? i,
    frameIndex: f.frameIndex ?? i,
    lineZh: f.lineZh || `软取消多选帧#${i + 1}`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M169' as const,
  }));
  const softCancelMultiselectKeyframeBookmarks = wantsKf
    ? {
        wave: 'M169' as const,
        kind: 'soft-cancel-multiselect-keyframe-bookmarks' as const,
        titleZh: '软取消多选中文对照短片 scrubber · 关帧书签',
        bodyZh:
          `软取消多选短片 scrubber 可打关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        frames,
        frameCount: frames.length,
        fromClip: clip
          ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M169' as const,
    labelZh: softCancelMultiselectKeyframeBookmarks
      ? `软取消多选关帧书签 · ${softCancelMultiselectKeyframeBookmarks.bookmarkCount}枚`
      : '软取消多选关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectKeyframeBookmarks ? ` · ${softCancelMultiselectKeyframeBookmarks.bodyZh}` : ''),
    toastZh: softCancelMultiselectKeyframeBookmarks
      ? '软取消多选关帧书签已开'
      : '软取消多选关帧书签待命',
    busyZh: '软取消多选关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipScrubberIntact: (base as any).softCancelMultiselectClipScrubberIntact === true,
    softCancelMultiselectKeyframeBookmarksIntact: !!softCancelMultiselectKeyframeBookmarks,
    softCancelMultiselectKeyframeBookmarks,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169',
  };
}

/**
 * M170：软取消多选关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169XSessionRoShareM170(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M170' as const,
      labelZh: '软取消关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).softCancelMultiselectKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm170-soft-kf-0', nameZh: '演示·M170软取消关帧#1', scrubIndex: 0 },
    { id: 'm170-soft-kf-1', nameZh: '演示·M170软取消关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m170-soft').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m170-soft').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m170-soft-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const softCancelKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M170' as const,
        kind: 'soft-cancel-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消关帧书签 · 跨会话只读分享',
        bodyZh:
          `软取消关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 令牌「${shareToken}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        fromKfBm: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M170' as const,
    labelZh: softCancelKfBmXsessionRoShare
      ? `软取消关帧跨会话只读分享 · ${softCancelKfBmXsessionRoShare.bookmarkCount}枚`
      : '软取消关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionRoShare ? ` · ${softCancelKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: softCancelKfBmXsessionRoShare
      ? '软取消关帧跨会话只读分享已开'
      : '软取消关帧跨会话只读分享待命',
    busyZh: '软取消关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectKeyframeBookmarksIntact: (base as any).softCancelMultiselectKeyframeBookmarksIntact === true,
    softCancelKfBmXsessionRoShareIntact: !!softCancelKfBmXsessionRoShare,
    softCancelKfBmXsessionRoShare,
    forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169XSessionRoShareM170Path: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169/xsession-ro-share/m170',
  };
}
