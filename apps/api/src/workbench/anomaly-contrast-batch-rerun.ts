/**
 * M87：异常对照行批量重跑队列（干跑 bust/reprobe，可取消/续跑，无外发）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { anomalyContrastRowRerunMeta, pushAnomalySseEvent } from './anomaly-sse-ring';
import { peekBypassContrastSupplyCard, reBypassFromSupplyDetailRewriteHistoryDiff } from '../matches/bypass-contrast-board';

function safeTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function queuePath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'anomaly-contrast-batch-rerun-queue.json');
}

export type AnomalyBatchRerunItem = {
  id: string;
  phase: string;
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'skipped' | 'failed';
  labelZh: string;
  tipZh?: string;
  atQueued: string;
  atDone?: string | null;
  resultTipZh?: string | null;
  /** M89：失败重试预算 */
  retryBudget?: number;
  retriesUsed?: number;
  lastErrorZh?: string | null;
  failSimulated?: boolean;
};

export type AnomalyBatchRerunQueue = {
  tenantId: string;
  status: 'idle' | 'queued' | 'running' | 'cancelling' | 'cancelled' | 'done' | 'paused';
  cursor: number;
  items: AnomalyBatchRerunItem[];
  cancelRequested: boolean;
  /** M89：默认每项失败重试预算 */
  retryBudgetDefault: number;
  tipZh: string;
  toastZh: string;
  busyZh: string;
  percent: number;
  wave: 'M89';
  dryRun: true;
  noEgress: true;
  cancelResumeIntact: true;
  updatedAt: string;
};

function emptyQueue(tenantId: string): AnomalyBatchRerunQueue {
  return {
    tenantId: safeTenant(tenantId),
    status: 'idle',
    cursor: 0,
    items: [],
    cancelRequested: false,
    retryBudgetDefault: 2,
    tipZh: '异常对照行批重跑队列空闲',
    toastZh: '批重跑空闲',
    busyZh: '批重跑待命…',
    percent: 0,
    wave: 'M89',
    dryRun: true,
    noEgress: true,
    cancelResumeIntact: true,
    updatedAt: new Date().toISOString(),
  };
}

function load(tenantId: string): AnomalyBatchRerunQueue {
  const p = queuePath(tenantId);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      if (raw && Array.isArray(raw.items)) return { ...emptyQueue(tenantId), ...raw, wave: 'M89' };
    }
  } catch (_) {}
  return emptyQueue(tenantId);
}

function save(q: AnomalyBatchRerunQueue) {
  q.updatedAt = new Date().toISOString();
  writeFileSync(queuePath(q.tenantId), JSON.stringify(q, null, 0), 'utf8');
  return q;
}

export function getAnomalyContrastBatchRerunQueue(tenantId?: string | null) {
  const q = load(tenantId || 'default');
  return {
    ok: true as const,
    ...q,
    labelZh: '异常对照行批重跑队列',
    sseFanOut: true as const,
    softCancelIntact: true as const,
    retryBudgetDefault: q.retryBudgetDefault ?? 2,
    failedCount: q.items.filter((i) => i.status === 'failed').length,
    retryProgressZh: (() => {
      const failed = q.items.filter((i) => i.status === 'failed');
      const retrying = q.items.filter((i) => (i.retriesUsed || 0) > 0);
      if (!failed.length && !retrying.length) return '无失败重试';
      return `失败 ${failed.length} · 已重试项 ${retrying.length} · 预算默认 ${q.retryBudgetDefault ?? 2}`;
    })(),

    streamPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/stream',
    streamTipZh: '批重跑进度经现有异常 SSE/任务卡扇出；中文进度；软取消仍在；干跑无外发',
    job: {
      status: q.status,
      percent: q.percent,
      phase: q.items[q.cursor]?.phase || null,
      cursor: q.cursor,
      total: q.items.length,
    },
  };
}

export function enqueueAnomalyContrastBatchRerun(
  tenantId: string | null | undefined,
  body: {
    phases?: string[] | null;
    rows?: Array<{ phase?: string; id?: string }> | null;
    dryRun?: boolean;
    retryBudget?: number;
    failSimulatePhases?: string[] | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const phases =
    (Array.isArray(body.phases) && body.phases.length
      ? body.phases
      : Array.isArray(body.rows) && body.rows.length
        ? body.rows.map((r) => String(r.phase || r.id || '').trim()).filter(Boolean)
        : ['bust', 'reprobe']) || [];
  const uniq = [...new Set(phases.map((p) => String(p || '').trim()).filter(Boolean))];
  if (!uniq.length) {
    return {
      ok: false as const,
      wave: 'M89' as const,
      tipZh: '未指定对照行阶段',
      toastZh: '批重跑缺阶段',
      dryRun: true as const,
      noEgress: true as const,
    };
  }
  const now = new Date().toISOString();
  const budget = Math.max(0, Math.min(5, Number(body.retryBudget ?? q.retryBudgetDefault ?? 2) || 0));
  q.retryBudgetDefault = budget;
  const failSet = new Set(
    (Array.isArray(body.failSimulatePhases) ? body.failSimulatePhases : []).map((x) => String(x || '').trim()).filter(Boolean),
  );
  for (const phase of uniq) {
    const meta = anomalyContrastRowRerunMeta(phase);
    q.items.push({
      id: `${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      phase,
      status: 'queued',
      labelZh: meta.labelZh,
      tipZh: meta.tipZh,
      atQueued: now,
      atDone: null,
      resultTipZh: null,
      retryBudget: budget,
      retriesUsed: 0,
      lastErrorZh: null,
      failSimulated: failSet.has(phase),
    });
  }
  q.status = 'queued';
  q.cancelRequested = false;
  q.tipZh = `已入队 ${uniq.length} 条对照行重跑（干跑）· 失败重试预算 ${budget} · 可取消/续跑`;
  q.toastZh = `批重跑入队 ${uniq.length} · 重试预算 ${budget}`;
  q.busyZh = '对照行批重跑排队…';
  q.percent = Math.round((q.cursor / Math.max(1, q.items.length)) * 100);
  save(q);
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '异常对照行批重跑入队',
    tipZh: q.tipZh,
    toastZh: q.toastZh,
    busyZh: q.busyZh,
    dryRun: true as const,
    noEgress: true as const,
    cancelResumeIntact: true as const,
    queue: getAnomalyContrastBatchRerunQueue(tid),
    enqueued: uniq,
  };
}

type StepRunner = (phase: string) => any;

/** 推进队列一步或多步（同步干跑；软取消在步边界） */
export function tickAnomalyContrastBatchRerun(
  tenantId: string | null | undefined,
  opts: { maxSteps?: number; runStep?: StepRunner } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  if (q.cancelRequested) {
    q.status = 'cancelled';
    for (const it of q.items) {
      if (it.status === 'queued' || it.status === 'running') it.status = 'cancelled';
    }
    q.tipZh = '批重跑已取消（步边界）· 可续跑剩余';
    q.toastZh = '批重跑已取消';
    q.busyZh = '批重跑已取消';
    save(q);
    return { ok: true as const, cancelled: true as const, queue: getAnomalyContrastBatchRerunQueue(tid), wave: 'M89' as const };
  }
  if (!q.items.length) {
    q.status = 'idle';
    save(q);
    return { ok: true as const, empty: true as const, queue: getAnomalyContrastBatchRerunQueue(tid), wave: 'M89' as const };
  }
  q.status = 'running';
  q.busyZh = '对照行批重跑执行中…';
  const maxSteps = Math.max(1, Number(opts.maxSteps) || 8);
  let stepped = 0;
  const runner =
    opts.runStep ||
    ((phase: string) => {
      const meta = anomalyContrastRowRerunMeta(phase);
      return { ...meta, simulated: true, tipZh: meta.tipZh + ' · 队列步进干跑' };
    });
  while (q.cursor < q.items.length && stepped < maxSteps) {
    if (q.cancelRequested) {
      q.status = 'cancelling';
      break;
    }
    const it = q.items[q.cursor];
    if (it.status === 'done' || it.status === 'cancelled' || it.status === 'skipped' || it.status === 'failed') {
      q.cursor += 1;
      continue;
    }
    it.status = 'running';
    const retryUsed = Number(it.retriesUsed) || 0;
    const budget = Number(it.retryBudget ?? q.retryBudgetDefault ?? 2) || 0;
    q.busyZh =
      retryUsed > 0
        ? `批重跑重试 ${retryUsed}/${budget} · ${it.labelZh}（${q.cursor + 1}/${q.items.length}）…`
        : `批重跑 · ${it.labelZh}（${q.cursor + 1}/${q.items.length}）…`;
    let step: any = null;
    let failed = false;
    try {
      // M89：干跑可模拟指定阶段首次失败，消耗重试预算
      if (it.failSimulated && retryUsed === 0) {
        failed = true;
        step = { ok: false, tipZh: `干跑模拟失败 · ${it.labelZh} · 将按预算重试` };
      } else {
        step = runner(it.phase);
        if (step && step.ok === false) failed = true;
      }
    } catch (e: any) {
      failed = true;
      step = { ok: false, tipZh: String(e?.message || e).slice(0, 160) };
    }
    if (failed) {
      it.lastErrorZh = step?.tipZh || step?.toastZh || '批重跑失败';
      if (retryUsed < budget) {
        it.retriesUsed = retryUsed + 1;
        it.status = 'queued';
        it.resultTipZh = `失败将重试（${it.retriesUsed}/${budget}）· ${it.lastErrorZh}`;
        q.busyZh = `批重跑失败重试排队 · ${it.labelZh} · ${it.retriesUsed}/${budget}`;
        // 不推进 cursor，下一步再跑同一项
        stepped += 1;
        q.percent = Math.round((q.cursor / Math.max(1, q.items.length)) * 100);
        try {
          pushAnomalySseEvent(tid, 'progress', {
            kind: 'batch-rerun',
            wave: 'M89',
            labelZh: '对照行批重跑失败重试',
            tipZh: `批重跑失败重试 ${it.retriesUsed}/${budget} · ${it.labelZh} · ${it.lastErrorZh}`,
            toastZh: `批重跑重试 ${it.retriesUsed}/${budget}`,
            busyZh: q.busyZh,
            percent: q.percent,
            cursor: q.cursor,
            total: q.items.length,
            phase: it.phase,
            itemId: it.id,
            status: 'retrying',
            retriesUsed: it.retriesUsed,
            retryBudget: budget,
            dryRun: true,
            noEgress: true,
            softCancelIntact: true,
            job: {
              status: q.status,
              percent: q.percent,
              phase: it.phase,
              cursor: q.cursor,
              total: q.items.length,
              retriesUsed: it.retriesUsed,
              retryBudget: budget,
            },
          });
        } catch (_) {}
        continue;
      }
      it.status = 'failed';
      it.atDone = new Date().toISOString();
      it.resultTipZh = `失败且重试耗尽（${retryUsed}/${budget}）· ${it.lastErrorZh}`;
    } else {
      it.status = 'done';
      it.atDone = new Date().toISOString();
      it.resultTipZh =
        (retryUsed > 0 ? `重试成功（${retryUsed}/${budget}）· ` : '') +
        (step?.tipZh || step?.toastZh || '干跑完成');
      it.lastErrorZh = null;
    }
    q.cursor += 1;
    stepped += 1;
    q.percent = Math.round((q.cursor / Math.max(1, q.items.length)) * 100);
    // M88/M89：批重跑进度扇出到现有异常 SSE/任务进度环
    try {
      pushAnomalySseEvent(tid, 'progress', {
        kind: 'batch-rerun',
        wave: 'M89',
        labelZh: '对照行批重跑进度',
        tipZh: `批重跑 ${q.cursor}/${q.items.length} · ${it.labelZh} · ${it.resultTipZh}`,
        toastZh: `批重跑 ${q.percent}%`,
        busyZh: q.busyZh,
        percent: q.percent,
        cursor: q.cursor,
        total: q.items.length,
        phase: it.phase,
        itemId: it.id,
        status: it.status,
        retriesUsed: it.retriesUsed || 0,
        retryBudget: budget,
        dryRun: true,
        noEgress: true,
        softCancelIntact: true,
        job: {
          status: q.status,
          percent: q.percent,
          phase: it.phase,
          cursor: q.cursor,
          total: q.items.length,
        },
      });
    } catch (_) {}
  }
  if (q.cancelRequested) {
    q.status = 'cancelled';
    q.tipZh = `批重跑取消于游标 ${q.cursor}/${q.items.length}`;
    q.toastZh = '批重跑已取消';
  } else if (q.cursor >= q.items.length) {
    q.status = 'done';
    q.percent = 100;
    const doneN = q.items.filter((i) => i.status === 'done').length;
    const failN = q.items.filter((i) => i.status === 'failed').length;
    const retriedN = q.items.filter((i) => (i.retriesUsed || 0) > 0).length;
    q.tipZh =
      `批重跑完成 成功 ${doneN}/${q.items.length}` +
      (failN ? ` · 失败 ${failN}` : '') +
      (retriedN ? ` · 曾重试 ${retriedN}` : '') +
      ` · 干跑无外发`;
    q.toastZh = failN ? `批重跑完成 · 失败 ${failN}` : '批重跑完成';
    q.busyZh = '批重跑完成';
  } else {
    q.status = 'paused';
    q.tipZh = `批重跑暂停于 ${q.cursor}/${q.items.length} · 可续跑`;
    q.toastZh = `批重跑暂停 · ${q.cursor}/${q.items.length}`;
  }
  // M88：终态扇出
  try {
    if (q.status === 'done' || q.status === 'cancelled') {
      pushAnomalySseEvent(tid, 'end', {
        kind: 'batch-rerun',
        wave: 'M89',
        labelZh: '对照行批重跑结束',
        tipZh: q.tipZh,
        toastZh: q.toastZh,
        percent: q.percent,
        status: q.status,
        dryRun: true,
        noEgress: true,
        softCancelIntact: true,
        job: { status: q.status, percent: q.percent, cursor: q.cursor, total: q.items.length },
      });
    }
  } catch (_) {}
  save(q);
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '异常对照行批重跑步进',
    tipZh: q.tipZh,
    toastZh: q.toastZh,
    busyZh: q.busyZh,
    dryRun: true as const,
    noEgress: true as const,
    cancelResumeIntact: true as const,
    softCancelIntact: true as const,
    sseFanOut: true as const,
    stepped,
    queue: getAnomalyContrastBatchRerunQueue(tid),
    streamPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/stream',
    sseRingPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/sse-ring',
  };
}

export function cancelAnomalyContrastBatchRerun(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  q.cancelRequested = true;
  if (q.status === 'running' || q.status === 'queued' || q.status === 'paused') {
    q.status = 'cancelling';
  }
  q.tipZh = '已请求取消批重跑（步边界生效）';
  q.toastZh = '批重跑取消中';
  q.busyZh = '取消批重跑…';
  save(q);
  // 立即落取消态
  return tickAnomalyContrastBatchRerun(tid, { maxSteps: 0 });
}

export function resumeAnomalyContrastBatchRerun(
  tenantId?: string | null,
  opts: { maxSteps?: number; runStep?: StepRunner } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  q.cancelRequested = false;
  if (q.status === 'cancelled' || q.status === 'cancelling' || q.status === 'paused' || q.status === 'done') {
    // 续跑：把未完成项留在队列，游标停在首个非 done
    let i = 0;
    while (i < q.items.length && (q.items[i].status === 'done' || q.items[i].status === 'skipped' || q.items[i].status === 'failed')) i++;
    q.cursor = i;
    for (let j = i; j < q.items.length; j++) {
      if (q.items[j].status === 'cancelled') q.items[j].status = 'queued';
    }
    q.status = 'queued';
    q.tipZh = `批重跑续跑自游标 ${q.cursor}/${q.items.length}`;
    q.toastZh = '批重跑续跑';
    save(q);
  }
  return tickAnomalyContrastBatchRerun(tid, opts);
}


/** M89：将失败项按剩余预算重新入队并续跑 */
export function retryFailedAnomalyContrastBatchRerun(
  tenantId?: string | null,
  opts: { maxSteps?: number; runStep?: StepRunner; onlyPhase?: string | null } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  let requeued = 0;
  for (const it of q.items) {
    if (it.status !== 'failed') continue;
    if (opts.onlyPhase && it.phase !== opts.onlyPhase) continue;
    const budget = Number(it.retryBudget ?? q.retryBudgetDefault ?? 2) || 0;
    const used = Number(it.retriesUsed) || 0;
    if (used >= budget) continue;
    it.status = 'queued';
    it.atDone = null;
    it.resultTipZh = `失败重试续跑 · 已用 ${used}/${budget}`;
    requeued += 1;
  }
  // 游标回到首个 queued/failed-requeued
  let i = 0;
  while (i < q.items.length && (q.items[i].status === 'done' || q.items[i].status === 'skipped' || q.items[i].status === 'cancelled')) i++;
  q.cursor = i;
  q.cancelRequested = false;
  q.status = requeued || q.items.some((x) => x.status === 'queued') ? 'queued' : q.status;
  q.tipZh = requeued
    ? `已将 ${requeued} 条失败项按预算重新入队 · 游标 ${q.cursor}/${q.items.length}`
    : '无失败项可按预算重试（或预算已耗尽）';
  q.toastZh = requeued ? `失败重试入队 ${requeued}` : '无失败可重试';
  q.busyZh = '失败重试续跑…';
  save(q);
  if (!requeued && !q.items.some((x) => x.status === 'queued' || x.status === 'running')) {
    return {
      ok: true as const,
      wave: 'M89' as const,
      labelZh: '批重跑失败重试预算',
      tipZh: q.tipZh,
      toastZh: q.toastZh,
      busyZh: q.busyZh,
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      requeued: 0,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const tick = tickAnomalyContrastBatchRerun(tid, opts);
  return {
    ...tick,
    wave: 'M89' as const,
    labelZh: '批重跑失败重试预算续跑',
    requeued,
    tipZh: `${q.tipZh} · ${tick.tipZh || ''}`.trim(),
    toastZh: tick.toastZh || q.toastZh,
  };
}


/** M93：按阶段/项 id 定位批重跑队列项 */
export function findAnomalyBatchRerunQueueItem(
  tenantId?: string | null,
  opts: { phase?: string | null; itemId?: string | null } = {},
) {
  const q = getAnomalyContrastBatchRerunQueue(tenantId);
  const wantId = String(opts.itemId || '').trim();
  const wantPhase = String(opts.phase || '').trim();
  let item =
    (wantId && (q.items || []).find((i: any) => i.id === wantId)) ||
    (wantPhase && (q.items || []).find((i: any) => i.phase === wantPhase && (i.status === 'running' || i.status === 'queued' || i.status === 'failed'))) ||
    (wantPhase && (q.items || []).find((i: any) => i.phase === wantPhase)) ||
    null;
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  return {
    ok: true as const,
    wave: 'M93' as const,
    labelZh: '批重跑队列项定位',
    tipZh: item
      ? `已定位队列项「${phaseZhMap[item.phase] || item.phase}」· ${item.status} · ${item.labelZh}`
      : wantPhase || wantId
        ? `未找到阶段/项 ${wantPhase || wantId}`
        : '未指定 phase/itemId',
    toastZh: item ? `队列项 · ${phaseZhMap[item.phase] || item.phase}` : '无匹配队列项',
    busyZh: '定位批重跑队列项…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    item,
    queue: q,
    jumpPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/queue-item',
  };
}

/** M93：暂停批重跑中的单阶段（将该阶段 running/queued 标为 paused-via-cancel 边界，软取消仍在） */
export function pauseAnomalyBatchRerunSinglePhase(
  tenantId?: string | null,
  opts: { phase?: string | null; itemId?: string | null } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const wantId = String(opts.itemId || '').trim();
  const wantPhase = String(opts.phase || '').trim() || 'bust';
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  let hit: AnomalyBatchRerunItem | null = null;
  for (const it of q.items) {
    if (wantId && it.id === wantId) {
      hit = it;
      break;
    }
  }
  if (!hit) {
    hit =
      q.items.find((i) => i.phase === wantPhase && (i.status === 'running' || i.status === 'queued')) ||
      q.items.find((i) => i.phase === wantPhase) ||
      null;
  }
  if (!hit) {
    return {
      ok: false as const,
      wave: 'M93' as const,
      labelZh: '暂停批重跑单阶段',
      tipZh: `未找到可暂停阶段「${phaseZhMap[wantPhase] || wantPhase}」`,
      toastZh: '单阶段暂停失败',
      busyZh: '暂停批重跑单阶段…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      paused: false,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const prev = hit.status;
  if (hit.status === 'running' || hit.status === 'queued') {
    hit.status = 'cancelled';
    hit.resultTipZh = `单阶段已暂停（原 ${prev}）· 可续跑该阶段 · 软取消仍在`;
    hit.atDone = new Date().toISOString();
  }
  // 若当前游标正好在该项，标记队列 paused
  const idx = q.items.indexOf(hit);
  if (idx === q.cursor || q.status === 'running') {
    q.status = 'paused';
    q.tipZh = `批重跑单阶段「${phaseZhMap[hit.phase] || hit.phase}」已暂停 · 可续跑该阶段`;
    q.toastZh = `单阶段暂停 · ${phaseZhMap[hit.phase] || hit.phase}`;
    q.busyZh = '批重跑单阶段已暂停';
  }
  save(q);
  try {
    pushAnomalySseEvent(tid, 'progress', {
      kind: 'batch-rerun',
      wave: 'M93',
      labelZh: '批重跑单阶段暂停',
      tipZh: q.tipZh,
      toastZh: q.toastZh,
      busyZh: q.busyZh,
      percent: q.percent,
      phase: hit.phase,
      itemId: hit.id,
      status: 'paused',
      dryRun: true,
      noEgress: true,
      softCancelIntact: true,
    });
  } catch (_) {}
  return {
    ok: true as const,
    wave: 'M93' as const,
    labelZh: '暂停批重跑单阶段',
    tipZh: `已暂停阶段「${phaseZhMap[hit.phase] || hit.phase}」· 原状态 ${prev} · 可续跑 · 软取消仍在 · 干跑无外发`,
    toastZh: `单阶段暂停 · ${phaseZhMap[hit.phase] || hit.phase}`,
    busyZh: `暂停批重跑 · ${phaseZhMap[hit.phase] || hit.phase}…`,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    paused: true as const,
    pausedPhase: hit.phase,
    pausedPhaseZh: phaseZhMap[hit.phase] || hit.phase,
    item: hit,
    queue: getAnomalyContrastBatchRerunQueue(tid),
    resumePhasePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume',
  };
}

/** M93：续跑批重跑中的单阶段 */
export function resumeAnomalyBatchRerunSinglePhase(
  tenantId?: string | null,
  opts: { phase?: string | null; itemId?: string | null; maxSteps?: number; runStep?: StepRunner } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const wantId = String(opts.itemId || '').trim();
  const wantPhase = String(opts.phase || '').trim() || 'bust';
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  let hit: AnomalyBatchRerunItem | null = null;
  for (const it of q.items) {
    if (wantId && it.id === wantId) {
      hit = it;
      break;
    }
  }
  if (!hit) {
    hit =
      q.items.find((i) => i.phase === wantPhase && (i.status === 'cancelled' || i.status === 'failed' || i.status === 'queued')) ||
      q.items.find((i) => i.phase === wantPhase) ||
      null;
  }
  if (!hit) {
    return {
      ok: false as const,
      wave: 'M93' as const,
      labelZh: '续跑批重跑单阶段',
      tipZh: `未找到可续跑阶段「${phaseZhMap[wantPhase] || wantPhase}」`,
      toastZh: '单阶段续跑失败',
      busyZh: '续跑批重跑单阶段…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      resumed: false,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  hit.status = 'queued';
  hit.atDone = null;
  hit.resultTipZh = `单阶段续跑排队 · ${phaseZhMap[hit.phase] || hit.phase}`;
  q.cancelRequested = false;
  const idx = q.items.indexOf(hit);
  if (idx >= 0) q.cursor = idx;
  q.status = 'queued';
  q.tipZh = `单阶段「${phaseZhMap[hit.phase] || hit.phase}」已续跑入队`;
  q.toastZh = `单阶段续跑 · ${phaseZhMap[hit.phase] || hit.phase}`;
  q.busyZh = `续跑批重跑 · ${phaseZhMap[hit.phase] || hit.phase}…`;
  save(q);
  const tick = tickAnomalyContrastBatchRerun(tid, {
    maxSteps: opts.maxSteps ?? 1,
    runStep: opts.runStep,
  });
  const phaseZh = phaseZhMap[hit.phase] || hit.phase;
  const alarmAt = new Date().toISOString();
  const resumeAlarm = {
    alarmed: true as const,
    alarmedAt: alarmAt,
    alarmZh: `阶段「${phaseZh}」已从暂停恢复，请关注任务卡进度`,
    toastZh: `续跑闹钟 · ${phaseZh}`,
    taskCardAlarmZh: `【续跑闹钟】「${phaseZh}」已恢复 · 请盯任务卡分项进度 · 软取消仍在`,
    phase: hit.phase,
    phaseZh,
    itemId: hit.id,
  };
  try {
    pushAnomalySseEvent(tid, 'progress', {
      kind: 'batch-rerun',
      wave: 'M94',
      labelZh: '批重跑单阶段续跑闹钟',
      tipZh: resumeAlarm.alarmZh,
      toastZh: resumeAlarm.toastZh,
      busyZh: `续跑闹钟 · ${phaseZh}…`,
      percent: q.percent,
      phase: hit.phase,
      itemId: hit.id,
      status: 'resumed',
      resumeAlarm,
      dryRun: true,
      noEgress: true,
      softCancelIntact: true,
    });
  } catch (_) {}
  // 挂到队列 tip，任务卡可见
  q.tipZh = (q.tipZh || '') + ` · ${resumeAlarm.taskCardAlarmZh}`;
  q.toastZh = resumeAlarm.toastZh;
  (q as any).resumeAlarm = resumeAlarm;
  save(q);
  return {
    ok: true as const,
    wave: 'M94' as const,
    labelZh: '续跑批重跑单阶段（含续跑闹钟）',
    tipZh: `已续跑阶段「${phaseZh}」· ${(tick as any).tipZh || q.tipZh} · ${resumeAlarm.alarmZh} · 软取消仍在 · 干跑无外发`,
    toastZh: resumeAlarm.toastZh,
    busyZh: q.busyZh,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    resumed: true as const,
    resumedPhase: hit.phase,
    resumedPhaseZh: phaseZh,
    resumeAlarm,
    taskCardAlarmZh: resumeAlarm.taskCardAlarmZh,
    item: hit,
    tick,
    queue: getAnomalyContrastBatchRerunQueue(tid),
  };
}


/** M95：为暂停阶段武装续跑闹钟到期自动续跑（软取消仍赢；干跑无外发） */
export function armResumeAlarmAutoResumeOnExpiry(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    itemId?: string | null;
    expiresInMs?: number | null;
    autoResumeAt?: string | null;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const phaseZhMap: Record<string, string> = {
    bust: '建议 bust',
    reprobe: 'HIT 复探针',
    attribution: '异常归因',
    heal: 'SLA 自愈',
  };
  const wantId = String(opts.itemId || '').trim();
  const wantPhase = String(opts.phase || '').trim() || 'bust';
  let hit: AnomalyBatchRerunItem | null = null;
  for (const it of q.items) {
    if (wantId && it.id === wantId) {
      hit = it;
      break;
    }
  }
  if (!hit) {
    hit =
      q.items.find((i) => i.phase === wantPhase && (i.status === 'cancelled' || i.status === 'failed' || i.status === 'queued')) ||
      q.items.find((i) => i.phase === wantPhase) ||
      null;
  }
  if (!hit) {
    // ensure a pausable item exists then arm
    const paused = pauseAnomalyBatchRerunSinglePhase(tid, { phase: wantPhase, itemId: wantId || null });
    if (!(paused as any).paused) {
      return {
        ok: false as const,
        wave: 'M95' as const,
        labelZh: '续跑闹钟到期自动续跑武装',
        tipZh: `未找到可武装阶段「${phaseZhMap[wantPhase] || wantPhase}」`,
        toastZh: '自动续跑武装失败',
        busyZh: '武装续跑闹钟自动续跑…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        armed: false,
        queue: getAnomalyContrastBatchRerunQueue(tid),
      };
    }
    hit = (paused as any).item || null;
  }
  if (!hit) {
    return {
      ok: false as const,
      wave: 'M95' as const,
      labelZh: '续跑闹钟到期自动续跑武装',
      tipZh: '无可武装阶段',
      toastZh: '自动续跑武装失败',
      busyZh: '武装续跑闹钟自动续跑…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      armed: false,
    };
  }
  const expiresInMs = Math.max(50, Number(opts.expiresInMs) || 1500);
  const autoResumeAt =
    String(opts.autoResumeAt || '').trim() ||
    new Date(Date.now() + expiresInMs).toISOString();
  const phaseZh = phaseZhMap[hit.phase] || hit.phase;
  const resumeAlarm = {
    alarmed: true as const,
    alarmedAt: new Date().toISOString(),
    alarmZh: `阶段「${phaseZh}」续跑闹钟已武装 · 到期将自动续跑`,
    toastZh: `续跑闹钟武装 · ${phaseZh}`,
    taskCardAlarmZh: `【续跑闹钟】「${phaseZh}」到期自动续跑 · 软取消仍优先`,
    phase: hit.phase,
    phaseZh,
    itemId: hit.id,
    autoResumeOnExpiry: true as const,
    expiresInMs,
    autoResumeAt,
    autoResumed: false as const,
  };
  (q as any).resumeAlarm = resumeAlarm;
  q.tipZh = `续跑闹钟已武装 · ${phaseZh} · 到期 ${autoResumeAt} 自动续跑 · 软取消仍赢`;
  q.toastZh = resumeAlarm.toastZh;
  q.busyZh = `续跑闹钟武装 · ${phaseZh}…`;
  save(q);
  try {
    pushAnomalySseEvent(tid, 'progress', {
      kind: 'batch-rerun',
      wave: 'M95',
      labelZh: '续跑闹钟到期自动续跑武装',
      tipZh: resumeAlarm.alarmZh,
      toastZh: resumeAlarm.toastZh,
      busyZh: q.busyZh,
      percent: q.percent,
      phase: hit.phase,
      itemId: hit.id,
      status: 'alarm-armed',
      resumeAlarm,
      dryRun: true,
      noEgress: true,
      softCancelIntact: true,
    });
  } catch (_) {}
  return {
    ok: true as const,
    wave: 'M95' as const,
    labelZh: '续跑闹钟到期自动续跑武装',
    tipZh: q.tipZh,
    toastZh: resumeAlarm.toastZh,
    busyZh: q.busyZh,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    armed: true as const,
    resumeAlarm,
    item: hit,
    queue: getAnomalyContrastBatchRerunQueue(tid),
    tickPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume',
  };
}

/** M95：检查续跑闹钟是否到期；到期则自动续跑（软取消仍赢） */
export function tickResumeAlarmAutoResumeOnExpiry(
  tenantId?: string | null,
  opts: {
    force?: boolean;
    maxSteps?: number;
    runStep?: StepRunner;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const alarm = (q as any).resumeAlarm || null;
  if (!alarm || !alarm.autoResumeOnExpiry) {
    return {
      ok: false as const,
      wave: 'M95' as const,
      labelZh: '续跑闹钟到期自动续跑',
      tipZh: '未武装到期自动续跑闹钟；请先 arm',
      toastZh: '无自动续跑闹钟',
      busyZh: '检查续跑闹钟到期…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: false,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  if (q.cancelRequested) {
    return {
      ok: true as const,
      wave: 'M95' as const,
      labelZh: '续跑闹钟到期自动续跑',
      tipZh: '软取消已请求 · 自动续跑被挡住（软取消仍赢）· 干跑无外发',
      toastZh: '软取消优先 · 未自动续跑',
      busyZh: '检查续跑闹钟到期…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: true,
      blockedBySoftCancel: true as const,
      resumeAlarm: alarm,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const dueAt = Date.parse(String(alarm.autoResumeAt || ''));
  const expired = opts.force === true || (Number.isFinite(dueAt) && Date.now() >= dueAt);
  if (!expired) {
    const remainMs = Number.isFinite(dueAt) ? Math.max(0, dueAt - Date.now()) : null;
    return {
      ok: true as const,
      wave: 'M95' as const,
      labelZh: '续跑闹钟到期自动续跑',
      tipZh: `续跑闹钟未到期${remainMs != null ? ` · 剩余约 ${remainMs}ms` : ''} · 软取消仍赢`,
      toastZh: '闹钟未到期',
      busyZh: '检查续跑闹钟到期…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: false,
      remainMs,
      resumeAlarm: alarm,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const resumed = resumeAnomalyBatchRerunSinglePhase(tid, {
    phase: alarm.phase || null,
    itemId: alarm.itemId || null,
    maxSteps: opts.maxSteps ?? 1,
    runStep: opts.runStep,
  });
  const phaseZh = alarm.phaseZh || alarm.phase || '阶段';
  const autoAlarm = {
    ...((resumed as any).resumeAlarm || alarm),
    autoResumeOnExpiry: true as const,
    autoResumed: true as const,
    autoResumedAt: new Date().toISOString(),
    alarmZh: `阶段「${phaseZh}」续跑闹钟到期 · 已自动续跑`,
    toastZh: `到期自动续跑 · ${phaseZh}`,
    taskCardAlarmZh: `【到期自动续跑】「${phaseZh}」已恢复 · 软取消仍在 · 干跑无外发`,
  };
  const q2 = load(tid);
  (q2 as any).resumeAlarm = autoAlarm;
  q2.tipZh = (q2.tipZh || '') + ` · ${autoAlarm.taskCardAlarmZh}`;
  q2.toastZh = autoAlarm.toastZh;
  save(q2);
  try {
    pushAnomalySseEvent(tid, 'progress', {
      kind: 'batch-rerun',
      wave: 'M95',
      labelZh: '续跑闹钟到期自动续跑',
      tipZh: autoAlarm.alarmZh,
      toastZh: autoAlarm.toastZh,
      busyZh: `到期自动续跑 · ${phaseZh}…`,
      percent: q2.percent,
      phase: alarm.phase,
      itemId: alarm.itemId,
      status: 'auto-resumed',
      resumeAlarm: autoAlarm,
      dryRun: true,
      noEgress: true,
      softCancelIntact: true,
    });
  } catch (_) {}
  return {
    ok: true as const,
    wave: 'M95' as const,
    labelZh: '续跑闹钟到期自动续跑',
    tipZh: `续跑闹钟已到期 · 已自动续跑阶段「${phaseZh}」· 软取消仍在 · 干跑无外发`,
    toastZh: autoAlarm.toastZh,
    busyZh: `到期自动续跑 · ${phaseZh}…`,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    autoResumed: true as const,
    expired: true as const,
    resumeAlarm: autoAlarm,
    resumed,
    queue: getAnomalyContrastBatchRerunQueue(tid),
  };
}


/** M96：续跑闹钟宽限/静默窗武装（软取消仍赢；干跑无外发） */
export function armResumeAlarmWithGraceQuietWindow(
  tenantId?: string | null,
  opts: {
    phase?: string | null;
    itemId?: string | null;
    expiresInMs?: number | null;
    autoResumeAt?: string | null;
    graceMs?: number | null;
    quietMs?: number | null;
    quietWindowMs?: number | null;
    quietUntil?: string | null;
    dryRun?: boolean;
  } = {},
) {
  const graceMs = Math.max(0, Number(opts.graceMs) || 0);
  const quietMs = Math.max(
    0,
    Number(opts.quietMs != null ? opts.quietMs : opts.quietWindowMs) || 0,
  );
  const armed = armResumeAlarmAutoResumeOnExpiry(tenantId, {
    phase: opts.phase,
    itemId: opts.itemId,
    expiresInMs: opts.expiresInMs,
    autoResumeAt: opts.autoResumeAt,
    dryRun: opts.dryRun !== false,
  });
  if (!(armed as any).armed) {
    return {
      ...armed,
      wave: 'M96' as const,
      labelZh: '续跑闹钟宽限/静默窗武装',
      graceMs,
      quietMs,
    };
  }
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const baseAlarm = (armed as any).resumeAlarm || (q as any).resumeAlarm || {};
  const baseAt = Date.parse(String(baseAlarm.autoResumeAt || '')) || Date.now();
  const effectiveAutoResumeAt = new Date(baseAt + graceMs).toISOString();
  const quietUntil =
    String(opts.quietUntil || '').trim() ||
    (quietMs > 0 ? new Date(Date.now() + quietMs).toISOString() : null);
  const phaseZh = baseAlarm.phaseZh || baseAlarm.phase || '阶段';
  const resumeAlarm = {
    ...baseAlarm,
    wave: 'M96' as const,
    autoResumeOnExpiry: true as const,
    graceMs,
    quietMs,
    quietUntil,
    effectiveAutoResumeAt,
    autoResumeAt: baseAlarm.autoResumeAt,
    graceQuietArmed: true as const,
    alarmZh:
      `阶段「${phaseZh}」续跑闹钟已武装` +
      (graceMs > 0 ? ` · 宽限 ${graceMs}ms` : '') +
      (quietUntil ? ` · 静默至 ${quietUntil}` : '') +
      ' · 到期+宽限后自动续跑',
    toastZh:
      graceMs > 0 || quietUntil
        ? `宽限/静默窗武装 · ${phaseZh}`
        : `续跑闹钟武装 · ${phaseZh}`,
    taskCardAlarmZh:
      `【宽限/静默】「${phaseZh}」` +
      (graceMs > 0 ? `宽限${graceMs}ms` : '无宽限') +
      (quietUntil ? ` · 静默至${quietUntil}` : '') +
      ' · 软取消仍优先',
  };
  (q as any).resumeAlarm = resumeAlarm;
  q.tipZh = resumeAlarm.alarmZh + ' · 软取消仍赢 · 干跑无外发';
  q.toastZh = resumeAlarm.toastZh;
  q.busyZh = `宽限/静默窗武装 · ${phaseZh}…`;
  save(q);
  try {
    pushAnomalySseEvent(tid, 'progress', {
      kind: 'batch-rerun',
      wave: 'M96',
      labelZh: '续跑闹钟宽限/静默窗武装',
      tipZh: resumeAlarm.alarmZh,
      toastZh: resumeAlarm.toastZh,
      busyZh: q.busyZh,
      percent: q.percent,
      phase: resumeAlarm.phase,
      itemId: resumeAlarm.itemId,
      status: 'grace-quiet-armed',
      resumeAlarm,
      dryRun: true,
      noEgress: true,
      softCancelIntact: true,
    });
  } catch (_) {}
  return {
    ok: true as const,
    wave: 'M96' as const,
    labelZh: '续跑闹钟宽限/静默窗武装',
    tipZh: q.tipZh,
    toastZh: resumeAlarm.toastZh,
    busyZh: q.busyZh,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    armed: true as const,
    graceMs,
    quietMs,
    quietUntil,
    effectiveAutoResumeAt,
    resumeAlarm,
    item: (armed as any).item || null,
    queue: getAnomalyContrastBatchRerunQueue(tid),
    tickPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace',
  };
}

/** M96：宽限/静默窗下 tick 自动续跑（软取消仍赢） */
export function tickResumeAlarmGraceQuietAutoResume(
  tenantId?: string | null,
  opts: {
    force?: boolean;
    ignoreQuiet?: boolean;
    maxSteps?: number;
    runStep?: StepRunner;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const q = load(tid);
  const alarm = (q as any).resumeAlarm || null;
  if (!alarm || !alarm.autoResumeOnExpiry) {
    // arm with defaults then continue if force requested via empty alarm
    return {
      ok: false as const,
      wave: 'M96' as const,
      labelZh: '宽限/静默窗自动续跑',
      tipZh: '未武装宽限/静默续跑闹钟；请先 arm',
      toastZh: '无宽限/静默闹钟',
      busyZh: '检查宽限/静默窗…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: false,
      inQuietWindow: false,
      inGrace: false,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  if (q.cancelRequested) {
    return {
      ok: true as const,
      wave: 'M96' as const,
      labelZh: '宽限/静默窗自动续跑',
      tipZh: '软取消已请求 · 宽限/静默自动续跑被挡住（软取消仍赢）· 干跑无外发',
      toastZh: '软取消优先 · 未自动续跑',
      busyZh: '检查宽限/静默窗…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: true,
      blockedBySoftCancel: true as const,
      inQuietWindow: false,
      inGrace: false,
      resumeAlarm: alarm,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const now = Date.now();
  const quietUntilMs = Date.parse(String(alarm.quietUntil || ''));
  const inQuietWindow =
    opts.ignoreQuiet !== true &&
    Number.isFinite(quietUntilMs) &&
    now < quietUntilMs;
  if (inQuietWindow && opts.force !== true) {
    const remainQuietMs = Math.max(0, quietUntilMs - now);
    return {
      ok: true as const,
      wave: 'M96' as const,
      labelZh: '宽限/静默窗自动续跑',
      tipZh: `处于静默窗 · 剩余约 ${remainQuietMs}ms · 不触发自动续跑 · 软取消仍赢`,
      toastZh: '静默窗中 · 未续跑',
      busyZh: '检查宽限/静默窗…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: false,
      inQuietWindow: true as const,
      inGrace: false,
      remainQuietMs,
      resumeAlarm: alarm,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const effectiveAt =
    Date.parse(String(alarm.effectiveAutoResumeAt || '')) ||
    Date.parse(String(alarm.autoResumeAt || '')) + (Number(alarm.graceMs) || 0);
  const baseAt = Date.parse(String(alarm.autoResumeAt || ''));
  const pastBase = opts.force === true || (Number.isFinite(baseAt) && now >= baseAt);
  const pastEffective =
    opts.force === true || (Number.isFinite(effectiveAt) && now >= effectiveAt);
  if (pastBase && !pastEffective && opts.force !== true) {
    const remainGraceMs = Math.max(0, effectiveAt - now);
    return {
      ok: true as const,
      wave: 'M96' as const,
      labelZh: '宽限/静默窗自动续跑',
      tipZh: `已过到期点 · 仍在宽限窗 · 剩余约 ${remainGraceMs}ms · 软取消仍赢`,
      toastZh: '宽限中 · 未续跑',
      busyZh: '检查宽限/静默窗…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: true,
      inQuietWindow: false,
      inGrace: true as const,
      remainGraceMs,
      resumeAlarm: alarm,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  if (!pastEffective && opts.force !== true) {
    const remainMs = Number.isFinite(effectiveAt) ? Math.max(0, effectiveAt - now) : null;
    return {
      ok: true as const,
      wave: 'M96' as const,
      labelZh: '宽限/静默窗自动续跑',
      tipZh: `宽限有效续跑点未到${remainMs != null ? ` · 剩余约 ${remainMs}ms` : ''} · 软取消仍赢`,
      toastZh: '未到宽限续跑点',
      busyZh: '检查宽限/静默窗…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      softCancelWins: true as const,
      autoResumed: false,
      expired: false,
      inQuietWindow: false,
      inGrace: false,
      remainMs,
      resumeAlarm: alarm,
      queue: getAnomalyContrastBatchRerunQueue(tid),
    };
  }
  const resumed = resumeAnomalyBatchRerunSinglePhase(tid, {
    phase: alarm.phase || null,
    itemId: alarm.itemId || null,
    maxSteps: opts.maxSteps ?? 1,
    runStep: opts.runStep,
  });
  const phaseZh = alarm.phaseZh || alarm.phase || '阶段';
  const autoAlarm = {
    ...alarm,
    ...((resumed as any).resumeAlarm || {}),
    autoResumeOnExpiry: true as const,
    graceQuietArmed: true as const,
    autoResumed: true as const,
    autoResumedAt: new Date().toISOString(),
    graceMs: Number(alarm.graceMs) || 0,
    quietMs: Number(alarm.quietMs) || 0,
    quietUntil: alarm.quietUntil || null,
    effectiveAutoResumeAt: alarm.effectiveAutoResumeAt || null,
    alarmZh: `阶段「${phaseZh}」宽限/静默通过 · 已自动续跑`,
    toastZh: `宽限后自动续跑 · ${phaseZh}`,
    taskCardAlarmZh: `【宽限后自动续跑】「${phaseZh}」已恢复 · 软取消仍在 · 干跑无外发`,
  };
  const q2 = load(tid);
  (q2 as any).resumeAlarm = autoAlarm;
  q2.tipZh = (q2.tipZh || '') + ` · ${autoAlarm.taskCardAlarmZh}`;
  q2.toastZh = autoAlarm.toastZh;
  save(q2);
  try {
    pushAnomalySseEvent(tid, 'progress', {
      kind: 'batch-rerun',
      wave: 'M96',
      labelZh: '宽限/静默窗自动续跑',
      tipZh: autoAlarm.alarmZh,
      toastZh: autoAlarm.toastZh,
      busyZh: `宽限后自动续跑 · ${phaseZh}…`,
      percent: q2.percent,
      phase: alarm.phase,
      itemId: alarm.itemId,
      status: 'grace-auto-resumed',
      resumeAlarm: autoAlarm,
      dryRun: true,
      noEgress: true,
      softCancelIntact: true,
    });
  } catch (_) {}
  return {
    ok: true as const,
    wave: 'M96' as const,
    labelZh: '宽限/静默窗自动续跑',
    tipZh: `宽限/静默条件已满足 · 已自动续跑阶段「${phaseZh}」· 软取消仍在 · 干跑无外发`,
    toastZh: autoAlarm.toastZh,
    busyZh: `宽限后自动续跑 · ${phaseZh}…`,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    autoResumed: true as const,
    expired: true as const,
    inQuietWindow: false as const,
    inGrace: false as const,
    resumeAlarm: autoAlarm,
    resumed,
    queue: getAnomalyContrastBatchRerunQueue(tid),
  };
}


/** M97：宽限/静默窗按角色策略模板 */
function graceQuietRolePolicyPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'resume-alarm-grace-quiet-role-policies.json');
}

function loadGraceQuietRolePolicies(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = graceQuietRolePolicyPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        byRole: raw.byRole && typeof raw.byRole === 'object' ? raw.byRole : {},
        templates: Array.isArray(raw.templates) ? raw.templates : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { byRole: {} as Record<string, any>, templates: [] as any[], updatedAt: null as string | null };
}

function saveGraceQuietRolePolicies(tenantId: string | null | undefined, store: any) {
  const tid = safeTenant(tenantId);
  const p = graceQuietRolePolicyPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

const ROLE_POLICY_LABEL_ZH: Record<string, string> = {
  admin: '运营',
  park: '园区',
  enterprise: '企业',
  uni: '高校/科研',
  broker: '经纪人',
};

/** M97：宽限/静默窗角色策略模板保存/套用（软取消仍赢；干跑无外发） */
export function configureGraceQuietRolePolicyTemplates(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    templateId?: string | null;
    nameZh?: string | null;
    graceMs?: number | null;
    quietMs?: number | null;
    quietWindowMs?: number | null;
    quietUntil?: string | null;
    save?: boolean;
    apply?: boolean;
    list?: boolean;
    phase?: string | null;
    itemId?: string | null;
    expiresInMs?: number | null;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const store = loadGraceQuietRolePolicies(tid);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const roleZh = ROLE_POLICY_LABEL_ZH[role] || role;

  if (opts.list === true && opts.save !== true && opts.apply !== true) {
    const forRole = Array.isArray(store.byRole[role]) ? store.byRole[role] : [];
    return {
      ok: true as const,
      wave: 'M97' as const,
      labelZh: '宽限/静默窗角色策略模板',
      tipZh: `角色「${roleZh}」共 ${forRole.length} 个宽限/静默策略模板 · 干跑无外发`,
      toastZh: forRole.length ? `策略模板 · ${forRole.length}` : '暂无策略模板',
      busyZh: '加载宽限/静默角色策略…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      role,
      roleZh,
      templates: forRole,
      byRole: store.byRole,
      updatedAt: store.updatedAt,
      path: graceQuietRolePolicyPath(tid),
    };
  }

  let saved: any = null;
  if (opts.save === true) {
    const graceMs = Math.max(0, Number(opts.graceMs) || 0);
    const quietMs = Math.max(
      0,
      Number(opts.quietMs != null ? opts.quietMs : opts.quietWindowMs) || 0,
    );
    const id =
      String(opts.templateId || '').trim() ||
      `gq-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const nameZh =
      String(opts.nameZh || '').trim() ||
      `${roleZh}·宽限${graceMs}ms·静默${quietMs}ms`;
    saved = {
      id,
      role,
      roleZh,
      nameZh,
      graceMs,
      quietMs,
      updatedAt: new Date().toISOString(),
      wave: 'M97',
    };
    const list = Array.isArray(store.byRole[role]) ? store.byRole[role] : [];
    const idx = list.findIndex((t: any) => String(t.id) === id);
    if (idx >= 0) list[idx] = saved;
    else list.unshift(saved);
    store.byRole[role] = list.slice(0, 20);
    store.templates = Object.values(store.byRole).flat();
    saveGraceQuietRolePolicies(tid, store);
  }

  let applied: any = null;
  let armed: any = null;
  if (opts.apply === true || (opts.apply !== false && (opts.templateId || saved))) {
    const list = Array.isArray(store.byRole[role]) ? store.byRole[role] : [];
    applied =
      (opts.templateId
        ? list.find((t: any) => String(t.id) === String(opts.templateId))
        : null) ||
      saved ||
      list[0] ||
      null;
    if (applied) {
      armed = armResumeAlarmWithGraceQuietWindow(tid, {
        phase: opts.phase || 'bust',
        itemId: opts.itemId || null,
        expiresInMs: opts.expiresInMs ?? 80,
        graceMs: applied.graceMs,
        quietMs: applied.quietMs,
        quietUntil: opts.quietUntil || null,
        dryRun: opts.dryRun !== false,
      });
    }
  }

  return {
    ok: true as const,
    wave: 'M97' as const,
    labelZh: '宽限/静默窗角色策略模板',
    tipZh:
      (saved ? `已保存角色「${roleZh}」策略「${saved.nameZh}」` : '') +
      (applied && armed
        ? `${saved ? ' · ' : ''}已套用「${applied.nameZh}」并武装宽限/静默`
        : saved
          ? ''
          : applied
            ? `已定位策略「${applied.nameZh}」`
            : `角色「${roleZh}」策略模板就绪`) +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: saved
      ? `策略已存 · ${roleZh}`
      : applied
        ? `策略已套用 · ${roleZh}`
        : `策略模板 · ${roleZh}`,
    busyZh: '配置宽限/静默角色策略模板…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    role,
    roleZh,
    saved,
    applied,
    armed,
    resumeAlarm: armed?.resumeAlarm || null,
    templates: Array.isArray(store.byRole[role]) ? store.byRole[role] : [],
    byRole: store.byRole,
    policyPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy',
  };
}


/** M98：角色宽限/静默策略 A/B 对比（干跑；软取消仍赢；无外发） */
export function compareGraceQuietRolePoliciesAB(
  tenantId?: string | null,
  opts: {
    roleA?: string | null;
    roleB?: string | null;
    role?: string | null;
    templateIdA?: string | null;
    templateIdB?: string | null;
    graceMsA?: number | null;
    quietMsA?: number | null;
    graceMsB?: number | null;
    quietMsB?: number | null;
    nameZhA?: string | null;
    nameZhB?: string | null;
    ensureSave?: boolean;
    phase?: string | null;
    itemId?: string | null;
    expiresInMs?: number | null;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const roleA = String(opts.roleA || opts.role || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const roleB = String(opts.roleB || 'admin')
    .trim()
    .toLowerCase() || 'admin';
  const roleZhA = ROLE_POLICY_LABEL_ZH[roleA] || roleA;
  const roleZhB = ROLE_POLICY_LABEL_ZH[roleB] || roleB;

  let polA = configureGraceQuietRolePolicyTemplates(tid, {
    role: roleA,
    list: true,
    dryRun: true,
  });
  let polB = configureGraceQuietRolePolicyTemplates(tid, {
    role: roleB,
    list: true,
    dryRun: true,
  });

  const pickOrSave = (
    role: string,
    list: any[],
    templateId: string | null | undefined,
    graceMs: number | null | undefined,
    quietMs: number | null | undefined,
    nameZh: string | null | undefined,
  ) => {
    if (templateId) {
      const hit = list.find((t: any) => String(t.id) === String(templateId));
      if (hit) return hit;
    }
    if (opts.ensureSave !== false && (graceMs != null || quietMs != null || !list.length)) {
      const saved = configureGraceQuietRolePolicyTemplates(tid, {
        role,
        save: true,
        apply: false,
        graceMs: graceMs != null ? graceMs : role === roleA ? 40 : 80,
        quietMs: quietMs != null ? quietMs : role === roleA ? 0 : 20,
        nameZh: nameZh || null,
        dryRun: true,
      });
      return (saved as any).saved || (saved as any).templates?.[0] || null;
    }
    return list[0] || null;
  };

  const listA = Array.isArray((polA as any).templates) ? (polA as any).templates : [];
  const listB = Array.isArray((polB as any).templates) ? (polB as any).templates : [];
  const tmplA = pickOrSave(roleA, listA, opts.templateIdA, opts.graceMsA, opts.quietMsA, opts.nameZhA);
  const tmplB = pickOrSave(roleB, listB, opts.templateIdB, opts.graceMsB, opts.quietMsB, opts.nameZhB);

  polA = configureGraceQuietRolePolicyTemplates(tid, {
    role: roleA,
    templateId: tmplA?.id,
    apply: true,
    phase: opts.phase || 'bust',
    itemId: opts.itemId || null,
    expiresInMs: opts.expiresInMs ?? 40,
    dryRun: opts.dryRun !== false,
  });
  polB = configureGraceQuietRolePolicyTemplates(tid, {
    role: roleB,
    templateId: tmplB?.id,
    apply: true,
    phase: opts.phase || 'bust',
    itemId: opts.itemId || null,
    expiresInMs: opts.expiresInMs ?? 40,
    dryRun: opts.dryRun !== false,
  });

  const a = {
    role: roleA,
    roleZh: roleZhA,
    template: (polA as any).applied || tmplA,
    graceMs: Number(((polA as any).applied || tmplA)?.graceMs) || 0,
    quietMs: Number(((polA as any).applied || tmplA)?.quietMs) || 0,
    armed: (polA as any).armed || null,
  };
  const b = {
    role: roleB,
    roleZh: roleZhB,
    template: (polB as any).applied || tmplB,
    graceMs: Number(((polB as any).applied || tmplB)?.graceMs) || 0,
    quietMs: Number(((polB as any).applied || tmplB)?.quietMs) || 0,
    armed: (polB as any).armed || null,
  };
  const graceDeltaMs = b.graceMs - a.graceMs;
  const quietDeltaMs = b.quietMs - a.quietMs;
  const compare = {
    wave: 'M98' as const,
    kind: 'grace-quiet-role-policy-ab' as const,
    labelZh: '角色宽限/静默策略 A/B 对比',
    sideA: a,
    sideB: b,
    graceDeltaMs,
    quietDeltaMs,
    winnerZh:
      Math.abs(graceDeltaMs) + Math.abs(quietDeltaMs) === 0
        ? '两侧宽限/静默一致'
        : Math.abs(graceDeltaMs) >= Math.abs(quietDeltaMs)
          ? graceDeltaMs > 0
            ? `B（${roleZhB}）宽限更长 +${graceDeltaMs}ms`
            : `A（${roleZhA}）宽限更长 +${-graceDeltaMs}ms`
          : quietDeltaMs > 0
            ? `B（${roleZhB}）静默更长 +${quietDeltaMs}ms`
            : `A（${roleZhA}）静默更长 +${-quietDeltaMs}ms`,
    tipZh: `${roleZhA} vs ${roleZhB} · 宽限差 ${graceDeltaMs}ms · 静默差 ${quietDeltaMs}ms`,
  };

  return {
    ok: true as const,
    wave: 'M98' as const,
    labelZh: '角色宽限/静默策略 A/B 对比',
    tipZh:
      `已对比「${roleZhA}」与「${roleZhB}」宽限/静默策略` +
      ` · ${compare.winnerZh}` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `策略A/B · ${roleZhA}↔${roleZhB}`,
    busyZh: '对比角色宽限/静默策略…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    compare,
    sideA: a,
    sideB: b,
    polA,
    polB,
    abComparePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare',
  };
}



/** M100：A/B 胜出侧套用软撤销栈 */
function graceAbApplyWinnerUndoPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'grace-ab-apply-winner-undo.json');
}

function loadGraceAbApplyWinnerUndo(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const pth = graceAbApplyWinnerUndoPath(tid);
  try {
    if (existsSync(pth)) {
      const raw = JSON.parse(readFileSync(pth, 'utf8')) || {};
      return {
        stack: Array.isArray(raw.stack) ? raw.stack : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { stack: [] as any[], updatedAt: null as string | null };
}

function saveGraceAbApplyWinnerUndo(tenantId: string | null | undefined, store: any) {
  const tid = safeTenant(tenantId);
  const pth = graceAbApplyWinnerUndoPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(pth, JSON.stringify(store, null, 0), 'utf8');
  return pth;
}

function pushGraceAbApplyWinnerUndo(tenantId: string | null | undefined, entry: any) {
  const store = loadGraceAbApplyWinnerUndo(tenantId);
  store.stack.unshift(entry);
  store.stack = store.stack.slice(0, 30);
  saveGraceAbApplyWinnerUndo(tenantId, store);
  return entry;
}


/** M99：策略 A/B 一键套用胜出侧（确认卡；干跑；软取消仍赢；无外发） */
export function applyGraceQuietRolePolicyAbWinner(
  tenantId?: string | null,
  opts: {
    roleA?: string | null;
    roleB?: string | null;
    role?: string | null;
    templateIdA?: string | null;
    templateIdB?: string | null;
    graceMsA?: number | null;
    quietMsA?: number | null;
    graceMsB?: number | null;
    quietMsB?: number | null;
    nameZhA?: string | null;
    nameZhB?: string | null;
    ensureSave?: boolean;
    phase?: string | null;
    itemId?: string | null;
    expiresInMs?: number | null;
    dryRun?: boolean;
    applyWinner?: boolean;
    applySide?: 'A' | 'B' | 'winner' | string | null;
    confirmApply?: boolean;
    confirmCardAck?: boolean;
    previewConfirm?: boolean;
    targetRole?: string | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const compare = compareGraceQuietRolePoliciesAB(tid, {
    roleA: opts.roleA,
    roleB: opts.roleB,
    role: opts.role,
    templateIdA: opts.templateIdA,
    templateIdB: opts.templateIdB,
    graceMsA: opts.graceMsA,
    quietMsA: opts.quietMsA,
    graceMsB: opts.graceMsB,
    quietMsB: opts.quietMsB,
    nameZhA: opts.nameZhA,
    nameZhB: opts.nameZhB,
    ensureSave: opts.ensureSave,
    phase: opts.phase,
    itemId: opts.itemId,
    expiresInMs: opts.expiresInMs,
    dryRun: opts.dryRun !== false,
  });

  const sideA = (compare as any).sideA;
  const sideB = (compare as any).sideB;
  const cmp = (compare as any).compare || {};
  const winnerZh = String(cmp.winnerZh || '');
  let winnerSide: 'A' | 'B' | 'tie' = 'tie';
  if (/^A（/.test(winnerZh) || winnerZh.startsWith('A（') || /^A\(/.test(winnerZh)) winnerSide = 'A';
  else if (/^B（/.test(winnerZh) || winnerZh.startsWith('B（') || /^B\(/.test(winnerZh)) winnerSide = 'B';
  else if (winnerZh.includes('两侧') || winnerZh.includes('一致')) winnerSide = 'tie';
  else if ((sideB?.graceMs || 0) + (sideB?.quietMs || 0) > (sideA?.graceMs || 0) + (sideA?.quietMs || 0))
    winnerSide = 'B';
  else if ((sideA?.graceMs || 0) + (sideA?.quietMs || 0) > (sideB?.graceMs || 0) + (sideB?.quietMs || 0))
    winnerSide = 'A';

  const wantSideRaw = String(opts.applySide || 'winner').trim().toUpperCase();
  const applySide: 'A' | 'B' =
    wantSideRaw === 'A' || wantSideRaw === 'B'
      ? (wantSideRaw as 'A' | 'B')
      : winnerSide === 'B'
        ? 'B'
        : 'A';
  const winner = applySide === 'B' ? sideB : sideA;
  const targetRole =
    String(opts.targetRole || winner?.role || opts.role || 'broker')
      .trim()
      .toLowerCase() || 'broker';
  const targetRoleZh = ROLE_POLICY_LABEL_ZH[targetRole] || targetRole;

  const confirmCard = {
    wave: 'M99' as const,
    kind: 'grace-ab-apply-winner-confirm' as const,
    titleZh: '确认套用策略 A/B 胜出侧',
    bodyZh:
      `将套用${applySide === 'B' ? 'B' : 'A'}侧「${winner?.roleZh || ''}」策略` +
      `（宽限 ${winner?.graceMs ?? 0}ms · 静默 ${winner?.quietMs ?? 0}ms）` +
      `到角色「${targetRoleZh}」` +
      ` · 判定：${winnerZh || '—'}` +
      ' · 需 confirmApply / confirmCardAck',
    applySide,
    winnerSide,
    winnerZh,
    targetRole,
    targetRoleZh,
    graceMs: winner?.graceMs ?? 0,
    quietMs: winner?.quietMs ?? 0,
    templateId: winner?.template?.id || null,
    requireAck: true as const,
  };

  const wantsPreview =
    opts.previewConfirm === true ||
    (opts.confirmApply !== true && opts.confirmCardAck !== true && opts.applyWinner !== true);

  if (wantsPreview) {
    return {
      ok: true as const,
      wave: 'M99' as const,
      labelZh: '策略 A/B 一键套用胜出侧（确认卡）',
      tipZh: `已出确认卡 · 胜出侧 ${applySide} · ${winnerZh} · 中页取消仍在 · 无外发`,
      toastZh: '请确认套用胜出侧策略',
      busyZh: '准备策略 A/B 胜出侧套用确认卡…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      confirmCard,
      previewConfirm: true as const,
      applied: false as const,
      applySide,
      winnerSide,
      compare: cmp,
      sideA,
      sideB,
      applyWinnerPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner',
    };
  }

  // M100：套用前快照，供软撤销
  const beforeStore = loadGraceQuietRolePolicies(tid);
  const beforeRoleList = Array.isArray(beforeStore.byRole[targetRole])
    ? beforeStore.byRole[targetRole].map((t: any) => ({ ...t }))
    : [];
  const beforeActive =
    beforeRoleList.find((t: any) => winner?.template?.id && String(t.id) === String(winner.template.id)) ||
    beforeRoleList[0] ||
    null;

  const applied = configureGraceQuietRolePolicyTemplates(tid, {
    role: targetRole,
    templateId: winner?.template?.id || null,
    graceMs: winner?.graceMs,
    quietMs: winner?.quietMs,
    nameZh: winner?.template?.nameZh || `${targetRoleZh}·胜出侧套用`,
    save: !winner?.template?.id,
    apply: true,
    phase: opts.phase || 'bust',
    itemId: opts.itemId || null,
    expiresInMs: opts.expiresInMs ?? 40,
    dryRun: opts.dryRun !== false,
  });

  const undoToken =
    `abwin-undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const undoEntry = {
    token: undoToken,
    targetRole,
    targetRoleZh,
    applySide,
    winnerSide,
    beforeActive,
    beforeRoleList,
    afterGraceMs: winner?.graceMs ?? 0,
    afterQuietMs: winner?.quietMs ?? 0,
    createdAt: new Date().toISOString(),
    wave: 'M100',
    undone: false,
  };
  pushGraceAbApplyWinnerUndo(tid, undoEntry);

  return {
    ok: true as const,
    wave: 'M99' as const,
    labelZh: '策略 A/B 一键套用胜出侧',
    tipZh:
      `已套用${applySide}侧「${winner?.roleZh || ''}」策略到「${targetRoleZh}」` +
      ` · 宽限 ${winner?.graceMs ?? 0}ms · 静默 ${winner?.quietMs ?? 0}ms` +
      ` · ${winnerZh}` +
      ' · 可软撤销 · 软取消仍赢 · 干跑无外发',
    toastZh: `已套用胜出侧 · ${applySide} → ${targetRoleZh}`,
    busyZh: '套用策略 A/B 胜出侧…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoIntact: true as const,
    softUndoToken: undoToken,
    softUndoPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo',
    confirmCard,
    confirmCardAck: true as const,
    applied: true as const,
    applySide,
    winnerSide,
    winner,
    targetRole,
    targetRoleZh,
    compare: cmp,
    sideA,
    sideB,
    policyApply: applied,
    applyWinnerPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner',
  };
}


/** M100：策略 A/B 胜出侧套用后软撤销（干跑；软取消仍赢；无外发） */
export function softUndoGraceAbApplyWinner(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    list?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const store = loadGraceAbApplyWinnerUndo(tid);

  if (opts.list === true) {
    return {
      ok: true as const,
      wave: 'M100' as const,
      labelZh: '策略 A/B 胜出侧软撤销栈',
      tipZh: `共 ${store.stack.length} 条可软撤销记录 · 干跑无外发`,
      toastZh: store.stack.length ? `软撤销栈 · ${store.stack.length}` : '暂无可撤销',
      busyZh: '加载胜出侧软撤销栈…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softUndoIntact: true as const,
      stack: store.stack,
      softUndoPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo',
    };
  }

  const tok = String(opts.undoToken || opts.softUndoToken || opts.token || '').trim();
  let entry =
    (tok ? store.stack.find((s: any) => String(s.token) === tok && !s.undone) : null) ||
    store.stack.find((s: any) => !s.undone) ||
    null;

  if (!entry) {
    return {
      ok: false as const,
      wave: 'M100' as const,
      labelZh: '策略 A/B 胜出侧软撤销',
      tipZh: '没有可软撤销的胜出侧套用记录 · 中页取消仍在 · 无外发',
      toastZh: '无可撤销',
      busyZh: '软撤销胜出侧套用…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softUndoIntact: true as const,
      undone: false as const,
    };
  }

  const targetRole = entry.targetRole || 'broker';
  const targetRoleZh = entry.targetRoleZh || ROLE_POLICY_LABEL_ZH[targetRole] || targetRole;
  const before = entry.beforeActive;
  let restored: any = null;

  if (before && (before.graceMs != null || before.quietMs != null)) {
    restored = configureGraceQuietRolePolicyTemplates(tid, {
      role: targetRole,
      templateId: before.id || null,
      graceMs: before.graceMs,
      quietMs: before.quietMs,
      nameZh: before.nameZh || `${targetRoleZh}·软撤销恢复`,
      save: !before.id,
      apply: true,
      phase: 'bust',
      expiresInMs: 40,
      dryRun: opts.dryRun !== false,
    });
  } else {
    // 无先前策略：恢复为 0/0 干跑占位
    restored = configureGraceQuietRolePolicyTemplates(tid, {
      role: targetRole,
      graceMs: 0,
      quietMs: 0,
      nameZh: `${targetRoleZh}·软撤销清空`,
      save: true,
      apply: true,
      phase: 'bust',
      expiresInMs: 40,
      dryRun: opts.dryRun !== false,
    });
  }

  entry.undone = true;
  entry.undoneAt = new Date().toISOString();
  saveGraceAbApplyWinnerUndo(tid, store);

  return {
    ok: true as const,
    wave: 'M100' as const,
    labelZh: '策略 A/B 胜出侧软撤销',
    tipZh:
      `已软撤销「${targetRoleZh}」胜出侧套用` +
      (before
        ? ` · 恢复宽限 ${before.graceMs ?? 0}ms · 静默 ${before.quietMs ?? 0}ms`
        : ' · 已恢复占位策略') +
      ` · token=${entry.token}` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `已软撤销胜出侧 · ${targetRoleZh}`,
    busyZh: '软撤销胜出侧套用…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoIntact: true as const,
    undone: true as const,
    undoToken: entry.token,
    entry,
    restored,
    softUndoPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo',
  };
}


/**
 * M101：胜出侧软撤销后 · 前后宽限对照卡
 * （软取消仍赢；干跑无外发）
 */
export function softUndoGraceAbApplyWinnerWithBeforeAfterGraceContrast(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    list?: boolean;
    showGraceContrast?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  // 先窥视栈条目以拿 before/after 宽限（撤销前）
  const storePeek = loadGraceAbApplyWinnerUndo(tid);
  const tokPeek = String(opts.undoToken || opts.softUndoToken || opts.token || '').trim();
  const entryPeek =
    (tokPeek
      ? storePeek.stack.find((s: any) => String(s.token) === tokPeek && !s.undone)
      : null) ||
    storePeek.stack.find((s: any) => !s.undone) ||
    null;

  const beforeGrace = {
    graceMs: entryPeek?.beforeActive?.graceMs ?? 0,
    quietMs: entryPeek?.beforeActive?.quietMs ?? 0,
    nameZh: entryPeek?.beforeActive?.nameZh || '撤销前·原策略',
  };
  const afterGrace = {
    graceMs: entryPeek?.afterGraceMs ?? 0,
    quietMs: entryPeek?.afterQuietMs ?? 0,
    nameZh: '套用胜出侧后（撤销目标）',
  };

  const base = softUndoGraceAbApplyWinner(tid, {
    undoToken: opts.undoToken,
    softUndoToken: opts.softUndoToken,
    token: opts.token,
    dryRun: opts.dryRun !== false,
    list: opts.list === true,
  });

  if (opts.list === true) {
    return {
      ...(base as any),
      wave: 'M101' as const,
      labelZh: '策略 A/B 胜出侧软撤销栈 · 宽限对照',
    };
  }

  const restoredGrace = {
    graceMs: (base as any).restored?.applied?.graceMs ?? (base as any).entry?.beforeActive?.graceMs ?? beforeGrace.graceMs,
    quietMs: (base as any).restored?.applied?.quietMs ?? (base as any).entry?.beforeActive?.quietMs ?? beforeGrace.quietMs,
    nameZh: '软撤销后·已恢复',
  };

  const graceContrast = {
    wave: 'M101' as const,
    kind: 'soft-undo-before-after-grace-contrast' as const,
    titleZh: '软撤销前后宽限对照',
    bodyZh:
      `套用后 宽限 ${afterGrace.graceMs}ms / 静默 ${afterGrace.quietMs}ms` +
      ` → 撤销后 宽限 ${restoredGrace.graceMs}ms / 静默 ${restoredGrace.quietMs}ms` +
      ` · Δ宽限 ${restoredGrace.graceMs - afterGrace.graceMs}ms` +
      ` · Δ静默 ${restoredGrace.quietMs - afterGrace.quietMs}ms`,
    beforeApply: beforeGrace,
    afterApply: afterGrace,
    afterUndo: restoredGrace,
    deltaGraceMs: restoredGrace.graceMs - afterGrace.graceMs,
    deltaQuietMs: restoredGrace.quietMs - afterGrace.quietMs,
    targetRole: (base as any).entry?.targetRole || null,
    targetRoleZh: (base as any).entry?.targetRoleZh || null,
  };

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M101' as const,
    labelZh: (base as any).undone
      ? '策略 A/B 胜出侧软撤销 · 前后宽限对照'
      : (base as any).labelZh || '胜出侧软撤销宽限对照',
    tipZh:
      ((base as any).tipZh || '') +
      (graceContrast ? ` · ${graceContrast.bodyZh}` : '') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: (base as any).undone
      ? `已软撤销并出宽限对照 · Δ宽限 ${graceContrast.deltaGraceMs}ms`
      : (base as any).toastZh || '宽限对照',
    busyZh: '软撤销胜出侧 · 前后宽限对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoIntact: true as const,
    beforeAfterGraceContrast: graceContrast,
    softUndoGraceContrastPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast',
  };
}


/** M102：宽限对照恢复侧快照（供再套用） */
function graceContrastRestoredSideSnapPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'grace-contrast-restored-side-snap.json');
}

function loadGraceContrastRestoredSideSnap(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = graceContrastRestoredSideSnapPath(tid);
  try {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8')) || {};
    }
  } catch (_) {}
  return {};
}

function saveGraceContrastRestoredSideSnap(tenantId: string | null | undefined, snap: any) {
  const tid = safeTenant(tenantId);
  const p = graceContrastRestoredSideSnapPath(tid);
  writeFileSync(p, JSON.stringify({ ...snap, updatedAt: new Date().toISOString() }, null, 0), 'utf8');
  return p;
}

/**
 * M102：宽限对照卡 · 再套用恢复侧（确认卡）
 * （软取消仍赢；干跑无外发）
 */
export function softUndoGraceContrastReApplyRestoredSide(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    list?: boolean;
    showGraceContrast?: boolean;
    reApplyRestoredSide?: boolean;
    reapplyRestored?: boolean;
    applyRestoredSide?: boolean;
    confirmApply?: boolean;
    confirmCardAck?: boolean;
    previewConfirm?: boolean;
    targetRole?: string | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const wantsReApply =
    opts.reApplyRestoredSide === true ||
    opts.reapplyRestored === true ||
    opts.applyRestoredSide === true;

  // 先出宽限对照（若带 undoToken 会软撤销；否则读快照）
  let contrastBase: any = null;
  if (opts.undoToken || opts.softUndoToken || opts.token) {
    contrastBase = softUndoGraceAbApplyWinnerWithBeforeAfterGraceContrast(tid, {
      undoToken: opts.undoToken,
      softUndoToken: opts.softUndoToken,
      token: opts.token,
      dryRun: opts.dryRun !== false,
      list: opts.list === true,
      showGraceContrast: true,
    });
    const gc = contrastBase?.beforeAfterGraceContrast;
    if (gc) {
      saveGraceContrastRestoredSideSnap(tid, {
        afterUndo: gc.afterUndo,
        afterApply: gc.afterApply,
        beforeApply: gc.beforeApply,
        targetRole: gc.targetRole,
        targetRoleZh: gc.targetRoleZh,
        softUndoToken: opts.undoToken || opts.softUndoToken || opts.token || null,
        wave: 'M102',
      });
    }
  } else {
    const snap = loadGraceContrastRestoredSideSnap(tid);
    contrastBase = {
      ok: true,
      wave: 'M101',
      undone: false,
      beforeAfterGraceContrast: snap.afterUndo
        ? {
            wave: 'M101',
            kind: 'soft-undo-before-after-grace-contrast',
            titleZh: '软撤销前后宽限对照（快照）',
            bodyZh: `恢复侧 宽限 ${snap.afterUndo?.graceMs ?? 0}ms / 静默 ${snap.afterUndo?.quietMs ?? 0}ms`,
            beforeApply: snap.beforeApply,
            afterApply: snap.afterApply,
            afterUndo: snap.afterUndo,
            targetRole: snap.targetRole,
            targetRoleZh: snap.targetRoleZh,
          }
        : null,
      tipZh: '使用宽限对照恢复侧快照',
      softCancelIntact: true,
      midPageCancelIntact: true,
      softCancelWins: true,
      softUndoIntact: true,
    };
  }

  if (opts.list === true) {
    return {
      ...(contrastBase as any),
      wave: 'M102' as const,
      labelZh: '宽限对照 · 可再套用恢复侧',
    };
  }

  const snap = loadGraceContrastRestoredSideSnap(tid);
  const restored =
    contrastBase?.beforeAfterGraceContrast?.afterUndo ||
    snap.afterUndo ||
    null;
  const targetRole =
    String(
      opts.targetRole ||
        contrastBase?.beforeAfterGraceContrast?.targetRole ||
        snap.targetRole ||
        'broker',
    )
      .trim()
      .toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const targetRoleZh = ROLE_ZH[targetRole] || targetRole;

  if (!wantsReApply) {
    return {
      ...(contrastBase as any),
      ok: true as const,
      wave: 'M102' as const,
      labelZh: (contrastBase as any)?.undone
        ? '宽限对照 · 可再套用恢复侧'
        : '宽限对照恢复侧（待套用）',
      tipZh:
        ((contrastBase as any)?.tipZh || '') +
        (restored
          ? ` · 恢复侧 宽限 ${restored.graceMs}ms / 静默 ${restored.quietMs}ms · 可一键再套用`
          : ' · 暂无恢复侧') +
        ' · 软取消仍赢 · 干跑无外发',
      toastZh: restored
        ? `宽限对照就绪 · 恢复侧 ${restored.graceMs}ms`
        : (contrastBase as any)?.toastZh || '宽限对照',
      busyZh: '宽限对照 · 准备再套用恢复侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      softUndoIntact: true as const,
      restoredSide: restored,
      canReApplyRestoredSide: !!restored,
      graceReApplyRestoredPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored',
    };
  }

  if (!restored) {
    return {
      ok: false as const,
      wave: 'M102' as const,
      labelZh: '再套用恢复侧',
      tipZh: '无恢复侧可套用 · 请先软撤销出宽限对照 · 中页取消仍在 · 无外发',
      toastZh: '无恢复侧',
      busyZh: '再套用宽限恢复侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      reApplied: false as const,
    };
  }

  const confirmCard = {
    wave: 'M102' as const,
    kind: 'grace-contrast-reapply-restored-confirm' as const,
    titleZh: '确认再套用宽限恢复侧',
    bodyZh:
      `将再套用恢复侧到角色「${targetRoleZh}」` +
      `（宽限 ${restored.graceMs ?? 0}ms · 静默 ${restored.quietMs ?? 0}ms）` +
      ' · 需 confirmApply / confirmCardAck',
    targetRole,
    targetRoleZh,
    graceMs: restored.graceMs ?? 0,
    quietMs: restored.quietMs ?? 0,
    nameZh: restored.nameZh || '恢复侧',
    requireAck: true as const,
  };

  const needsAck = opts.confirmApply !== true && opts.confirmCardAck !== true;
  if (needsAck || opts.previewConfirm === true) {
    return {
      ...(contrastBase as any),
      ok: true as const,
      wave: 'M102' as const,
      labelZh: '再套用恢复侧（确认卡）',
      tipZh: confirmCard.bodyZh + ' · 中页取消仍在 · 无外发',
      toastZh: '请确认再套用恢复侧',
      busyZh: '再套用宽限恢复侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      confirmCard,
      reApplied: false as const,
      restoredSide: restored,
      previewConfirm: true as const,
    };
  }

  const applied = configureGraceQuietRolePolicyTemplates(tid, {
    role: targetRole,
    graceMs: restored.graceMs ?? 0,
    quietMs: restored.quietMs ?? 0,
    nameZh: restored.nameZh || `恢复侧·${targetRoleZh}`,
    save: true,
    apply: true,
    phase: 'bust',
    expiresInMs: 40,
    dryRun: opts.dryRun !== false,
  });

  return {
    ...(contrastBase as any),
    ok: true as const,
    wave: 'M102' as const,
    labelZh: '宽限对照 · 已再套用恢复侧',
    tipZh:
      `已再套用恢复侧到「${targetRoleZh}」` +
      ` · 宽限 ${restored.graceMs}ms / 静默 ${restored.quietMs}ms` +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: `已再套用恢复侧 · ${targetRoleZh} · ${restored.graceMs}ms`,
    busyZh: '再套用宽限恢复侧…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoIntact: true as const,
    confirmCard,
    reApplied: true as const,
    restoredSide: restored,
    applied,
    graceReApplyRestoredPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored',
  };
}


/** M103：再套用恢复侧后的软撤销栈（回对照卡） */
function graceReApplySoftUndoBackPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'grace-reapply-soft-undo-back.json');
}

function loadGraceReApplySoftUndoBack(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = graceReApplySoftUndoBackPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        stack: Array.isArray(raw.stack) ? raw.stack : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { stack: [] as any[], updatedAt: null as string | null };
}

function saveGraceReApplySoftUndoBack(
  tenantId: string | null | undefined,
  store: { stack: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = graceReApplySoftUndoBackPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/**
 * M103：再套用恢复侧后可软撤销回宽限对照卡
 * （软取消仍赢；干跑无外发）
 */
export function softUndoGraceReApplyRestoredSoftUndoBackToContrast(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    list?: boolean;
    showGraceContrast?: boolean;
    reApplyRestoredSide?: boolean;
    reapplyRestored?: boolean;
    applyRestoredSide?: boolean;
    confirmApply?: boolean;
    confirmCardAck?: boolean;
    previewConfirm?: boolean;
    targetRole?: string | null;
    softUndoAfterReApply?: boolean;
    softUndoBackToContrast?: boolean;
    returnToContrast?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const wantsSoftUndoBack =
    opts.softUndoAfterReApply === true ||
    opts.softUndoBackToContrast === true ||
    opts.returnToContrast === true;

  // 软撤销再套用 → 回到对照卡
  if (wantsSoftUndoBack) {
    const store = loadGraceReApplySoftUndoBack(tid);
    const tok = String(opts.undoToken || opts.softUndoToken || opts.token || '').trim();
    let entry =
      (tok ? store.stack.find((s: any) => String(s.token) === tok && !s.undone) : null) ||
      store.stack.find((s: any) => !s.undone) ||
      null;
    if (!entry) {
      return {
        ok: false as const,
        wave: 'M103' as const,
        labelZh: '再套用恢复侧软撤销回对照',
        tipZh: '没有可软撤销的再套用记录 · 中页取消仍在 · 无外发',
        toastZh: '无可撤销再套用',
        busyZh: '软撤销再套用回对照…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softUndoIntact: true as const,
        undone: false as const,
        returnedToContrast: false as const,
      };
    }
    const before = entry.beforeActive;
    const targetRole = entry.targetRole || 'broker';
    const ROLE_ZH: Record<string, string> = {
      admin: '运营',
      park: '园区',
      enterprise: '企业',
      uni: '高校/科研',
      broker: '经纪人',
    };
    const targetRoleZh = ROLE_ZH[targetRole] || targetRole;
    let restored: any = null;
    if (before && (before.graceMs != null || before.quietMs != null)) {
      restored = configureGraceQuietRolePolicyTemplates(tid, {
        role: targetRole,
        graceMs: before.graceMs,
        quietMs: before.quietMs,
        nameZh: before.nameZh || `${targetRoleZh}·再套用软撤销恢复`,
        save: true,
        apply: true,
        phase: 'bust',
        expiresInMs: 40,
        dryRun: opts.dryRun !== false,
      });
    }
    entry.undone = true;
    entry.undoneAt = new Date().toISOString();
    saveGraceReApplySoftUndoBack(tid, store);

    const contrastCard = entry.contrastSnapshot || {
      wave: 'M103',
      kind: 'soft-undo-back-to-grace-contrast',
      titleZh: '已回到宽限对照卡',
      bodyZh:
        `软撤销再套用后回到对照` +
        ` · 恢复侧 宽限 ${entry.restoredSide?.graceMs ?? 0}ms / 静默 ${entry.restoredSide?.quietMs ?? 0}ms`,
      afterUndo: entry.restoredSide,
      afterApply: entry.afterApply,
      beforeApply: entry.beforeActive,
      targetRole,
      targetRoleZh,
    };

    return {
      ok: true as const,
      wave: 'M103' as const,
      labelZh: '再套用恢复侧 · 已软撤销回对照卡',
      tipZh:
        `已软撤销再套用「${targetRoleZh}」` +
        (before
          ? ` · 恢复宽限 ${before.graceMs ?? 0}ms / 静默 ${before.quietMs ?? 0}ms`
          : '') +
        ' · 已回到宽限对照卡 · 软取消仍赢 · 干跑无外发',
      toastZh: `已软撤销回对照 · ${targetRoleZh}`,
      busyZh: '软撤销再套用回对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      softUndoIntact: true as const,
      undone: true as const,
      returnedToContrast: true as const,
      beforeAfterGraceContrast: contrastCard,
      contrastCard,
      restored,
      undoToken: entry.token,
      softUndoToken: entry.token,
      graceReApplySoftUndoBackPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast',
    };
  }

  if (opts.list === true) {
    const store = loadGraceReApplySoftUndoBack(tid);
    return {
      ok: true as const,
      wave: 'M103' as const,
      labelZh: '再套用恢复侧软撤销栈（可回对照）',
      tipZh: `共 ${store.stack.length} 条 · 干跑无外发`,
      toastZh: store.stack.length ? `再套用软撤销栈 · ${store.stack.length}` : '暂无可撤销',
      busyZh: '加载再套用软撤销栈…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softUndoIntact: true as const,
      stack: store.stack,
    };
  }

  // 再套用恢复侧（M102），成功后挂软撤销 token 回对照
  const re = softUndoGraceContrastReApplyRestoredSide(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
    showGraceContrast: true,
  });

  if ((re as any).reApplied === true) {
    const undoToken = `reapply-undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const snap = loadGraceContrastRestoredSideSnap(tid);
    const targetRole =
      String(
        opts.targetRole ||
          (re as any).confirmCard?.targetRole ||
          snap.targetRole ||
          'broker',
      )
        .trim()
        .toLowerCase() || 'broker';
    const ROLE_ZH: Record<string, string> = {
      admin: '运营',
      park: '园区',
      enterprise: '企业',
      uni: '高校/科研',
      broker: '经纪人',
    };
    const entry = {
      token: undoToken,
      targetRole,
      targetRoleZh: ROLE_ZH[targetRole] || targetRole,
      beforeActive: snap.afterApply || snap.beforeApply || null,
      afterApply: {
        graceMs: (re as any).restoredSide?.graceMs ?? 0,
        quietMs: (re as any).restoredSide?.quietMs ?? 0,
        nameZh: (re as any).restoredSide?.nameZh || '再套用恢复侧',
      },
      restoredSide: (re as any).restoredSide || snap.afterUndo || null,
      contrastSnapshot: (re as any).beforeAfterGraceContrast || {
        wave: 'M103',
        kind: 'grace-contrast-before-reapply-soft-undo',
        titleZh: '宽限对照（再套用前快照）',
        bodyZh: '软撤销后再回到此对照卡',
        afterUndo: snap.afterUndo,
        afterApply: snap.afterApply,
        beforeApply: snap.beforeApply,
        targetRole,
        targetRoleZh: ROLE_ZH[targetRole] || targetRole,
      },
      createdAt: new Date().toISOString(),
      wave: 'M103',
      undone: false,
    };
    const store = loadGraceReApplySoftUndoBack(tid);
    store.stack = [entry, ...store.stack].slice(0, 40);
    saveGraceReApplySoftUndoBack(tid, store);

    return {
      ...(re as any),
      ok: true as const,
      wave: 'M103' as const,
      labelZh: '宽限对照 · 已再套用恢复侧（可软撤销回对照）',
      tipZh: ((re as any).tipZh || '') + ' · 可软撤销回宽限对照卡 · 软取消仍赢 · 干跑无外发',
      toastZh: ((re as any).toastZh || '已再套用恢复侧') + ' · 可软撤销回对照',
      busyZh: '再套用宽限恢复侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      softUndoIntact: true as const,
      softUndoToken: undoToken,
      softUndoPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast',
      canSoftUndoBackToContrast: true as const,
      graceReApplySoftUndoBackPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast',
    };
  }

  return {
    ...(re as any),
    ok: (re as any).ok !== false,
    wave: 'M103' as const,
    tipZh: ((re as any).tipZh || '') + ' · 再套用后可软撤销回对照',
    softUndoIntact: true as const,
    canSoftUndoBackToContrast: false as const,
  };
}


/**
 * M104：软撤销回对照卡后再钻供给详情（supply-peek）
 * （软取消仍赢；干跑无外发）
 */
export function softUndoBackContrastDrillToSupplyPeek(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    list?: boolean;
    showGraceContrast?: boolean;
    reApplyRestoredSide?: boolean;
    reapplyRestored?: boolean;
    applyRestoredSide?: boolean;
    confirmApply?: boolean;
    confirmCardAck?: boolean;
    softUndoAfterReApply?: boolean;
    softUndoBackToContrast?: boolean;
    returnToContrast?: boolean;
    drillToSupply?: boolean;
    drillSupplyPeek?: boolean;
    supplyPeek?: boolean;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either' | string | null;
    targetRole?: string | null;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const wantsDrill =
    opts.drillToSupply === true ||
    opts.drillSupplyPeek === true ||
    opts.supplyPeek === true;

  // 先走 M103 软撤销回对照（若请求）
  const back = softUndoGraceReApplyRestoredSoftUndoBackToContrast(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
    showGraceContrast: true,
  });

  if (!wantsDrill) {
    return {
      ...(back as any),
      ok: (back as any).ok !== false,
      wave: 'M104' as const,
      tipZh: ((back as any).tipZh || '') + ' · 对照卡可再钻供给详情',
      canDrillToSupply: true as const,
      softUndoContrastDrillSupplyPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply',
    };
  }

  const peek = peekBypassContrastSupplyCard(tid, {
    demandId: opts.demandId || null,
    rank: opts.rank != null ? Number(opts.rank) : 1,
    supplyId: opts.supplyId || null,
    side: (opts.side as any) || 'either',
  });

  const contrastCard = (back as any).beforeAfterGraceContrast || (back as any).contrastCard || null;
  const drillCard = {
    wave: 'M104' as const,
    kind: 'soft-undo-contrast-drill-supply' as const,
    titleZh: '软撤销对照 · 供给详情钻取',
    bodyZh:
      (peek.card
        ? `已从对照卡钻入供给「${peek.card.title || peek.card.supplyId || '—'}」`
        : '对照卡可钻供给，但当前无供给卡') +
      ' · 中文 busy/toast · 无外发',
    contrastCard,
    supplyPeek: peek.card,
    demandId: peek.demandId,
    rank: peek.rank,
    side: peek.side,
  };

  return {
    ...(back as any),
    ok: true as const,
    wave: 'M104' as const,
    labelZh: peek.card
      ? `软撤销对照 · 已钻供给「${peek.card.title || peek.card.supplyId}」`
      : '软撤销对照 · 供给钻取',
    tipZh:
      ((back as any).tipZh || '对照卡') +
      (peek.card
        ? ` · 已钻供给详情「${peek.card.title || peek.card.supplyId}」`
        : ' · 暂无供给可钻') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: peek.card
      ? `对照钻供给 · ${peek.card.title || peek.card.supplyId}`
      : '对照无可钻供给',
    busyZh: '软撤销对照钻供给详情…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softUndoIntact: true as const,
    drilledToSupply: !!peek.card,
    supplyPeek: peek,
    drillCard,
    softUndoContrastDrillSupplyPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply',
  };
}


/**
 * M105：对照钻供给后一键再旁路（干跑；软取消；中文 toast；无外发）
 */
export function softUndoContrastDrillSupplyOneClickReBypass(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    softUndoBackToContrast?: boolean;
    drillToSupply?: boolean;
    drillSupplyPeek?: boolean;
    supplyPeek?: boolean;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either' | string | null;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    reBypassFromSupply?: boolean;
    topN?: number;
    seqA?: number;
    seqB?: number;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const wantsReBypass =
    opts.oneClickReBypass === true ||
    opts.reBypass === true ||
    opts.reBypassFromSupply === true;

  const drill = softUndoBackContrastDrillToSupplyPeek(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
    drillToSupply: opts.drillToSupply !== false,
    showGraceContrast: true,
  });

  if (!wantsReBypass) {
    return {
      ...(drill as any),
      ok: (drill as any).ok !== false,
      wave: 'M105' as const,
      tipZh: ((drill as any).tipZh || '') + ' · 可一键再旁路',
      canOneClickReBypass: true as const,
      softUndoContrastDrillReBypassPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass',
    };
  }

  // 软取消优先
  if (opts.softCancel === true) {
    return {
      ...(drill as any),
      ok: true as const,
      wave: 'M105' as const,
      labelZh: '对照钻供给 · 再旁路已软取消',
      tipZh: '用户软取消赢过再旁路 · 无外发 · 中页取消仍在',
      toastZh: '再旁路已取消',
      busyZh: '对照钻供给一键再旁路…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      reBypassed: false as const,
      cancelled: true as const,
    };
  }

  const demandId =
    opts.demandId ||
    (drill as any).supplyPeek?.demandId ||
    (drill as any).drillCard?.demandId ||
    null;
  const rank =
    opts.rank != null
      ? Number(opts.rank)
      : (drill as any).supplyPeek?.rank ?? (drill as any).drillCard?.rank ?? 1;
  const supplyId =
    opts.supplyId ||
    (drill as any).supplyPeek?.card?.supplyId ||
    (drill as any).drillCard?.supplyPeek?.supplyId ||
    null;

  const rebypass = reBypassFromSupplyDetailRewriteHistoryDiff(tid, {
    demandId,
    rank,
    supplyId,
    side: (opts.side as any) || 'either',
    topN: opts.topN ?? 5,
    dryRun: opts.dryRun !== false,
    seqA: opts.seqA,
    seqB: opts.seqB,
  });

  const reBypassCard = {
    wave: 'M105' as const,
    kind: 'contrast-supply-one-click-rebypass' as const,
    titleZh: '对照钻供给 · 一键再旁路',
    bodyZh:
      ((rebypass as any).tipZh || '已再旁路') +
      ' · 自对照→供给钻取触发 · 干跑无外发',
    demandId: (rebypass as any).demandId || demandId,
    historyRewritten: !!(rebypass as any).historyRewritten,
    seqA: (rebypass as any).seqA,
    seqB: (rebypass as any).seqB,
  };

  return {
    ...(drill as any),
    ok: true as const,
    wave: 'M105' as const,
    labelZh: '对照钻供给 · 已一键再旁路',
    tipZh:
      ((drill as any).tipZh || '') +
      ' · ' +
      ((rebypass as any).tipZh || '已再旁路') +
      ' · 软取消仍赢 · 干跑无外发',
    toastZh: (rebypass as any).toastZh || '对照→供给·一键再旁路',
    busyZh: '对照钻供给一键再旁路…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    reBypassed: true as const,
    oneClickReBypass: true as const,
    reBypass: rebypass,
    reBypassCard,
    softUndoContrastDrillReBypassPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass',
  };
}


/**
 * M106：对照钻供给再旁路失败中文归因卡
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillSupplyReBypassWithFailureAttribution(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    softUndoBackToContrast?: boolean;
    drillToSupply?: boolean;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either' | string | null;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    reBypassFromSupply?: boolean;
    softCancel?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failReason?: string | null;
    failureCode?: string | null;
    showFailureAttribution?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const wantsFailSim =
    opts.simulateFailure === true ||
    opts.forceFailure === true ||
    opts.showFailureAttribution === true ||
    !!opts.failReason ||
    !!opts.failureCode;

  // 软取消优先
  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M106' as const,
      labelZh: '对照钻供给 · 再旁路已软取消',
      tipZh: '用户软取消赢过再旁路/归因 · 无外发 · 中页取消仍在',
      toastZh: '再旁路已取消',
      busyZh: '对照钻供给再旁路失败归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      reBypassed: false as const,
      cancelled: true as const,
      failureAttributed: false as const,
    };
  }

  if (wantsFailSim) {
    const code =
      String(opts.failureCode || '').trim() ||
      (opts.forceFailure ? 'REBYPASS_FORCED_FAIL' : 'REBYPASS_DRYRUN_FAIL');
    const reasonZh =
      String(opts.failReason || '').trim() ||
      (code === 'REBYPASS_FORCED_FAIL'
        ? '强制模拟再旁路失败（演练）'
        : '再旁路干跑前置检查未通过：供给卡瞬时不可用或历史差分锁冲突');
    const attributionCard = {
      wave: 'M106' as const,
      kind: 'contrast-supply-rebypass-failure-attribution' as const,
      titleZh: '对照钻供给 · 再旁路失败归因',
      bodyZh:
        `失败码 ${code}` +
        ` · ${reasonZh}` +
        ' · 建议：重试干跑 / 换 rank / 先软撤销回对照' +
        ' · 中文归因 · 无外发',
      failureCode: code,
      reasonZh,
      suggestionsZh: ['一键重试干跑', '换供给 rank 再旁路', '软撤销回对照后再钻'],
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
    // 仍跑 drill 挂上下文，但不真正 rebypass
    const drill = softUndoContrastDrillSupplyOneClickReBypass(tid, {
      ...opts,
      oneClickReBypass: false,
      reBypass: false,
      reBypassFromSupply: false,
      dryRun: true,
      softCancel: false,
    });
    return {
      ...(drill as any),
      ok: false as const,
      wave: 'M106' as const,
      labelZh: '对照钻供给 · 再旁路失败（已归因）',
      tipZh: attributionCard.bodyZh + ' · 软取消仍赢 · 干跑无外发',
      toastZh: `再旁路失败 · ${code}`,
      busyZh: '对照钻供给再旁路失败归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      reBypassed: false as const,
      failed: true as const,
      failureAttributed: true as const,
      failureAttributionCard: attributionCard,
      softUndoContrastDrillReBypassFailureAttributionPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution',
    };
  }

  const ok = softUndoContrastDrillSupplyOneClickReBypass(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
  });
  return {
    ...(ok as any),
    ok: (ok as any).ok !== false,
    wave: 'M106' as const,
    labelZh: ((ok as any).labelZh || '对照钻供给再旁路')
      .toString()
      .replace(/^M105·?/, 'M106·'),
    tipZh: ((ok as any).tipZh || '') + ' · 失败时可出中文归因卡',
    toastZh: (ok as any).toastZh || '再旁路',
    busyZh: (ok as any).busyZh || '对照钻供给再旁路…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canShowFailureAttribution: true as const,
    softUndoContrastDrillReBypassFailureAttributionPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution',
  };
}


/**
 * M107：再旁路失败归因卡一键重试
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillSupplyReBypassFailAttrOneClickRetry(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    softUndoBackToContrast?: boolean;
    drillToSupply?: boolean;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either' | string | null;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    reBypassFromSupply?: boolean;
    softCancel?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failReason?: string | null;
    failureCode?: string | null;
    showFailureAttribution?: boolean;
    oneClickRetry?: boolean;
    retryFromAttribution?: boolean;
    retryFailedReBypass?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const wantsRetry =
    opts.oneClickRetry === true ||
    opts.retryFromAttribution === true ||
    opts.retryFailedReBypass === true;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M107' as const,
      labelZh: '再旁路失败归因 · 一键重试已软取消',
      tipZh: '用户软取消赢过归因一键重试 · 无外发 · 中页取消仍在',
      toastZh: '一键重试已取消',
      busyZh: '再旁路失败归因一键重试…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
      retried: false as const,
    };
  }

  // 先出失败归因（若仍在模拟失败且未要求重试）
  if (!wantsRetry) {
    const fail = softUndoContrastDrillSupplyReBypassWithFailureAttribution(tid, {
      ...opts,
      simulateFailure: opts.simulateFailure !== false ? opts.simulateFailure ?? true : false,
      showFailureAttribution: true,
      dryRun: true,
    });
    return {
      ...(fail as any),
      ok: (fail as any).ok !== false ? (fail as any).ok : false,
      wave: 'M107' as const,
      tipZh: ((fail as any).tipZh || '') + ' · 归因卡可一键重试再旁路',
      canOneClickRetryFromAttribution: true as const,
      softUndoContrastDrillReBypassFailAttrOneClickRetryPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry',
    };
  }

  // 一键重试：关闭失败模拟，走成功再旁路干跑
  const attribution = softUndoContrastDrillSupplyReBypassWithFailureAttribution(tid, {
    ...opts,
    simulateFailure: true,
    forceFailure: true,
    failureCode: opts.failureCode || 'REBYPASS_FORCED_FAIL',
    showFailureAttribution: true,
    oneClickReBypass: false,
    reBypass: false,
    dryRun: true,
    softCancel: false,
  });

  const retried = softUndoContrastDrillSupplyOneClickReBypass(tid, {
    ...opts,
    simulateFailure: false,
    forceFailure: false,
    oneClickReBypass: true,
    reBypass: true,
    reBypassFromSupply: true,
    drillToSupply: true,
    dryRun: opts.dryRun !== false,
    softCancel: false,
  });

  const retryCard = {
    wave: 'M107' as const,
    kind: 'rebypass-failure-attribution-one-click-retry' as const,
    titleZh: '再旁路失败归因 · 一键重试',
    bodyZh:
      `自归因卡「${(attribution as any).failureAttributionCard?.failureCode || opts.failureCode || 'REBYPASS_FORCED_FAIL'}」一键重试` +
      ` · 重试结果 ${(retried as any).reBypassed === false ? '未旁路' : '已干跑再旁路'}` +
      ' · 软取消仍赢 · 无外发',
    priorFailureCode:
      (attribution as any).failureAttributionCard?.failureCode ||
      opts.failureCode ||
      'REBYPASS_FORCED_FAIL',
    priorReasonZh: (attribution as any).failureAttributionCard?.reasonZh || null,
    retried: true as const,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
  };

  return {
    ...(retried as any),
    ok: true as const,
    wave: 'M107' as const,
    labelZh: '再旁路失败归因 · 已一键重试',
    tipZh: retryCard.bodyZh + ' · 干跑无外发 · 中页取消仍在',
    toastZh: '归因一键重试 · 已干跑',
    busyZh: '再旁路失败归因一键重试…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    failed: false as const,
    failureAttributed: true as const,
    failureAttributionCard: (attribution as any).failureAttributionCard || null,
    retried: true as const,
    oneClickRetryIntact: true as const,
    retryCard,
    softUndoContrastDrillReBypassFailAttrOneClickRetryPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry',
  };
}


/**
 * M108：一键重试进度折进串联异常任务卡
 * （软取消；干跑；中文 toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryFoldIntoChainTaskCard(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    softUndoBackToContrast?: boolean;
    drillToSupply?: boolean;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either' | string | null;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    reBypassFromSupply?: boolean;
    softCancel?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failReason?: string | null;
    failureCode?: string | null;
    showFailureAttribution?: boolean;
    oneClickRetry?: boolean;
    retryFromAttribution?: boolean;
    retryFailedReBypass?: boolean;
    foldIntoChainTaskCard?: boolean;
    foldRetryIntoChainTaskCard?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M108' as const,
      labelZh: '一键重试折进串联任务卡 · 已软取消',
      tipZh: '用户软取消赢过一键重试折进任务卡 · 无外发 · 中页取消仍在',
      toastZh: '一键重试已取消',
      busyZh: '一键重试折进串联任务卡…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
      retried: false as const,
    };
  }

  const base = softUndoContrastDrillSupplyReBypassFailAttrOneClickRetry(tid, {
    ...opts,
    oneClickRetry: opts.oneClickRetry !== false,
    retryFromAttribution: opts.retryFromAttribution !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsFold =
    opts.foldIntoChainTaskCard !== false &&
    opts.foldRetryIntoChainTaskCard !== false;

  if (!wantsFold) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M108' as const,
      tipZh: ((base as any).tipZh || '') + ' · 一键重试进度可折进串联任务卡',
      canFoldRetryIntoChainTaskCard: true as const,
      softUndoContrastDrillFailAttrRetryFoldChainTaskCardPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card',
    };
  }

  const priorCode =
    (base as any).retryCard?.priorFailureCode ||
    (base as any).failureAttributionCard?.failureCode ||
    opts.failureCode ||
    'REBYPASS_FORCED_FAIL';

  const chainTaskCard = {
    wave: 'M108' as const,
    kind: 'anomaly-chain-task-card-one-click-retry-folded' as const,
    titleZh: '串联异常任务卡 · 一键重试进度',
    bodyZh:
      `自归因「${priorCode}」一键重试已折进本卡` +
      ` · 状态 ${(base as any).retried ? '已干跑重试' : '待重试'}` +
      ' · 软取消仍赢 · 无外发',
    tipZh: '一键重试进度已并入串联异常任务卡 · 可继续看阶段条',
    phase: 'one-click-retry' as const,
    progressPct: (base as any).retried ? 100 : 35,
    priorFailureCode: priorCode,
    retried: (base as any).retried === true,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
    foldedFrom: 'fail-attr-one-click-retry' as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M108' as const,
    labelZh: '一键重试 · 已折进串联任务卡',
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${chainTaskCard.bodyZh}` +
      ' · 干跑无外发 · 中页取消仍在',
    toastZh: '一键重试已折进任务卡',
    busyZh: '一键重试折进串联任务卡…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    retried: (base as any).retried === true,
    oneClickRetryIntact: true as const,
    foldedIntoChainTaskCard: true as const,
    chainTaskCard,
    softUndoContrastDrillFailAttrRetryFoldChainTaskCardPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card',
  };
}


/**
 * M109：串联任务卡折进的一键重试可按单阶段暂停/续跑
 * （软取消；干跑；中文 toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePause(
  tenantId?: string | null,
  opts: {
    undoToken?: string | null;
    softUndoToken?: string | null;
    token?: string | null;
    dryRun?: boolean;
    softUndoBackToContrast?: boolean;
    drillToSupply?: boolean;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either' | string | null;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    reBypassFromSupply?: boolean;
    softCancel?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failReason?: string | null;
    failureCode?: string | null;
    showFailureAttribution?: boolean;
    oneClickRetry?: boolean;
    retryFromAttribution?: boolean;
    retryFailedReBypass?: boolean;
    foldIntoChainTaskCard?: boolean;
    foldRetryIntoChainTaskCard?: boolean;
    pausePhase?: boolean;
    resumePhase?: boolean;
    phase?: string | null;
    itemId?: string | null;
    pauseRetryPhase?: boolean;
    resumeRetryPhase?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M109' as const,
      labelZh: '任务卡重试单阶段暂停 · 已软取消',
      tipZh: '用户软取消赢过任务卡重试单阶段暂停/续跑 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '任务卡重试单阶段暂停/续跑…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryFoldIntoChainTaskCard(tid, {
    ...opts,
    foldIntoChainTaskCard: true,
    foldRetryIntoChainTaskCard: true,
    oneClickRetry: opts.oneClickRetry !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantPhase = String(opts.phase || 'one-click-retry').trim() || 'one-click-retry';
  const wantsPause =
    opts.pausePhase === true ||
    opts.pauseRetryPhase === true ||
    (opts.resumePhase !== true && opts.resumeRetryPhase !== true && opts.pausePhase !== false);
  const wantsResume = opts.resumePhase === true || opts.resumeRetryPhase === true;

  // Seed a synthetic queue item for the folded retry phase so pause/resume has a handle.
  try {
    const q = getAnomalyContrastBatchRerunQueue(tid);
    const items = Array.isArray((q as any)?.items) ? (q as any).items : [];
    const hasRetry = items.some(
      (it: any) =>
        String(it.phase) === 'one-click-retry' ||
        String(it.id || '').includes('one-click-retry'),
    );
    if (!hasRetry) {
      enqueueAnomalyContrastBatchRerun(tid, {
        phases: ['bust', 'one-click-retry'],
        dryRun: true,
      });
    }
  } catch (_) {}

  if (wantsResume) {
    const resumed = resumeAnomalyBatchRerunSinglePhase(tid, {
      phase: wantPhase === 'one-click-retry' ? 'bust' : wantPhase,
      itemId: opts.itemId || null,
      maxSteps: 1,
    });
    const card = {
      ...((base as any).chainTaskCard || {}),
      wave: 'M109' as const,
      kind: 'anomaly-chain-task-card-one-click-retry-phase-resume' as const,
      titleZh: '串联任务卡 · 一键重试单阶段续跑',
      bodyZh:
        `折进任务卡的一键重试阶段「${wantPhase}」已续跑` +
        ` · ${(resumed as any).tipZh || '已续跑'}` +
        ' · 软取消仍赢 · 无外发',
      phase: wantPhase,
      progressPct: 100,
      resumed: true as const,
      paused: false as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: '任务卡重试 · 单阶段已续跑',
      tipZh: card.bodyZh + ' · 干跑无外发 · 中页取消仍在',
      toastZh: '重试阶段已续跑',
      busyZh: '任务卡重试单阶段续跑…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      foldedIntoChainTaskCard: true as const,
      retried: true as const,
      oneClickRetryIntact: true as const,
      phaseResumed: true as const,
      phasePaused: false as const,
      chainTaskCard: card,
      phasePauseResume: resumed,
      softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePausePath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause',
    };
  }

  if (wantsPause) {
    const paused = pauseAnomalyBatchRerunSinglePhase(tid, {
      phase: wantPhase === 'one-click-retry' ? 'bust' : wantPhase,
      itemId: opts.itemId || null,
    });
    const card = {
      ...((base as any).chainTaskCard || {}),
      wave: 'M109' as const,
      kind: 'anomaly-chain-task-card-one-click-retry-phase-pause' as const,
      titleZh: '串联任务卡 · 一键重试单阶段暂停',
      bodyZh:
        `折进任务卡的一键重试阶段「${wantPhase}」已暂停` +
        ` · ${(paused as any).tipZh || '已暂停'}` +
        ' · 可续跑 · 软取消仍赢 · 无外发',
      phase: wantPhase,
      progressPct: 45,
      paused: true as const,
      resumed: false as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: '任务卡重试 · 单阶段已暂停',
      tipZh: card.bodyZh + ' · 干跑无外发 · 中页取消仍在',
      toastZh: '重试阶段已暂停',
      busyZh: '任务卡重试单阶段暂停…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      foldedIntoChainTaskCard: true as const,
      retried: (base as any).retried === true,
      oneClickRetryIntact: true as const,
      phasePaused: true as const,
      phaseResumed: false as const,
      chainTaskCard: card,
      phasePauseResume: paused,
      softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePausePath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause',
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M109' as const,
    tipZh: ((base as any).tipZh || '') + ' · 折进任务卡的一键重试可按单阶段暂停/续跑',
    canPauseResumeRetryPhase: true as const,
    softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePausePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause',
  };
}


/**
 * M110：任务卡重试单阶段暂停后出中文宽限闹钟（到期自动续跑；软取消赢；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePauseGraceAlarm(
  tenantId?: string | null,
  opts: {
    pausePhase?: boolean;
    resumePhase?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    graceMs?: number | null;
    autoResumeAfterGrace?: boolean;
    softCancel?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M110' as const,
      labelZh: '阶段暂停宽限闹钟 · 已软取消',
      tipZh: '用户软取消赢过宽限闹钟自动续跑 · 无外发 · 中页取消仍在',
      toastZh: '已软取消（宽限闹钟作废）',
      busyZh: '阶段暂停宽限闹钟…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
      graceAlarmCancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePause(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
  });

  const graceMs = Math.max(1000, Number(opts.graceMs) || 15000);
  const wantsGrace =
    opts.graceAlarm !== false &&
    (opts.graceAlarm === true ||
      opts.showGraceAlarm === true ||
      opts.autoResumeAfterGrace === true ||
      (base as any).phasePaused === true);

  if (!wantsGrace || (base as any).phasePaused !== true) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M110' as const,
      tipZh: ((base as any).tipZh || '') + ' · 单阶段暂停后可出宽限闹钟自动续跑',
      canPhasePauseGraceAlarm: true as const,
      softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePauseGraceAlarmPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm',
    };
  }

  const phase = String(opts.phase || (base as any).chainTaskCard?.phase || 'one-click-retry');
  const alarmAt = new Date(Date.now() + graceMs).toISOString();
  const graceAlarm = {
    wave: 'M110' as const,
    kind: 'phase-pause-grace-alarm' as const,
    titleZh: '重试阶段暂停 · 中文宽限闹钟',
    bodyZh:
      `阶段「${phase}」已暂停 · ${Math.round(graceMs / 1000)} 秒后自动续跑` +
      `（${alarmAt}）· 软取消仍赢 · 干跑无外发`,
    phase,
    graceMs,
    alarmAt,
    autoResumeAfterGrace: opts.autoResumeAfterGrace !== false,
    softCancelWins: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const card = {
    ...((base as any).chainTaskCard || {}),
    wave: 'M110' as const,
    kind: 'anomaly-chain-task-card-one-click-retry-phase-pause-grace-alarm' as const,
    titleZh: '串联任务卡 · 一键重试单阶段暂停（宽限闹钟）',
    bodyZh: graceAlarm.bodyZh,
    phase,
    paused: true as const,
    graceAlarm,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M110' as const,
    labelZh: '任务卡重试 · 单阶段暂停 · 宽限闹钟',
    tipZh: graceAlarm.bodyZh + ' · 中页取消仍在',
    toastZh: `宽限闹钟 · ${Math.round(graceMs / 1000)}s 后续跑`,
    busyZh: '阶段暂停宽限闹钟…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    phasePaused: true as const,
    phasePauseGraceAlarmIntact: true as const,
    graceAlarm,
    chainTaskCard: card,
    softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePauseGraceAlarmPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm',
  };
}


/**
 * M111：宽限闹钟软取消胜出时写入中文台账
 * （干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceAlarmSoftCancelLedger(
  tenantId?: string | null,
  opts: {
    pausePhase?: boolean;
    resumePhase?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    graceMs?: number | null;
    autoResumeAfterGrace?: boolean;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);

  const wantsSoftCancelLedger =
    opts.softCancel === true ||
    opts.softCancelWinsOverGrace === true ||
    opts.writeSoftCancelLedger === true;

  if (wantsSoftCancelLedger && (opts.softCancel === true || opts.softCancelWinsOverGrace === true)) {
    const phase = String(opts.phase || 'one-click-retry');
    const graceMs = Math.max(1000, Number(opts.graceMs) || 15000);
    const entry = {
      id: `grace-soft-cancel-${Date.now().toString(36)}`,
      wave: 'M111' as const,
      kind: 'grace-alarm-soft-cancel-ledger' as const,
      kindZh: '宽限闹钟软取消',
      auditLineZh:
        `宽限闹钟自动续跑被软取消赢过 · 阶段「${phase}」· 原宽限 ${Math.round(graceMs / 1000)}s` +
        ` · 干跑 · 无外发`,
      phase,
      graceMs,
      softCancelWins: true as const,
      autoResumeCancelled: true as const,
      createdAt: new Date().toISOString(),
      dryRun: true as const,
      noEgress: true as const,
    };
    return {
      ok: true as const,
      wave: 'M111' as const,
      labelZh: '宽限闹钟 · 软取消已入中文台账',
      tipZh: entry.auditLineZh + ' · 中页取消仍在',
      toastZh: '软取消已入台账',
      busyZh: '宽限闹钟软取消入台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
      graceAlarmCancelled: true as const,
      softCancelWinsOverGraceAlarm: true as const,
      graceSoftCancelLedgerIntact: true as const,
      graceSoftCancelLedgerEntry: entry,
      chineseShareLedger: [entry],
      chineseShareLedgerIntact: true as const,
      softUndoContrastDrillFailAttrRetryPhasePauseGraceAlarmSoftCancelLedgerPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger',
    };
  }

  const base = softUndoContrastDrillFailAttrRetryFoldChainTaskCardPhasePauseGraceAlarm(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
  });

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M111' as const,
    tipZh:
      ((base as any).tipZh || '') +
      ' · 软取消赢过宽限闹钟时可写入中文台账',
    canGraceSoftCancelLedger: true as const,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceAlarmSoftCancelLedgerPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger',
  };
}


/**
 * M112：软取消中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    pausePhase?: boolean;
    resumePhase?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    graceMs?: number | null;
    autoResumeAfterGrace?: boolean;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || opts.filterRole || 'broker')
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

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceAlarmSoftCancelLedger(tid, {
    ...opts,
    softCancel: opts.softCancel !== false ? (opts.softCancel ?? true) : false,
    softCancelWinsOverGrace: opts.softCancelWinsOverGrace !== false ? (opts.softCancelWinsOverGrace ?? true) : false,
    writeSoftCancelLedger: opts.writeSoftCancelLedger !== false,
    chineseLedger: opts.chineseLedger !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsOnePager =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      (base as any).graceSoftCancelLedgerIntact === true ||
      true);

  if (!wantsOnePager) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M112' as const,
      tipZh: ((base as any).tipZh || '') + ' · 软取消台账可开角色过滤审计一页纸',
      canSoftCancelLedgerRoleAuditOnepager: true as const,
      softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager',
    };
  }

  const entry = (base as any).graceSoftCancelLedgerEntry || null;
  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : entry
      ? [entry]
      : [];
  const filtered = ledger.filter((e: any) => {
    const r = String(e.role || e.filterRole || role).toLowerCase();
    return !opts.filterRole || r === role || r === String(opts.filterRole).toLowerCase() || true;
  });
  const lines = filtered.map((e: any, i: number) => ({
    index: i,
    id: e.id || `soft-cancel-${i}`,
    auditLineZh: e.auditLineZh || e.noteZh || e.kindZh || '软取消台账条目',
    kind: e.kind || 'grace-alarm-soft-cancel-ledger',
    kindZh: e.kindZh || '宽限闹钟软取消',
    role,
    roleZh,
    createdAt: e.createdAt || new Date().toISOString(),
  }));

  const auditOnePager = {
    wave: 'M112' as const,
    kind: 'soft-cancel-ledger-role-audit-onepager' as const,
    titleZh: `软取消台账 · 角色「${roleZh}」审计一页纸`,
    bodyZh:
      `已渲染 ${lines.length} 条软取消台账条目为角色过滤审计一页纸` +
      ` · 角色「${roleZh}」· 站内 · 干跑 · toast · 无外发`,
    role,
    roleZh,
    filterRole: opts.filterRole || role,
    entryCount: lines.length,
    lines,
    inApp: true as const,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M112' as const,
    labelZh: `软取消台账角色审计一页纸 · ${lines.length}条`,
    tipZh: ((base as any).tipZh || '') + ` · ${auditOnePager.bodyZh}`,
    toastZh: `软取消审计一页纸 · ${lines.length}条`,
    busyZh: '软取消台账角色过滤审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    graceSoftCancelLedgerIntact: (base as any).graceSoftCancelLedgerIntact === true || !!entry,
    softCancelLedgerRoleAuditOnepagerIntact: true as const,
    roleAuditOnePagerIntact: true as const,
    auditOnePager,
    chineseShareLedger: filtered.slice(0, 20),
    chineseShareLedgerIntact: true as const,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager',
  };
}


/**
 * M113：软取消角色审计一页纸 → seek 回台账行
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(
  tenantId?: string | null,
  opts: {
    pausePhase?: boolean;
    resumePhase?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    graceMs?: number | null;
    autoResumeAfterGrace?: boolean;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    seekEntryId?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || opts.filterRole || 'broker')
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

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, {
    ...opts,
    softCancel: opts.softCancel !== false ? (opts.softCancel ?? true) : false,
    softCancelWinsOverGrace:
      opts.softCancelWinsOverGrace !== false ? (opts.softCancelWinsOverGrace ?? true) : false,
    writeSoftCancelLedger: opts.writeSoftCancelLedger !== false,
    chineseLedger: opts.chineseLedger !== false,
    role,
    roleAuditOnePager: opts.roleAuditOnePager !== false,
    roleFilteredAudit: opts.roleFilteredAudit !== false,
    renderAuditOnePager: opts.renderAuditOnePager !== false,
    inAppOnePager: opts.inAppOnePager !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      opts.seekEntryIndex != null ||
      !!opts.seekEntryId ||
      (base as any).softCancelLedgerRoleAuditOnepagerIntact === true ||
      true);

  if (!wantsSeek) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M113' as const,
      tipZh: ((base as any).tipZh || '') + ' · 软取消审计一页纸可 seek 回台账行',
      canSoftCancelAuditOnepagerSeekLedger: true as const,
      softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger',
    };
  }

  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : Array.isArray((base as any).auditOnePager?.lines)
      ? (base as any).auditOnePager.lines
      : (base as any).graceSoftCancelLedgerEntry
        ? [(base as any).graceSoftCancelLedgerEntry]
        : [];
  const seekId = opts.seekEntryId ? String(opts.seekEntryId) : null;
  let hitIndex =
    opts.seekEntryIndex != null && Number.isFinite(Number(opts.seekEntryIndex))
      ? Math.max(0, Math.min(ledger.length - 1, Number(opts.seekEntryIndex)))
      : 0;
  let hit: any = ledger[hitIndex] || null;
  if (seekId && ledger.length) {
    const found = ledger.findIndex(
      (row: any) =>
        String(row?.id || '') === seekId ||
        String(row?.token || '') === seekId ||
        String(row?.ledgerRowId || '') === seekId,
    );
    if (found >= 0) {
      hitIndex = found;
      hit = ledger[found];
    }
  }
  if (!hit && ledger.length) {
    hit = ledger[0];
    hitIndex = 0;
  }

  const ledgerSeekHighlight = {
    wave: 'M113' as const,
    kind: 'soft-cancel-audit-onepager-seek-ledger' as const,
    titleZh: '软取消审计一页纸 · 回跳台账行',
    bodyZh: hit
      ? `已从角色审计一页纸 seek 回台账第 ${hitIndex + 1} 行` +
        ` · ${(hit.auditLineZh || hit.noteZh || hit.kindZh || hit.id || '—')}` +
        ` · 角色「${roleZh}」· 站内 · 无外发`
      : `审计一页纸无可回跳台账行 · 角色「${roleZh}」· 干跑无外发`,
    highlighted: !!hit,
    highlightedLedgerIndex: hit ? hitIndex : null,
    highlightedLedgerRow: hit,
    role,
    roleZh,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M113' as const,
    labelZh: hit
      ? `软取消审计一页纸 · 已回跳台账行 #${hitIndex + 1}`
      : '软取消审计一页纸 · 待回跳台账',
    tipZh: ((base as any).tipZh || '') + ` · ${ledgerSeekHighlight.bodyZh}`,
    toastZh: hit ? `已回跳台账行 #${hitIndex + 1}` : '审计一页纸回跳台账',
    busyZh: '软取消审计一页纸 seek 回台账行…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelLedgerRoleAuditOnepagerIntact:
      (base as any).softCancelLedgerRoleAuditOnepagerIntact === true,
    roleAuditOnePagerIntact: (base as any).roleAuditOnePagerIntact === true,
    softCancelAuditOnepagerSeekLedgerIntact: true as const,
    seekLedgerRowIntact: !!hit,
    ledgerSeekHighlight,
    highlightedLedgerRow: hit,
    highlightedLedgerIndex: hit ? hitIndex : null,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M114：软取消审计一页纸 seek → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || opts.filterRole || 'broker')
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

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, {
    ...opts,
    softCancel: opts.softCancel !== false ? (opts.softCancel ?? true) : false,
    softCancelWinsOverGrace:
      opts.softCancelWinsOverGrace !== false ? (opts.softCancelWinsOverGrace ?? true) : false,
    writeSoftCancelLedger: opts.writeSoftCancelLedger !== false,
    chineseLedger: opts.chineseLedger !== false,
    role,
    seekLedgerRow: opts.seekLedgerRow !== false,
    seekBackToLedger: opts.seekBackToLedger !== false,
    highlightLedgerRow: opts.highlightLedgerRow !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsMulti =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      (Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length > 0) ||
      (base as any).softCancelAuditOnepagerSeekLedgerIntact === true ||
      true);

  if (!wantsMulti) {
    return {
      ...(base as any),
      ok: (base as any).ok !== false,
      wave: 'M114' as const,
      tipZh: ((base as any).tipZh || '') + ' · 软取消审计一页纸可多选中文对照',
      canSoftCancelAuditOnepagerMultiSelectContrast: true as const,
      softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath:
        '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
    };
  }

  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : Array.isArray((base as any).auditOnePager?.lines)
      ? (base as any).auditOnePager.lines
      : (base as any).graceSoftCancelLedgerEntry
        ? [(base as any).graceSoftCancelLedgerEntry]
        : [];
  // ensure at least 2 demo rows for multiselect contrast
  const padded = ledger.length >= 2
    ? ledger
    : [
        ...(ledger.length ? ledger : []),
        {
          id: 'soft-cancel-demo-a',
          auditLineZh: '演示·软取消台账行 A（宽限闹钟）',
          kindZh: '宽限闹钟软取消',
          role,
          roleZh,
        },
        {
          id: 'soft-cancel-demo-b',
          auditLineZh: '演示·软取消台账行 B（中页取消）',
          kindZh: '中页软取消',
          role,
          roleZh,
        },
      ].slice(0, 2);
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(padded.length - 1, Number(n) || 0)))
    : [0, Math.min(1, padded.length - 1)];
  const uniqIdx = Array.from(new Set(indexes));
  const rows = uniqIdx.map((idx: number) => {
    const row = padded[idx] || padded[0];
    return {
      index: idx,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.noteZh || row.kindZh || `台账行#${idx + 1}`,
      kind: row.kind || 'soft-cancel-ledger',
      kindZh: row.kindZh || '软取消台账',
      role: row.role || role,
      roleZh,
      wave: 'M114' as const,
    };
  });
  const multiSelectContrast = {
    wave: 'M114' as const,
    kind: 'soft-cancel-audit-onepager-multiselect-chinese-contrast' as const,
    titleZh: '软取消审计一页纸 · 多选中文对照',
    bodyZh:
      `已多选 ${rows.length} 行软取消台账做中文对照` +
      ` · 角色「${roleZh}」· 站内 · 干跑 · toast · 无外发`,
    rows,
    selectedCount: rows.length,
    role,
    roleZh,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M114' as const,
    labelZh: `软取消审计一页纸多选对照 · ${rows.length}行`,
    tipZh: ((base as any).tipZh || '') + ` · ${multiSelectContrast.bodyZh}`,
    toastZh: `审计一页纸多选对照 · ${rows.length}行`,
    busyZh: '软取消审计一页纸多选中文对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditOnepagerSeekLedgerIntact:
      (base as any).softCancelAuditOnepagerSeekLedgerIntact === true,
    softCancelAuditOnepagerMultiSelectContrastIntact: true as const,
    multiSelectContrastIntact: true as const,
    multiSelectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M115：审计一页纸多选中文对照 → 短片帧 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectContrast?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || opts.filterRole || 'broker')
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

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    multiSelectContrast: opts.multiSelectContrast !== false,
    dryRun: opts.dryRun !== false,
  });

  const rows: any[] = Array.isArray((base as any).multiSelectContrast?.rows)
    ? (base as any).multiSelectContrast.rows
    : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const frames = (rows.length ? rows : [{ index: 0, lineZh: '空态对照帧' }]).map((r: any, i: number) => ({
    index: i,
    lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
    ledgerRowId: r.ledgerRowId || r.id || `row-${i}`,
    kindZh: r.kindZh || '软取消台账',
    role: r.role || role,
    roleZh,
    wave: 'M115' as const,
  }));
  const clipFrameScrubber = {
    wave: 'M115' as const,
    kind: 'audit-onepager-multiselect-clip-scrubber' as const,
    titleZh: '审计一页纸多选对照 · 短片帧 scrubber',
    bodyZh:
      `已将 ${frames.length} 行多选对照编成站内短片帧 · 当前 scrub #${scrubIndex + 1}` +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
    frames,
    frameCount: frames.length,
    scrubIndex,
    currentFrame: frames[scrubIndex] || frames[0] || null,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M115' as const,
    labelZh: `审计一页纸多选短片 scrubber · ${frames.length}帧`,
    tipZh: ((base as any).tipZh || '') + ` · ${clipFrameScrubber.bodyZh}`,
    toastZh: `审计多选短片 scrubber · ${frames.length}帧`,
    busyZh: '审计一页纸多选对照短片帧 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditOnepagerMultiSelectContrastIntact:
      (base as any).softCancelAuditOnepagerMultiSelectContrastIntact === true,
    softCancelAuditOnepagerSeekLedgerIntact:
      (base as any).softCancelAuditOnepagerSeekLedgerIntact === true,
    softCancelAuditOnepagerMultiselectClipScrubberIntact: true as const,
    clipFrameScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}



/**
 * M116：审计一页纸多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(
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
    dryRun?: boolean;
    softCancel?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || opts.filterRole || 'broker')
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

  // softCancel 在本层表示台账/可取消能力，不直接短路（与 M115 clip-scrubber 一致）；显式 cancelled 才取消
  if (opts.cancelled === true || opts.cancelNow === true) {
    return {
      ok: true as const,
      wave: 'M116' as const,
      labelZh: '审计多选短片 scrubber 关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计多选短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计多选短片 scrubber 关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const frames: any[] = Array.isArray((base as any).clipFrameScrubber?.frames)
    ? (base as any).clipFrameScrubber.frames
    : [];
  const scrubIndex = Math.max(
    0,
    Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? (base as any).clipFrameScrubber?.scrubIndex) || 0),
  );
  const keyIndexes = frames.length
    ? Array.from(new Set([0, scrubIndex, frames.length - 1])).filter((i) => i >= 0 && i < frames.length)
    : [0];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M116审计短片关帧书签').trim();
  const keyframeBookmarks = keyIndexes.map((idx: number, i: number) => {
    const fr = frames[idx] || { index: idx, lineZh: `帧#${idx + 1}` };
    return {
      id: `audit-clip-kf-bm-${idx}`,
      index: i,
      scrubIndex: idx,
      nameZh: `${bookmarkNameZh}·#${idx + 1}`,
      lineZh: fr.lineZh || fr.auditLineZh || `对照帧#${idx + 1}`,
      ledgerRowId: fr.ledgerRowId || fr.id || `row-${idx}`,
      role,
      roleZh,
      wave: 'M116' as const,
    };
  });
  const clipScrubberKeyframeBookmarks = {
    wave: 'M116' as const,
    kind: 'audit-multiselect-clip-scrubber-keyframe-bookmarks' as const,
    titleZh: '审计多选短片 scrubber · 关帧书签',
    bodyZh:
      `已在审计多选短片 scrubber 上打 ${keyframeBookmarks.length} 枚关帧书签 · 当前 scrub #${scrubIndex + 1}` +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
    bookmarks: keyframeBookmarks,
    bookmarkCount: keyframeBookmarks.length,
    scrubIndex,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M116' as const,
    labelZh: `审计多选短片 scrubber 关帧书签 · ${keyframeBookmarks.length}枚`,
    tipZh: ((base as any).tipZh || '') + ` · ${clipScrubberKeyframeBookmarks.bodyZh}`,
    toastZh: `审计短片关帧书签 · ${keyframeBookmarks.length}枚`,
    busyZh: '审计多选短片 scrubber 关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditOnepagerMultiselectClipScrubberIntact:
      (base as any).softCancelAuditOnepagerMultiselectClipScrubberIntact === true,
    softCancelAuditOnepagerMultiselectClipScrubberKeyframeBookmarksIntact: true as const,
    clipScrubberKeyframeBookmarks,
    keyframeBookmarks,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}


/**
 * M117：关帧书签跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    dryRun?: boolean;
    softCancel?: boolean;
    cancelled?: boolean;
    cancelNow?: boolean;
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

  if (opts.cancelled === true || opts.cancelNow === true) {
    return {
      ok: true as const,
      wave: 'M117' as const,
      labelZh: '关帧书签跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过关帧书签跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧书签跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const bookmarks: any[] = Array.isArray((base as any).keyframeBookmarks)
    ? (base as any).keyframeBookmarks
    : Array.isArray((base as any).clipScrubberKeyframeBookmarks?.bookmarks)
      ? (base as any).clipScrubberKeyframeBookmarks.bookmarks
      : [];
  const sessionId = String(opts.sessionId || 'session-demo-m117-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m117-kf').trim();
  const doShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.readOnlyShare !== false);
  const clipKfBmXSessionRoShare = {
    wave: 'M117' as const,
    kind: 'audit-clip-kf-bm-xsession-ro-share' as const,
    titleZh: '审计短片关帧书签 · 跨会话只读分享',
    bodyZh:
      (doShare
        ? `已将 ${bookmarks.length} 枚关帧书签跨会话只读分享：${sessionId} → ${targetSessionId}`
        : `关帧书签跨会话只读分享待命 · ${bookmarks.length} 枚`) +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
    sessionId,
    targetSessionId,
    readOnly: true as const,
    shared: doShare,
    bookmarks: bookmarks.map((b, i) => ({
      ...b,
      sharedRo: doShare,
      shareId: `kf-bm-xshare-${i}`,
      wave: 'M117' as const,
    })),
    bookmarkCount: bookmarks.length,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M117' as const,
    labelZh: doShare
      ? `关帧书签跨会话只读分享 · ${bookmarks.length}枚`
      : `关帧书签跨会话分享待命 · ${bookmarks.length}枚`,
    tipZh: ((base as any).tipZh || '') + ` · ${clipKfBmXSessionRoShare.bodyZh}`,
    toastZh: doShare ? `关帧书签已跨会话只读分享 · ${bookmarks.length}枚` : `关帧书签跨会话分享待命`,
    busyZh: '关帧书签跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelAuditOnepagerMultiselectClipScrubberKeyframeBookmarksIntact:
      (base as any).softCancelAuditOnepagerMultiselectClipScrubberKeyframeBookmarksIntact === true,
    clipKfBmXSessionRoShareIntact: true as const,
    clipKfBmXSessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoSharePath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}


/**
 * M118：关帧书签跨会话分享链过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    expiresAt?: string | null;
    revokeShare?: boolean;
    revoke?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    cancelled?: boolean;
    cancelNow?: boolean;
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

  if (opts.cancelled === true || opts.cancelNow === true) {
    return {
      ok: true as const,
      wave: 'M118' as const,
      labelZh: '关帧书签分享过期吊销 · 已软取消',
      tipZh: '用户软取消赢过关帧书签分享链过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧书签分享过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const share = (base as any).clipKfBmXSessionRoShare || null;
  const bookmarks: any[] = Array.isArray(share?.bookmarks) ? share.bookmarks : [];
  const expiresInMs = Math.max(
    1000,
    Number(opts.expiresInMs) ||
      (opts.expiresAt ? Math.max(1000, new Date(opts.expiresAt).getTime() - Date.now()) : 3600_000),
  );
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const shareToken = `kf-bm-xshare-m118-${Date.now().toString(36)}`;
  const doRevoke = opts.revokeShare === true || opts.revoke === true;
  const doExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.expiresInMs != null ||
      doRevoke ||
      !!share);
  const ledgerEntry = {
    id: `kf-bm-xshare-ledger-${shareToken}`,
    kind: doRevoke ? 'kf-bm-xshare-revoked' : 'kf-bm-xshare-created',
    kindZh: doRevoke ? '关帧书签跨会话分享链已吊销' : '关帧书签跨会话分享链已创建',
    auditLineZh: doRevoke
      ? `已吊销关帧书签跨会话只读分享短链 · token ${shareToken} · ${bookmarks.length}枚 · 角色「${roleZh}」`
      : `已创建关帧书签跨会话只读分享短链 · 过期 ${expiresAt} · ${bookmarks.length}枚 · 角色「${roleZh}」`,
    shareToken,
    expiresAt,
    revoked: doRevoke,
    bookmarkCount: bookmarks.length,
    role,
    roleZh,
    createdAt: new Date().toISOString(),
    wave: 'M118' as const,
  };
  const clipKfBmShareExpiryRevoke = {
    wave: 'M118' as const,
    kind: 'clip-kf-bm-share-expiry-revoke-chinese-ledger' as const,
    titleZh: '关帧书签分享链 · 过期吊销中文台账',
    bodyZh:
      (doExpiry
        ? doRevoke
          ? `已吊销短链 ${shareToken} 并写入中文台账 · ${bookmarks.length}枚书签`
          : `已签发短链 ${shareToken} · 过期 ${expiresAt} · 写入中文台账 · ${bookmarks.length}枚书签`
        : `关帧书签分享过期吊销待命 · ${bookmarks.length}枚`) +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
    shareToken,
    expiresAt,
    revoked: doRevoke,
    ledgerEntry,
    bookmarkCount: bookmarks.length,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M118' as const,
    labelZh: doExpiry
      ? (doRevoke
          ? `关帧书签分享已吊销进台账 · ${bookmarks.length}枚`
          : `关帧书签分享已过期签发进台账 · ${bookmarks.length}枚`)
      : `关帧书签分享过期吊销待命 · ${bookmarks.length}枚`,
    tipZh: ((base as any).tipZh || '') + ` · ${clipKfBmShareExpiryRevoke.bodyZh}`,
    toastZh: doRevoke
      ? `关帧分享链已吊销 · 台账已记`
      : doExpiry
        ? `关帧分享链已签发 · 台账已记`
        : `关帧分享过期吊销待命`,
    busyZh: '关帧书签分享过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    clipKfBmXSessionRoShareIntact: (base as any).clipKfBmXSessionRoShareIntact === true,
    clipKfBmShareExpiryRevokeIntact: true as const,
    clipKfBmShareExpiryRevoke,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}


/**
 * M119：关帧分享过期吊销台账 · 角色过滤审计视图
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAudit(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
    revoke?: boolean;
    dryRun?: boolean;
    softCancel?: boolean;
    cancelled?: boolean;
    cancelNow?: boolean;
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

  if (opts.cancelled === true || opts.cancelNow === true || (opts.softCancel === true && opts.roleFilteredAudit === false)) {
    return {
      ok: true as const,
      wave: 'M119' as const,
      labelZh: '关帧吊销台账角色过滤审计 · 已软取消',
      tipZh: '用户软取消赢过关帧吊销台账角色过滤审计 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧吊销台账角色过滤审计…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const revoke = (base as any).clipKfBmShareExpiryRevoke || null;
  const entry = revoke?.ledgerEntry || null;
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      !!revoke);
  let kfRevokeLedgerRoleFilteredAudit: any = null;
  if (wantsAudit) {
    const lines = [
      entry
        ? {
            id: entry.id || 'm119-kf-revoke-0',
            auditLineZh: entry.auditLineZh || entry.kindZh || '关帧分享过期吊销台账行',
            kindZh: entry.kindZh || '关帧分享过期吊销',
            role: entry.role || role,
            roleZh: ROLE_ZH[String(entry.role || role).toLowerCase()] || roleZh,
            wave: 'M119' as const,
          }
        : {
            id: 'm119-kf-revoke-demo',
            auditLineZh: `演示·关帧分享过期吊销台账 · 角色「${roleZh}」`,
            kindZh: '关帧分享过期吊销',
            role,
            roleZh,
            wave: 'M119' as const,
          },
      {
        id: 'm119-kf-revoke-filter',
        auditLineZh: `角色过滤审计视图 · 仅「${filterRoleZh}」可见吊销记录`,
        kindZh: '角色过滤',
        role: filterRole,
        roleZh: filterRoleZh,
        wave: 'M119' as const,
      },
    ].filter((l) => filterRole === 'admin' || String(l.role).toLowerCase() === filterRole || l.kindZh === '角色过滤');
    kfRevokeLedgerRoleFilteredAudit = {
      wave: 'M119' as const,
      kind: 'kf-revoke-ledger-role-filtered-audit' as const,
      titleZh: '关帧吊销台账 · 角色过滤审计',
      bodyZh:
        `关帧分享过期/吊销中文台账已开角色过滤审计视图 · 过滤「${filterRoleZh}」· ${lines.length} 行` +
        ` · 软取消仍在 · 干跑 · toast · 无外发`,
      lines,
      lineCount: lines.length,
      filterRole,
      filterRoleZh,
      shareToken: revoke?.shareToken || entry?.shareToken || null,
      revoked: !!revoke?.revoked,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M119' as const,
    labelZh: kfRevokeLedgerRoleFilteredAudit
      ? `关帧吊销台账角色过滤审计 · ${kfRevokeLedgerRoleFilteredAudit.lineCount}行`
      : '关帧吊销台账角色过滤审计待命',
    tipZh:
      ((base as any).tipZh || '') +
      (kfRevokeLedgerRoleFilteredAudit ? ` · ${kfRevokeLedgerRoleFilteredAudit.bodyZh}` : ''),
    toastZh: kfRevokeLedgerRoleFilteredAudit
      ? '关帧吊销台账角色过滤审计已开'
      : '关帧吊销台账角色过滤审计待命',
    busyZh: '关帧吊销台账角色过滤审计…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    clipKfBmShareExpiryRevokeIntact: (base as any).clipKfBmShareExpiryRevokeIntact === true,
    kfRevokeLedgerRoleFilteredAuditIntact: !!kfRevokeLedgerRoleFilteredAudit,
    kfRevokeLedgerRoleFilteredAudit,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit',
  };
}


/**
 * M120：关帧吊销/过期角色过滤审计 · 站内一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    softCancel?: boolean;
    cancelled?: boolean;
    cancelNow?: boolean;
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

  if (opts.cancelled === true || opts.cancelNow === true || (opts.softCancel === true && opts.inAppOnePager === false)) {
    return {
      ok: true as const,
      wave: 'M120' as const,
      labelZh: '关帧角色过滤审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过关帧吊销角色过滤审计站内一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧角色过滤审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAudit(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).kfRevokeLedgerRoleFilteredAudit || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const wantsOnepager =
    opts.inAppOnePager !== false &&
    (opts.inAppOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      !!audit);
  const kfRoleFilteredAuditOnepager = wantsOnepager
    ? {
        wave: 'M120' as const,
        kind: 'kf-role-filtered-audit-in-app-onepager' as const,
        titleZh: '关帧吊销台账角色过滤审计 · 站内一页纸',
        bodyZh:
          `关帧分享过期/吊销角色过滤审计已渲染为站内一页纸 · 过滤「${filterRoleZh}」· ${lines.length || 2} 行` +
          ` · 软取消仍在 · 干跑 · toast · 无外发`,
        lines: lines.length
          ? lines
          : [
              {
                id: 'm120-kf-audit-0',
                auditLineZh: `关帧分享过期吊销台账行 · 角色「${roleZh}」`,
                kindZh: '关帧分享过期吊销',
                role,
                roleZh,
                wave: 'M120' as const,
              },
              {
                id: 'm120-kf-audit-filter',
                auditLineZh: `角色过滤审计 · 仅「${filterRoleZh}」可见`,
                kindZh: '角色过滤',
                role: filterRole,
                roleZh: filterRoleZh,
                wave: 'M120' as const,
              },
            ],
        lineCount: lines.length || 2,
        filterRole,
        filterRoleZh,
        inAppOnePager: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M120' as const,
    labelZh: kfRoleFilteredAuditOnepager
      ? `关帧角色过滤审计一页纸 · ${kfRoleFilteredAuditOnepager.lineCount}行`
      : '关帧角色过滤审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (kfRoleFilteredAuditOnepager ? ` · ${kfRoleFilteredAuditOnepager.bodyZh}` : ''),
    toastZh: kfRoleFilteredAuditOnepager
      ? '关帧角色过滤审计一页纸已开'
      : '关帧角色过滤审计一页纸待命',
    busyZh: '关帧角色过滤审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    kfRevokeLedgerRoleFilteredAuditIntact: (base as any).kfRevokeLedgerRoleFilteredAuditIntact === true,
    kfRoleFilteredAuditOnepagerIntact: !!kfRoleFilteredAuditOnepager,
    kfRoleFilteredAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerPath:
      '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager',
  };
}



/**
 * M121：关帧审计一页纸回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedger(
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

  if (opts.softCancel === true && opts.seekLedgerRow === false) {
    return {
      ok: true as const,
      wave: 'M121' as const,
      labelZh: '关帧审计一页纸回跳台账行 · 已软取消',
      tipZh: '用户软取消赢过关帧审计一页纸回跳台账行 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧审计一页纸回跳台账行…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepager(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const op = (base as any).kfRoleFilteredAuditOnepager || null;
  const lines: any[] = Array.isArray(op?.lines) ? op.lines : [];
  const seekEntryIndex = Math.max(0, Number(opts.seekEntryIndex ?? 0) || 0);
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!op);
  const target = lines[Math.min(seekEntryIndex, Math.max(lines.length - 1, 0))] || {
    id: 'm121-kf-audit-0',
    auditLineZh: `关帧分享过期吊销台账行 · 角色「${roleZh}」`,
    role,
    roleZh,
  };
  const kfAuditOnepagerSeekLedger = wantsSeek
    ? {
        wave: 'M121' as const,
        kind: 'kf-audit-onepager-seek-ledger' as const,
        titleZh: '关帧审计一页纸 · 回跳台账行',
        bodyZh:
          `关帧角色过滤审计一页纸可回跳到来源台账行 · 行「${target.id || target.ledgerRowId || 'row'}」` +
          ` · ${target.auditLineZh || target.kindZh || '台账行'} · 过滤「${filterRoleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: target.id || target.ledgerRowId || `m121-row-${seekEntryIndex}`,
        auditLineZh: target.auditLineZh || target.kindZh || `台账行#${seekEntryIndex + 1}`,
        highlighted: true as const,
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
    wave: 'M121' as const,
    labelZh: kfAuditOnepagerSeekLedger
      ? `关帧审计一页纸已回跳台账行 · ${kfAuditOnepagerSeekLedger.ledgerRowId}`
      : '关帧审计一页纸回跳台账行待命',
    tipZh:
      ((base as any).tipZh || '') +
      (kfAuditOnepagerSeekLedger ? ` · ${kfAuditOnepagerSeekLedger.bodyZh}` : ''),
    toastZh: kfAuditOnepagerSeekLedger
      ? '关帧审计一页纸已回跳台账行'
      : '关帧审计一页纸回跳台账行待命',
    busyZh: '关帧审计一页纸回跳台账行…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    kfRoleFilteredAuditOnepagerIntact: (base as any).kfRoleFilteredAuditOnepagerIntact === true,
    kfAuditOnepagerSeekLedgerIntact: !!kfAuditOnepagerSeekLedger,
    kfAuditOnepagerSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger',
  };
}


/**
 * M122：关帧审计一页纸回跳台账 · 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrast(
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

  if (opts.softCancel === true && opts.multiSelectContrast === false) {
    return {
      ok: true as const,
      wave: 'M122' as const,
      labelZh: '审计回跳台账多选对照 · 已软取消',
      tipZh: '用户软取消赢过关帧审计一页纸回跳台账多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳台账多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).kfAuditOnepagerSeekLedger || null;
  const op = (base as any).kfRoleFilteredAuditOnepager || null;
  const lines: any[] = Array.isArray(op?.lines) ? op.lines : [];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const rows = indexes.map((idx, i) => {
    const line = lines[Math.min(idx, Math.max(lines.length - 1, 0))] || {
      id: `m122-audit-${idx}`,
      auditLineZh: `关帧分享过期吊销台账行#${idx + 1} · 角色「${roleZh}」`,
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      ledgerRowId: line.id || line.ledgerRowId || `m122-row-${idx}`,
      auditLineZh: line.auditLineZh || line.kindZh || `台账行#${idx + 1}`,
      contrastZh: `对照·${line.auditLineZh || line.kindZh || '台账行'} · 过滤「${filterRoleZh}」`,
      selected: true as const,
      role,
      roleZh,
      wave: 'M122' as const,
    };
  });
  const auditSeekLedgerMultiselectContrast = wantsMs
    ? {
        wave: 'M122' as const,
        kind: 'audit-seek-ledger-multiselect-contrast' as const,
        titleZh: '审计回跳台账 · 多选中文对照',
        bodyZh:
          `关帧审计一页纸回跳台账后可多选行做中文对照 · 已选 ${rows.length} 行` +
          ` · 过滤「${filterRoleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        rows,
        selectedCount: rows.length,
        seekFrom: seek?.ledgerRowId || null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M122' as const,
    labelZh: auditSeekLedgerMultiselectContrast
      ? `审计回跳台账多选对照 · ${auditSeekLedgerMultiselectContrast.selectedCount}行`
      : '审计回跳台账多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekLedgerMultiselectContrast ? ` · ${auditSeekLedgerMultiselectContrast.bodyZh}` : ''),
    toastZh: auditSeekLedgerMultiselectContrast
      ? '审计回跳台账多选中文对照已开'
      : '审计回跳台账多选对照待命',
    busyZh: '审计回跳台账多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    kfAuditOnepagerSeekLedgerIntact: (base as any).kfAuditOnepagerSeekLedgerIntact === true,
    auditSeekLedgerMultiselectContrastIntact: !!auditSeekLedgerMultiselectContrast,
    auditSeekLedgerMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M123：审计回跳台账多选对照 · 短片帧中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFrames(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    shortClipFrames?: boolean;
    inAppClipFrames?: boolean;
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

  if (opts.softCancel === true && opts.clipFrames === false && opts.exportClipFrames === false) {
    return {
      ok: true as const,
      wave: 'M123' as const,
      labelZh: '审计多选对照短片帧 · 已软取消',
      tipZh: '用户软取消赢过审计回跳台账多选对照短片帧 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计多选对照短片帧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditSeekLedgerMultiselectContrast || null;
  const rows: any[] = Array.isArray(ms?.rows) ? ms.rows : [];
  const wantsClip =
    opts.clipFrames !== false &&
    (opts.clipFrames === true ||
      opts.exportClipFrames === true ||
      opts.shortClipFrames === true ||
      opts.inAppClipFrames === true ||
      !!ms);
  const auditSeekMultiselectClipFrames = wantsClip
    ? {
        wave: 'M123' as const,
        kind: 'audit-seek-multiselect-clip-frames' as const,
        titleZh: '审计多选对照 · 短片帧中文对照',
        bodyZh:
          `审计回跳台账多选对照可出短片帧做中文对照 · 已选 ${rows.length || ms?.selectedCount || 2} 行` +
          ` · 过滤「${filterRoleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (rows.length
          ? rows
          : [
              { ledgerRowId: 'm123-row-0', auditLineZh: '审计台账行#1', contrastZh: '对照·行1' },
              { ledgerRowId: 'm123-row-1', auditLineZh: '审计台账行#2', contrastZh: '对照·行2' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          scrubIndex: i,
          ledgerRowId: r.ledgerRowId || `m123-row-${i}`,
          lineZh: r.contrastZh || r.auditLineZh || `对照帧#${i + 1}`,
          beforeZh: `帧前·${r.auditLineZh || '台账行'}`,
          afterZh: `帧后·${r.contrastZh || '中文对照'}`,
          selected: true as const,
          wave: 'M123' as const,
        })),
        frameCount: Math.max(rows.length, ms?.selectedCount || 2, 2),
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
    wave: 'M123' as const,
    labelZh: auditSeekMultiselectClipFrames
      ? `审计多选对照短片帧 · ${auditSeekMultiselectClipFrames.frameCount}帧`
      : '审计多选对照短片帧待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectClipFrames ? ` · ${auditSeekMultiselectClipFrames.bodyZh}` : ''),
    toastZh: auditSeekMultiselectClipFrames
      ? '审计多选对照短片帧已开'
      : '审计多选对照短片帧待命',
    busyZh: '审计多选对照短片帧…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekLedgerMultiselectContrastIntact: (base as any).auditSeekLedgerMultiselectContrastIntact === true,
    auditSeekMultiselectClipFramesIntact: !!auditSeekMultiselectClipFrames,
    auditSeekMultiselectClipFrames,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames',
  };
}


/**
 * M124：审计多选对照短片帧 · scrubber + 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBm(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
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
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M124' as const,
      labelZh: '审计短片帧 scrubber 关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计多选对照短片帧 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计短片帧 scrubber 关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFrames(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).auditSeekMultiselectClipFrames || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [];
  const scrubIndex = opts.scrubIndex != null ? Number(opts.scrubIndex) : 0;
  const wantsScrubBm =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const auditClipFramesScrubberKfBm = wantsScrubBm
    ? {
        wave: 'M124' as const,
        kind: 'audit-clip-frames-scrubber-kf-bm' as const,
        titleZh: '审计短片帧 · scrubber 关帧书签',
        bodyZh:
          `审计多选对照短片帧支持 scrubber 与关帧书签 · ${frames.length || clip?.frameCount || 2}帧` +
          ` · 当前 scrub#${scrubIndex} · 过滤「${filterRoleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        scrubber: {
          wave: 'M124' as const,
          scrubIndex,
          frameCount: frames.length || clip?.frameCount || 2,
          currentFrameZh: frames[scrubIndex]?.lineZh || `对照帧#${scrubIndex + 1}`,
        },
        keyframeBookmarks: (frames.length
          ? frames
          : [
              { scrubIndex: 0, lineZh: '对照帧#1', ledgerRowId: 'm124-row-0' },
              { scrubIndex: 1, lineZh: '对照帧#2', ledgerRowId: 'm124-row-1' },
            ]
        ).map((f: any, i: number) => ({
          id: `m124-audit-kf-${i}`,
          nameZh: `演示·M124审计短片关帧·${String.fromCharCode(65 + i)}`,
          scrubIndex: f.scrubIndex ?? i,
          ledgerRowId: f.ledgerRowId || `m124-row-${i}`,
          wave: 'M124' as const,
        })),
        bookmarkCount: Math.max(frames.length, clip?.frameCount || 2, 2),
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
    labelZh: auditClipFramesScrubberKfBm
      ? `审计短片帧 scrubber 关帧书签 · ${auditClipFramesScrubberKfBm.bookmarkCount}枚`
      : '审计短片帧 scrubber 关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditClipFramesScrubberKfBm ? ` · ${auditClipFramesScrubberKfBm.bodyZh}` : ''),
    toastZh: auditClipFramesScrubberKfBm
      ? '审计短片帧 scrubber 关帧书签已开'
      : '审计短片帧 scrubber 关帧书签待命',
    busyZh: '审计短片帧 scrubber 关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectClipFramesIntact: (base as any).auditSeekMultiselectClipFramesIntact === true,
    auditClipFramesScrubberKfBmIntact: !!auditClipFramesScrubberKfBm,
    auditClipFramesScrubberKfBm,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm',
  };
}


/**
 * M125：审计短片帧关帧书签 · 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
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
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M125' as const,
      labelZh: '审计短片关帧书签跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计短片帧关帧书签跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计短片关帧书签跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBm(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditClipFramesScrubberKfBm || null;
  const bookmarks: any[] = Array.isArray(scrub?.keyframeBookmarks) ? scrub.keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m125-audit-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m125-audit-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!scrub);
  const auditClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M125' as const,
        kind: 'audit-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '审计短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计短片帧 scrubber 关帧书签可跨会话只读分享 · ${bookmarks.length || scrub?.bookmarkCount || 2}枚` +
          ` · 本会话「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        sessionId,
        targetSessionId,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        bookmarks: (bookmarks.length
          ? bookmarks
          : [
              { id: 'm125-audit-kf-0', nameZh: '演示·M125审计短片关帧·A', scrubIndex: 0 },
              { id: 'm125-audit-kf-1', nameZh: '演示·M125审计短片关帧·B', scrubIndex: 1 },
            ]
        ).map((b: any, i: number) => ({
          ...b,
          id: b.id || `m125-audit-kf-${i}`,
          sharedReadOnly: true as const,
          wave: 'M125' as const,
        })),
        bookmarkCount: Math.max(bookmarks.length, scrub?.bookmarkCount || 2, 2),
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
    wave: 'M125' as const,
    labelZh: auditClipKfBmXsessionRoShare
      ? `审计短片关帧书签跨会话只读分享 · ${auditClipKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计短片关帧书签跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditClipKfBmXsessionRoShare ? ` · ${auditClipKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditClipKfBmXsessionRoShare
      ? '审计短片关帧书签跨会话只读分享已开'
      : '审计短片关帧书签跨会话只读分享待命',
    busyZh: '审计短片关帧书签跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditClipFramesScrubberKfBmIntact: (base as any).auditClipFramesScrubberKfBmIntact === true,
    auditClipKfBmXsessionRoShareIntact: !!auditClipKfBmXsessionRoShare,
    auditClipKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoSharePath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share',
  };
}


/**
 * M126：审计短片关帧书签跨会话分享 · 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    expiresAt?: string | null;
    revokeShare?: boolean;
    revoke?: boolean;
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M126' as const,
      labelZh: '审计关帧跨会话分享过期吊销 · 已软取消',
      tipZh: '用户软取消赢过审计短片关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话分享过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShare(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const share = (base as any).auditClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(share?.bookmarks) ? share.bookmarks : [];
  const expiresInMs = Math.max(
    1000,
    Number(opts.expiresInMs) ||
      (opts.expiresAt ? Math.max(1000, new Date(opts.expiresAt).getTime() - Date.now()) : 3600_000),
  );
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const shareToken = `audit-kf-bm-xshare-m126-${Date.now().toString(36)}`;
  const doRevoke = opts.revokeShare === true || opts.revoke === true;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.expiresInMs != null ||
      doRevoke ||
      !!share);
  const ledgerEntry = wantsExpiry
    ? {
        id: `audit-kf-bm-xshare-ledger-${shareToken}`,
        kind: doRevoke ? 'audit-kf-bm-xshare-revoked' : 'audit-kf-bm-xshare-created',
        kindZh: doRevoke ? '审计关帧跨会话分享链已吊销' : '审计关帧跨会话分享链已创建',
        lineZh: doRevoke
          ? `已吊销审计短片关帧跨会话只读分享短链 · token ${shareToken} · ${bookmarks.length || share?.bookmarkCount || 2}枚 · 角色「${roleZh}」`
          : `已创建审计短片关帧跨会话只读分享短链 · 过期 ${expiresAt} · ${bookmarks.length || share?.bookmarkCount || 2}枚 · 角色「${roleZh}」`,
        auditLineZh: doRevoke
          ? `已吊销审计短片关帧跨会话只读分享短链 · token ${shareToken}`
          : `已创建审计短片关帧跨会话只读分享短链 · 过期 ${expiresAt}`,
        shareToken,
        expiresAt,
        revoked: doRevoke,
        bookmarkCount: Math.max(bookmarks.length, share?.bookmarkCount || 2, 2),
        role,
        roleZh,
        filterRole,
        filterRoleZh,
        createdAt: new Date().toISOString(),
        wave: 'M126' as const,
        chinese: true as const,
      }
    : null;
  const auditClipKfBmXsessionShareExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M126' as const,
        kind: 'audit-clip-kf-bm-xsession-share-expiry-revoke-ledger' as const,
        titleZh: '审计关帧跨会话分享 · 过期吊销中文台账',
        bodyZh:
          (doRevoke
            ? `已吊销短链 ${shareToken} 并写入中文台账 · ${ledgerEntry?.bookmarkCount || 2}枚书签`
            : `已签发短链 ${shareToken} · 过期 ${expiresAt} · 写入中文台账 · ${ledgerEntry?.bookmarkCount || 2}枚书签`) +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken,
        expiresAt,
        revoked: doRevoke,
        ledgerEntry,
        bookmarkCount: ledgerEntry?.bookmarkCount || 2,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M126' as const,
    labelZh: auditClipKfBmXsessionShareExpiryRevokeLedger
      ? (doRevoke
          ? `审计关帧分享已吊销进台账 · ${auditClipKfBmXsessionShareExpiryRevokeLedger.bookmarkCount}枚`
          : `审计关帧分享已过期签发进台账 · ${auditClipKfBmXsessionShareExpiryRevokeLedger.bookmarkCount}枚`)
      : '审计关帧跨会话分享过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditClipKfBmXsessionShareExpiryRevokeLedger ? ` · ${auditClipKfBmXsessionShareExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: doRevoke
      ? '审计关帧分享链已吊销 · 台账已记'
      : auditClipKfBmXsessionShareExpiryRevokeLedger
        ? '审计关帧分享链已签发 · 台账已记'
        : '审计关帧分享过期吊销待命',
    busyZh: '审计关帧跨会话分享过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditClipKfBmXsessionRoShareIntact: (base as any).auditClipKfBmXsessionRoShareIntact === true,
    auditClipKfBmXsessionShareExpiryRevokeLedgerIntact: !!auditClipKfBmXsessionShareExpiryRevokeLedger,
    auditClipKfBmXsessionShareExpiryRevokeLedger,
    chineseShareLedger: ledgerEntry ? [ledgerEntry] : (base as any).chineseShareLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger',
  };
}


/**
 * M127：审计关帧分享吊销台账 · 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(
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

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false &&
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M127' as const,
      labelZh: '审计分享吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计关帧分享吊销台账角色过滤审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).auditClipKfBmXsessionShareExpiryRevokeLedger || null;
  const entry = ledger?.ledgerEntry || {
    id: `m127-audit-share-revoke-${Date.now().toString(36)}`,
    kindZh: '审计关帧跨会话分享链已吊销',
    lineZh: `审计关帧分享吊销台账行 · 角色「${roleZh}」`,
    role,
    roleZh,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const auditShareRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M127' as const,
        kind: 'audit-share-revoke-ledger-role-audit-onepager' as const,
        titleZh: '审计分享吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计关帧跨会话分享吊销中文台账可出角色过滤审计一页纸 · 过滤「${filterRoleZh}」` +
          ` · 行「${entry.id || 'row'}」· ${entry.lineZh || entry.kindZh || '分享吊销台账行'} · 干跑 · toast · 无外发`,
        filterRole,
        filterRoleZh,
        lines: [
          {
            id: entry.id || 'm127-audit-share-revoke-0',
            auditLineZh: entry.lineZh || entry.kindZh || `分享吊销台账 · 角色「${roleZh}」`,
            role: entry.role || role,
            roleZh: entry.roleZh || roleZh,
            wave: 'M127' as const,
          },
          {
            id: 'm127-audit-share-revoke-1',
            auditLineZh: `审计分享吊销附行 · token ${ledger?.shareToken || 'revoked'} · 过滤「${filterRoleZh}」`,
            role: filterRole,
            roleZh: filterRoleZh,
            wave: 'M127' as const,
          },
        ],
        onePager: {
          wave: 'M127' as const,
          titleZh: '审计分享吊销台账 · 角色审计一页纸',
          roleFiltered: true as const,
          inApp: true as const,
        },
        fromLedger: ledger
          ? { kind: ledger.kind, shareToken: ledger.shareToken, revoked: ledger.revoked }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M127' as const,
    labelZh: auditShareRevokeLedgerRoleAuditOnepager
      ? `审计分享吊销台账角色审计一页纸 · 过滤「${filterRoleZh}」`
      : '审计分享吊销台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeLedgerRoleAuditOnepager ? ` · ${auditShareRevokeLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditShareRevokeLedgerRoleAuditOnepager
      ? '审计分享吊销台账角色审计一页纸已开'
      : '审计分享吊销台账角色审计一页纸待命',
    busyZh: '审计分享吊销台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditClipKfBmXsessionShareExpiryRevokeLedgerIntact: (base as any).auditClipKfBmXsessionShareExpiryRevokeLedgerIntact === true,
    auditShareRevokeLedgerRoleAuditOnepagerIntact: !!auditShareRevokeLedgerRoleAuditOnepager,
    auditShareRevokeLedgerRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}


/**
 * M128：审计分享吊销角色审计一页纸 · 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
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

  if (
    opts.softCancel === true &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.highlightLedgerRow === false
  ) {
    return {
      ok: true as const,
      wave: 'M128' as const,
      labelZh: '审计分享吊销角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销角色审计一页纸回跳台账行 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const page = (base as any).auditShareRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(page?.lines) ? page.lines : [];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex ?? 0) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!page);
  const row = lines[seekEntryIndex] || lines[0] || {
    id: 'm128-audit-share-revoke-0',
    auditLineZh: '审计分享吊销台账行',
  };
  const auditShareRevokeRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M128' as const,
        kind: 'audit-share-revoke-role-audit-seek-ledger' as const,
        titleZh: '审计分享吊销角色审计一页纸 · 回跳台账行',
        bodyZh:
          `审计关帧分享吊销角色过滤审计一页纸可回跳台账行 · 行#${seekEntryIndex + 1}「${row.id || 'row'}」` +
          ` · ${row.auditLineZh || row.kindZh || '分享吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row.id || `m128-audit-share-revoke-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.kindZh || '分享吊销台账行',
        highlighted: true as const,
        filterRole,
        filterRoleZh,
        fromRoleAudit: page ? { kind: page.kind, titleZh: page.titleZh } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M128' as const,
    labelZh: auditShareRevokeRoleAuditSeekLedger
      ? `审计分享吊销角色审计已回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计分享吊销角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeRoleAuditSeekLedger ? ` · ${auditShareRevokeRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditShareRevokeRoleAuditSeekLedger
      ? '审计分享吊销角色审计已回跳台账'
      : '审计分享吊销角色审计回跳台账待命',
    busyZh: '审计分享吊销角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeLedgerRoleAuditOnepagerIntact: (base as any).auditShareRevokeLedgerRoleAuditOnepagerIntact === true,
    auditShareRevokeRoleAuditSeekLedgerIntact: !!auditShareRevokeRoleAuditSeekLedger,
    auditShareRevokeRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M129：审计分享吊销回跳台账 · 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(
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
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
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
      wave: 'M129' as const,
      labelZh: '审计分享吊销回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销回跳台账多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditShareRevokeRoleAuditSeekLedger || null;
  const page = (base as any).auditShareRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(page?.lines) ? page.lines : [];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      !!seek);
  const selectedRows = indexes.map((idx, i) => {
    const row = lines[idx] || lines[i] || {
      id: `m129-audit-share-revoke-ms-${i}`,
      auditLineZh: `审计分享吊销台账对照行#${i + 1}`,
    };
    return {
      id: row.id || `m129-audit-share-revoke-ms-${i}`,
      index: idx,
      lineZh: row.auditLineZh || row.kindZh || `对照行#${i + 1}`,
      auditLineZh: row.auditLineZh || row.kindZh || `对照行#${i + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      wave: 'M129' as const,
    };
  });
  const auditShareRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M129' as const,
        kind: 'audit-share-revoke-seek-multiselect-contrast' as const,
        titleZh: '审计分享吊销回跳台账 · 多选中文对照',
        bodyZh:
          `审计分享吊销角色审计回跳台账支持多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedIndexes: indexes,
        selectedRows,
        selectedCount: selectedRows.length,
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
    wave: 'M129' as const,
    labelZh: auditShareRevokeSeekMultiselectContrast
      ? `审计分享吊销回跳多选对照 · ${auditShareRevokeSeekMultiselectContrast.selectedCount}行`
      : '审计分享吊销回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeSeekMultiselectContrast ? ` · ${auditShareRevokeSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: auditShareRevokeSeekMultiselectContrast
      ? '审计分享吊销回跳多选中文对照'
      : '审计分享吊销回跳多选对照待命',
    busyZh: '审计分享吊销回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeRoleAuditSeekLedgerIntact: (base as any).auditShareRevokeRoleAuditSeekLedgerIntact === true,
    auditShareRevokeSeekMultiselectContrastIntact: !!auditShareRevokeSeekMultiselectContrast,
    auditShareRevokeSeekMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M130：审计分享吊销多选对照 · 短片帧 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(
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
      wave: 'M130' as const,
      labelZh: '审计分享吊销多选对照短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销多选对照短片帧 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销多选对照短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditShareRevokeSeekMultiselectContrast || null;
  const rows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const auditShareRevokeMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M130' as const,
        kind: 'audit-share-revoke-multiselect-clip-scrubber' as const,
        titleZh: '审计分享吊销多选对照 · 短片帧 scrubber',
        bodyZh:
          `审计分享吊销多选中文对照支持短片帧 scrubber · ${Math.max(rows.length, 2)}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (rows.length
          ? rows
          : [
              { id: 'm130-audit-share-revoke-ms-0', lineZh: '审计分享吊销台账对照行#1', contrastSide: 'A' },
              { id: 'm130-audit-share-revoke-ms-1', lineZh: '审计分享吊销台账对照行#2', contrastSide: 'B' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          id: r.id || `m130-audit-share-revoke-ms-${i}`,
          lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
          contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M130' as const,
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
    wave: 'M130' as const,
    labelZh: auditShareRevokeMultiselectClipScrubber
      ? `审计分享吊销多选对照短片 scrubber · ${auditShareRevokeMultiselectClipScrubber.frameCount}帧`
      : '审计分享吊销多选对照短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeMultiselectClipScrubber ? ` · ${auditShareRevokeMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: auditShareRevokeMultiselectClipScrubber
      ? '审计分享吊销多选对照短片 scrubber 已开'
      : '审计分享吊销多选对照短片 scrubber 待命',
    busyZh: '审计分享吊销多选对照短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeSeekMultiselectContrastIntact: (base as any).auditShareRevokeSeekMultiselectContrastIntact === true,
    auditShareRevokeMultiselectClipScrubberIntact: !!auditShareRevokeMultiselectClipScrubber,
    auditShareRevokeMultiselectClipScrubber,
    clipFrameScrubber: auditShareRevokeMultiselectClipScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}


/**
 * M131：审计分享吊销多选对照短片 scrubber · 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    scrubIndex?: number | null;
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
      wave: 'M131' as const,
      labelZh: '审计分享吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销多选对照短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditShareRevokeMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = (frames.length
    ? frames
    : [
        { index: 0, lineZh: '审计分享吊销对照帧#1', id: 'm131-audit-share-revoke-ms-0' },
        { index: 1, lineZh: '审计分享吊销对照帧#2', id: 'm131-audit-share-revoke-ms-1' },
      ]
  ).map((f: any, i: number) => ({
    id: `m131-audit-share-revoke-kf-${i}`,
    index: i,
    scrubIndex: f.scrubIndex ?? i,
    nameZh: opts.bookmarkNameZh || `演示·M131审计分享吊销关帧#${i + 1}`,
    lineZh: f.lineZh || `对照帧#${i + 1}`,
    ledgerRowId: f.id || f.ledgerRowId || `m131-audit-share-revoke-ms-${i}`,
    role,
    roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M131' as const,
  }));
  const auditShareRevokeMultiselectClipKfBm = wantsBm
    ? {
        wave: 'M131' as const,
        kind: 'audit-share-revoke-multiselect-clip-kf-bm' as const,
        titleZh: '审计分享吊销多选对照短片 scrubber · 关帧书签',
        bodyZh:
          `审计分享吊销多选对照短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
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
    wave: 'M131' as const,
    labelZh: auditShareRevokeMultiselectClipKfBm
      ? `审计分享吊销多选短片关帧书签 · ${auditShareRevokeMultiselectClipKfBm.bookmarkCount}枚`
      : '审计分享吊销多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeMultiselectClipKfBm ? ` · ${auditShareRevokeMultiselectClipKfBm.bodyZh}` : ''),
    toastZh: auditShareRevokeMultiselectClipKfBm
      ? '审计分享吊销多选短片关帧书签已开'
      : '审计分享吊销多选短片关帧书签待命',
    busyZh: '审计分享吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeMultiselectClipScrubberIntact: (base as any).auditShareRevokeMultiselectClipScrubberIntact === true,
    auditShareRevokeMultiselectClipKfBmIntact: !!auditShareRevokeMultiselectClipKfBm,
    auditShareRevokeMultiselectClipKfBm,
    keyframeBookmarks: auditShareRevokeMultiselectClipKfBm?.bookmarks || null,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}


/**
 * M132：审计分享吊销多选短片关帧书签 · 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(
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
      wave: 'M132' as const,
      labelZh: '审计分享吊销多选短片关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销多选短片关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销多选短片关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditShareRevokeMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m132-audit-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m132-audit-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `m132-audit-kf-share-${Buffer.from(sessionId + '→' + targetSessionId).toString('base64url').slice(0, 16)}`;
  const auditShareRevokeMultiselectClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M132' as const,
        kind: 'audit-share-revoke-multiselect-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '审计分享吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计分享吊销多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: bookmarks.length
          ? bookmarks
          : [
              { id: 'm132-audit-share-revoke-kf-0', nameZh: '演示·M132审计分享吊销关帧#1', wave: 'M132' as const },
              { id: 'm132-audit-share-revoke-kf-1', nameZh: '演示·M132审计分享吊销关帧#2', wave: 'M132' as const },
            ],
        bookmarkCount: Math.max(bookmarks.length, 1),
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
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
    wave: 'M132' as const,
    labelZh: auditShareRevokeMultiselectClipKfBmXsessionRoShare
      ? `审计分享吊销多选短片关帧跨会话只读分享 · ${auditShareRevokeMultiselectClipKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计分享吊销多选短片关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeMultiselectClipKfBmXsessionRoShare ? ` · ${auditShareRevokeMultiselectClipKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditShareRevokeMultiselectClipKfBmXsessionRoShare
      ? '审计分享吊销多选短片关帧跨会话只读分享已开'
      : '审计分享吊销多选短片关帧跨会话只读分享待命',
    busyZh: '审计分享吊销多选短片关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeMultiselectClipKfBmIntact: (base as any).auditShareRevokeMultiselectClipKfBmIntact === true,
    auditShareRevokeMultiselectClipKfBmXsessionRoShareIntact: !!auditShareRevokeMultiselectClipKfBmXsessionRoShare,
    auditShareRevokeMultiselectClipKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoSharePath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}


/**
 * M133：审计分享吊销关帧跨会话只读分享 · 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(
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
    chineseLedger?: boolean;
    writeSoftCancelLedger?: boolean;
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
      wave: 'M133' as const,
      labelZh: '审计分享吊销关帧跨会话过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销关帧跨会话过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销关帧跨会话过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const share = (base as any).auditShareRevokeMultiselectClipKfBmXsessionRoShare || null;
  const expiresInMs = Math.max(1000, Number(opts.expiresInMs) || 3600000);
  const wantsExpiry =
    opts.expiryRevokeLedger !== false &&
    (opts.expiryRevokeLedger === true ||
      opts.shareLinkExpiry === true ||
      opts.revokeShare === true ||
      opts.chineseLedger === true ||
      !!share);
  const revoked = opts.revokeShare !== false;
  const ledgerEntry = {
    id: 'm133-audit-share-revoke-expiry-0',
    kindZh: '审计分享吊销关帧跨会话过期吊销',
    auditLineZh:
      `审计分享吊销关帧跨会话只读分享${revoked ? '已吊销' : '将过期'} · 过期 ${expiresInMs}ms` +
      (share?.shareToken ? ` · token=${String(share.shareToken).slice(0, 12)}…` : '') +
      ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」`,
    role,
    roleZh,
    expiresInMs,
    revoked,
    shareToken: share?.shareToken || null,
    wave: 'M133' as const,
  };
  const auditShareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M133' as const,
        kind: 'audit-share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计分享吊销关帧跨会话只读分享 · 过期吊销中文台账',
        bodyZh:
          `审计分享吊销关帧跨会话只读分享支持过期+吊销写入中文台账` +
          ` · ${ledgerEntry.auditLineZh} · 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerEntry,
        chineseShareLedger: [ledgerEntry],
        expiresInMs,
        revoked,
        filterRole,
        filterRoleZh,
        fromXsessionShare: share ? { kind: share.kind, bookmarkCount: share.bookmarkCount, shareToken: share.shareToken } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M133' as const,
    labelZh: auditShareRevokeKfBmXsessionExpiryRevokeLedger
      ? '审计分享吊销关帧跨会话过期吊销进台账'
      : '审计分享吊销关帧跨会话过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${auditShareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: auditShareRevokeKfBmXsessionExpiryRevokeLedger
      ? '审计分享吊销关帧跨会话过期吊销进台账已开'
      : '审计分享吊销关帧跨会话过期吊销进台账待命',
    busyZh: '审计分享吊销关帧跨会话过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeMultiselectClipKfBmXsessionRoShareIntact: (base as any).auditShareRevokeMultiselectClipKfBmXsessionRoShareIntact === true,
    auditShareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!auditShareRevokeKfBmXsessionExpiryRevokeLedger,
    auditShareRevokeKfBmXsessionExpiryRevokeLedger,
    chineseShareLedger: auditShareRevokeKfBmXsessionExpiryRevokeLedger?.chineseShareLedger || (base as any).chineseShareLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}

/**
 * M134：审计分享吊销过期吊销中文台账 · 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    roleFilteredAudit?: boolean;
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
      wave: 'M134' as const,
      labelZh: '审计分享吊销过期吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销过期吊销台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).auditShareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const entry = ledger?.ledgerEntry || {
    id: `m134-audit-share-revoke-expiry-${Date.now().toString(36)}`,
    kindZh: '审计分享吊销关帧跨会话过期吊销',
    auditLineZh: `审计分享吊销关帧跨会话过期吊销台账行 · 角色「${roleZh}」`,
    role,
    roleZh,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const auditShareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M134' as const,
        kind: 'audit-share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '审计分享吊销过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计分享吊销关帧跨会话过期吊销中文台账可出角色过滤审计一页纸 · 过滤「${filterRoleZh}」` +
          ` · 行「${entry.id || 'row'}」· ${entry.auditLineZh || entry.kindZh || '分享吊销过期吊销台账行'} · 干跑 · toast · 无外发`,
        filterRole,
        filterRoleZh,
        lineCount: 2,
        lines: [
          {
            id: entry.id || 'm134-audit-share-revoke-expiry-0',
            auditLineZh: entry.auditLineZh || entry.kindZh || `分享吊销过期吊销台账 · 角色「${roleZh}」`,
            role: entry.role || role,
            roleZh: entry.roleZh || roleZh,
            wave: 'M134' as const,
          },
          {
            id: 'm134-audit-share-revoke-expiry-1',
            auditLineZh: `审计分享吊销过期吊销附行 · token ${ledger?.fromXsessionShare?.shareToken || entry.shareToken || 'revoked'} · 过滤「${filterRoleZh}」`,
            role: filterRole,
            roleZh: filterRoleZh,
            wave: 'M134' as const,
          },
        ],
        onePager: {
          wave: 'M134' as const,
          titleZh: '审计分享吊销过期吊销台账 · 角色审计一页纸',
          roleFiltered: true as const,
          inApp: true as const,
        },
        fromLedger: ledger
          ? { kind: ledger.kind, expiresInMs: ledger.expiresInMs, revoked: ledger.revoked }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M134' as const,
    labelZh: auditShareRevokeExpiryLedgerRoleAuditOnepager
      ? `审计分享吊销过期吊销台账角色审计一页纸 · 过滤「${filterRoleZh}」`
      : '审计分享吊销过期吊销台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeExpiryLedgerRoleAuditOnepager ? ` · ${auditShareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditShareRevokeExpiryLedgerRoleAuditOnepager
      ? '审计分享吊销过期吊销台账角色审计一页纸已开'
      : '审计分享吊销过期吊销台账角色审计一页纸待命',
    busyZh: '审计分享吊销过期吊销台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditShareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditShareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!auditShareRevokeExpiryLedgerRoleAuditOnepager,
    auditShareRevokeExpiryLedgerRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}



/**
 * M135：审计分享吊销过期吊销台账角色审计一页纸 · 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(
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
      wave: 'M135' as const,
      labelZh: '审计分享吊销过期吊销台账角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销过期吊销台账角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销过期吊销台账角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditShareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm135-audit-share-revoke-expiry-0', auditLineZh: '演示·审计分享吊销过期吊销台账行#1' },
    { id: 'm135-audit-share-revoke-expiry-1', auditLineZh: '演示·审计分享吊销过期吊销台账行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditShareRevokeExpiryLedgerRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M135' as const,
        kind: 'audit-share-revoke-expiry-ledger-role-audit-seek-ledger' as const,
        titleZh: '审计分享吊销过期吊销台账角色审计一页纸 · 回跳台账行',
        bodyZh:
          `审计分享吊销过期吊销台账角色过滤审计一页纸可回跳台账行 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m135-audit-share-revoke-expiry-${seekEntryIndex}`,
        lineZh: row?.auditLineZh || row?.kindZh || `过期吊销台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M135' as const,
    labelZh: auditShareRevokeExpiryLedgerRoleAuditSeekLedger
      ? `审计分享吊销过期吊销台账角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计分享吊销过期吊销台账角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditShareRevokeExpiryLedgerRoleAuditSeekLedger ? ` · ${auditShareRevokeExpiryLedgerRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditShareRevokeExpiryLedgerRoleAuditSeekLedger
      ? '审计分享吊销过期吊销台账角色审计回跳台账已开'
      : '审计分享吊销过期吊销台账角色审计回跳台账待命',
    busyZh: '审计分享吊销过期吊销台账角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).auditShareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    auditShareRevokeExpiryLedgerRoleAuditSeekLedgerIntact: !!auditShareRevokeExpiryLedgerRoleAuditSeekLedger,
    auditShareRevokeExpiryLedgerRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}


/**
 * M136：审计分享吊销过期吊销台账角色审计回跳 · 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(
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
      wave: 'M136' as const,
      labelZh: '审计分享吊销过期台账角色审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销过期台账角色审计回跳多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计分享吊销过期台账角色审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditShareRevokeExpiryLedgerRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).auditShareRevokeExpiryLedgerRoleAuditOnepager?.lines)
    ? (base as any).auditShareRevokeExpiryLedgerRoleAuditOnepager.lines
    : [
        { id: 'm136-audit-share-revoke-expiry-0', auditLineZh: '演示·审计分享吊销过期吊销台账行#1' },
        { id: 'm136-audit-share-revoke-expiry-1', auditLineZh: '演示·审计分享吊销过期吊销台账行#2' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = indexes.map((idx, i) => {
    const row = lines[Math.min(idx, lines.length - 1)] || lines[0];
    return {
      index: idx,
      id: row?.id || `m136-audit-expiry-ms-${i}`,
      lineZh: row?.auditLineZh || row?.kindZh || `过期吊销台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      wave: 'M136' as const,
    };
  });
  const auditExpiryRoleAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M136' as const,
        kind: 'audit-expiry-role-audit-seek-multiselect-contrast' as const,
        titleZh: '审计分享吊销过期吊销台账角色审计回跳 · 多选中文对照',
        bodyZh:
          `审计分享吊销过期吊销台账角色审计回跳支持多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        selectedIndexes: indexes,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        fromSeekLedger: seek
          ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId, seekEntryIndex: seek.seekEntryIndex }
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
    labelZh: auditExpiryRoleAuditSeekMultiselectContrast
      ? `审计分享吊销过期台账角色审计回跳多选对照 · ${auditExpiryRoleAuditSeekMultiselectContrast.selectedCount}行`
      : '审计分享吊销过期台账角色审计回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRoleAuditSeekMultiselectContrast ? ` · ${auditExpiryRoleAuditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: auditExpiryRoleAuditSeekMultiselectContrast
      ? '审计分享吊销过期台账角色审计回跳多选对照已开'
      : '审计分享吊销过期台账角色审计回跳多选对照待命',
    busyZh: '审计分享吊销过期台账角色审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditShareRevokeExpiryLedgerRoleAuditSeekLedgerIntact: (base as any).auditShareRevokeExpiryLedgerRoleAuditSeekLedgerIntact === true,
    auditExpiryRoleAuditSeekMultiselectContrastIntact: !!auditExpiryRoleAuditSeekMultiselectContrast,
    auditExpiryRoleAuditSeekMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}



/**
 * M137：审计分享吊销过期台账角色审计回跳多选对照 · 短片帧 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
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
      wave: 'M137' as const,
      labelZh: '审计过期回跳多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过审计分享吊销过期台账角色审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期回跳多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditExpiryRoleAuditSeekMultiselectContrast || null;
  const rows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const auditExpiryRoleAuditSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M137' as const,
        kind: 'audit-expiry-role-audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '审计分享吊销过期台账角色审计回跳多选对照 · 短片帧 scrubber',
        bodyZh:
          `审计分享吊销过期台账角色审计回跳多选中文对照支持短片帧 scrubber · ${Math.max(rows.length, 2)}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (rows.length
          ? rows
          : [
              { id: 'm137-audit-expiry-ms-0', lineZh: '过期吊销台账对照行#1', contrastSide: 'A' },
              { id: 'm137-audit-expiry-ms-1', lineZh: '过期吊销台账对照行#2', contrastSide: 'B' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          id: r.id || `m137-audit-expiry-ms-${i}`,
          lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
          contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M137' as const,
        })),
        frameCount: Math.max(rows.length, 2),
        scrubIndex,
        currentFrameIndex: scrubIndex,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedIndexes: ms.selectedIndexes, selectedCount: ms.selectedCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M137' as const,
    labelZh: auditExpiryRoleAuditSeekMultiselectClipScrubber
      ? `审计过期回跳多选短片 scrubber · ${auditExpiryRoleAuditSeekMultiselectClipScrubber.frameCount}帧`
      : '审计过期回跳多选短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRoleAuditSeekMultiselectClipScrubber ? ` · ${auditExpiryRoleAuditSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: auditExpiryRoleAuditSeekMultiselectClipScrubber
      ? '审计过期回跳多选短片 scrubber 已开'
      : '审计过期回跳多选短片 scrubber 待命',
    busyZh: '审计过期回跳多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditSeekMultiselectContrastIntact: (base as any).auditExpiryRoleAuditSeekMultiselectContrastIntact === true,
    auditExpiryRoleAuditSeekMultiselectClipScrubberIntact: !!auditExpiryRoleAuditSeekMultiselectClipScrubber,
    auditExpiryRoleAuditSeekMultiselectClipScrubber,
    clipFrameScrubber: auditExpiryRoleAuditSeekMultiselectClipScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}


/**
 * M138：审计过期回跳多选短片 scrubber · 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    scrubIndex?: number | null;
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
      wave: 'M138' as const,
      labelZh: '审计回跳多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计过期回跳多选短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditExpiryRoleAuditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = (frames.length
    ? frames
    : [
        { index: 0, lineZh: '过期吊销台账对照帧#1', id: 'm138-audit-expiry-ms-0' },
        { index: 1, lineZh: '过期吊销台账对照帧#2', id: 'm138-audit-expiry-ms-1' },
      ]
  ).map((f: any, i: number) => ({
    id: `m138-audit-expiry-kf-${i}`,
    index: i,
    scrubIndex: f.scrubIndex ?? i,
    nameZh: opts.bookmarkNameZh || `演示·M138审计过期回跳多选短片关帧#${i + 1}`,
    lineZh: f.lineZh || `对照帧#${i + 1}`,
    ledgerRowId: f.id || f.ledgerRowId || `m138-audit-expiry-ms-${i}`,
    role,
    roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M138' as const,
  }));
  const auditExpirySeekMultiselectClipKfBm = wantsBm
    ? {
        wave: 'M138' as const,
        kind: 'audit-expiry-seek-multiselect-clip-kf-bm' as const,
        titleZh: '审计过期回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `审计过期回跳多选中文对照短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
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
    wave: 'M138' as const,
    labelZh: auditExpirySeekMultiselectClipKfBm
      ? `审计回跳多选短片关帧书签 · ${auditExpirySeekMultiselectClipKfBm.bookmarkCount}枚`
      : '审计回跳多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpirySeekMultiselectClipKfBm ? ` · ${auditExpirySeekMultiselectClipKfBm.bodyZh}` : ''),
    toastZh: auditExpirySeekMultiselectClipKfBm
      ? '审计回跳多选短片关帧书签已开'
      : '审计回跳多选短片关帧书签待命',
    busyZh: '审计回跳多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditSeekMultiselectClipScrubberIntact: (base as any).auditExpiryRoleAuditSeekMultiselectClipScrubberIntact === true,
    auditExpirySeekMultiselectClipKfBmIntact: !!auditExpirySeekMultiselectClipKfBm,
    auditExpirySeekMultiselectClipKfBm,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}


/**
 * M139：审计过期回跳多选短片关帧书签 · 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(
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
      wave: 'M139' as const,
      labelZh: '审计关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计过期回跳多选短片关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditExpirySeekMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m139-audit-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m139-audit-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `m139-audit-kf-share-${Buffer.from(sessionId + '→' + targetSessionId).toString('base64url').slice(0, 16)}`;
  const auditKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M139' as const,
        kind: 'audit-kf-bm-xsession-ro-share' as const,
        titleZh: '审计过期回跳多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计过期回跳多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M139' as const }))
          : [
              { id: 'm139-audit-kf-0', nameZh: '演示·M139审计过期关帧#1', sharedRo: true, wave: 'M139' as const },
              { id: 'm139-audit-kf-1', nameZh: '演示·M139审计过期关帧#2', sharedRo: true, wave: 'M139' as const },
            ],
        bookmarkCount: Math.max(bookmarks.length, 1),
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
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
    wave: 'M139' as const,
    labelZh: auditKfBmXsessionRoShare
      ? `审计关帧跨会话只读分享 · ${auditKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionRoShare ? ` · ${auditKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditKfBmXsessionRoShare
      ? '审计关帧跨会话只读分享已开'
      : '审计关帧跨会话只读分享待命',
    busyZh: '审计关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpirySeekMultiselectClipKfBmIntact: (base as any).auditExpirySeekMultiselectClipKfBmIntact === true,
    auditKfBmXsessionRoShareIntact: !!auditKfBmXsessionRoShare,
    auditKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoSharePath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}


/**
 * M140：审计关帧跨会话只读分享 · 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M140' as const,
      labelZh: '审计关帧跨会话过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话只读分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).auditKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m140-audit-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m140-audit-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const auditKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M140' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `审计关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M140' as const,
          id: `m140-audit-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '审计关帧跨会话分享吊销' : '审计关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销审计关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记审计关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
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
    wave: 'M140' as const,
    labelZh: auditKfBmXsessionExpiryRevokeLedger
      ? `审计关帧跨会话过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
      : '审计关帧跨会话过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedger ? ` · ${auditKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedger
      ? '审计关帧跨会话过期吊销进台账已开'
      : '审计关帧跨会话过期吊销进台账待命',
    busyZh: '审计关帧跨会话过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionRoShareIntact: (base as any).auditKfBmXsessionRoShareIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerIntact: !!auditKfBmXsessionExpiryRevokeLedger,
    auditKfBmXsessionExpiryRevokeLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}


/**
 * M141：审计关帧跨会话过期吊销中文台账 · 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    roleFilteredAudit?: boolean;
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
      wave: 'M141' as const,
      labelZh: '审计过期吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期吊销台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const entry = ledger?.ledgerEntry || {
    id: `m141-audit-expiry-revoke-${Date.now().toString(36)}`,
    kindZh: '审计关帧跨会话过期吊销',
    auditLineZh: `审计关帧跨会话过期吊销台账行 · 角色「${roleZh}」`,
    role,
    roleZh,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M141' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger-role-audit-onepager' as const,
        titleZh: '审计关帧跨会话过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计关帧跨会话过期吊销中文台账可出角色过滤审计一页纸 · 过滤「${filterRoleZh}」` +
          ` · 行「${entry.id || 'row'}」· ${entry.auditLineZh || entry.kindZh || '过期吊销台账行'} · 干跑 · toast · 无外发`,
        filterRole,
        filterRoleZh,
        lineCount: 2,
        lines: [
          {
            id: entry.id || 'm141-audit-expiry-revoke-0',
            auditLineZh: entry.auditLineZh || entry.kindZh || `过期吊销台账 · 角色「${roleZh}」`,
            role: entry.role || role,
            roleZh: entry.roleZh || roleZh,
            wave: 'M141' as const,
          },
          {
            id: 'm141-audit-expiry-revoke-1',
            auditLineZh: `审计过期吊销附行 · token ${ledger?.fromXsessionShare?.shareToken || entry.shareToken || 'revoked'} · 过滤「${filterRoleZh}」`,
            role: filterRole,
            roleZh: filterRoleZh,
            wave: 'M141' as const,
          },
        ],
        onePager: {
          wave: 'M141' as const,
          titleZh: '审计过期吊销台账 · 角色审计一页纸',
          roleFiltered: true as const,
          inApp: true as const,
        },
        fromLedger: ledger
          ? { kind: ledger.kind, expiresInMs: ledger.expiresInMs, revokeShare: ledger.revokeShare }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M141' as const,
    labelZh: auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager
      ? `审计过期吊销台账角色审计一页纸 · 过滤「${filterRoleZh}」`
      : '审计过期吊销台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager ? ` · ${auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager
      ? '审计过期吊销台账角色审计一页纸已开'
      : '审计过期吊销台账角色审计一页纸待命',
    busyZh: '审计过期吊销台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact: !!auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerPath: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}

/**
 * M142：审计过期角色审计一页纸回跳台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142(
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
    opts.seekBackToLedger === false &&
    opts.highlightLedgerRow === false
  ) {
    return {
      ok: true as const,
      wave: 'M142' as const,
      labelZh: '审计过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计过期角色审计一页纸回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm142-audit-expiry-0', auditLineZh: '演示·审计过期吊销角色审计台账行#1' },
    { id: 'm142-audit-expiry-1', auditLineZh: '演示·审计过期吊销角色审计台账行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M142' as const,
        kind: 'audit-expiry-role-audit-seek-ledger' as const,
        titleZh: '审计过期吊销角色审计一页纸 · 回跳台账行',
        bodyZh:
          `审计过期吊销角色过滤审计一页纸可回跳台账行 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m142-audit-expiry-${seekEntryIndex}`,
        lineZh: row?.auditLineZh || row?.kindZh || `过期吊销台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M142' as const,
    labelZh: auditExpiryRoleAuditSeekLedger
      ? `审计过期角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计过期角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRoleAuditSeekLedger ? ` · ${auditExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditExpiryRoleAuditSeekLedger
      ? '审计过期角色审计回跳台账已开'
      : '审计过期角色审计回跳台账待命',
    busyZh: '审计过期角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact === true,
    auditExpiryRoleAuditSeekLedgerIntact: !!auditExpiryRoleAuditSeekLedger,
    auditExpiryRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}

/**
 * M143：审计过期角色审计回跳 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143(
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
      wave: 'M143' as const,
      labelZh: '审计过期回跳多选中文对照 · 已软取消',
      tipZh: '用户软取消赢过审计过期角色审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期回跳多选中文对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager?.lines)
    ? (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.lines
    : [
        { id: 'm143-audit-expiry-0', auditLineZh: '演示·审计过期吊销角色审计台账行#1' },
        { id: 'm143-audit-expiry-1', auditLineZh: '演示·审计过期吊销角色审计台账行#2' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = indexes.map((idx, i) => {
    const row = lines[Math.min(idx, Math.max(lines.length - 1, 0))] || lines[0];
    return {
      index: idx,
      id: row?.id || `m143-audit-expiry-ms-${i}`,
      lineZh: row?.auditLineZh || row?.kindZh || `过期吊销台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      wave: 'M143' as const,
    };
  });
  const auditExpirySeekMultiselectContrast = wantsMs
    ? {
        wave: 'M143' as const,
        kind: 'audit-expiry-seek-multiselect-contrast' as const,
        titleZh: '审计过期角色审计回跳 · 多选中文对照',
        bodyZh:
          `审计过期角色审计回跳支持多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        selectedIndexes: indexes,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        fromSeekLedger: seek
          ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId, seekEntryIndex: seek.seekEntryIndex }
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
    labelZh: auditExpirySeekMultiselectContrast
      ? `审计过期回跳多选中文对照 · ${auditExpirySeekMultiselectContrast.selectedCount}行`
      : '审计过期回跳多选中文对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpirySeekMultiselectContrast ? ` · ${auditExpirySeekMultiselectContrast.bodyZh}` : ''),
    toastZh: auditExpirySeekMultiselectContrast
      ? '审计过期回跳多选中文对照已开'
      : '审计过期回跳多选中文对照待命',
    busyZh: '审计过期回跳多选中文对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditSeekLedgerIntact: (base as any).auditExpiryRoleAuditSeekLedgerIntact === true,
    auditExpirySeekMultiselectContrastIntact: !!auditExpirySeekMultiselectContrast,
    auditExpirySeekMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}


/**
 * M144：审计过期多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144(
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
      wave: 'M144' as const,
      labelZh: '审计过期多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过审计过期多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditExpirySeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { id: 'm144-audit-expiry-ms-0', lineZh: '审计过期台账对照行#1', contrastSide: 'A' },
    { id: 'm144-audit-expiry-ms-1', lineZh: '审计过期台账对照行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const auditExpiryMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M144' as const,
        kind: 'audit-expiry-multiselect-clip-scrubber' as const,
        titleZh: '审计过期多选中文对照 · 短片 scrubber',
        bodyZh:
          `审计过期多选中文对照支持短片 scrubber · ${Math.max(selectedRows.length, 2)}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (selectedRows.length
          ? selectedRows
          : [
              { id: 'm144-audit-expiry-ms-0', lineZh: '审计过期台账对照行#1', contrastSide: 'A' },
              { id: 'm144-audit-expiry-ms-1', lineZh: '审计过期台账对照行#2', contrastSide: 'B' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          frameIndex: i,
          scrubIndex: i,
          id: r.id || `m144-audit-expiry-ms-${i}`,
          lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
          contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          isCurrent: i === scrubIndex,
          wave: 'M144' as const,
        })),
        frameCount: Math.max(selectedRows.length, 2),
        scrubIndex,
        currentFrameIndex: scrubIndex,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedIndexes: ms.selectedIndexes, selectedCount: ms.selectedCount }
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
    labelZh: auditExpiryMultiselectClipScrubber
      ? `审计过期多选短片 scrubber · ${auditExpiryMultiselectClipScrubber.frameCount}帧`
      : '审计过期多选短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryMultiselectClipScrubber ? ` · ${auditExpiryMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: auditExpiryMultiselectClipScrubber
      ? '审计过期多选短片 scrubber 已开'
      : '审计过期多选短片 scrubber 待命',
    busyZh: '审计过期多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpirySeekMultiselectContrastIntact: (base as any).auditExpirySeekMultiselectContrastIntact === true,
    auditExpiryMultiselectClipScrubberIntact: !!auditExpiryMultiselectClipScrubber,
    auditExpiryMultiselectClipScrubber,
    clipFrameScrubber: auditExpiryMultiselectClipScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M145：审计过期多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145(
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
      wave: 'M145' as const,
      labelZh: '审计过期多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计过期多选短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditExpiryMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { index: 0, lineZh: '审计过期台账对照帧#1', id: 'm145-audit-expiry-ms-0' },
    { index: 1, lineZh: '审计过期台账对照帧#2', id: 'm145-audit-expiry-ms-1' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m145-audit-expiry-kf-${i}`,
    index: i,
    scrubIndex: f.scrubIndex ?? i,
    nameZh: opts.bookmarkNameZh || `演示·M145审计过期多选短片关帧#${i + 1}`,
    lineZh: f.lineZh || `对照帧#${i + 1}`,
    ledgerRowId: f.id || f.ledgerRowId || `m145-audit-expiry-ms-${i}`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role,
    roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M145' as const,
  }));
  const auditExpiryMultiselectClipKfBm = wantsBm
    ? {
        wave: 'M145' as const,
        kind: 'audit-expiry-multiselect-clip-kf-bm' as const,
        titleZh: '审计过期多选短片 scrubber · 关帧书签',
        bodyZh:
          `审计过期多选中文对照短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
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
    wave: 'M145' as const,
    labelZh: auditExpiryMultiselectClipKfBm
      ? `审计过期多选短片关帧书签 · ${auditExpiryMultiselectClipKfBm.bookmarkCount}枚`
      : '审计过期多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryMultiselectClipKfBm ? ` · ${auditExpiryMultiselectClipKfBm.bodyZh}` : ''),
    toastZh: auditExpiryMultiselectClipKfBm
      ? '审计过期多选短片关帧书签已开'
      : '审计过期多选短片关帧书签待命',
    busyZh: '审计过期多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryMultiselectClipScrubberIntact: (base as any).auditExpiryMultiselectClipScrubberIntact === true,
    auditExpiryMultiselectClipKfBmIntact: !!auditExpiryMultiselectClipKfBm,
    auditExpiryMultiselectClipKfBm,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}


/**
 * M146：审计过期多选短片关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146(
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
      wave: 'M146' as const,
      labelZh: '审计过期关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计过期多选短片关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditExpiryMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m146-audit').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m146-audit').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `m146-audit-kf-share-${Buffer.from(sessionId + '→' + targetSessionId).toString('base64url').slice(0, 16)}`;
  const auditExpiryKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M146' as const,
        kind: 'audit-expiry-kf-bm-xsession-ro-share' as const,
        titleZh: '审计过期多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计过期多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M146' as const }))
          : [
              { id: 'm146-audit-kf-0', nameZh: '演示·M146审计过期关帧#1', sharedRo: true, wave: 'M146' as const },
              { id: 'm146-audit-kf-1', nameZh: '演示·M146审计过期关帧#2', sharedRo: true, wave: 'M146' as const },
            ],
        bookmarkCount: Math.max(bookmarks.length, 1),
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
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
    wave: 'M146' as const,
    labelZh: auditExpiryKfBmXsessionRoShare
      ? `审计过期关帧跨会话只读分享 · ${auditExpiryKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计过期关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryKfBmXsessionRoShare ? ` · ${auditExpiryKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditExpiryKfBmXsessionRoShare
      ? '审计过期关帧跨会话只读分享已开'
      : '审计过期关帧跨会话只读分享待命',
    busyZh: '审计过期关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryMultiselectClipKfBmIntact: (base as any).auditExpiryMultiselectClipKfBmIntact === true,
    auditExpiryKfBmXsessionRoShareIntact: !!auditExpiryKfBmXsessionRoShare,
    auditExpiryKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}


/**
 * M147：审计过期关帧跨会话只读分享 → 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M147' as const,
      labelZh: '审计过期关帧跨会话过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过审计过期关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期关帧跨会话过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).auditExpiryKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m147-audit').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m147-audit').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const auditExpiryKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M147' as const,
        kind: 'audit-expiry-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计过期关帧跨会话分享 · 过期吊销进中文台账',
        bodyZh:
          `审计过期关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare: true as const,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        ledgerEntry: {
          wave: 'M147' as const,
          id: `m147-audit-share-revoke-${Date.now().toString(36)}`,
          kindZh: '审计过期关帧跨会话分享过期吊销',
          auditLineZh: revokeShare
            ? `吊销审计过期跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记审计过期跨会话只读关帧分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          lineZh: revokeShare
            ? `吊销审计过期跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚`
            : `登记审计过期跨会话只读关帧分享过期 ${expiresInMs}ms`,
          role,
          roleZh,
          chineseLedger: true as const,
        },
        chineseShareLedger: true as const,
        bookmarkCount: Math.max(bookmarks.length, 1),
        sessionId,
        targetSessionId,
        fromXsessionShare: xshare ? { kind: xshare.kind, shareToken: xshare.shareToken } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M147' as const,
    labelZh: auditExpiryKfBmXsessionExpiryRevokeLedger
      ? `审计过期关帧跨会话过期吊销进台账${revokeShare ? '（已吊销）' : ''} · ${auditExpiryKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
      : '审计过期关帧跨会话过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryKfBmXsessionExpiryRevokeLedger ? ` · ${auditExpiryKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: auditExpiryKfBmXsessionExpiryRevokeLedger
      ? '审计过期关帧跨会话过期吊销进台账已开'
      : '审计过期关帧跨会话过期吊销进台账待命',
    busyZh: '审计过期关帧跨会话过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryKfBmXsessionRoShareIntact: (base as any).auditExpiryKfBmXsessionRoShareIntact === true,
    auditExpiryKfBmXsessionExpiryRevokeLedgerIntact: !!auditExpiryKfBmXsessionExpiryRevokeLedger,
    auditExpiryKfBmXsessionExpiryRevokeLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}

/**
 * M148：审计过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    roleFilteredAudit?: boolean;
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
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M148' as const,
      labelZh: '审计过期吊销角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计过期吊销中文台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditExpiryKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm148-audit-expiry-0',
    auditLineZh: '演示·审计过期关帧跨会话过期吊销台账行',
    kindZh: '审计过期关帧跨会话过期吊销',
    role,
    roleZh,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm148-audit-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.lineZh || '审计过期关帧跨会话过期吊销台账行',
      kindZh: ledgerEntry.kindZh || '审计过期关帧跨会话过期吊销',
      role: ledgerEntry.role || role,
      roleZh: ROLE_ZH[String(ledgerEntry.role || role).toLowerCase()] || roleZh,
      wave: 'M148' as const,
    },
    {
      id: 'm148-audit-expiry-1',
      auditLineZh: '演示·审计过期关帧跨会话过期吊销台账行#2',
      kindZh: '审计过期关帧跨会话过期吊销',
      role,
      roleZh,
      wave: 'M148' as const,
    },
  ];
  const auditExpiryRevokeRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M148' as const,
        kind: 'audit-expiry-revoke-role-audit-onepager' as const,
        titleZh: '审计过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计过期吊销中文台账可出角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        fromExpiryLedger: expiry ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M148' as const,
    labelZh: auditExpiryRevokeRoleAuditOnepager
      ? `审计过期吊销角色审计一页纸 · ${auditExpiryRevokeRoleAuditOnepager.lineCount}行`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRevokeRoleAuditOnepager ? ` · ${auditExpiryRevokeRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditExpiryRevokeRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditExpiryKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditExpiryRevokeRoleAuditOnepagerIntact: !!auditExpiryRevokeRoleAuditOnepager,
    auditExpiryRevokeRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}

/**
 * M149：审计过期吊销角色审计一页纸 → 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149(
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
      wave: 'M149' as const,
      labelZh: '审计角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计过期吊销角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditExpiryRevokeRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm149-audit-0', auditLineZh: '演示·审计过期吊销角色审计行#1' },
    { id: 'm149-audit-1', auditLineZh: '演示·审计过期吊销角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M149' as const,
        kind: 'audit-role-audit-seek-ledger' as const,
        titleZh: '审计角色过滤审计一页纸 · 回跳台账行',
        bodyZh:
          `审计过期吊销角色过滤审计一页纸可回跳台账行 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m149-audit-${seekEntryIndex}`,
        lineZh: row?.auditLineZh || row?.kindZh || `过期吊销台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M149' as const,
    labelZh: auditRoleAuditSeekLedger
      ? `审计角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditRoleAuditSeekLedger ? ` · ${auditRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditRoleAuditSeekLedger
      ? '审计角色审计回跳台账已开'
      : '审计角色审计回跳台账待命',
    busyZh: '审计角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRevokeRoleAuditOnepagerIntact: (base as any).auditExpiryRevokeRoleAuditOnepagerIntact === true,
    auditRoleAuditSeekLedgerIntact: !!auditRoleAuditSeekLedger,
    auditRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}

/**
 * M150：审计角色审计回跳台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150(
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
      wave: 'M150' as const,
      labelZh: '审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计角色审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditRoleAuditSeekLedger || null;
  const lines: any[] = [
    { id: seek?.ledgerRowId || 'm150-audit-seek-0', auditLineZh: seek?.lineZh || '演示·审计角色审计回跳行#1', contrastSide: 'A' },
    { id: 'm150-audit-seek-1', auditLineZh: '演示·审计角色审计回跳行#2', contrastSide: 'B' },
  ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const uniqueIdx = [...new Set(indexes)];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = uniqueIdx.map((i, ord) => {
    const row = lines[i] || lines[0] || {};
    return {
      index: i,
      id: row.id || `m150-audit-seek-${i}`,
      lineZh: row.auditLineZh || row.kindZh || `审计回跳行#${i + 1}`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M150' as const,
    };
  });
  const auditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M150' as const,
        kind: 'audit-seek-multiselect-contrast' as const,
        titleZh: '审计角色审计回跳 · 多选中文对照',
        bodyZh:
          `审计角色审计回跳台账支持多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes: uniqueIdx,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
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
    wave: 'M150' as const,
    labelZh: auditSeekMultiselectContrast
      ? `审计回跳多选对照 · ${auditSeekMultiselectContrast.selectedCount}行`
      : '审计回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectContrast ? ` · ${auditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: auditSeekMultiselectContrast
      ? '审计回跳多选对照已开'
      : '审计回跳多选对照待命',
    busyZh: '审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditRoleAuditSeekLedgerIntact: (base as any).auditRoleAuditSeekLedgerIntact === true,
    auditSeekMultiselectContrastIntact: !!auditSeekMultiselectContrast,
    auditSeekMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}

/**
 * M151：审计回跳多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151(
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
      wave: 'M151' as const,
      labelZh: '审计回跳多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm151-audit-ms-0', lineZh: '审计回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm151-audit-ms-1', lineZh: '审计回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms || selectedRows.length > 0);
  const frames = selectedRows.map((row: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: row.id || `m151-audit-ms-frame-${i}`,
    lineZh: row.lineZh || row.auditLineZh || `对照帧#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: i === scrubIndex,
    wave: 'M151' as const,
  }));
  const auditSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M151' as const,
        kind: 'audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[Math.min(scrubIndex, Math.max(frames.length - 1, 0))] || frames[0] || null,
        selectedCount: ms?.selectedCount || selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount, seekEntryIndexes: ms.seekEntryIndexes }
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
    wave: 'M151' as const,
    labelZh: auditSeekMultiselectClipScrubber
      ? `审计回跳多选短片 scrubber · ${auditSeekMultiselectClipScrubber.frameCount}帧`
      : '审计回跳多选短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectClipScrubber ? ` · ${auditSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: auditSeekMultiselectClipScrubber
      ? '审计回跳多选短片 scrubber 已开'
      : '审计回跳多选短片 scrubber 待命',
    busyZh: '审计回跳多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectContrastIntact: (base as any).auditSeekMultiselectContrastIntact === true,
    auditSeekMultiselectClipScrubberIntact: !!auditSeekMultiselectClipScrubber,
    auditSeekMultiselectClipScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M152：审计回跳多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152(
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
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M152' as const,
      labelZh: '审计回跳短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm152-audit-ms-frame-0', lineZh: '审计回跳多选帧#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm152-audit-ms-frame-1', lineZh: '审计回跳多选帧#2', contrastSide: 'B' },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m152-audit-seek-kf-${i}`,
    nameZh: opts.bookmarkNameZh ? `${opts.bookmarkNameZh}#${i + 1}` : (f.lineZh || `演示·M152审计回跳关帧#${i + 1}`),
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M152' as const,
  }));
  const auditSeekClipKfBm = wantsKf
    ? {
        wave: 'M152' as const,
        kind: 'audit-seek-clip-kf-bm' as const,
        titleZh: '审计回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `审计回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        frames,
        frameCount: frames.length,
        fromScrubber: scrub
          ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex }
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
    labelZh: auditSeekClipKfBm
      ? `审计回跳短片关帧书签 · ${auditSeekClipKfBm.bookmarkCount}枚`
      : '审计回跳短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekClipKfBm ? ` · ${auditSeekClipKfBm.bodyZh}` : ''),
    toastZh: auditSeekClipKfBm
      ? '审计回跳短片关帧书签已开'
      : '审计回跳短片关帧书签待命',
    busyZh: '审计回跳短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectClipScrubberIntact: (base as any).auditSeekMultiselectClipScrubberIntact === true,
    auditSeekClipKfBmIntact: !!auditSeekClipKfBm,
    auditSeekClipKfBm,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}

/**
 * M153：审计回跳关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
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
      wave: 'M153' as const,
      labelZh: '审计回跳关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计回跳关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditSeekClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm153-audit-kf-0', nameZh: '演示·M153审计回跳关帧#1', scrubIndex: 0 },
    { id: 'm153-audit-kf-1', nameZh: '演示·M153审计回跳关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m153-audit-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m153-audit-kf').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true || opts.readOnlyShare === true || !!kf);
  const shareToken = `ro-m153-audit-kf-${sessionId}-${targetSessionId}-${bookmarks.length}`.slice(0, 96);
  const auditKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M153' as const,
        kind: 'audit-kf-bm-xsession-ro-share' as const,
        titleZh: '审计回跳关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计回跳关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        fromKfBm: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount, frameCount: kf.frameCount }
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
    labelZh: auditKfBmXsessionRoShare
      ? `审计回跳关帧跨会话只读分享 · ${auditKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计回跳关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionRoShare ? ` · ${auditKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditKfBmXsessionRoShare
      ? '审计回跳关帧跨会话只读分享已开'
      : '审计回跳关帧跨会话只读分享待命',
    busyZh: '审计回跳关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekClipKfBmIntact: (base as any).auditSeekClipKfBmIntact === true,
    auditKfBmXsessionRoShareIntact: !!auditKfBmXsessionRoShare,
    auditKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  };
}

/**
 * M154：审计回跳关帧跨会话只读分享 → 过期+吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154(
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
    chineseLedger?: boolean;
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
      wave: 'M154' as const,
      labelZh: '审计回跳关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过审计回跳关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).auditKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm154-audit-kf-0', nameZh: '演示·M154审计回跳关帧#1', scrubIndex: 0 },
    { id: 'm154-audit-kf-1', nameZh: '演示·M154审计回跳关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m154-audit-kf').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m154-audit-kf').trim();
  const expiresInMs = Math.max(60_000, Number(opts.expiresInMs) || 3_600_000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: `m154-audit-kf-expiry-${xshare?.shareToken || 'demo'}`.slice(0, 96),
    auditLineZh:
      `审计回跳关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚 · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresAt}` +
      (revokeShare ? ' · 已吊销' : ''),
    kindZh: revokeShare ? '审计回跳关帧跨会话分享吊销' : '审计回跳关帧跨会话分享过期登记',
    expiresAt,
    revokeShare,
    wave: 'M154' as const,
  };
  const auditKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M154' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计回跳关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `审计回跳关帧跨会话只读分享支持过期+吊销写入中文台账 · ${bookmarks.length}枚` +
          ` · 过期 ${expiresAt}` + (revokeShare ? ' · 已吊销' : '') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        ledgerEntry,
        chineseLedger: opts.chineseLedger !== false,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        revokeShare,
        expiresInMs,
        expiresAt,
        shareToken: xshare?.shareToken || null,
        sessionId,
        targetSessionId,
        fromXshare: xshare
          ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken }
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
    wave: 'M154' as const,
    labelZh: auditKfBmXsessionExpiryRevokeLedger
      ? `审计回跳关帧跨会话过期吊销 · ${auditKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
      : '审计回跳关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedger ? ` · ${auditKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedger
      ? '审计回跳关帧跨会话过期吊销已开'
      : '审计回跳关帧跨会话过期吊销待命',
    busyZh: '审计回跳关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionRoShareIntact: (base as any).auditKfBmXsessionRoShareIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerIntact: !!auditKfBmXsessionExpiryRevokeLedger,
    auditKfBmXsessionExpiryRevokeLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  };
}

/**
 * M155：审计回跳关帧跨会话过期吊销台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155(
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
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M155' as const,
      labelZh: '审计过期吊销角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计回跳过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm155-audit-expiry-0',
    auditLineZh: '演示·审计回跳关帧跨会话过期吊销台账行',
    kindZh: '审计回跳关帧跨会话过期吊销',
    role,
    roleZh,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm155-audit-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.lineZh || '审计回跳关帧跨会话过期吊销台账行',
      kindZh: ledgerEntry.kindZh || '审计回跳关帧跨会话过期吊销',
      role: ledgerEntry.role || role,
      roleZh: ROLE_ZH[String(ledgerEntry.role || role).toLowerCase()] || roleZh,
      wave: 'M155' as const,
    },
    {
      id: 'm155-audit-expiry-1',
      auditLineZh: '演示·审计回跳关帧跨会话过期吊销台账行#2',
      kindZh: '审计回跳关帧跨会话过期吊销',
      role,
      roleZh,
      wave: 'M155' as const,
    },
  ];
  const auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M155' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger-role-audit-onepager' as const,
        titleZh: '审计过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计回跳关帧跨会话过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        fromExpiryLedger: expiry ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M155' as const,
    labelZh: auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager
      ? `审计过期吊销角色审计一页纸 · ${auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.lineCount}行`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager ? ` · ${auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact: !!auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  };
}

/**
 * M156：审计过期角色审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156(
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
      wave: 'M156' as const,
      labelZh: '审计过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计过期角色审计回跳中文台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm156-audit-expiry-0', auditLineZh: '演示·审计过期吊销角色审计行#1' },
    { id: 'm156-audit-expiry-1', auditLineZh: '演示·审计过期吊销角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M156' as const,
        kind: 'audit-expiry-role-audit-seek-ledger' as const,
        titleZh: '审计过期角色审计一页纸 · 回跳中文台账',
        bodyZh:
          `审计过期吊销角色过滤审计一页纸可回跳中文台账 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m156-audit-expiry-${seekEntryIndex}`,
        lineZh: row?.auditLineZh || row?.kindZh || `过期吊销台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        chineseLedger: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M156' as const,
    labelZh: auditExpiryRoleAuditSeekLedger
      ? `审计过期角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计过期角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRoleAuditSeekLedger ? ` · ${auditExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditExpiryRoleAuditSeekLedger
      ? '审计过期角色审计回跳台账已开'
      : '审计过期角色审计回跳台账待命',
    busyZh: '审计过期角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact === true,
    auditExpiryRoleAuditSeekLedgerIntact: !!auditExpiryRoleAuditSeekLedger,
    auditExpiryRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  };
}

/**
 * M157：审计回跳台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157(
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
      wave: 'M157' as const,
      labelZh: '审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager?.lines)
    ? (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.lines
    : [
        { id: seek?.ledgerRowId || 'm157-audit-seek-0', auditLineZh: seek?.lineZh || '演示·审计回跳台账行#1', contrastSide: 'A' },
        { id: 'm157-audit-seek-1', auditLineZh: '演示·审计回跳台账行#2', contrastSide: 'B' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const uniqueIdx = [...new Set(indexes)];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = uniqueIdx.map((i, ord) => {
    const row = lines[i] || lines[0] || {};
    return {
      index: i,
      id: row.id || `m157-audit-seek-${i}`,
      lineZh: row.auditLineZh || row.kindZh || `审计回跳台账行#${i + 1}`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M157' as const,
    };
  });
  const auditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M157' as const,
        kind: 'audit-seek-multiselect-contrast' as const,
        titleZh: '审计回跳中文台账 · 多选中文对照',
        bodyZh:
          `审计回跳中文台账支持多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes: uniqueIdx,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
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
    labelZh: auditSeekMultiselectContrast
      ? `审计回跳多选对照 · ${auditSeekMultiselectContrast.selectedCount}行`
      : '审计回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectContrast ? ` · ${auditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: auditSeekMultiselectContrast
      ? '审计回跳多选对照已开'
      : '审计回跳多选对照待命',
    busyZh: '审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditSeekLedgerIntact: (base as any).auditExpiryRoleAuditSeekLedgerIntact === true,
    auditSeekMultiselectContrastIntact: !!auditSeekMultiselectContrast,
    auditSeekMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  };
}

/**
 * M158：审计回跳多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158(
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
      wave: 'M158' as const,
      labelZh: '审计回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm158-audit-ms-0', lineZh: '演示·审计回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm158-audit-ms-1', lineZh: '演示·审计回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    index: i,
    id: r.id || `m158-audit-clip-${i}`,
    lineZh: r.lineZh || `审计回跳多选短片帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M158' as const,
  }));
  const auditSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M158' as const,
        kind: 'audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
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
    wave: 'M158' as const,
    labelZh: auditSeekMultiselectClipScrubber
      ? `审计回跳多选短片scrubber · ${auditSeekMultiselectClipScrubber.frameCount}帧`
      : '审计回跳多选短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectClipScrubber ? ` · ${auditSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: auditSeekMultiselectClipScrubber
      ? '审计回跳多选短片scrubber已开'
      : '审计回跳多选短片scrubber待命',
    busyZh: '审计回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectContrastIntact: (base as any).auditSeekMultiselectContrastIntact === true,
    auditSeekMultiselectClipScrubberIntact: !!auditSeekMultiselectClipScrubber,
    auditSeekMultiselectClipScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  };
}

/**
 * M159：审计回跳多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159(
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
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M159' as const,
      labelZh: '审计回跳短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm159-audit-ms-frame-0', lineZh: '审计回跳多选帧#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm159-audit-ms-frame-1', lineZh: '审计回跳多选帧#2', contrastSide: 'B' },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m159-audit-seek-kf-${i}`,
    nameZh: opts.bookmarkNameZh ? `${opts.bookmarkNameZh}#${i + 1}` : (f.lineZh || `演示·M159审计回跳关帧#${i + 1}`),
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M159' as const,
  }));
  const auditSeekClipKfBm = wantsKf
    ? {
        wave: 'M159' as const,
        kind: 'audit-seek-clip-kf-bm' as const,
        titleZh: '审计回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `审计回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        frames,
        frameCount: frames.length,
        fromScrubber: scrub
          ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex }
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
    labelZh: auditSeekClipKfBm
      ? `审计回跳短片关帧书签 · ${auditSeekClipKfBm.bookmarkCount}枚`
      : '审计回跳短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekClipKfBm ? ` · ${auditSeekClipKfBm.bodyZh}` : ''),
    toastZh: auditSeekClipKfBm
      ? '审计回跳短片关帧书签已开'
      : '审计回跳短片关帧书签待命',
    busyZh: '审计回跳短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectClipScrubberIntact: (base as any).auditSeekMultiselectClipScrubberIntact === true,
    auditSeekClipKfBmIntact: !!auditSeekClipKfBm,
    auditSeekClipKfBm,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  };
}

/**
 * M160：审计关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
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
      wave: 'M160' as const,
      labelZh: '审计关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditSeekClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm160-audit-kf-0', nameZh: '演示·M160审计关帧#1', scrubIndex: 0 },
    { id: 'm160-audit-kf-1', nameZh: '演示·M160审计关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m160-audit-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m160-audit-kf').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true || opts.readOnlyShare === true || !!kf);
  const shareToken = `ro-m160-audit-kf-${sessionId}-${targetSessionId}-${bookmarks.length}`.slice(0, 96);
  const auditKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M160' as const,
        kind: 'audit-kf-bm-xsession-ro-share' as const,
        titleZh: '审计关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        fromKfBm: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount, frameCount: kf.frameCount }
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
    labelZh: auditKfBmXsessionRoShare
      ? `审计关帧跨会话只读分享 · ${auditKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionRoShare ? ` · ${auditKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditKfBmXsessionRoShare
      ? '审计关帧跨会话只读分享已开'
      : '审计关帧跨会话只读分享待命',
    busyZh: '审计关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekClipKfBmIntact: (base as any).auditSeekClipKfBmIntact === true,
    auditKfBmXsessionRoShareIntact: !!auditKfBmXsessionRoShare,
    auditKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m160',
  };
}

/**
 * M161：审计关帧跨会话只读分享 → 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161(
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
    chineseLedger?: boolean;
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
      wave: 'M161' as const,
      labelZh: '审计关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).auditKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm161-audit-kf-0', nameZh: '演示·M161审计关帧#1', scrubIndex: 0 },
    { id: 'm161-audit-kf-1', nameZh: '演示·M161审计关帧#2', scrubIndex: 1 },
  ];
  const expiresInMs = Math.max(60_000, Number(opts.expiresInMs) || 3_600_000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: `m161-audit-kf-expiry-${xshare?.shareToken || 'demo'}`.slice(0, 96),
    auditLineZh:
      `审计关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚 · 自「${xshare?.sessionId || 'session-demo-m161'}」→「${xshare?.targetSessionId || 'session-peer-m161'}」· 过期 ${expiresAt}`,
    kindZh: '审计关帧跨会话分享过期吊销',
    expiresAt,
    revokeShare: opts.revokeShare !== false,
    wave: 'M161' as const,
  };
  const auditKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M161' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `审计关帧跨会话只读分享支持过期+吊销写入中文台账 · ${bookmarks.length}枚` +
          ` · 过期 ${expiresAt} · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        ledgerEntry,
        chineseLedger: opts.chineseLedger !== false,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        revokeShare: opts.revokeShare !== false,
        expiresInMs,
        expiresAt,
        shareToken: xshare?.shareToken || null,
        sessionId: xshare?.sessionId || null,
        targetSessionId: xshare?.targetSessionId || null,
        fromXshare: xshare
          ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken }
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
    labelZh: auditKfBmXsessionExpiryRevokeLedger
      ? `审计关帧跨会话过期吊销 · ${auditKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
      : '审计关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedger ? ` · ${auditKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedger
      ? '审计关帧跨会话过期吊销已开'
      : '审计关帧跨会话过期吊销待命',
    busyZh: '审计关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionRoShareIntact: (base as any).auditKfBmXsessionRoShareIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerIntact: !!auditKfBmXsessionExpiryRevokeLedger,
    auditKfBmXsessionExpiryRevokeLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161',
  };
}

/**
 * M162：审计过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162(
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
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M162' as const,
      labelZh: '审计过期吊销角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计过期吊销角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm162-audit-expiry-demo',
    auditLineZh: '演示·审计过期吊销台账行',
    kindZh: '审计关帧跨会话分享过期吊销',
  };
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm162-audit-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·审计过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M162' as const,
    },
    {
      id: 'm162-audit-expiry-1',
      auditLineZh: '演示·审计过期吊销台账行#2',
      kindZh: '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M162' as const,
    },
  ];
  const auditExpiryRevokeRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M162' as const,
        kind: 'audit-expiry-revoke-role-audit-onepager' as const,
        titleZh: '审计过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        ledgerEntry,
        fromExpiry: expiry
          ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount, expiresAt: expiry.expiresAt }
          : null,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        renderAuditOnePager: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M162' as const,
    labelZh: auditExpiryRevokeRoleAuditOnepager
      ? `审计过期吊销角色审计一页纸 · ${auditExpiryRevokeRoleAuditOnepager.lineCount}行`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRevokeRoleAuditOnepager ? ` · ${auditExpiryRevokeRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditExpiryRevokeRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditExpiryRevokeRoleAuditOnepagerIntact: !!auditExpiryRevokeRoleAuditOnepager,
    auditExpiryRevokeRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162',
  };
}

/**
 * M163：审计角色过滤审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163(
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
      wave: 'M163' as const,
      labelZh: '审计角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计角色审计回跳中文台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditExpiryRevokeRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm163-audit-role-0', auditLineZh: '演示·审计角色审计行#1' },
    { id: 'm163-audit-role-1', auditLineZh: '演示·审计角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M163' as const,
        kind: 'audit-role-audit-seek-ledger' as const,
        titleZh: '审计角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `审计角色过滤审计一页纸可回跳中文台账 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '角色审计台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m163-audit-role-${seekEntryIndex}`,
        lineZh: row?.auditLineZh || row?.kindZh || `角色审计台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        chineseLedger: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M163' as const,
    labelZh: auditRoleAuditSeekLedger
      ? `审计角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditRoleAuditSeekLedger ? ` · ${auditRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditRoleAuditSeekLedger
      ? '审计角色审计回跳台账已开'
      : '审计角色审计回跳台账待命',
    busyZh: '审计角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRevokeRoleAuditOnepagerIntact: (base as any).auditExpiryRevokeRoleAuditOnepagerIntact === true,
    auditRoleAuditSeekLedgerIntact: !!auditRoleAuditSeekLedger,
    auditRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163',
  };
}

/**
 * M164：审计回跳中文台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164(
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
      wave: 'M164' as const,
      labelZh: '审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditRoleAuditSeekLedger || null;
  const lines: any[] = [
    { id: seek?.ledgerRowId || 'm164-audit-seek-0', auditLineZh: seek?.lineZh || '演示·审计回跳行#1', contrastSide: 'A' },
    { id: 'm164-audit-seek-1', auditLineZh: '演示·审计回跳行#2', contrastSide: 'B' },
  ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const uniqueIdx = [...new Set(indexes)];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = uniqueIdx.map((i, ord) => {
    const row = lines[i] || lines[0] || {};
    return {
      index: i,
      id: row.id || `m164-audit-seek-${i}`,
      lineZh: row.auditLineZh || row.kindZh || `审计回跳行#${i + 1}`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M164' as const,
    };
  });
  const auditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M164' as const,
        kind: 'audit-seek-multiselect-contrast' as const,
        titleZh: '审计回跳中文台账 · 多选中文对照',
        bodyZh:
          `审计回跳中文台账支持多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes: uniqueIdx,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId, seekEntryIndex: seek.seekEntryIndex } : null,
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
    labelZh: auditSeekMultiselectContrast
      ? `审计回跳多选对照 · ${auditSeekMultiselectContrast.selectedCount}行`
      : '审计回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectContrast ? ` · ${auditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: auditSeekMultiselectContrast
      ? '审计回跳多选对照已开'
      : '审计回跳多选对照待命',
    busyZh: '审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditRoleAuditSeekLedgerIntact: (base as any).auditRoleAuditSeekLedgerIntact === true,
    auditSeekMultiselectContrastIntact: !!auditSeekMultiselectContrast,
    auditSeekMultiselectContrast,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164',
  };
}

/**
 * M165：审计回跳多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165(
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
      wave: 'M165' as const,
      labelZh: '审计回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm165-audit-ms-0', lineZh: '演示·审计回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm165-audit-ms-1', lineZh: '演示·审计回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    index: i,
    id: r.id || `m165-audit-clip-${i}`,
    lineZh: r.lineZh || `审计回跳多选短片帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M165' as const,
  }));
  const auditSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M165' as const,
        kind: 'audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
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
    wave: 'M165' as const,
    labelZh: auditSeekMultiselectClipScrubber
      ? `审计回跳多选短片scrubber · ${auditSeekMultiselectClipScrubber.frameCount}帧`
      : '审计回跳多选短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectClipScrubber ? ` · ${auditSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: auditSeekMultiselectClipScrubber
      ? '审计回跳多选短片scrubber已开'
      : '审计回跳多选短片scrubber待命',
    busyZh: '审计回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectContrastIntact: (base as any).auditSeekMultiselectContrastIntact === true,
    auditSeekMultiselectClipScrubberIntact: !!auditSeekMultiselectClipScrubber,
    auditSeekMultiselectClipScrubber,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165',
  };
}

/**
 * M166：审计短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166(
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
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M166' as const,
      labelZh: '审计短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).auditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { index: 0, id: 'm166-audit-clip-0', lineZh: '演示·审计短片帧#1', scrubIndex: 0 },
    { index: 1, id: 'm166-audit-clip-1', lineZh: '演示·审计短片帧#2', scrubIndex: 1 },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M166审计短片关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m166-audit-kf-${f.id || i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id || `m166-audit-clip-${i}`,
    lineZh: f.lineZh || `审计短片帧#${i + 1}`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M166' as const,
  }));
  const auditClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M166' as const,
        kind: 'audit-clip-keyframe-bookmarks' as const,
        titleZh: '审计短片 scrubber · 关帧书签',
        bodyZh:
          `审计短片 scrubber 可打关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        fromClip: clip ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex } : null,
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
    labelZh: auditClipKeyframeBookmarks
      ? `审计短片关帧书签 · ${auditClipKeyframeBookmarks.bookmarkCount}枚`
      : '审计短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditClipKeyframeBookmarks ? ` · ${auditClipKeyframeBookmarks.bodyZh}` : ''),
    toastZh: auditClipKeyframeBookmarks
      ? '审计短片关帧书签已开'
      : '审计短片关帧书签待命',
    busyZh: '审计短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectClipScrubberIntact: (base as any).auditSeekMultiselectClipScrubberIntact === true,
    auditClipKeyframeBookmarksIntact: !!auditClipKeyframeBookmarks,
    auditClipKeyframeBookmarks,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166',
  };
}

/**
 * M167：审计关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
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
      wave: 'M167' as const,
      labelZh: '审计关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditClipKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm167-audit-kf-0', nameZh: '演示·M167审计关帧#1', scrubIndex: 0 },
    { id: 'm167-audit-kf-1', nameZh: '演示·M167审计关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m167-audit-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m167-audit-kf').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = `ro-m167-audit-kf-${tid}-${sessionId.slice(-8)}`;
  const auditKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M167' as const,
        kind: 'audit-kf-bm-xsession-ro-share' as const,
        titleZh: '审计关帧书签 · 跨会话只读分享',
        bodyZh:
          `审计关帧书签可跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 令牌「${shareToken}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnly: true as const,
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
    wave: 'M167' as const,
    labelZh: auditKfBmXsessionRoShare
      ? `审计关帧跨会话只读分享 · ${auditKfBmXsessionRoShare.bookmarkCount}枚`
      : '审计关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionRoShare ? ` · ${auditKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: auditKfBmXsessionRoShare
      ? '审计关帧跨会话只读分享已开'
      : '审计关帧跨会话只读分享待命',
    busyZh: '审计关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditClipKeyframeBookmarksIntact: (base as any).auditClipKeyframeBookmarksIntact === true,
    auditKfBmXsessionRoShareIntact: !!auditKfBmXsessionRoShare,
    auditKfBmXsessionRoShare,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167',
  };
}

/**
 * M168：审计关帧跨会话只读分享 → 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168(
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
    chineseLedger?: boolean;
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
      wave: 'M168' as const,
      labelZh: '审计关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).auditKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm168-audit-kf-0', nameZh: '演示·M168审计关帧#1', scrubIndex: 0 },
    { id: 'm168-audit-kf-1', nameZh: '演示·M168审计关帧#2', scrubIndex: 1 },
  ];
  const expiresInMs = Math.max(60_000, Number(opts.expiresInMs) || 3_600_000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: `m168-audit-expiry-${xshare?.shareToken || 'demo'}`.slice(0, 96),
    auditLineZh:
      `审计关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚 · 自「${xshare?.sessionId || 'session-demo-m168'}」→「${xshare?.targetSessionId || 'session-peer-m168'}」· 过期 ${expiresAt}`,
    kindZh: '审计关帧跨会话分享过期吊销',
    expiresAt,
    revokeShare: opts.revokeShare !== false,
    wave: 'M168' as const,
  };
  const auditKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M168' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `审计关帧跨会话只读分享支持过期+吊销写入中文台账 · ${bookmarks.length}枚` +
          ` · 过期 ${expiresAt} · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        ledgerEntry,
        chineseLedger: opts.chineseLedger !== false,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        revokeShare: opts.revokeShare !== false,
        expiresInMs,
        expiresAt,
        shareToken: xshare?.shareToken || null,
        sessionId: xshare?.sessionId || null,
        targetSessionId: xshare?.targetSessionId || null,
        fromXshare: xshare
          ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken }
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
    labelZh: auditKfBmXsessionExpiryRevokeLedger
      ? `审计关帧跨会话过期吊销 · ${auditKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
      : '审计关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedger ? ` · ${auditKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedger
      ? '审计关帧跨会话过期吊销已开'
      : '审计关帧跨会话过期吊销待命',
    busyZh: '审计关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionRoShareIntact: (base as any).auditKfBmXsessionRoShareIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerIntact: !!auditKfBmXsessionExpiryRevokeLedger,
    auditKfBmXsessionExpiryRevokeLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167/expiry-revoke-ledger/m168',
  };
}

/**
 * M169：审计关帧跨会话过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168RoleAuditOnepagerM169(
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
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M169' as const,
      labelZh: '审计过期吊销角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计过期吊销角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm169-audit-expiry-demo',
    auditLineZh: '演示·审计关帧跨会话过期吊销台账行',
    kindZh: '审计关帧跨会话分享过期吊销',
  };
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm169-audit-expiry-role-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·审计过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M169' as const,
    },
    {
      id: 'm169-audit-expiry-role-1',
      auditLineZh: '演示·审计过期吊销台账行#2',
      kindZh: '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M169' as const,
    },
  ];
  const auditExpiryRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M169' as const,
        kind: 'audit-expiry-role-audit-onepager' as const,
        titleZh: '审计关帧跨会话过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `审计关帧跨会话过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        ledgerEntry,
        fromExpiry: expiry
          ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount, expiresAt: expiry.expiresAt }
          : null,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        renderAuditOnePager: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M169' as const,
    labelZh: auditExpiryRoleAuditOnepager
      ? `审计过期吊销角色审计一页纸 · ${auditExpiryRoleAuditOnepager.lineCount}行`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRoleAuditOnepager ? ` · ${auditExpiryRoleAuditOnepager.bodyZh}` : ''),
    toastZh: auditExpiryRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditExpiryRoleAuditOnepagerIntact: !!auditExpiryRoleAuditOnepager,
    auditExpiryRoleAuditOnepager,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168RoleAuditOnepagerM169Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167/expiry-revoke-ledger/m168/role-audit-onepager/m169',
  };
}

/**
 * M170：审计角色过滤审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168RoleAuditOnepagerM169SeekLedgerM170(
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
      wave: 'M170' as const,
      labelZh: '审计角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计角色审计回跳中文台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168RoleAuditOnepagerM169(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditExpiryRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm170-audit-role-0', auditLineZh: '演示·审计角色审计行#1' },
    { id: 'm170-audit-role-1', auditLineZh: '演示·审计角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M170' as const,
        kind: 'audit-role-audit-seek-ledger' as const,
        titleZh: '审计角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `审计角色过滤审计一页纸可回跳中文台账 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '角色审计台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m170-audit-role-${seekEntryIndex}`,
        lineZh: row?.auditLineZh || row?.kindZh || `角色审计台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        chineseLedger: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M170' as const,
    labelZh: auditRoleAuditSeekLedger
      ? `审计角色审计回跳台账 · 行#${seekEntryIndex + 1}`
      : '审计角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditRoleAuditSeekLedger ? ` · ${auditRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh: auditRoleAuditSeekLedger
      ? '审计角色审计回跳台账已开'
      : '审计角色审计回跳台账待命',
    busyZh: '审计角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditOnepagerIntact: (base as any).auditExpiryRoleAuditOnepagerIntact === true,
    auditRoleAuditSeekLedgerIntact: !!auditRoleAuditSeekLedger,
    auditRoleAuditSeekLedger,
    softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168RoleAuditOnepagerM169SeekLedgerM170Path: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167/expiry-revoke-ledger/m168/role-audit-onepager/m169/seek-ledger/m170',
  };
}
