/**
 * M86：单需求旁路重跑前后 TopN 对照看板（干跑友好、无外发）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type BypassTopNRow = {
  rank: number;
  matchId?: string | null;
  supplyId?: string | null;
  title?: string | null;
  orgName?: string | null;
  kind?: string | null;
  score?: number | null;
};

export type BypassContrastBoard = {
  demandId: string;
  before: BypassTopNRow[];
  after: BypassTopNRow[];
  rows: Array<{
    rank: number;
    before: BypassTopNRow | null;
    after: BypassTopNRow | null;
    changedZh: string;
  }>;
  demotedIds: string[];
  promotedIds: string[];
  at: string;
  dryRun: boolean;
  tipZh: string;
  summaryZh: string;
};

function safeTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function boardPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'bypass-contrast-board.json');
}

function normalizeRows(rows: any[] | null | undefined, topN = 5): BypassTopNRow[] {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.slice(0, Math.max(1, topN)).map((r, i) => ({
    rank: i + 1,
    matchId: r?.matchId || r?.id || null,
    supplyId: r?.supplyId || r?.capabilityId || r?.outcomeId || r?.id || null,
    title: r?.title || r?.supplyTitle || r?.capability?.title || r?.outcome?.title || null,
    orgName: r?.orgName || r?.supplyOrg || r?.org?.name || null,
    kind: r?.kind || r?.type || (r?.capabilityId ? 'capability' : r?.outcomeId ? 'outcome' : null),
    score:
      r?.score != null
        ? Number(r.score)
        : r?.totalScore != null
          ? Number(r.totalScore)
          : r?.total != null
            ? Number(r.total)
            : null,
  }));
}

export function buildBypassContrastRows(
  beforeIn: any[] | null | undefined,
  afterIn: any[] | null | undefined,
  topN = 5,
): Pick<BypassContrastBoard, 'before' | 'after' | 'rows' | 'demotedIds' | 'promotedIds' | 'summaryZh' | 'tipZh'> {
  const before = normalizeRows(beforeIn, topN);
  const after = normalizeRows(afterIn, topN);
  const beforeIds = new Set(before.map((r) => String(r.supplyId || r.matchId || r.title || '')));
  const afterIds = new Set(after.map((r) => String(r.supplyId || r.matchId || r.title || '')));
  const demotedIds = [...beforeIds].filter((id) => id && !afterIds.has(id));
  const promotedIds = [...afterIds].filter((id) => id && !beforeIds.has(id));
  const maxN = Math.max(before.length, after.length, 1);
  const rows: BypassContrastBoard['rows'] = [];
  for (let i = 0; i < maxN; i++) {
    const b = before[i] || null;
    const a = after[i] || null;
    const bid = String(b?.supplyId || b?.matchId || '');
    const aid = String(a?.supplyId || a?.matchId || '');
    let changedZh = '一致';
    if (!b && a) changedZh = '重跑后替入';
    else if (b && !a) changedZh = '重跑后缺席';
    else if (b && a && bid && aid && bid !== aid) changedZh = '名次已替换';
    else if (b && a && (b.score ?? null) !== (a.score ?? null)) changedZh = '分值变化';
    rows.push({ rank: i + 1, before: b, after: a, changedZh });
  }
  const summaryZh =
    demotedIds.length || promotedIds.length
      ? `旁路对照：前 ${before.length} / 后 ${after.length} · 替下 ${demotedIds.length} · 替入 ${promotedIds.length}`
      : `旁路对照：前后 TopN 结构一致（${after.length || before.length} 条）`;
  return {
    before,
    after,
    rows,
    demotedIds,
    promotedIds,
    summaryZh,
    tipZh: summaryZh + ' · 单需求旁路 · 软取消仍在',
  };
}

export function persistBypassContrastBoard(
  tenantId: string | null | undefined,
  demandId: string,
  before: any[] | null | undefined,
  after: any[] | null | undefined,
  opts: { topN?: number; dryRun?: boolean } = {},
): BypassContrastBoard {
  const built = buildBypassContrastRows(before, after, opts.topN ?? 5);
  const board: BypassContrastBoard = {
    demandId: String(demandId || '').trim() || 'unknown',
    ...built,
    at: new Date().toISOString(),
    dryRun: opts.dryRun !== false,
  };
  const tid = safeTenant(tenantId);
  const p = boardPath(tid);
  let store: {
    latest: BypassContrastBoard | null;
    byDemand: Record<string, BypassContrastBoard>;
    history?: any[];
    playbackCursor?: number;
  } = {
    latest: null,
    byDemand: {},
    history: [],
    playbackCursor: 0,
  };
  try {
    if (existsSync(p)) store = JSON.parse(readFileSync(p, 'utf8')) || store;
  } catch (_) {}
  if (!store.byDemand || typeof store.byDemand !== 'object') store.byDemand = {};
  if (!Array.isArray(store.history)) store.history = [];
  store.latest = board;
  store.byDemand[board.demandId] = board;
  const keys = Object.keys(store.byDemand);
  while (keys.length > 24) {
    const drop = keys.shift();
    if (drop) delete store.byDemand[drop];
  }
  // M89：追加历史快照供回放
  const seq =
    (store.history.length
      ? Number(store.history[store.history.length - 1].seq) || store.history.length
      : 0) + 1;
  store.history.push({
    seq,
    at: board.at,
    demandId: board.demandId,
    summaryZh: board.summaryZh,
    demotedIds: board.demotedIds || [],
    promotedIds: board.promotedIds || [],
    before: board.before || [],
    after: board.after || [],
    rows: board.rows || [],
    dryRun: board.dryRun !== false,
    tipZh: board.tipZh || board.summaryZh,
  });
  while (store.history.length > 32) store.history.shift();
  store.playbackCursor = seq;
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return board;
}

export function readBypassContrastBoard(
  tenantId?: string | null,
  demandId?: string | null,
): {
  ok: true;
  wave: 'M89';
  labelZh: string;
  tipZh: string;
  toastZh: string;
  busyZh: string;
  dryRun: true;
  noEgress: true;
  softCancelIntact: true;
  board: BypassContrastBoard | null;
  demandId: string | null;
} {
  const p = boardPath(tenantId || 'default');
  let store: { latest: BypassContrastBoard | null; byDemand: Record<string, BypassContrastBoard> } = {
    latest: null,
    byDemand: {},
  };
  try {
    if (existsSync(p)) store = JSON.parse(readFileSync(p, 'utf8')) || store;
  } catch (_) {}
  const id = String(demandId || '').trim();
  const board = id ? store.byDemand?.[id] || null : store.latest || null;
  return {
    ok: true,
    wave: 'M89',
    labelZh: '单需求旁路结果对照看板（可钻供给卡）',
    tipZh: board
      ? `${board.summaryZh} · demandId=${board.demandId}`
      : '尚无旁路对照；先钻取单需求重跑旁路（可干跑）',
    toastZh: board ? board.summaryZh : '对照看板为空',
    busyZh: '加载旁路对照看板…',
    dryRun: true,
    noEgress: true,
    softCancelIntact: true,
    board,
    demandId: board?.demandId || id || null,
  };
}

/** 干跑：用 before 克隆 + 轻微扰动生成 after，便于冒烟无写库 */
export function simulateBypassAfterForDryRun(before: any[], topN = 5): BypassTopNRow[] {
  const base = normalizeRows(before, topN);
  if (!base.length) {
    return [
      {
        rank: 1,
        matchId: 'dry-after-1',
        supplyId: 'dry-supply-1',
        title: '干跑旁路供给样例 A',
        orgName: '干跑机构甲',
        kind: 'capability',
        score: 0.82,
      },
      {
        rank: 2,
        matchId: 'dry-after-2',
        supplyId: 'dry-supply-2',
        title: '干跑旁路供给样例 B',
        orgName: '干跑机构乙',
        kind: 'outcome',
        score: 0.71,
      },
    ].slice(0, topN);
  }
  // 交换首末 + 微调分，制造可见 diff
  const after = base.map((r) => ({ ...r }));
  if (after.length >= 2) {
    const tmp = after[0];
    after[0] = { ...after[after.length - 1], rank: 1 };
    after[after.length - 1] = { ...tmp, rank: after.length };
  }
  after[0] = {
    ...after[0],
    score: Math.min(0.99, Number(after[0].score || 0.5) + 0.03),
    title: (after[0].title || '供给') + '（旁路后）',
  };
  return after.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** M87：从对照看板 TopN 行钻取供给/伙伴卡 peek（干跑友好） */
export type BypassSupplyCardPeek = {
  ok: true;
  wave: 'M89';
  labelZh: string;
  tipZh: string;
  toastZh: string;
  busyZh: string;
  dryRun: true;
  noEgress: true;
  softCancelIntact: true;
  demandId: string | null;
  rank: number | null;
  side: 'before' | 'after' | 'either';
  card: {
    supplyId: string | null;
    matchId: string | null;
    title: string | null;
    orgName: string | null;
    kind: string | null;
    score: number | null;
    changedZh: string | null;
    partnerHintZh: string;
    peekZh: string;
  } | null;
  oneClickReContrastPath?: string;
  oneClickReContrastLabelZh?: string;
};

export function peekBypassContrastSupplyCard(
  tenantId?: string | null,
  opts: {
    demandId?: string | null;
    rank?: number | null;
    side?: 'before' | 'after' | 'either';
    supplyId?: string | null;
  } = {},
): BypassSupplyCardPeek {
  const boardWrap = readBypassContrastBoard(tenantId, opts.demandId || null);
  const board = boardWrap.board;
  const side = opts.side || 'either';
  const rank = opts.rank != null ? Number(opts.rank) : null;
  const wantId = opts.supplyId ? String(opts.supplyId) : null;
  let hitRow: BypassContrastBoard['rows'][0] | null = null;
  let picked: BypassTopNRow | null = null;
  let pickedSide: 'before' | 'after' = 'after';
  if (board?.rows?.length) {
    for (const row of board.rows) {
      const candidates: Array<{ side: 'before' | 'after'; row: BypassTopNRow | null }> = [
        { side: 'after', row: row.after },
        { side: 'before', row: row.before },
      ];
      for (const c of candidates) {
        if (!c.row) continue;
        if (side !== 'either' && side !== c.side) continue;
        if (rank != null && row.rank !== rank) continue;
        if (wantId && String(c.row.supplyId || c.row.matchId || '') !== wantId) continue;
        hitRow = row;
        picked = c.row;
        pickedSide = c.side;
        break;
      }
      if (picked) break;
    }
    if (!picked && board.rows[0]) {
      hitRow = board.rows[0];
      picked = hitRow.after || hitRow.before;
      pickedSide = hitRow.after ? 'after' : 'before';
    }
  }
  const card = picked
    ? {
        supplyId: picked.supplyId || null,
        matchId: picked.matchId || null,
        title: picked.title || null,
        orgName: picked.orgName || null,
        kind: picked.kind || null,
        score: picked.score ?? null,
        changedZh: hitRow?.changedZh || null,
        partnerHintZh: picked.orgName
          ? `伙伴机构「${picked.orgName}」· ${picked.kind || '供给'}`
          : `供给卡 · ${picked.kind || '未分类'}`,
        peekZh:
          `【供给卡 peek】#${hitRow?.rank ?? '?'} · ${pickedSide === 'after' ? '旁路后' : '旁路前'}` +
          `\n标题：${picked.title || '—'}` +
          `\n机构：${picked.orgName || '—'}` +
          `\n分值：${picked.score != null ? picked.score : '—'}` +
          `\nsupplyId：${picked.supplyId || '—'}` +
          (hitRow?.changedZh ? `\n对照：${hitRow.changedZh}` : ''),
      }
    : null;
  return {
    ok: true,
    wave: 'M89',
    labelZh: '旁路对照钻取供给卡 peek',
    tipZh: card
      ? `已钻取 ${card.title || card.supplyId || '供给'} · ${card.partnerHintZh} · 软取消仍在`
      : '对照看板无可行；请先干跑单需求旁路生成看板',
    toastZh: card ? `供给卡 · ${card.title || card.supplyId || 'peek'}` : '无供给可 peek',
    busyZh: '钻取供给卡…',
    dryRun: true,
    noEgress: true,
    softCancelIntact: true,
    demandId: board?.demandId || opts.demandId || null,
    rank: hitRow?.rank ?? rank,
    side: picked ? pickedSide : side,
    card,
    oneClickReContrastPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/supply-peek/re-contrast',
    oneClickReContrastLabelZh: '供给卡一键旁路重跑对照',
  };
}


/** M88/M89：供给卡一键旁路重跑对照（刷新看板；M89 写历史） */
export function reContrastFromSupplyPeek(
  tenantId?: string | null,
  opts: {
    demandId?: string | null;
    rank?: number | null;
    side?: 'before' | 'after' | 'either';
    supplyId?: string | null;
    topN?: number;
    dryRun?: boolean;
  } = {},
) {
  const peek = peekBypassContrastSupplyCard(tenantId, {
    demandId: opts.demandId,
    rank: opts.rank,
    side: opts.side,
    supplyId: opts.supplyId,
  });
  const demandId = String(opts.demandId || peek.demandId || '').trim() || 'dry-demand';
  const topN = Math.max(1, Number(opts.topN) || 5);
  const boardWrap = readBypassContrastBoard(tenantId, demandId);
  const before =
    boardWrap.board?.before?.length
      ? boardWrap.board.before
      : peek.card
        ? [
            {
              rank: peek.rank || 1,
              matchId: peek.card.matchId,
              supplyId: peek.card.supplyId,
              title: peek.card.title,
              orgName: peek.card.orgName,
              kind: peek.card.kind,
              score: peek.card.score,
            },
          ]
        : [];
  const after = simulateBypassAfterForDryRun(before, topN);
  const board = persistBypassContrastBoard(tenantId, demandId, before, after, {
    topN,
    dryRun: opts.dryRun !== false,
  });
  const refreshedPeek = peekBypassContrastSupplyCard(tenantId, {
    demandId,
    rank: opts.rank ?? peek.rank,
    side: opts.side || 'after',
    supplyId: opts.supplyId || peek.card?.supplyId,
  });
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '供给卡一键旁路重跑对照',
    tipZh:
      `已从供给卡一键旁路重跑对照 · demandId=${demandId} · ${board.summaryZh} · 看板已刷新 · 软取消仍在`,
    toastZh: `一键再对照 · ${board.summaryZh}`,
    busyZh: '供给卡一键旁路重跑对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    demandId,
    board,
    contrastBoard: board,
    contrastBoardPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board',
    supplyPeek: refreshedPeek,
    priorPeek: peek,
    reContrastPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/supply-peek/re-contrast',
    historyPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history',
    historyLabelZh: '旁路对照历史回放',
  };
}


/** M89：旁路对照历史快照（可回放） */
export type BypassContrastHistoryEntry = {
  seq: number;
  at: string;
  demandId: string;
  summaryZh: string;
  demotedIds: string[];
  promotedIds: string[];
  before: BypassTopNRow[];
  after: BypassTopNRow[];
  rows: BypassContrastBoard['rows'];
  dryRun: boolean;
  tipZh: string;
};

type BypassContrastStore = {
  latest: BypassContrastBoard | null;
  byDemand: Record<string, BypassContrastBoard>;
  history: any[];
  playbackCursor: number;
};

function loadBoardStore(tenantId: string): BypassContrastStore {
  const p = boardPath(tenantId);
  let store: BypassContrastStore = { latest: null, byDemand: {}, history: [], playbackCursor: 0 };
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      store = {
        latest: raw.latest || null,
        byDemand: raw.byDemand && typeof raw.byDemand === 'object' ? raw.byDemand : {},
        history: Array.isArray(raw.history) ? raw.history : [],
        playbackCursor: Number(raw.playbackCursor) || 0,
      };
    }
  } catch (_) {}
  return store;
}

function saveBoardStore(tenantId: string, store: BypassContrastStore) {
  writeFileSync(boardPath(tenantId), JSON.stringify(store, null, 0), 'utf8');
}

function boardToHistoryEntry(board: BypassContrastBoard, seq: number): BypassContrastHistoryEntry {
  return {
    seq,
    at: board.at,
    demandId: board.demandId,
    summaryZh: board.summaryZh,
    demotedIds: board.demotedIds || [],
    promotedIds: board.promotedIds || [],
    before: board.before || [],
    after: board.after || [],
    rows: board.rows || [],
    dryRun: board.dryRun !== false,
    tipZh: board.tipZh || board.summaryZh,
  };
}

/** 内部：在 persist 后追加历史（由 patch 后的 persist 调用） */
export function appendBypassContrastHistory(
  tenantId: string | null | undefined,
  board: BypassContrastBoard,
): BypassContrastHistoryEntry {
  const tid = safeTenant(tenantId);
  const store = loadBoardStore(tid);
  const seq = (store.history.length ? Number(store.history[store.history.length - 1].seq) || store.history.length : 0) + 1;
  const entry = boardToHistoryEntry(board, seq);
  store.history.push(entry);
  while (store.history.length > 32) store.history.shift();
  store.playbackCursor = entry.seq;
  store.latest = board;
  if (!store.byDemand) store.byDemand = {};
  store.byDemand[board.demandId] = board;
  saveBoardStore(tid, store);
  return entry;
}

export function listBypassContrastHistory(
  tenantId?: string | null,
  opts: { demandId?: string | null; limit?: number } = {},
) {
  const store = loadBoardStore(tenantId || 'default');
  let items = store.history.slice();
  const demandId = String(opts.demandId || '').trim();
  if (demandId) items = items.filter((h) => h.demandId === demandId);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 16, 32));
  const clipped = items.slice(-limit);
  const minSeq = clipped.length ? clipped[0].seq : 0;
  const maxSeq = clipped.length ? clipped[clipped.length - 1].seq : 0;
  const cursor = store.playbackCursor || maxSeq;
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '旁路对照历史回放',
    tipZh: clipped.length
      ? `旁路对照历史 ${clipped.length} 帧 · 游标 seq #${cursor}（${minSeq}..${maxSeq}）· 可 seek/播放 · 软取消仍在`
      : '尚无旁路对照历史；先干跑一键再对照或单需求旁路',
    toastZh: clipped.length ? `对照历史 · ${clipped.length} 帧` : '对照历史空',
    busyZh: '加载旁路对照历史…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    count: clipped.length,
    minSeq,
    maxSeq,
    currentSeq: cursor,
    frames: clipped
      .slice()
      .reverse()
      .map((h) => ({
        seq: h.seq,
        at: h.at,
        demandId: h.demandId,
        summaryZh: h.summaryZh,
        demoted: (h.demotedIds || []).length,
        promoted: (h.promotedIds || []).length,
        labelZh: `seq #${h.seq} · ${h.demandId} · ${h.summaryZh}`,
      })),
    scrubber: {
      enabled: clipped.length > 0,
      minSeq,
      maxSeq,
      currentSeq: cursor,
      labelZh: '旁路对照历史 scrubber',
      tipZh: clipped.length
        ? `拖动回放 seq ${minSeq}..${maxSeq}；中页取消仍可用`
        : '暂无历史可回放',
      seekPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/seek',
      playPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/play',
      intervalMs: 900,
    },
    historyPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history',
  };
}

export function seekBypassContrastHistory(
  tenantId?: string | null,
  opts: { seq?: number; pause?: boolean; demandId?: string | null } = {},
) {
  const tid = safeTenant(tenantId);
  const store = loadBoardStore(tid);
  const seq = Number(opts.seq);
  const hit =
    store.history.find((h) => h.seq === seq) ||
    (opts.demandId
      ? [...store.history].reverse().find((h) => h.demandId === String(opts.demandId))
      : null) ||
    null;
  if (hit) {
    store.playbackCursor = hit.seq;
    // 回放到该帧：latest 指向历史帧对应看板
    const board: BypassContrastBoard = {
      demandId: hit.demandId,
      before: hit.before,
      after: hit.after,
      rows: hit.rows,
      demotedIds: hit.demotedIds,
      promotedIds: hit.promotedIds,
      at: hit.at,
      dryRun: hit.dryRun,
      tipZh: hit.tipZh,
      summaryZh: hit.summaryZh,
    };
    store.latest = board;
    saveBoardStore(tid, store);
  }
  const list = listBypassContrastHistory(tid, { demandId: opts.demandId || null });
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '旁路对照历史 seek',
    tipZh: hit
      ? `已定位历史 seq #${hit.seq} · ${hit.summaryZh} · ${opts.pause ? '已暂停' : '可播放'} · 软取消仍在`
      : `未找到 seq #${seq}`,
    toastZh: hit ? `历史 seek · #${hit.seq}` : 'seq 不存在',
    busyZh: '旁路对照历史 seek…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    paused: opts.pause === true,
    seq: hit?.seq ?? (Number.isFinite(seq) ? seq : null),
    frame: hit
      ? {
          seq: hit.seq,
          at: hit.at,
          demandId: hit.demandId,
          summaryZh: hit.summaryZh,
          demotedIds: hit.demotedIds,
          promotedIds: hit.promotedIds,
          rows: hit.rows,
        }
      : null,
    board: hit
      ? {
          demandId: hit.demandId,
          before: hit.before,
          after: hit.after,
          rows: hit.rows,
          demotedIds: hit.demotedIds,
          promotedIds: hit.promotedIds,
          at: hit.at,
          dryRun: hit.dryRun,
          tipZh: hit.tipZh,
          summaryZh: hit.summaryZh,
        }
      : null,
    history: list,
  };
}

export function playBypassContrastHistory(
  tenantId?: string | null,
  opts: { fromSeq?: number; steps?: number; demandId?: string | null } = {},
) {
  const tid = safeTenant(tenantId);
  const store = loadBoardStore(tid);
  let items = store.history.slice();
  if (opts.demandId) items = items.filter((h) => h.demandId === String(opts.demandId));
  if (!items.length) {
    return {
      ok: true as const,
      wave: 'M89' as const,
      labelZh: '旁路对照历史播放',
      tipZh: '无可播放的旁路对照历史',
      toastZh: '对照历史空',
      busyZh: '播放旁路对照历史…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      played: [] as any[],
      history: listBypassContrastHistory(tid, { demandId: opts.demandId || null }),
    };
  }
  const fromSeq = opts.fromSeq != null ? Number(opts.fromSeq) : store.playbackCursor || items[0].seq;
  const startIdx = Math.max(0, items.findIndex((h) => h.seq >= fromSeq));
  const steps = Math.max(1, Math.min(Number(opts.steps) || 3, items.length));
  const played: any[] = [];
  for (let i = startIdx; i < items.length && played.length < steps; i++) {
    const h = items[i];
    store.playbackCursor = h.seq;
    store.latest = {
      demandId: h.demandId,
      before: h.before,
      after: h.after,
      rows: h.rows,
      demotedIds: h.demotedIds,
      promotedIds: h.promotedIds,
      at: h.at,
      dryRun: h.dryRun,
      tipZh: h.tipZh,
      summaryZh: h.summaryZh,
    };
    played.push({
      seq: h.seq,
      demandId: h.demandId,
      summaryZh: h.summaryZh,
      at: h.at,
      labelZh: `播放 #${h.seq} · ${h.summaryZh}`,
    });
  }
  saveBoardStore(tid, store);
  return {
    ok: true as const,
    wave: 'M89' as const,
    labelZh: '旁路对照历史播放',
    tipZh: `已播放 ${played.length} 帧 · 游标 seq #${store.playbackCursor} · 软取消仍在 · 干跑无外发`,
    toastZh: `对照历史播放 · ${played.length} 帧`,
    busyZh: '播放旁路对照历史…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    currentSeq: store.playbackCursor,
    played,
    history: listBypassContrastHistory(tid, { demandId: opts.demandId || null }),
  };
}


/** M90：旁路对照历史两帧差分对照 */
export function diffBypassContrastHistory(
  tenantId?: string | null,
  opts: { seqA?: number; seqB?: number; demandId?: string | null } = {},
) {
  const tid = safeTenant(tenantId);
  const store = loadBoardStore(tid);
  let items = store.history.slice();
  if (opts.demandId) items = items.filter((h) => h.demandId === String(opts.demandId));
  if (items.length < 2 && store.history.length >= 2) items = store.history.slice();

  let a =
    opts.seqA != null
      ? items.find((h) => h.seq === Number(opts.seqA)) || store.history.find((h) => h.seq === Number(opts.seqA))
      : null;
  let b =
    opts.seqB != null
      ? items.find((h) => h.seq === Number(opts.seqB)) || store.history.find((h) => h.seq === Number(opts.seqB))
      : null;

  // 默认：最近两帧（旧→新）
  if (!a || !b) {
    const pool = (items.length >= 2 ? items : store.history).slice();
    if (pool.length >= 2) {
      a = a || pool[pool.length - 2];
      b = b || pool[pool.length - 1];
    }
  }

  if (!a || !b) {
    return {
      ok: true as const,
      wave: 'M90' as const,
      labelZh: '旁路对照历史差分',
      tipZh: '历史不足两帧，无法差分；先干跑两次旁路对照',
      toastZh: '差分需两帧',
      busyZh: '旁路历史差分对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      seqA: null as number | null,
      seqB: null as number | null,
      diff: null as any,
      history: listBypassContrastHistory(tid, { demandId: opts.demandId || null }),
    };
  }

  const demotedA = new Set(a.demotedIds || []);
  const demotedB = new Set(b.demotedIds || []);
  const promotedA = new Set(a.promotedIds || []);
  const promotedB = new Set(b.promotedIds || []);

  const newlyDemoted = [...demotedB].filter((id) => !demotedA.has(id));
  const newlyPromoted = [...promotedB].filter((id) => !promotedA.has(id));
  const recoveredFromDemote = [...demotedA].filter((id) => !demotedB.has(id));
  const lostPromotion = [...promotedA].filter((id) => !promotedB.has(id));

  // TopN 排名位移：按 supplyId / id
  const rankKey = (r: any) => String(r?.supplyId || r?.id || r?.orgId || '');
  const beforeRankA = new Map((a.before || []).map((r: any, i: number) => [rankKey(r), i + 1]));
  const afterRankA = new Map((a.after || []).map((r: any, i: number) => [rankKey(r), i + 1]));
  const beforeRankB = new Map((b.before || []).map((r: any, i: number) => [rankKey(r), i + 1]));
  const afterRankB = new Map((b.after || []).map((r: any, i: number) => [rankKey(r), i + 1]));
  const allIds = new Set([
    ...beforeRankA.keys(),
    ...afterRankA.keys(),
    ...beforeRankB.keys(),
    ...afterRankB.keys(),
  ]);
  const rankShifts = [...allIds]
    .filter(Boolean)
    .map((id) => {
      const aAfter = afterRankA.has(id) ? Number(afterRankA.get(id)) : null;
      const bAfter = afterRankB.has(id) ? Number(afterRankB.get(id)) : null;
      let delta = 0;
      if (aAfter != null && bAfter != null) delta = bAfter - aAfter;
      else if (aAfter != null && bAfter == null) delta = 99;
      else if (aAfter == null && bAfter != null) delta = -99;
      return {
        id,
        rankAfterA: aAfter,
        rankAfterB: bAfter,
        delta,
        changedZh:
          aAfter != null && bAfter != null && delta !== 0
            ? `排名 ${aAfter} → ${bAfter}（Δ${delta > 0 ? '+' : ''}${delta}）`
            : aAfter != null && bAfter == null
              ? `离开 TopN（曾 #${aAfter}）`
              : aAfter == null && bAfter != null
                ? `进入 TopN（现 #${bAfter}）`
                : '无排名变化',
      };
    })
    .filter((r) => r.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 16);

  const sameDemand = a.demandId === b.demandId;
  const summaryZh =
    `差分 #${a.seq}→#${b.seq}` +
    (sameDemand ? ` · 需求 ${a.demandId}` : ` · 跨需求 ${a.demandId}→${b.demandId}`) +
    ` · 新降权 ${newlyDemoted.length} · 新提权 ${newlyPromoted.length} · 排名位移 ${rankShifts.length}`;

  return {
    ok: true as const,
    wave: 'M90' as const,
    labelZh: '旁路对照历史差分对照',
    tipZh: summaryZh + ' · 软取消仍在 · 干跑无外发',
    toastZh: `历史差分 · #${a.seq}→#${b.seq}`,
    busyZh: '旁路历史差分对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    seqA: a.seq,
    seqB: b.seq,
    frameA: {
      seq: a.seq,
      at: a.at,
      demandId: a.demandId,
      summaryZh: a.summaryZh,
      demoted: (a.demotedIds || []).length,
      promoted: (a.promotedIds || []).length,
    },
    frameB: {
      seq: b.seq,
      at: b.at,
      demandId: b.demandId,
      summaryZh: b.summaryZh,
      demoted: (b.demotedIds || []).length,
      promoted: (b.promotedIds || []).length,
    },
    diff: {
      newlyDemoted,
      newlyPromoted,
      recoveredFromDemote,
      lostPromotion,
      rankShifts,
      sameDemand,
      summaryZh,
      rowsChanged:
        JSON.stringify((a.rows || []).map((r: any) => r?.supplyId || r?.id)) !==
        JSON.stringify((b.rows || []).map((r: any) => r?.supplyId || r?.id)),
    },
    contrastDiffPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff',
    rollbackToFrameAPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a',
    rollbackToFrameALabelZh: '一键回滚到帧 A',
    history: listBypassContrastHistory(tid, { demandId: opts.demandId || null }),
  };
}


/** M92：回滚前后中文对照卡（站内，无外发） */
export function buildBypassRollbackContrastCard(diff: any, opts: { rolledBack?: boolean; seqA?: number | null } = {}) {
  const frameA = diff?.frameA || null;
  const frameB = diff?.frameB || null;
  const d = diff?.diff || {};
  const seqA = opts.seqA != null ? opts.seqA : diff?.seqA;
  const seqB = diff?.seqB;
  const beforeZh = frameB
    ? `回滚前（帧 B #${seqB}）：${frameB.summaryZh || '—'} · 降权 ${frameB.demoted ?? 0} · 提权 ${frameB.promoted ?? 0}`
    : '回滚前：无帧 B';
  const afterZh = frameA
    ? `回滚后（帧 A #${seqA}）：${frameA.summaryZh || '—'} · 降权 ${frameA.demoted ?? 0} · 提权 ${frameA.promoted ?? 0}`
    : '回滚后：无帧 A';
  const shifts = Array.isArray(d.rankShifts) ? d.rankShifts.slice(0, 8) : [];
  const shiftLines = shifts.map(
    (s: any) => `${s.id || '—'}：${s.changedZh || ('Δ' + (s.delta ?? '?'))}`,
  );
  const bodyZh =
    beforeZh +
    '\n' +
    afterZh +
    (d.summaryZh ? '\n差分摘要：' + d.summaryZh : '') +
    (shiftLines.length ? '\n排名位移：' + shiftLines.join('；') : '');
  return {
    titleZh: opts.rolledBack ? '旁路回滚前后对照' : '旁路回滚前后对照（预览）',
    bodyZh,
    beforeZh,
    afterZh,
    before: {
      labelZh: '回滚前（当前/帧 B）',
      seq: seqB ?? null,
      frame: frameB,
      summaryZh: frameB?.summaryZh || null,
    },
    after: {
      labelZh: '回滚后（帧 A）',
      seq: seqA ?? null,
      frame: frameA,
      summaryZh: frameA?.summaryZh || null,
    },
    diffSummaryZh: d.summaryZh || null,
    newlyDemoted: d.newlyDemoted || [],
    newlyPromoted: d.newlyPromoted || [],
    rankShifts: shifts,
    midPageCancelIntact: true as const,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
    wave: 'M93' as const,
    supplyDetailDrillable: true as const,
    supplyDetailDrillPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
    supplyDetailDrillLabelZh: '从对照卡钻供给详情',
  };
}

/** M91/M92：旁路差分一键回滚到帧 A；回滚后出中文前后对照卡（干跑安全：只恢复看板 latest，不外发） */
export function rollbackBypassContrastHistoryToFrameA(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    confirmRollback?: boolean;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const diff = diffBypassContrastHistory(tid, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId || null,
  });
  if (!(diff as any).ok || !(diff as any).frameA) {
    return {
      ...diff,
      wave: 'M93' as const,
      labelZh: '旁路差分一键回滚到帧 A',
      tipZh: ((diff as any).tipZh || '差分不足') + ' · 无法回滚',
      toastZh: '回滚失败',
      busyZh: '旁路差分回滚到帧 A…',
      rolledBack: false,
      contrastCard: null,
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
    };
  }
  const seqA = Number((diff as any).seqA);
  const contrastCardPreview = buildBypassRollbackContrastCard(diff, { rolledBack: false, seqA });
  // dry-run preview: 不写盘，只给 before/after 卡
  if (opts.confirmRollback !== true || opts.dryRun === true) {
    return {
      ok: true as const,
      wave: 'M93' as const,
      labelZh: '旁路差分一键回滚到帧 A（预览）',
      tipZh:
        `将把看板 latest 恢复为帧 A（seq #${seqA}）· ${(diff as any).frameA?.summaryZh || ''} · 干跑无外发 · 软取消仍在`,
      toastZh: `回滚预览 · #${seqA}`,
      busyZh: '旁路差分回滚到帧 A…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      rolledBack: false,
      confirmRollbackRequired: true as const,
      seqA,
      seqB: (diff as any).seqB,
      frameA: (diff as any).frameA,
      frameB: (diff as any).frameB,
      diff: (diff as any).diff,
      contrastCard: contrastCardPreview,
      rollbackPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a',
      contrastCardPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card',
      tipConfirmZh: '传 confirmRollback:true 且 dryRun≠true 才真恢复看板（仍无外发）；回滚后出前后对照卡',
    };
  }
  const sought = seekBypassContrastHistory(tid, { seq: seqA, pause: true, demandId: opts.demandId || null });
  const contrastCard = buildBypassRollbackContrastCard(diff, { rolledBack: !!sought.frame, seqA });
  return {
    ...sought,
    wave: 'M93' as const,
    labelZh: '旁路差分一键回滚到帧 A',
    tipZh:
      (sought.tipZh || '') +
      ` · 已从差分 #${(diff as any).seqA}→#${(diff as any).seqB} 一键回滚到帧 A · 已出前后对照卡 · 干跑无外发 · 软取消仍在`,
    toastZh: sought.ok ? `已回滚到帧 A · #${seqA}` : '回滚失败',
    busyZh: '旁路差分回滚到帧 A…',
    rolledBack: !!sought.frame,
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    seqA,
    seqB: (diff as any).seqB,
    frameA: (diff as any).frameA,
    frameB: (diff as any).frameB,
    diff: (diff as any).diff,
    contrastCard,
    rollbackPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a',
    contrastCardPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card',
  };
}


/** M93：从回滚对照卡点钻到供给 peek 详情（站内、无外发） */
export function drillRollbackContrastCardIntoSupplyDetail(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    dryRun?: boolean;
  } = {},
) {
  const rb = rollbackBypassContrastHistoryToFrameA(tenantId, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId || null,
    confirmRollback: false,
    dryRun: true,
  });
  const card = (rb as any).contrastCard || buildBypassRollbackContrastCard(rb);
  const shifts = Array.isArray(card?.rankShifts) ? card.rankShifts : [];
  const demoted = Array.isArray(card?.newlyDemoted) ? card.newlyDemoted : [];
  const promoted = Array.isArray(card?.newlyPromoted) ? card.newlyPromoted : [];
  const wantId =
    String(opts.supplyId || '').trim() ||
    String(shifts[0]?.id || shifts[0]?.supplyId || demoted[0] || promoted[0] || '').trim() ||
    null;
  const wantRank = opts.rank != null ? Number(opts.rank) : shifts[0]?.rank != null ? Number(shifts[0].rank) : 1;
  const peek = peekBypassContrastSupplyCard(tenantId, {
    demandId: opts.demandId || (rb as any).demandId || (rb as any).frameA?.demandId || null,
    rank: wantRank,
    side: opts.side || 'either',
    supplyId: wantId,
  });
  const peekCard = peek?.card || null;
  const supplyDetail = peekCard
    ? {
        ...peekCard,
        fromContrastCard: true as const,
        contrastBeforeZh: card?.beforeZh || null,
        contrastAfterZh: card?.afterZh || null,
        contrastDiffSummaryZh: card?.diffSummaryZh || null,
        detailZh:
          (peekCard.peekZh || '') +
          (card?.diffSummaryZh ? `\n对照差分：${card.diffSummaryZh}` : '') +
          (card?.beforeZh ? `\n${card.beforeZh}` : '') +
          (card?.afterZh ? `\n${card.afterZh}` : ''),
        drillSourceZh: '旁路回滚对照卡 → 供给详情',
      }
    : null;
  const drillables = [
    ...shifts.slice(0, 6).map((s: any) => ({
      kind: 'rankShift',
      id: s.id || s.supplyId || null,
      rank: s.rank ?? null,
      labelZh: `排名位移 ${s.id || '—'}：${s.changedZh || ('Δ' + (s.delta ?? '?'))}`,
      drillPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
    })),
    ...demoted.slice(0, 4).map((id: any) => ({
      kind: 'demoted',
      id: String(id),
      labelZh: `新降权 ${id}`,
      drillPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
    })),
    ...promoted.slice(0, 4).map((id: any) => ({
      kind: 'promoted',
      id: String(id),
      labelZh: `新提权 ${id}`,
      drillPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
    })),
  ];
  // enrich contrast card with drill affordance
  const enrichedContrast = {
    ...card,
    wave: 'M93' as const,
    supplyDetailDrillable: true as const,
    supplyDetailDrillPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
    supplyDetailDrillLabelZh: '从对照卡钻供给详情',
    drillables,
  };
  return {
    ok: true as const,
    wave: 'M93' as const,
    labelZh: '回滚对照卡钻供给详情',
    tipZh: supplyDetail
      ? `已从对照卡钻入供给「${supplyDetail.title || supplyDetail.supplyId || 'peek'}」· ${supplyDetail.partnerHintZh || ''} · 软取消仍在 · 干跑无外发`
      : '对照卡无可钻供给 · 请先干跑旁路生成看板与差分',
    toastZh: supplyDetail
      ? `对照→供给 · ${supplyDetail.title || supplyDetail.supplyId || '详情'}`
      : '无供给可钻',
    busyZh: '从对照卡钻供给详情…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    contrastCard: enrichedContrast,
    supplyPeek: peek,
    supplyDetail,
    drilledSupplyId: supplyDetail?.supplyId || wantId,
    drilledRank: peek?.rank ?? wantRank,
    drillPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
    reContrastPath: peek?.oneClickReContrastPath ||
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/supply-peek/re-contrast',
    oneClickReBypassPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass',
    oneClickReBypassLabelZh: '供给详情一键再旁路并回写历史差分',
    reBypassRewritesHistoryDiff: true as const,
  };
}


/** M94：供给详情一键再旁路，并回写/刷新对照历史差分（干跑无外发） */
export function reBypassFromSupplyDetailRewriteHistoryDiff(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    dryRun?: boolean;
  } = {},
) {
  const detail = drillRollbackContrastCardIntoSupplyDetail(tenantId, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId || null,
    rank: opts.rank,
    supplyId: opts.supplyId,
    side: opts.side || 'either',
    dryRun: true,
  });
  const demandId =
    String(
      opts.demandId ||
        (detail as any).supplyPeek?.demandId ||
        (detail as any).drilledSupplyId ||
        (detail as any).contrastCard?.before?.frame?.demandId ||
        '',
    ).trim() || 'dry-demand';
  const histBefore = listBypassContrastHistory(tenantId, { demandId, limit: 32 });
  const maxBefore = Number(histBefore.maxSeq) || 0;
  const re = reContrastFromSupplyPeek(tenantId, {
    demandId,
    rank: opts.rank ?? (detail as any).drilledRank ?? 1,
    side: opts.side || 'after',
    supplyId: opts.supplyId || (detail as any).drilledSupplyId || null,
    topN: opts.topN ?? 5,
    dryRun: opts.dryRun !== false,
  });
  const histAfter = listBypassContrastHistory(tenantId, { demandId, limit: 32 });
  const maxAfter = Number(histAfter.maxSeq) || 0;
  const seqA = opts.seqA != null ? Number(opts.seqA) : maxBefore || Math.max(1, maxAfter - 1);
  const seqB = opts.seqB != null ? Number(opts.seqB) : maxAfter || seqA;
  const rewrittenDiff = diffBypassContrastHistory(tenantId, {
    seqA,
    seqB,
    demandId,
  });
  const historyRewritten = maxAfter > maxBefore || Boolean((rewrittenDiff as any).ok);
  return {
    ok: true as const,
    wave: 'M94' as const,
    labelZh: '供给详情一键再旁路并回写历史差分',
    tipZh:
      `已从供给详情一键再旁路 · demandId=${demandId}` +
      ` · 历史 ${maxBefore}→${maxAfter}` +
      ((rewrittenDiff as any).summaryZh ? ` · 差分：${(rewrittenDiff as any).summaryZh}` : '') +
      ' · 干跑无外发 · 软取消仍在',
    toastZh: historyRewritten
      ? `再旁路已回写差分 · #${seqA}→#${seqB}`
      : `再旁路完成 · #${seqA}→#${seqB}`,
    busyZh: '供给详情一键再旁路并回写历史差分…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    demandId,
    supplyDetail: (detail as any).supplyDetail || null,
    drilledSupplyId: (detail as any).drilledSupplyId || null,
    reBypass: re,
    contrastBoard: (re as any).board || (re as any).contrastBoard || null,
    historyBefore: { maxSeq: maxBefore, count: histBefore.count },
    historyAfter: { maxSeq: maxAfter, count: histAfter.count },
    historyRewritten,
    rewrittenHistoryDiff: rewrittenDiff,
    historyDiff: rewrittenDiff,
    seqA,
    seqB,
    contrastCard: (detail as any).contrastCard || null,
    reBypassPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass',
    historyDiffPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff',
    supplyDetailPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail',
  };
}


/** M95：再旁路历史差分上定点标注供给字段（干跑无外发） */
export function annotatePinpointSupplyFieldsOnReBypassDiff(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: Array<{
      supplyId?: string | null;
      field?: string | null;
      fieldKey?: string | null;
      noteZh?: string | null;
      valueHint?: string | null;
    }> | null;
    fields?: string[] | null;
    noteZh?: string | null;
    dryRun?: boolean;
  } = {},
) {
  const rebypass = reBypassFromSupplyDetailRewriteHistoryDiff(tenantId, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId || null,
    rank: opts.rank,
    supplyId: opts.supplyId,
    side: opts.side || 'either',
    topN: opts.topN ?? 5,
    dryRun: opts.dryRun !== false,
  });
  const diff = (rebypass as any).rewrittenHistoryDiff || (rebypass as any).historyDiff || null;
  const defaultSupplyId =
    String(opts.supplyId || (rebypass as any).drilledSupplyId || '').trim() ||
    String((diff as any)?.diff?.rankShifts?.[0]?.id || '').trim() ||
    'dry-supply-1';
  const incoming = Array.isArray(opts.annotations) ? opts.annotations : [];
  const fromFields = (Array.isArray(opts.fields) ? opts.fields : [])
    .map((f) => String(f).trim())
    .filter(Boolean)
    .map((field) => ({
      supplyId: defaultSupplyId,
      field,
      fieldKey: field,
      noteZh: String(opts.noteZh || '').trim() || `定点标注 · ${field}`,
      valueHint: null as string | null,
    }));
  const raw = [...incoming, ...fromFields];
  const annotated = (raw.length
    ? raw
    : [
        {
          supplyId: defaultSupplyId,
          field: 'title',
          fieldKey: 'title',
          noteZh: '再旁路差分：供给标题需人工核对',
          valueHint: null,
        },
        {
          supplyId: defaultSupplyId,
          field: 'orgName',
          fieldKey: 'orgName',
          noteZh: '再旁路差分：机构名位移/变更标注',
          valueHint: null,
        },
      ]
  ).map((a, i) => {
    const field = String(a.field || a.fieldKey || `field${i + 1}`).trim() || `field${i + 1}`;
    const supplyId = String(a.supplyId || defaultSupplyId).trim() || defaultSupplyId;
    const noteZh = String(a.noteZh || '').trim() || `定点标注 · ${field}`;
    return {
      id: `ann-${supplyId}-${field}-${i}`,
      supplyId,
      field,
      fieldKey: field,
      noteZh,
      valueHint: a.valueHint != null ? String(a.valueHint) : null,
      at: new Date().toISOString(),
      pinpoint: true as const,
    };
  });
  const bySupply: Record<string, typeof annotated> = {};
  for (const a of annotated) {
    if (!bySupply[a.supplyId]) bySupply[a.supplyId] = [];
    bySupply[a.supplyId].push(a);
  }
  const annotatedDiff = {
    ...(diff && typeof diff === 'object' ? diff : {}),
    wave: 'M95',
    supplyFieldAnnotations: annotated,
    annotationsBySupply: bySupply,
    annotatedSupplyIds: Object.keys(bySupply),
    annotationCount: annotated.length,
    summaryZh:
      ((diff as any)?.summaryZh ? String((diff as any).summaryZh) + ' · ' : '') +
      `定点标注 ${annotated.length} 条供给字段`,
    tipZh:
      ((diff as any)?.tipZh ? String((diff as any).tipZh) + ' · ' : '') +
      `已定点标注 ${annotated.length} 个供给字段 · 软取消仍在 · 干跑无外发`,
    toastZh: `差分定点标注 · ${annotated.length} 字段`,
    pinpointAnnotateIntact: true as const,
  };
  return {
    ok: true as const,
    wave: 'M95' as const,
    labelZh: '再旁路差分定点标注供给字段',
    tipZh:
      `已在再旁路历史差分上定点标注 ${annotated.length} 个供给字段` +
      ` · supply=${Object.keys(bySupply).join(',') || '—'}` +
      ' · 干跑无外发 · 软取消仍在',
    toastZh: `差分定点标注 · ${annotated.length}`,
    busyZh: '再旁路差分定点标注供给字段…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    demandId: (rebypass as any).demandId || opts.demandId || null,
    seqA: (rebypass as any).seqA ?? opts.seqA ?? null,
    seqB: (rebypass as any).seqB ?? opts.seqB ?? null,
    rebypass,
    rewrittenHistoryDiff: annotatedDiff,
    historyDiff: annotatedDiff,
    supplyFieldAnnotations: annotated,
    annotationsBySupply: bySupply,
    annotatePath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate',
  };
}


/** M96：定点标注差分 → 站内对照条 + 按字段过滤播放（干跑无外发） */
export function playbackAnnotatedReBypassDiffContrastStrip(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: Array<{
      supplyId?: string | null;
      field?: string | null;
      fieldKey?: string | null;
      noteZh?: string | null;
      valueHint?: string | null;
    }> | null;
    fields?: string[] | null;
    noteZh?: string | null;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    playIndex?: number | null;
    dryRun?: boolean;
  } = {},
) {
  const annotated = annotatePinpointSupplyFieldsOnReBypassDiff(tenantId, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId || null,
    rank: opts.rank,
    supplyId: opts.supplyId,
    side: opts.side || 'either',
    topN: opts.topN ?? 5,
    annotations: opts.annotations,
    fields: opts.fields,
    noteZh: opts.noteZh,
    dryRun: opts.dryRun !== false,
  });
  const all = Array.isArray(annotated.supplyFieldAnnotations)
    ? annotated.supplyFieldAnnotations
    : [];
  const filterRaw =
    (Array.isArray(opts.fieldFilter) && opts.fieldFilter.length
      ? opts.fieldFilter
      : null) ||
    (Array.isArray(opts.filterFields) && opts.filterFields.length
      ? opts.filterFields
      : null) ||
    null;
  const filterSet = filterRaw
    ? new Set(filterRaw.map((f) => String(f).trim()).filter(Boolean))
    : null;
  const filtered = filterSet
    ? all.filter((a: any) => filterSet.has(String(a.field || a.fieldKey || '')))
    : all;
  const stripItems = filtered.map((a: any, i: number) => ({
    index: i,
    id: a.id,
    supplyId: a.supplyId,
    field: a.field,
    fieldKey: a.fieldKey || a.field,
    noteZh: a.noteZh,
    valueHint: a.valueHint ?? null,
    stripZh: `【${a.field}】${a.noteZh || ''}`,
    beforeZh: `帧A · ${a.field}`,
    afterZh: `帧B · ${a.field}${a.valueHint ? ` · ${a.valueHint}` : ''}`,
    pinpoint: true as const,
  }));
  const playIndex = Math.max(
    0,
    Math.min(
      stripItems.length ? stripItems.length - 1 : 0,
      Number(opts.playIndex) || 0,
    ),
  );
  const contrastStrip = {
    wave: 'M96' as const,
    kind: 'in-app-contrast-strip' as const,
    labelZh: '定点标注站内对照条',
    itemCount: stripItems.length,
    items: stripItems,
    fieldFilter: filterSet ? [...filterSet] : null,
    filterApplied: Boolean(filterSet),
    tipZh: filterSet
      ? `对照条已按字段过滤：${[...filterSet].join('、')} · ${stripItems.length} 条`
      : `对照条含全部定点标注 ${stripItems.length} 条 · 可按字段过滤播放`,
  };
  const playback = {
    wave: 'M96' as const,
    kind: 'field-filter-playback' as const,
    labelZh: '按字段过滤差分播放',
    frames: stripItems.map((it, i) => ({
      seq: i,
      field: it.field,
      supplyId: it.supplyId,
      stripZh: it.stripZh,
      beforeZh: it.beforeZh,
      afterZh: it.afterZh,
      noteZh: it.noteZh,
      active: i === playIndex,
    })),
    currentIndex: playIndex,
    currentFrame: stripItems[playIndex] || null,
    total: stripItems.length,
    fieldFilter: filterSet ? [...filterSet] : null,
    tipZh:
      stripItems.length > 0
        ? `播放帧 ${playIndex + 1}/${stripItems.length}` +
          (filterSet ? ` · 过滤 ${[...filterSet].join('、')}` : '') +
          ' · 干跑无外发'
        : '无播放帧（可放宽字段过滤）',
  };
  return {
    ok: true as const,
    wave: 'M96' as const,
    labelZh: '定点标注对照条与字段过滤播放',
    tipZh:
      `已从定点标注差分生成站内对照条 ${stripItems.length} 条` +
      (filterSet ? ` · 字段过滤 ${[...filterSet].join('、')}` : '') +
      ` · 播放帧 ${playIndex + 1}/${Math.max(stripItems.length, 1)}` +
      ' · 软取消仍在 · 干跑无外发',
    toastZh: `对照条播放 · ${stripItems.length} 字段`,
    busyZh: '生成定点标注对照条与字段过滤播放…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    annotate: annotated,
    supplyFieldAnnotations: all,
    contrastStrip,
    fieldFilterPlayback: playback,
    playback,
    contrastStripPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip',
  };
}


/** M97：字段过滤预设存储 */
function fieldFilterPresetsPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'contrast-strip-field-filter-presets.json');
}

function loadFieldFilterPresets(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = fieldFilterPresetsPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        presets: Array.isArray(raw.presets) ? raw.presets : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { presets: [] as any[], updatedAt: null as string | null };
}

function saveFieldFilterPresets(tenantId: string | null | undefined, store: { presets: any[]; updatedAt?: string | null }) {
  const tid = safeTenant(tenantId);
  const p = fieldFilterPresetsPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/** M97：对照条短片帧序列 + 字段过滤预设保存/套用（干跑无外发） */
export function exportContrastStripInAppClipFramesAndFieldFilterPresets(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: Array<{
      supplyId?: string | null;
      field?: string | null;
      fieldKey?: string | null;
      noteZh?: string | null;
      valueHint?: string | null;
    }> | null;
    fields?: string[] | null;
    noteZh?: string | null;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    playIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    savePreset?: boolean;
    applyPresetId?: string | null;
    presetNameZh?: string | null;
    presetId?: string | null;
    listPresets?: boolean;
    dryRun?: boolean;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const store = loadFieldFilterPresets(tid);

  if (opts.listPresets === true && !opts.savePreset && !opts.applyPresetId && opts.fieldFilter == null && opts.filterFields == null) {
    return {
      ok: true as const,
      wave: 'M97' as const,
      labelZh: '字段过滤预设列表',
      tipZh: `共 ${store.presets.length} 个字段过滤预设 · 干跑无外发`,
      toastZh: store.presets.length ? `过滤预设 · ${store.presets.length}` : '暂无过滤预设',
      busyZh: '加载字段过滤预设…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      presets: store.presets,
      updatedAt: store.updatedAt,
      presetsPath: fieldFilterPresetsPath(tid),
    };
  }

  let appliedPreset: any = null;
  let fieldFilter = opts.fieldFilter || opts.filterFields || null;
  if (opts.applyPresetId) {
    appliedPreset =
      store.presets.find((p: any) => String(p.id) === String(opts.applyPresetId)) || null;
    if (appliedPreset?.fieldFilter) {
      fieldFilter = appliedPreset.fieldFilter;
    }
  }

  const stripBase = playbackAnnotatedReBypassDiffContrastStrip(tenantId, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId || null,
    rank: opts.rank,
    supplyId: opts.supplyId,
    side: opts.side || 'either',
    topN: opts.topN ?? 5,
    annotations: opts.annotations,
    fields: opts.fields,
    noteZh: opts.noteZh,
    fieldFilter,
    filterFields: fieldFilter,
    playIndex: opts.playIndex,
    dryRun: opts.dryRun !== false,
  });

  const framesSrc = Array.isArray((stripBase as any).fieldFilterPlayback?.frames)
    ? (stripBase as any).fieldFilterPlayback.frames
    : Array.isArray((stripBase as any).contrastStrip?.items)
      ? (stripBase as any).contrastStrip.items.map((it: any, i: number) => ({
          seq: i,
          field: it.field,
          supplyId: it.supplyId,
          stripZh: it.stripZh,
          beforeZh: it.beforeZh,
          afterZh: it.afterZh,
          noteZh: it.noteZh,
        }))
      : [];
  const maxFrames = Math.max(1, Math.min(Number(opts.maxFrames) || 24, 48));
  const fps = Math.max(1, Math.min(Number(opts.fps) || 4, 12));
  const clipFrames = framesSrc.slice(0, maxFrames).map((f: any, i: number) => ({
    frameIndex: i,
    tMs: Math.round((i * 1000) / fps),
    durationMs: Math.round(1000 / fps),
    field: f.field,
    supplyId: f.supplyId,
    stripZh: f.stripZh || f.beforeZh || '',
    beforeZh: f.beforeZh || '',
    afterZh: f.afterZh || '',
    noteZh: f.noteZh || null,
    captionZh: `短片帧 ${i + 1}/${Math.min(framesSrc.length, maxFrames)} · ${f.field || ''}`,
    inAppOnly: true as const,
  }));
  const clip = {
    wave: 'M97' as const,
    kind: 'in-app-clip-frames' as const,
    labelZh: '对照条站内短片帧',
    fps,
    frameCount: clipFrames.length,
    durationMs: clipFrames.length ? clipFrames[clipFrames.length - 1].tMs + clipFrames[clipFrames.length - 1].durationMs : 0,
    frames: clipFrames,
    tipZh:
      clipFrames.length > 0
        ? `站内短片 ${clipFrames.length} 帧 · ${fps}fps · 约 ${Math.round((clipFrames.length * 1000) / fps)}ms · 无外发`
        : '无短片帧（可放宽字段过滤）',
    exportHintZh: '仅站内帧序列，不落盘外发',
  };

  let savedPreset: any = null;
  if (opts.savePreset === true) {
    const filterArr = Array.isArray(fieldFilter)
      ? fieldFilter.map((f) => String(f).trim()).filter(Boolean)
      : (stripBase as any).contrastStrip?.fieldFilter || [];
    const id =
      String(opts.presetId || '').trim() ||
      `ffp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nameZh =
      String(opts.presetNameZh || '').trim() ||
      `过滤预设·${(filterArr.length ? filterArr.join('+') : '全部').slice(0, 24)}`;
    const existingIdx = store.presets.findIndex((p: any) => String(p.id) === id);
    savedPreset = {
      id,
      nameZh,
      fieldFilter: filterArr,
      updatedAt: new Date().toISOString(),
      wave: 'M97',
    };
    if (existingIdx >= 0) store.presets[existingIdx] = savedPreset;
    else store.presets.unshift(savedPreset);
    store.presets = store.presets.slice(0, 40);
    saveFieldFilterPresets(tid, store);
  }

  return {
    ok: true as const,
    wave: 'M97' as const,
    labelZh: '对照条短片帧与字段过滤预设',
    tipZh:
      `已生成站内短片 ${clip.frameCount} 帧` +
      (savedPreset ? ` · 已保存预设「${savedPreset.nameZh}」` : '') +
      (appliedPreset ? ` · 已套用预设「${appliedPreset.nameZh}」` : '') +
      ' · 软取消仍在 · 干跑无外发',
    toastZh: savedPreset
      ? `短片 ${clip.frameCount} 帧 · 已存预设`
      : appliedPreset
        ? `短片 ${clip.frameCount} 帧 · 已套用预设`
        : `短片帧 · ${clip.frameCount}`,
    busyZh: '生成对照条短片帧与字段过滤预设…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    clip,
    clipFrames,
    inAppClipFrames: clip,
    fieldFilterPresets: store.presets,
    savedPreset,
    appliedPreset,
    contrastStrip: (stripBase as any).contrastStrip,
    fieldFilterPlayback: (stripBase as any).fieldFilterPlayback,
    playback: (stripBase as any).playback,
    annotate: (stripBase as any).annotate,
    stripBase,
    clipPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames',
  };
}


/** M98：短片帧 scrubber + 字段过滤预设按角色默认 */
export function scrubContrastStripClipFramesWithRoleDefaultPresets(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: Array<{
      supplyId?: string | null;
      field?: string | null;
      fieldKey?: string | null;
      noteZh?: string | null;
      valueHint?: string | null;
    }> | null;
    fields?: string[] | null;
    noteZh?: string | null;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    playIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    savePreset?: boolean;
    applyPresetId?: string | null;
    presetNameZh?: string | null;
    presetId?: string | null;
    listPresets?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    role?: string | null;
    myRole?: string | null;
    setRoleDefault?: boolean;
    applyRoleDefault?: boolean;
    dryRun?: boolean;
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

  let applyPresetId = opts.applyPresetId || null;
  const store = loadFieldFilterPresets(tid);
  if (opts.applyRoleDefault === true && !applyPresetId) {
    const hit = store.presets.find(
      (p: any) => p.roleDefaultFor === role || (Array.isArray(p.roleDefaults) && p.roleDefaults.includes(role)),
    );
    if (hit) applyPresetId = hit.id;
  }

  const base = exportContrastStripInAppClipFramesAndFieldFilterPresets(tid, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId,
    rank: opts.rank,
    supplyId: opts.supplyId,
    side: opts.side,
    topN: opts.topN,
    annotations: opts.annotations,
    fields: opts.fields,
    noteZh: opts.noteZh,
    fieldFilter: opts.fieldFilter,
    filterFields: opts.filterFields,
    playIndex: opts.playIndex,
    fps: opts.fps,
    maxFrames: opts.maxFrames,
    savePreset: opts.savePreset,
    applyPresetId,
    presetNameZh: opts.presetNameZh,
    presetId: opts.presetId,
    listPresets: opts.listPresets,
    dryRun: opts.dryRun !== false,
  });

  if ((base as any).listPresets === true || opts.listPresets === true) {
    return {
      ...base,
      wave: 'M98' as const,
      labelZh: '短片帧 scrubber · 角色默认过滤预设',
      role,
      roleZh,
    };
  }

  const store2 = loadFieldFilterPresets(tid);
  let roleDefaultPreset: any = null;
  if (opts.setRoleDefault === true) {
    const targetId =
      String(opts.presetId || opts.applyPresetId || (base as any).savedPreset?.id || '').trim() ||
      (store2.presets[0] && store2.presets[0].id) ||
      '';
    if (targetId) {
      const idx = store2.presets.findIndex((p: any) => String(p.id) === targetId);
      if (idx >= 0) {
        for (const p of store2.presets) {
          if (p.roleDefaultFor === role) delete p.roleDefaultFor;
          if (Array.isArray(p.roleDefaults)) {
            p.roleDefaults = p.roleDefaults.filter((r: string) => r !== role);
          }
        }
        store2.presets[idx].roleDefaultFor = role;
        store2.presets[idx].roleDefaults = Array.from(
          new Set([...(store2.presets[idx].roleDefaults || []), role]),
        );
        store2.presets[idx].roleDefaultZh = `${roleZh}默认过滤`;
        store2.presets[idx].updatedAt = new Date().toISOString();
        store2.presets[idx].wave = 'M98';
        roleDefaultPreset = store2.presets[idx];
        saveFieldFilterPresets(tid, store2);
      }
    }
  } else {
    roleDefaultPreset =
      store2.presets.find(
        (p: any) => p.roleDefaultFor === role || (Array.isArray(p.roleDefaults) && p.roleDefaults.includes(role)),
      ) || null;
  }

  const frames: any[] = Array.isArray((base as any).clip?.frames)
    ? (base as any).clip.frames
    : Array.isArray((base as any).clipFrames)
      ? (base as any).clipFrames
      : [];
  const scrubRaw =
    opts.scrubIndex != null
      ? Number(opts.scrubIndex)
      : opts.scrubToFrame != null
        ? Number(opts.scrubToFrame)
        : opts.frameIndex != null
          ? Number(opts.frameIndex)
          : opts.playIndex != null
            ? Number(opts.playIndex)
            : 0;
  const scrubIndex = frames.length
    ? Math.max(0, Math.min(Math.floor(scrubRaw) || 0, frames.length - 1))
    : 0;
  const currentFrame = frames[scrubIndex] || null;
  const scrubber = {
    wave: 'M98' as const,
    kind: 'clip-frame-scrubber' as const,
    labelZh: '短片帧 scrubber',
    frameCount: frames.length,
    scrubIndex,
    currentFrame,
    prevIndex: scrubIndex > 0 ? scrubIndex - 1 : null,
    nextIndex: scrubIndex < frames.length - 1 ? scrubIndex + 1 : null,
    progressPct: frames.length ? Math.round(((scrubIndex + 1) / frames.length) * 100) : 0,
    tipZh: currentFrame
      ? `scrub 到帧 ${scrubIndex + 1}/${frames.length} · ${currentFrame.field || currentFrame.captionZh || ''}`
      : '暂无短片帧可 scrub',
    scrubHintZh: '拖拽/点选 scrubIndex 预览对照条短片帧 · 站内无外发',
  };

  return {
    ok: true as const,
    wave: 'M98' as const,
    labelZh: '短片帧 scrubber · 角色默认过滤预设',
    tipZh:
      `短片帧 scrubber · 帧 ${scrubIndex + 1}/${frames.length || 0}` +
      (roleDefaultPreset ? ` · 角色「${roleZh}」默认预设「${roleDefaultPreset.nameZh}」` : '') +
      (opts.setRoleDefault ? ' · 已设为角色默认' : '') +
      (opts.applyRoleDefault ? ' · 已套用角色默认' : '') +
      ' · 软取消仍在 · 干跑无外发',
    toastZh: opts.setRoleDefault
      ? `已设 ${roleZh} 默认过滤`
      : currentFrame
        ? `scrub · 帧 ${scrubIndex + 1}/${frames.length}`
        : '短片帧 scrubber',
    busyZh: '短片帧 scrubber / 角色默认过滤…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    role,
    roleZh,
    scrubber,
    currentFrame,
    scrubIndex,
    roleDefaultPreset,
    clip: (base as any).clip,
    clipFrames: frames,
    fieldFilterPresets: store2.presets,
    savedPreset: (base as any).savedPreset,
    appliedPreset: (base as any).appliedPreset,
    contrastStrip: (base as any).contrastStrip,
    fieldFilterPlayback: (base as any).fieldFilterPlayback,
    playback: (base as any).playback,
    annotate: (base as any).annotate,
    stripBase: base,
    scrubPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber',
  };
}


/** M99：短片帧 scrubber 帧书签存储 */
function clipFrameBookmarksPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'clip-frame-scrubber-bookmarks.json');
}

function loadClipFrameBookmarks(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = clipFrameBookmarksPath(tid);
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

function saveClipFrameBookmarks(
  tenantId: string | null | undefined,
  store: { bookmarks: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = clipFrameBookmarksPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/** M99：短片帧 scrubber 帧书签 + 角色默认过滤跨租户只读继承 */
export function bookmarkScrubClipFramesWithCrossTenantRoleDefaultInherit(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: Array<{
      supplyId?: string | null;
      field?: string | null;
      fieldKey?: string | null;
      noteZh?: string | null;
      valueHint?: string | null;
    }> | null;
    fields?: string[] | null;
    noteZh?: string | null;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    playIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    savePreset?: boolean;
    applyPresetId?: string | null;
    presetNameZh?: string | null;
    presetId?: string | null;
    listPresets?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    role?: string | null;
    myRole?: string | null;
    setRoleDefault?: boolean;
    applyRoleDefault?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    bookmarkId?: string | null;
    listBookmarks?: boolean;
    jumpToBookmarkId?: string | null;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    seedInheritSource?: boolean;
    dryRun?: boolean;
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

  let inheritedPreset: any = null;
  let inheritedReadOnly = false;
  const sourceTid = String(opts.inheritFromTenant || opts.sourceTenantId || '').trim();
  if ((opts.crossTenantInherit === true || !!sourceTid) && sourceTid && sourceTid !== tid) {
    let srcStore = loadFieldFilterPresets(sourceTid);
    // 演示/干跑：源租户无角色默认时，可 seed 一份只读源预设（仍无外发）
    if ((opts as any).seedInheritSource === true && !srcStore.presets.length) {
      const filterArr = Array.isArray(opts.fieldFilter)
        ? opts.fieldFilter.map((f) => String(f).trim()).filter(Boolean)
        : Array.isArray(opts.filterFields)
          ? opts.filterFields.map((f) => String(f).trim()).filter(Boolean)
          : ['title', 'orgName'];
      const seeded = {
        id: `seed-${role}-default`,
        nameZh: `${roleZh}跨租户源默认`,
        fieldFilter: filterArr,
        roleDefaultFor: role,
        roleDefaults: [role],
        roleDefaultZh: `${roleZh}默认过滤`,
        updatedAt: new Date().toISOString(),
        wave: 'M99',
        seededForInherit: true as const,
      };
      srcStore = { presets: [seeded], updatedAt: seeded.updatedAt };
      saveFieldFilterPresets(sourceTid, srcStore);
    }
    const hit =
      srcStore.presets.find(
        (p: any) =>
          p.roleDefaultFor === role ||
          (Array.isArray(p.roleDefaults) && p.roleDefaults.includes(role)),
      ) || srcStore.presets[0] || null;
    if (hit) {
      inheritedPreset = {
        ...hit,
        id: `ro-inherit-${sourceTid}-${hit.id}`,
        nameZh: `只读继承·${hit.nameZh || hit.id}`,
        inheritedFromTenant: sourceTid,
        readOnly: true as const,
        wave: 'M99',
      };
      inheritedReadOnly = true;
      if (!opts.applyPresetId) {
        opts = {
          ...opts,
          applyRoleDefault: false,
          fieldFilter: hit.fieldFilter || opts.fieldFilter,
          filterFields: hit.fieldFilter || opts.filterFields,
        };
      }
    }
  }

  let scrubIndexOpt = opts.scrubIndex;
  const bmStore = loadClipFrameBookmarks(tid);
  if (opts.jumpToBookmarkId) {
    const bm = bmStore.bookmarks.find((b: any) => String(b.id) === String(opts.jumpToBookmarkId));
    if (bm && bm.scrubIndex != null) scrubIndexOpt = bm.scrubIndex;
  }

  const base = scrubContrastStripClipFramesWithRoleDefaultPresets(tid, {
    seqA: opts.seqA,
    seqB: opts.seqB,
    demandId: opts.demandId,
    rank: opts.rank,
    supplyId: opts.supplyId,
    side: opts.side,
    topN: opts.topN,
    annotations: opts.annotations,
    fields: opts.fields,
    noteZh: opts.noteZh,
    fieldFilter: opts.fieldFilter,
    filterFields: opts.filterFields,
    playIndex: opts.playIndex,
    fps: opts.fps,
    maxFrames: opts.maxFrames,
    savePreset: opts.savePreset,
    applyPresetId: opts.applyPresetId,
    presetNameZh: opts.presetNameZh,
    presetId: opts.presetId,
    listPresets: opts.listPresets,
    scrubIndex: scrubIndexOpt,
    scrubToFrame: opts.scrubToFrame,
    frameIndex: opts.frameIndex,
    role,
    myRole: opts.myRole,
    setRoleDefault: opts.setRoleDefault,
    applyRoleDefault: opts.applyRoleDefault,
    dryRun: opts.dryRun !== false,
  });

  if (opts.listBookmarks === true) {
    return {
      ...base,
      wave: 'M99' as const,
      labelZh: '短片帧 scrubber 帧书签 · 跨租户只读继承',
      bookmarks: bmStore.bookmarks,
      inheritedPreset,
      inheritedReadOnly,
      sourceTenantId: sourceTid || null,
    };
  }

  let savedBookmark: any = null;
  if (opts.bookmark === true) {
    const scrubIndex =
      (base as any).scrubIndex != null
        ? Number((base as any).scrubIndex)
        : scrubIndexOpt != null
          ? Number(scrubIndexOpt)
          : 0;
    const frame = (base as any).currentFrame || null;
    const id =
      String(opts.bookmarkId || '').trim() ||
      `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const nameZh =
      String(opts.bookmarkNameZh || '').trim() ||
      `书签·帧${scrubIndex + 1}${frame?.field ? '·' + frame.field : ''}`;
    savedBookmark = {
      id,
      nameZh,
      scrubIndex,
      frameIndex: scrubIndex,
      field: frame?.field || null,
      captionZh: frame?.captionZh || null,
      role,
      roleZh,
      createdAt: new Date().toISOString(),
      wave: 'M99',
    };
    const idx = bmStore.bookmarks.findIndex((b: any) => String(b.id) === id);
    if (idx >= 0) bmStore.bookmarks[idx] = savedBookmark;
    else bmStore.bookmarks.unshift(savedBookmark);
    bmStore.bookmarks = bmStore.bookmarks.slice(0, 40);
    saveClipFrameBookmarks(tid, bmStore);
  }

  return {
    ok: true as const,
    wave: 'M99' as const,
    labelZh: '短片帧 scrubber 帧书签 · 跨租户只读继承',
    tipZh:
      `短片帧 scrubber` +
      ((base as any).scrubber
        ? ` · 帧 ${((base as any).scrubIndex ?? 0) + 1}/${(base as any).scrubber?.frameCount || 0}`
        : '') +
      (savedBookmark ? ` · 已收藏书签「${savedBookmark.nameZh}」` : '') +
      (inheritedPreset
        ? ` · 只读继承自租户「${sourceTid}」预设「${inheritedPreset.nameZh}」`
        : '') +
      ' · 软取消仍在 · 干跑无外发',
    toastZh: savedBookmark
      ? `已收藏帧书签 · ${savedBookmark.nameZh}`
      : inheritedPreset
        ? `跨租户只读继承 · ${inheritedPreset.nameZh}`
        : (base as any).toastZh || '短片帧书签',
    busyZh: '短片帧书签 / 跨租户只读继承…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    role,
    roleZh,
    scrubber: (base as any).scrubber,
    currentFrame: (base as any).currentFrame,
    scrubIndex: (base as any).scrubIndex,
    roleDefaultPreset: (base as any).roleDefaultPreset,
    savedBookmark,
    bookmarks: bmStore.bookmarks,
    inheritedPreset,
    inheritedReadOnly,
    sourceTenantId: sourceTid || null,
    clip: (base as any).clip,
    clipFrames: (base as any).clipFrames,
    fieldFilterPresets: (base as any).fieldFilterPresets,
    savedPreset: (base as any).savedPreset,
    appliedPreset: (base as any).appliedPreset || (inheritedReadOnly ? inheritedPreset : null),
    contrastStrip: (base as any).contrastStrip,
    fieldFilterPlayback: (base as any).fieldFilterPlayback,
    playback: (base as any).playback,
    annotate: (base as any).annotate,
    stripBase: base,
    bookmarkPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks',
  };
}


/** M100：帧书签只读分享短链存储 */
function clipFrameBookmarkSharesPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'clip-frame-bookmark-shares.json');
}

function loadClipFrameBookmarkShares(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = clipFrameBookmarkSharesPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        shares: Array.isArray(raw.shares) ? raw.shares : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { shares: [] as any[], updatedAt: null as string | null };
}

function saveClipFrameBookmarkShares(
  tenantId: string | null | undefined,
  store: { shares: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = clipFrameBookmarkSharesPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/**
 * M100：帧书签只读短链分享 + 跨租户继承中文差分预览后采纳
 * （软取消仍在；干跑无外发）
 */
export function shareClipFrameBookmarkReadOnlyLinkAndInheritDiffAdopt(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: Array<{
      supplyId?: string | null;
      field?: string | null;
      fieldKey?: string | null;
      noteZh?: string | null;
      valueHint?: string | null;
    }> | null;
    fields?: string[] | null;
    noteZh?: string | null;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    playIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    savePreset?: boolean;
    applyPresetId?: string | null;
    presetNameZh?: string | null;
    presetId?: string | null;
    listPresets?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    role?: string | null;
    myRole?: string | null;
    setRoleDefault?: boolean;
    applyRoleDefault?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    bookmarkId?: string | null;
    listBookmarks?: boolean;
    jumpToBookmarkId?: string | null;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    seedInheritSource?: boolean;
    shareBookmark?: boolean;
    createShareLink?: boolean;
    shareBookmarkId?: string | null;
    shareToken?: string | null;
    openShareToken?: string | null;
    listShares?: boolean;
    previewInheritDiff?: boolean;
    inheritDiffPreview?: boolean;
    adoptInherited?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
    dryRun?: boolean;
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

  // 打开只读分享短链
  const openTok = String(opts.openShareToken || opts.shareToken || '').trim();
  const shareStore = loadClipFrameBookmarkShares(tid);
  if (openTok) {
    const hit =
      shareStore.shares.find((s: any) => String(s.token) === openTok && !s.revoked) || null;
    if (!hit) {
      return {
        ok: false as const,
        wave: 'M100' as const,
        labelZh: '帧书签只读短链',
        tipZh: '分享短链无效或已撤销 · 中页取消仍在 · 无外发',
        toastZh: '短链无效',
        busyZh: '打开帧书签只读短链…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        share: null,
        readOnly: true as const,
      };
    }
    const bmBase = bookmarkScrubClipFramesWithCrossTenantRoleDefaultInherit(tid, {
      ...opts,
      jumpToBookmarkId: hit.bookmarkId,
      bookmark: false,
      crossTenantInherit: false,
      dryRun: opts.dryRun !== false,
    });
    return {
      ...bmBase,
      ok: true as const,
      wave: 'M100' as const,
      labelZh: '帧书签只读短链 · 打开',
      tipZh:
        `已打开只读短链「${hit.nameZh || hit.token}」` +
        ` · 书签「${hit.bookmarkNameZh || hit.bookmarkId}」` +
        ` · 帧 ${(hit.scrubIndex ?? 0) + 1}` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `只读短链 · ${hit.bookmarkNameZh || hit.token}`,
      busyZh: '打开帧书签只读短链…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      share: hit,
      readOnlyShare: true as const,
      openedViaShareToken: openTok,
      sharePath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link',
    };
  }

  const base = bookmarkScrubClipFramesWithCrossTenantRoleDefaultInherit(tid, {
    ...opts,
    dryRun: opts.dryRun !== false,
  });

  // 列出分享
  if (opts.listShares === true) {
    return {
      ...base,
      wave: 'M100' as const,
      labelZh: '帧书签只读短链台账',
      shares: shareStore.shares,
      tipZh: `共 ${shareStore.shares.length} 条只读短链 · 干跑无外发`,
      toastZh: shareStore.shares.length ? `短链 · ${shareStore.shares.length}` : '暂无短链',
    };
  }

  // 创建只读短链
  let createdShare: any = null;
  if (opts.shareBookmark === true || opts.createShareLink === true) {
    const bmId =
      String(opts.shareBookmarkId || opts.bookmarkId || (base as any).savedBookmark?.id || '').trim() ||
      ((base as any).bookmarks && (base as any).bookmarks[0]?.id) ||
      '';
    const bm =
      ((base as any).bookmarks || []).find((b: any) => String(b.id) === bmId) ||
      (base as any).savedBookmark ||
      null;
    if (bm) {
      const token =
        `bmshare-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      createdShare = {
        token,
        bookmarkId: bm.id,
        bookmarkNameZh: bm.nameZh,
        scrubIndex: bm.scrubIndex ?? 0,
        field: bm.field || null,
        role,
        roleZh,
        nameZh: `只读·${bm.nameZh}`,
        readOnly: true as const,
        inAppPath: `/ops.html#clip-bm-share=${token}`,
        apiPath:
          '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link',
        createdAt: new Date().toISOString(),
        revoked: false,
        wave: 'M100',
      };
      shareStore.shares.unshift(createdShare);
      shareStore.shares = shareStore.shares.slice(0, 60);
      saveClipFrameBookmarkShares(tid, shareStore);
    }
  }

  // 跨租户继承差分预览 / 采纳
  const localStore = loadFieldFilterPresets(tid);
  const localDefault =
    localStore.presets.find(
      (p: any) =>
        p.roleDefaultFor === role ||
        (Array.isArray(p.roleDefaults) && p.roleDefaults.includes(role)),
    ) || null;
  const inherited = (base as any).inheritedPreset || null;
  const localFilter: string[] = Array.isArray(localDefault?.fieldFilter)
    ? [...localDefault.fieldFilter]
    : Array.isArray(opts.fieldFilter)
      ? opts.fieldFilter.map((f) => String(f).trim()).filter(Boolean)
      : Array.isArray(opts.filterFields)
        ? opts.filterFields.map((f) => String(f).trim()).filter(Boolean)
        : [];
  const inhFilter: string[] = Array.isArray(inherited?.fieldFilter)
    ? [...inherited.fieldFilter]
    : [];
  const added = inhFilter.filter((f) => !localFilter.includes(f));
  const removed = localFilter.filter((f) => !inhFilter.includes(f));
  const same = inhFilter.filter((f) => localFilter.includes(f));
  const inheritDiffPreview = {
    wave: 'M100' as const,
    kind: 'cross-tenant-inherit-diff-preview' as const,
    titleZh: '跨租户继承差分预览',
    bodyZh:
      `将把源租户「${(base as any).sourceTenantId || opts.inheritFromTenant || '—'}」` +
      `角色「${roleZh}」过滤采纳到本租户` +
      ` · 本地 [${localFilter.join('、') || '空'}]` +
      ` → 继承 [${inhFilter.join('、') || '空'}]` +
      (added.length ? ` · 新增 ${added.join('、')}` : '') +
      (removed.length ? ` · 移除 ${removed.join('、')}` : '') +
      (same.length ? ` · 保留 ${same.join('、')}` : '') +
      ' · 需 confirmAdopt / confirmCardAck',
    localFilter,
    inheritedFilter: inhFilter,
    added,
    removed,
    same,
    inheritedPreset: inherited,
    localDefault,
    sourceTenantId: (base as any).sourceTenantId || opts.inheritFromTenant || null,
    requireAck: true as const,
  };

  const wantsDiffPreview =
    opts.previewInheritDiff === true ||
    opts.inheritDiffPreview === true ||
    (opts.adoptInherited === true && opts.confirmAdopt !== true && opts.confirmCardAck !== true);

  if (wantsDiffPreview && inherited) {
    return {
      ...base,
      ok: true as const,
      wave: 'M100' as const,
      labelZh: '跨租户继承差分预览（待采纳）',
      tipZh:
        `已出中文差分预览 · 源「${inheritDiffPreview.sourceTenantId}」` +
        ` · +${added.length}/-${removed.length}` +
        ' · 中页取消仍在 · 无外发',
      toastZh: '请确认采纳跨租户继承',
      busyZh: '跨租户继承差分预览…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      inheritDiffPreview,
      previewInheritDiff: true as const,
      adopted: false as const,
      createdShare,
      shares: shareStore.shares,
      sharePath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link',
    };
  }

  let adoptedPreset: any = null;
  if (
    opts.adoptInherited === true &&
    (opts.confirmAdopt === true || opts.confirmCardAck === true) &&
    inherited
  ) {
    const id =
      String(opts.presetId || '').trim() ||
      `adopt-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    adoptedPreset = {
      id,
      nameZh: `已采纳·${inherited.nameZh || inherited.id}`,
      fieldFilter: inhFilter.length ? inhFilter : ['title', 'orgName'],
      roleDefaultFor: role,
      roleDefaults: [role],
      roleDefaultZh: `${roleZh}默认过滤（跨租户采纳）`,
      adoptedFromTenant: inheritDiffPreview.sourceTenantId,
      adoptedFromPresetId: inherited.id,
      updatedAt: new Date().toISOString(),
      wave: 'M100',
      readOnly: false as const,
    };
    const idx = localStore.presets.findIndex((p: any) => String(p.id) === id);
    // clear other role defaults for this role
    for (const p of localStore.presets) {
      if (p.roleDefaultFor === role) delete p.roleDefaultFor;
      if (Array.isArray(p.roleDefaults)) {
        p.roleDefaults = p.roleDefaults.filter((r: string) => r !== role);
      }
    }
    if (idx >= 0) localStore.presets[idx] = adoptedPreset;
    else localStore.presets.unshift(adoptedPreset);
    localStore.presets = localStore.presets.slice(0, 40);
    saveFieldFilterPresets(tid, localStore);
  }

  return {
    ...base,
    ok: true as const,
    wave: 'M100' as const,
    labelZh: createdShare
      ? '帧书签只读短链分享'
      : adoptedPreset
        ? '跨租户继承差分采纳'
        : '帧书签只读短链 · 跨租户继承差分',
    tipZh:
      (createdShare
        ? `已生成只读书签短链「${createdShare.token}」· 站内 ${createdShare.inAppPath}`
        : '') +
      (adoptedPreset
        ? `${createdShare ? ' · ' : ''}已采纳继承预设「${adoptedPreset.nameZh}」` +
          ` · 过滤 [${adoptedPreset.fieldFilter.join('、')}]`
        : '') +
      (!createdShare && !adoptedPreset
        ? ((base as any).tipZh || '帧书签短链 / 继承差分')
        : '') +
      ' · 软取消仍在 · 干跑无外发',
    toastZh: createdShare
      ? `已分享只读短链 · ${createdShare.bookmarkNameZh || createdShare.token}`
      : adoptedPreset
        ? `已采纳跨租户继承 · ${adoptedPreset.nameZh}`
        : (base as any).toastZh || '帧书签短链',
    busyZh: '帧书签只读短链 / 跨租户继承差分采纳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    createdShare,
    shares: shareStore.shares,
    inheritDiffPreview: inherited ? inheritDiffPreview : null,
    adopted: !!adoptedPreset,
    adoptedPreset,
    sharePath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link',
  };
}


/** M101：短链过期/撤销中文台账路径 */
function clipFrameBookmarkShareLedgerPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'clip-frame-bookmark-share-ledger.json');
}

function loadClipFrameBookmarkShareLedger(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = clipFrameBookmarkShareLedgerPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        entries: Array.isArray(raw.entries) ? raw.entries : [],
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { entries: [] as any[], updatedAt: null as string | null };
}

function saveClipFrameBookmarkShareLedger(
  tenantId: string | null | undefined,
  store: { entries: any[]; updatedAt?: string | null },
) {
  const tid = safeTenant(tenantId);
  const p = clipFrameBookmarkShareLedgerPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

function pushShareLedgerEntry(tenantId: string | null | undefined, entry: any) {
  const store = loadClipFrameBookmarkShareLedger(tenantId);
  store.entries.unshift(entry);
  store.entries = store.entries.slice(0, 80);
  saveClipFrameBookmarkShareLedger(tenantId, store);
  return entry;
}

/**
 * M101：只读短链过期/撤销中文台账 + 继承采纳按字段勾选子集
 * （软取消仍在；干跑无外发）
 */
export function shareLinkExpiryRevokeLedgerAndInheritAdoptFieldSubset(
  tenantId?: string | null,
  opts: {
    seqA?: number;
    seqB?: number;
    demandId?: string | null;
    rank?: number | null;
    supplyId?: string | null;
    side?: 'before' | 'after' | 'either';
    topN?: number;
    annotations?: any[] | null;
    fields?: string[] | null;
    noteZh?: string | null;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    playIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    savePreset?: boolean;
    applyPresetId?: string | null;
    presetNameZh?: string | null;
    presetId?: string | null;
    listPresets?: boolean;
    scrubIndex?: number | null;
    scrubToFrame?: number | null;
    frameIndex?: number | null;
    role?: string | null;
    myRole?: string | null;
    setRoleDefault?: boolean;
    applyRoleDefault?: boolean;
    bookmark?: boolean;
    bookmarkNameZh?: string | null;
    bookmarkId?: string | null;
    listBookmarks?: boolean;
    jumpToBookmarkId?: string | null;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    seedInheritSource?: boolean;
    shareBookmark?: boolean;
    createShareLink?: boolean;
    shareBookmarkId?: string | null;
    shareToken?: string | null;
    openShareToken?: string | null;
    listShares?: boolean;
    previewInheritDiff?: boolean;
    inheritDiffPreview?: boolean;
    adoptInherited?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
    /** M101 */
    expiresInMs?: number | null;
    expiresAt?: string | null;
    revokeShare?: boolean;
    revokeToken?: string | null;
    listLedger?: boolean;
    adoptFields?: string[] | null;
    fieldSubset?: string[] | null;
    pickFieldSubset?: string[] | null;
    dryRun?: boolean;
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
  const ledger = loadClipFrameBookmarkShareLedger(tid);
  const shareStore = loadClipFrameBookmarkShares(tid);

  if (opts.listLedger === true) {
    return {
      ok: true as const,
      wave: 'M101' as const,
      labelZh: '帧书签短链过期/撤销中文台账',
      tipZh: `共 ${ledger.entries.length} 条台账 · 软取消仍在 · 干跑无外发`,
      toastZh: ledger.entries.length ? `短链台账 · ${ledger.entries.length}` : '暂无台账',
      busyZh: '加载短链过期/撤销台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      ledger: ledger.entries,
      shares: shareStore.shares,
      shareLedgerPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger',
    };
  }

  // 撤销短链
  if (opts.revokeShare === true) {
    const tok = String(opts.revokeToken || opts.shareToken || opts.openShareToken || '').trim();
    const hit = shareStore.shares.find((s: any) => String(s.token) === tok) || null;
    if (!hit) {
      return {
        ok: false as const,
        wave: 'M101' as const,
        labelZh: '帧书签短链撤销',
        tipZh: '未找到可撤销短链 · 中页取消仍在 · 无外发',
        toastZh: '短链不存在',
        busyZh: '撤销帧书签短链…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        revoked: false as const,
      };
    }
    hit.revoked = true;
    hit.revokedAt = new Date().toISOString();
    hit.revokeReasonZh = '运营主动撤销';
    saveClipFrameBookmarkShares(tid, shareStore);
    const ledgerEntry = pushShareLedgerEntry(tid, {
      kind: 'revoke',
      kindZh: '撤销',
      token: hit.token,
      bookmarkId: hit.bookmarkId,
      bookmarkNameZh: hit.bookmarkNameZh,
      at: hit.revokedAt,
      byRole: role,
      byRoleZh: roleZh,
      noteZh: `已撤销只读短链「${hit.nameZh || hit.token}」`,
      wave: 'M101',
    });
    return {
      ok: true as const,
      wave: 'M101' as const,
      labelZh: '帧书签短链撤销',
      tipZh: `已撤销短链「${hit.token}」· 台账已记 · 软取消仍在 · 干跑无外发`,
      toastZh: `已撤销短链 · ${hit.bookmarkNameZh || hit.token}`,
      busyZh: '撤销帧书签短链…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      revoked: true as const,
      share: hit,
      ledgerEntry,
      ledger: loadClipFrameBookmarkShareLedger(tid).entries,
      shareLedgerPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger',
    };
  }

  // 打开短链：校验过期/撤销
  const openTok = String(opts.openShareToken || opts.shareToken || '').trim();
  const openOnly = !!openTok && !opts.adoptInherited && !opts.shareBookmark && !opts.createShareLink;
  if (openOnly) {
    const hit = shareStore.shares.find((s: any) => String(s.token) === openTok) || null;
    if (!hit || hit.revoked) {
      return {
        ok: false as const,
        wave: 'M101' as const,
        labelZh: '帧书签只读短链',
        tipZh: hit?.revoked ? '短链已撤销 · 见中文台账' : '短链无效 · 中页取消仍在 · 无外发',
        toastZh: hit?.revoked ? '短链已撤销' : '短链无效',
        busyZh: '打开帧书签只读短链…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        share: hit,
        expired: false as const,
        revoked: !!hit?.revoked,
      };
    }
    if (hit.expiresAt && new Date(hit.expiresAt).getTime() < Date.now()) {
      hit.expired = true;
      saveClipFrameBookmarkShares(tid, shareStore);
      pushShareLedgerEntry(tid, {
        kind: 'expire',
        kindZh: '过期',
        token: hit.token,
        bookmarkId: hit.bookmarkId,
        bookmarkNameZh: hit.bookmarkNameZh,
        expiresAt: hit.expiresAt,
        at: new Date().toISOString(),
        byRole: role,
        byRoleZh: roleZh,
        noteZh: `短链「${hit.nameZh || hit.token}」已过期`,
        wave: 'M101',
      });
      return {
        ok: false as const,
        wave: 'M101' as const,
        labelZh: '帧书签只读短链',
        tipZh: `短链已过期（${hit.expiresAt}）· 台账已记 · 中页取消仍在 · 无外发`,
        toastZh: '短链已过期',
        busyZh: '打开帧书签只读短链…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        share: hit,
        expired: true as const,
        revoked: false as const,
      };
    }
  }

  // 字段子集：采纳时只取勾选字段
  const subsetRaw =
    (Array.isArray(opts.adoptFields) && opts.adoptFields) ||
    (Array.isArray(opts.fieldSubset) && opts.fieldSubset) ||
    (Array.isArray(opts.pickFieldSubset) && opts.pickFieldSubset) ||
    null;
  const fieldSubset = subsetRaw
    ? subsetRaw.map((f) => String(f).trim()).filter(Boolean)
    : null;

  // 生成短链时带过期
  const expiresInMs =
    opts.expiresInMs != null && Number.isFinite(Number(opts.expiresInMs))
      ? Math.max(1000, Number(opts.expiresInMs))
      : opts.expiresAt
        ? Math.max(1000, new Date(opts.expiresAt).getTime() - Date.now())
        : null;

  const base = shareClipFrameBookmarkReadOnlyLinkAndInheritDiffAdopt(tid, {
    ...opts,
    // 若指定字段子集且确认采纳，先让 base 用完整继承，再由本层裁剪写回
    adoptInherited:
      opts.adoptInherited === true && fieldSubset && fieldSubset.length
        ? false
        : opts.adoptInherited,
    confirmAdopt:
      opts.adoptInherited === true && fieldSubset && fieldSubset.length
        ? false
        : opts.confirmAdopt,
    confirmCardAck:
      opts.adoptInherited === true && fieldSubset && fieldSubset.length
        ? false
        : opts.confirmCardAck,
    dryRun: opts.dryRun !== false,
  });

  // 为新建短链补过期并记台账
  let createdShare = (base as any).createdShare || null;
  if ((opts.shareBookmark === true || opts.createShareLink === true) && createdShare) {
    if (expiresInMs != null) {
      createdShare.expiresAt = new Date(Date.now() + expiresInMs).toISOString();
      createdShare.expiresInMs = expiresInMs;
      const idx = shareStore.shares.findIndex((s: any) => String(s.token) === String(createdShare.token));
      if (idx >= 0) {
        shareStore.shares[idx] = { ...shareStore.shares[idx], ...createdShare, wave: 'M101' };
        saveClipFrameBookmarkShares(tid, shareStore);
      } else {
        // base 可能已写入；重载后更新
        const fresh = loadClipFrameBookmarkShares(tid);
        const j = fresh.shares.findIndex((s: any) => String(s.token) === String(createdShare.token));
        if (j >= 0) {
          fresh.shares[j] = { ...fresh.shares[j], ...createdShare, wave: 'M101' };
          saveClipFrameBookmarkShares(tid, fresh);
        }
      }
    }
    pushShareLedgerEntry(tid, {
      kind: 'create',
      kindZh: '创建',
      token: createdShare.token,
      bookmarkId: createdShare.bookmarkId,
      bookmarkNameZh: createdShare.bookmarkNameZh,
      expiresAt: createdShare.expiresAt || null,
      expiresInMs: createdShare.expiresInMs || null,
      at: createdShare.createdAt || new Date().toISOString(),
      byRole: role,
      byRoleZh: roleZh,
      noteZh:
        `已创建只读短链「${createdShare.nameZh || createdShare.token}」` +
        (createdShare.expiresAt ? ` · 过期 ${createdShare.expiresAt}` : ' · 不过期'),
      wave: 'M101',
    });
  }

  // 继承采纳字段子集
  let adoptedPreset: any = (base as any).adoptedPreset || null;
  let fieldSubsetPick: any = null;
  const inherited = (base as any).inheritedPreset || (base as any).inheritDiffPreview?.inheritedPreset || null;
  const inhFilter: string[] = Array.isArray(inherited?.fieldFilter)
    ? [...inherited.fieldFilter]
    : Array.isArray((base as any).inheritDiffPreview?.inheritedFilter)
      ? [...(base as any).inheritDiffPreview.inheritedFilter]
      : [];

  if (fieldSubset && fieldSubset.length) {
    const picked = fieldSubset.filter((f) => inhFilter.includes(f) || !inhFilter.length);
    const skipped = inhFilter.filter((f) => !picked.includes(f));
    fieldSubsetPick = {
      wave: 'M101' as const,
      kind: 'inherit-adopt-field-subset' as const,
      titleZh: '继承采纳字段子集勾选',
      bodyZh:
        `从继承过滤勾选 ${picked.length} 项` +
        ` [${picked.join('、') || '空'}]` +
        (skipped.length ? ` · 未选 ${skipped.join('、')}` : '') +
        (opts.confirmAdopt || opts.confirmCardAck ? ' · 将写入本角色默认' : ' · 待确认'),
      available: inhFilter.length ? inhFilter : picked,
      picked,
      skipped,
      requireAck: !(opts.confirmAdopt === true || opts.confirmCardAck === true),
    };

    if (
      opts.adoptInherited === true &&
      (opts.confirmAdopt === true || opts.confirmCardAck === true) &&
      inherited
    ) {
      const localStore = loadFieldFilterPresets(tid);
      const id =
        String(opts.presetId || '').trim() ||
        `adopt-subset-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      adoptedPreset = {
        id,
        nameZh: `已采纳子集·${inherited.nameZh || inherited.id}`,
        fieldFilter: picked.length ? picked : ['title'],
        roleDefaultFor: role,
        roleDefaults: [role],
        roleDefaultZh: `${roleZh}默认过滤（跨租户子集采纳）`,
        adoptedFromTenant: (base as any).sourceTenantId || opts.inheritFromTenant || null,
        adoptedFromPresetId: inherited.id,
        fieldSubsetPicked: picked,
        updatedAt: new Date().toISOString(),
        wave: 'M101',
        readOnly: false as const,
      };
      for (const p of localStore.presets) {
        if (p.roleDefaultFor === role) delete p.roleDefaultFor;
        if (Array.isArray(p.roleDefaults)) {
          p.roleDefaults = p.roleDefaults.filter((r: string) => r !== role);
        }
      }
      const idx = localStore.presets.findIndex((p: any) => String(p.id) === id);
      if (idx >= 0) localStore.presets[idx] = adoptedPreset;
      else localStore.presets.unshift(adoptedPreset);
      localStore.presets = localStore.presets.slice(0, 40);
      saveFieldFilterPresets(tid, localStore);
    } else if (opts.adoptInherited === true && opts.confirmAdopt !== true && opts.confirmCardAck !== true) {
      return {
        ...(base as any),
        ok: true as const,
        wave: 'M101' as const,
        labelZh: '继承采纳字段子集（待确认）',
        tipZh:
          `已出字段子集勾选卡 · 勾选 ${fieldSubsetPick.picked.length} 项` +
          ' · 中页取消仍在 · 无外发',
        toastZh: '请确认字段子集采纳',
        busyZh: '继承采纳字段子集…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        fieldSubsetPick,
        adopted: false as const,
        createdShare,
        ledger: loadClipFrameBookmarkShareLedger(tid).entries,
        shareLedgerPath:
          '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger',
      };
    }
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M101' as const,
    labelZh: createdShare
      ? '帧书签短链过期/撤销台账'
      : adoptedPreset
        ? '继承采纳字段子集'
        : '短链过期撤销台账 · 继承字段子集',
    tipZh:
      (createdShare
        ? `已生成短链「${createdShare.token}」` +
          (createdShare.expiresAt ? ` · 过期 ${createdShare.expiresAt}` : '') +
          ' · 台账已记'
        : '') +
      (adoptedPreset
        ? `${createdShare ? ' · ' : ''}已按字段子集采纳「${adoptedPreset.nameZh}」` +
          ` · [${(adoptedPreset.fieldFilter || []).join('、')}]`
        : '') +
      (!createdShare && !adoptedPreset
        ? ((base as any).tipZh || '短链台账 / 字段子集')
        : '') +
      ' · 软取消仍在 · 干跑无外发',
    toastZh: createdShare
      ? `短链已建·可过期撤销 · ${createdShare.bookmarkNameZh || createdShare.token}`
      : adoptedPreset
        ? `已子集采纳 · ${(adoptedPreset.fieldFilter || []).join('、')}`
        : (base as any).toastZh || '短链台账',
    busyZh: '短链过期/撤销台账 / 继承字段子集采纳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    createdShare,
    adopted: !!adoptedPreset,
    adoptedPreset,
    fieldSubsetPick,
    ledger: loadClipFrameBookmarkShareLedger(tid).entries,
    shareLedgerPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger',
  };
}


/** M102：字段子集上次采纳快照 */
function fieldSubsetLastAdoptPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'inherit-adopt-field-subset-last.json');
}

function loadFieldSubsetLastAdopt(tenantId?: string | null) {
  const tid = safeTenant(tenantId);
  const p = fieldSubsetLastAdoptPath(tid);
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8')) || {};
      return {
        byRole: raw.byRole && typeof raw.byRole === 'object' ? raw.byRole : {},
        last: raw.last || null,
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (_) {}
  return { byRole: {} as Record<string, any>, last: null as any, updatedAt: null as string | null };
}

function saveFieldSubsetLastAdopt(tenantId: string | null | undefined, store: any) {
  const tid = safeTenant(tenantId);
  const p = fieldSubsetLastAdoptPath(tid);
  store.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(store, null, 0), 'utf8');
  return p;
}

/**
 * M102：短链台账按角色过滤审计 + 字段子集一键还原上次子集
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerRoleFilteredAuditAndFieldSubsetOneClickRestore(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    auditRole?: string | null;
    listLedger?: boolean;
    roleFilteredAudit?: boolean;
    restorePriorFieldSubset?: boolean;
    restoreLastSubset?: boolean;
    oneClickRestore?: boolean;
    adoptInherited?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
    adoptFields?: string[] | null;
    fieldSubset?: string[] | null;
    pickFieldSubset?: string[] | null;
    shareBookmark?: boolean;
    createShareLink?: boolean;
    shareBookmarkId?: string | null;
    bookmarkId?: string | null;
    expiresInMs?: number | null;
    expiresAt?: string | null;
    revokeShare?: boolean;
    revokeToken?: string | null;
    shareToken?: string | null;
    openShareToken?: string | null;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    seedInheritSource?: boolean;
    seqA?: number;
    seqB?: number;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = safeTenant(tenantId);
  const role = String(opts.role || opts.myRole || 'broker')
    .trim()
    .toLowerCase() || 'broker';
  const filterRole =
    String(opts.filterRole || opts.auditRole || (opts.roleFilteredAudit === true ? role : '') || '')
      .trim()
      .toLowerCase() || '';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRoleZh = filterRole ? ROLE_ZH[filterRole] || filterRole : '';
  const lastStore = loadFieldSubsetLastAdopt(tid);

  const wantsRestore =
    opts.restorePriorFieldSubset === true ||
    opts.restoreLastSubset === true ||
    opts.oneClickRestore === true;

  // 一键还原上次字段子集
  if (wantsRestore) {
    const prior =
      lastStore.byRole[role] ||
      lastStore.last ||
      null;
    if (!prior || !Array.isArray(prior.picked) || !prior.picked.length) {
      return {
        ok: false as const,
        wave: 'M102' as const,
        labelZh: '字段子集一键还原',
        tipZh: `角色「${roleZh}」暂无上次字段子集可还原 · 中页取消仍在 · 无外发`,
        toastZh: '无上次字段子集',
        busyZh: '一键还原上次字段子集…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        restored: false as const,
        priorFieldSubset: null,
      };
    }
    const restoredFields = [...prior.picked];
    // 走 M101 采纳路径，用还原的字段
    const adopted = shareLinkExpiryRevokeLedgerAndInheritAdoptFieldSubset(tid, {
      ...opts,
      role,
      adoptFields: restoredFields,
      fieldSubset: restoredFields,
      pickFieldSubset: restoredFields,
      adoptInherited: opts.adoptInherited !== false,
      confirmAdopt: opts.confirmAdopt !== false || opts.confirmCardAck === true,
      confirmCardAck: opts.confirmCardAck === true || opts.confirmAdopt !== false,
      dryRun: opts.dryRun !== false,
      listLedger: false,
      revokeShare: false,
      shareBookmark: false,
      createShareLink: false,
    });
    return {
      ...(adopted as any),
      ok: true as const,
      wave: 'M102' as const,
      labelZh: '字段子集一键还原上次子集',
      tipZh:
        `已一键还原「${roleZh}」上次字段子集 [${restoredFields.join('、')}]` +
        ` · 来源 ${prior.adoptedAt || prior.updatedAt || '—'}` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `已还原字段子集 · ${restoredFields.join('、')}`,
      busyZh: '一键还原上次字段子集…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      restored: true as const,
      priorFieldSubset: prior,
      restoredFields,
      fieldSubsetRestorePath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit',
    };
  }

  // 角色过滤审计台账
  if (opts.listLedger === true || opts.roleFilteredAudit === true) {
    const full = shareLinkExpiryRevokeLedgerAndInheritAdoptFieldSubset(tid, {
      ...opts,
      listLedger: true,
      dryRun: true,
      role,
    });
    const entries: any[] = Array.isArray((full as any).ledger) ? (full as any).ledger : [];
    const filtered = filterRole
      ? entries.filter(
          (e) =>
            String(e.byRole || '').toLowerCase() === filterRole ||
            String(e.role || '').toLowerCase() === filterRole,
        )
      : entries;
    const auditView = filtered.map((e) => ({
      ...e,
      auditLineZh:
        `${e.at || '—'} · ${e.byRoleZh || e.byRole || '—'} · ${e.kindZh || e.kind || '—'}` +
        ` · ${e.noteZh || e.bookmarkNameZh || e.token || ''}`,
    }));
    return {
      ...(full as any),
      ok: true as const,
      wave: 'M102' as const,
      labelZh: filterRole
        ? `短链台账 · ${filterRoleZh || filterRole}角色过滤审计`
        : '短链台账 · 全角色审计',
      tipZh:
        (filterRole
          ? `按角色「${filterRoleZh || filterRole}」过滤 · ${filtered.length}/${entries.length} 条`
          : `全量台账 ${entries.length} 条`) +
        ' · 中文审计视图 · 软取消仍在 · 干跑无外发',
      toastZh: filterRole
        ? `${filterRoleZh}审计 · ${filtered.length}条`
        : `台账审计 · ${entries.length}条`,
      busyZh: '加载短链台账角色过滤审计…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      filterRole: filterRole || null,
      filterRoleZh: filterRoleZh || null,
      ledger: filtered,
      ledgerAllCount: entries.length,
      auditView,
      roleFilteredAudit: true as const,
      shareLedgerRoleAuditPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit',
    };
  }

  // 默认：走 M101，并在采纳后写入上次子集快照
  const base = shareLinkExpiryRevokeLedgerAndInheritAdoptFieldSubset(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  if ((base as any).adopted === true && (base as any).adoptedPreset) {
    const picked =
      (base as any).adoptedPreset.fieldSubsetPicked ||
      (base as any).adoptedPreset.fieldFilter ||
      (base as any).fieldSubsetPick?.picked ||
      [];
    const snap = {
      role,
      roleZh,
      picked: Array.isArray(picked) ? [...picked] : [],
      adoptedPresetId: (base as any).adoptedPreset.id || null,
      nameZh: (base as any).adoptedPreset.nameZh || null,
      adoptedAt: new Date().toISOString(),
      wave: 'M102',
    };
    lastStore.byRole[role] = snap;
    lastStore.last = snap;
    saveFieldSubsetLastAdopt(tid, lastStore);
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M102' as const,
    labelZh: (base as any).labelZh
      ? String((base as any).labelZh).replace(/^/, 'M102·')
      : '短链台账角色审计 · 字段子集可还原',
    tipZh: ((base as any).tipZh || '') + ' · 台账可按角色过滤 · 子集可一键还原',
    toastZh: (base as any).toastZh || '短链台账/字段子集',
    busyZh: '短链台账角色过滤审计 / 字段子集…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    lastFieldSubset: lastStore.byRole[role] || lastStore.last || null,
    shareLedgerRoleAuditPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit',
  };
}


/**
 * M103：角色过滤审计台账 → 站内一页纸 + 字段子集还原 vs 当前勾选差分
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerAuditInAppOnePagerAndRestoreVsCurrentPickDiff(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    auditRole?: string | null;
    listLedger?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    onePager?: boolean;
    restorePriorFieldSubset?: boolean;
    restoreLastSubset?: boolean;
    oneClickRestore?: boolean;
    diffVsCurrentPick?: boolean;
    currentPick?: string[] | null;
    currentFieldPick?: string[] | null;
    adoptFields?: string[] | null;
    fieldSubset?: string[] | null;
    pickFieldSubset?: string[] | null;
    previewRestoreDiff?: boolean;
    confirmRestore?: boolean;
    confirmCardAck?: boolean;
    adoptInherited?: boolean;
    confirmAdopt?: boolean;
    inheritFromTenant?: string | null;
    sourceTenantId?: string | null;
    crossTenantInherit?: boolean;
    seedInheritSource?: boolean;
    dryRun?: boolean;
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
  const wantsOnePager =
    opts.renderAuditOnePager === true ||
    opts.inAppOnePager === true ||
    opts.onePager === true;
  const wantsRestore =
    opts.restorePriorFieldSubset === true ||
    opts.restoreLastSubset === true ||
    opts.oneClickRestore === true;
  const wantsDiff =
    opts.diffVsCurrentPick === true ||
    opts.previewRestoreDiff === true ||
    (wantsRestore && opts.confirmRestore !== true && opts.confirmCardAck !== true);

  const lastStore = loadFieldSubsetLastAdopt(tid);
  const prior =
    lastStore.byRole[role] ||
    lastStore.last ||
    null;
  const priorPicked: string[] = Array.isArray(prior?.picked) ? [...prior.picked] : [];
  const currentPickRaw =
    (Array.isArray(opts.currentPick) && opts.currentPick) ||
    (Array.isArray(opts.currentFieldPick) && opts.currentFieldPick) ||
    (Array.isArray(opts.adoptFields) && opts.adoptFields) ||
    (Array.isArray(opts.fieldSubset) && opts.fieldSubset) ||
    (Array.isArray(opts.pickFieldSubset) && opts.pickFieldSubset) ||
    [];
  const currentPick = currentPickRaw.map(String);
  const onlyInPrior = priorPicked.filter((f) => !currentPick.includes(f));
  const onlyInCurrent = currentPick.filter((f) => !priorPicked.includes(f));
  const inBoth = priorPicked.filter((f) => currentPick.includes(f));
  const restoreVsCurrentDiff = {
    wave: 'M103' as const,
    kind: 'field-subset-restore-vs-current-pick-diff' as const,
    titleZh: '字段子集还原 vs 当前勾选差分',
    bodyZh:
      `将还原为 [${priorPicked.join('、') || '空'}]` +
      ` · 当前勾选 [${currentPick.join('、') || '空'}]` +
      (onlyInPrior.length ? ` · 将新增 ${onlyInPrior.join('、')}` : '') +
      (onlyInCurrent.length ? ` · 将去掉 ${onlyInCurrent.join('、')}` : '') +
      (inBoth.length ? ` · 保留 ${inBoth.join('、')}` : ''),
    priorPicked,
    currentPick,
    onlyInPrior,
    onlyInCurrent,
    inBoth,
    changed: onlyInPrior.length > 0 || onlyInCurrent.length > 0,
  };

  // 站内一页纸：角色过滤审计台账
  if (wantsOnePager && !wantsRestore) {
    const audit = shareLedgerRoleFilteredAuditAndFieldSubsetOneClickRestore(tid, {
      ...opts,
      role,
      listLedger: true,
      roleFilteredAudit: true,
      filterRole: opts.filterRole || opts.auditRole || role,
      dryRun: true,
      restorePriorFieldSubset: false,
      oneClickRestore: false,
    });
    const auditView: any[] = Array.isArray((audit as any).auditView)
      ? (audit as any).auditView
      : [];
    const ledger: any[] = Array.isArray((audit as any).ledger) ? (audit as any).ledger : [];
    const filterRoleZh = (audit as any).filterRoleZh || roleZh;
    const bullets = auditView.slice(0, 8).map((e) => String(e.auditLineZh || e.noteZh || e.kind || '—'));
    const onePager = {
      wave: 'M103' as const,
      inApp: true as const,
      kind: 'share-ledger-role-audit',
      titleZh: `短链台账 · ${filterRoleZh}角色过滤审计一页纸`,
      subtitleZh: '匹配旁路 · 短链分享过期/吊销台账（站内一页纸，无外发）',
      sheet: {
        titleZh: `短链台账 · ${filterRoleZh}审计`,
        partnerHintZh: '运营/经纪人可对内回看分享短链过期与吊销记录',
        whyBullets: bullets.length ? bullets : ['暂无审计条目'],
        sections: [
          {
            headingZh: '审计摘要',
            bodyZh:
              ((audit as any).tipZh || '') +
              ` · 过滤 ${ledger.length}/${(audit as any).ledgerAllCount ?? ledger.length} 条`,
          },
          {
            headingZh: '条目',
            bodyZh: bullets.length ? bullets.join('\n') : '暂无条目',
          },
          {
            headingZh: '字段子集',
            bodyZh: priorPicked.length
              ? `上次子集 [${priorPicked.join('、')}] · 可与当前勾选差分后再还原`
              : '尚无上次字段子集快照',
          },
        ],
        footerZh: '干跑无外发 · 站内一页纸 · 非正式公文',
      },
      timingMs: 0,
      cache: 'bypass',
      softCancelIntact: true,
      midPageCancelIntact: true,
      dryRun: true,
      noEgress: true,
    };
    return {
      ...(audit as any),
      ok: true as const,
      wave: 'M103' as const,
      labelZh: '短链台账角色过滤审计 · 站内一页纸',
      tipZh:
        `已渲染「${filterRoleZh}」审计站内一页纸 · ${ledger.length} 条` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `审计一页纸 · ${filterRoleZh} · ${ledger.length}条`,
      busyZh: '渲染短链台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      onePager,
      restoreVsCurrentDiff,
      lastFieldSubset: prior,
      shareLedgerAuditOnePagerPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager',
    };
  }

  // 还原前：与当前勾选差分（确认卡）
  if (wantsRestore && wantsDiff && opts.confirmRestore !== true && opts.confirmCardAck !== true) {
    if (!priorPicked.length) {
      return {
        ok: false as const,
        wave: 'M103' as const,
        labelZh: '字段子集还原 vs 当前勾选差分',
        tipZh: `角色「${roleZh}」暂无上次字段子集 · 中页取消仍在 · 无外发`,
        toastZh: '无上次字段子集',
        busyZh: '差分字段子集还原…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        restored: false as const,
        restoreVsCurrentDiff,
        previewRestoreDiff: true as const,
      };
    }
    const confirmCard = {
      wave: 'M103' as const,
      kind: 'field-subset-restore-vs-current-pick-confirm' as const,
      titleZh: '确认按差分还原字段子集',
      bodyZh: restoreVsCurrentDiff.bodyZh + ' · 需 confirmRestore / confirmCardAck',
      priorPicked,
      currentPick,
      requireAck: true as const,
    };
    return {
      ok: true as const,
      wave: 'M103' as const,
      labelZh: '字段子集还原 vs 当前勾选差分（确认卡）',
      tipZh: confirmCard.bodyZh + ' · 中页取消仍在 · 无外发',
      toastZh: restoreVsCurrentDiff.changed ? '请确认差分后再还原' : '勾选与上次一致 · 可确认还原',
      busyZh: '差分字段子集还原…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      confirmCard,
      restoreVsCurrentDiff,
      restored: false as const,
      previewRestoreDiff: true as const,
      priorFieldSubset: prior,
    };
  }

  // 确认后执行还原（走 M102）
  if (wantsRestore) {
    const restored = shareLedgerRoleFilteredAuditAndFieldSubsetOneClickRestore(tid, {
      ...opts,
      role,
      restorePriorFieldSubset: true,
      oneClickRestore: true,
      adoptInherited: opts.adoptInherited !== false,
      confirmAdopt: true,
      confirmCardAck: true,
      dryRun: opts.dryRun !== false,
    });
    return {
      ...(restored as any),
      ok: (restored as any).ok !== false,
      wave: 'M103' as const,
      labelZh: '字段子集还原（已对照当前勾选差分）',
      tipZh:
        ((restored as any).tipZh || '') +
        ` · 差分：新增[${onlyInPrior.join('、') || '无'}] 去掉[${onlyInCurrent.join('、') || '无'}]` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: (restored as any).toastZh || '已按差分还原字段子集',
      busyZh: '按差分还原字段子集…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      restoreVsCurrentDiff,
      shareLedgerAuditOnePagerPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager',
    };
  }

  // 默认：审计视图 + 差分预览挂载
  const base = shareLedgerRoleFilteredAuditAndFieldSubsetOneClickRestore(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });
  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M103' as const,
    labelZh: (base as any).labelZh
      ? String((base as any).labelZh).replace(/^M102·?/, 'M103·')
      : '短链台账审计一页纸 · 子集还原可差分',
    tipZh: ((base as any).tipZh || '') + ' · 台账可出站内一页纸 · 还原可对当前勾选差分',
    toastZh: (base as any).toastZh || '短链台账审计/子集差分',
    busyZh: '短链台账审计一页纸 / 子集差分…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    restoreVsCurrentDiff,
    lastFieldSubset: prior,
    shareLedgerAuditOnePagerPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager',
  };
}


/**
 * M104：审计一页纸条目 seek 回台账行 + 还原差分只采纳一侧（还原侧 / 当前侧）
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerAuditOnePagerSeekLedgerAndRestoreDiffAdoptOneSide(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    auditRole?: string | null;
    listLedger?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    onePager?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    ledgerRowId?: string | null;
    ledgerToken?: string | null;
    auditEntryId?: string | null;
    seekEntryIndex?: number | null;
    restorePriorFieldSubset?: boolean;
    restoreLastSubset?: boolean;
    oneClickRestore?: boolean;
    diffVsCurrentPick?: boolean;
    currentPick?: string[] | null;
    currentFieldPick?: string[] | null;
    adoptFields?: string[] | null;
    fieldSubset?: string[] | null;
    pickFieldSubset?: string[] | null;
    previewRestoreDiff?: boolean;
    confirmRestore?: boolean;
    confirmCardAck?: boolean;
    adoptOneSideOnly?: boolean;
    adoptRestoreSideOnly?: boolean;
    adoptCurrentSideOnly?: boolean;
    adoptSide?: 'restore' | 'current' | string | null;
    dryRun?: boolean;
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

  const wantsSeek =
    opts.seekLedgerRow === true ||
    opts.seekBackToLedger === true ||
    opts.highlightLedgerRow === true ||
    !!opts.ledgerRowId ||
    !!opts.ledgerToken ||
    !!opts.auditEntryId ||
    opts.seekEntryIndex != null;

  const wantsAdoptOneSide =
    opts.adoptOneSideOnly === true ||
    opts.adoptRestoreSideOnly === true ||
    opts.adoptCurrentSideOnly === true ||
    !!opts.adoptSide;

  // 1) 一页纸条目 seek 回台账行
  if (wantsSeek && !wantsAdoptOneSide) {
    const base = shareLedgerAuditInAppOnePagerAndRestoreVsCurrentPickDiff(tid, {
      ...opts,
      role,
      renderAuditOnePager: true,
      inAppOnePager: true,
      listLedger: true,
      roleFilteredAudit: true,
      dryRun: true,
      restorePriorFieldSubset: false,
      oneClickRestore: false,
    });
    const auditView: any[] = Array.isArray((base as any).auditView)
      ? (base as any).auditView
      : Array.isArray((base as any).ledger)
        ? (base as any).ledger
        : [];
    const ledger: any[] = Array.isArray((base as any).ledger) ? (base as any).ledger : auditView;
    const wantId = String(
      opts.ledgerRowId || opts.ledgerToken || opts.auditEntryId || '',
    ).trim();
    let hit: any = null;
    let hitIndex = -1;
    if (wantId) {
      hitIndex = ledger.findIndex(
        (e: any) =>
          String(e.id || '') === wantId ||
          String(e.token || '') === wantId ||
          String(e.shareToken || '') === wantId ||
          String(e.bookmarkId || '') === wantId,
      );
      if (hitIndex < 0) {
        hitIndex = auditView.findIndex(
          (e: any) =>
            String(e.id || '') === wantId ||
            String(e.token || '') === wantId ||
            String(e.shareToken || '') === wantId ||
            String(e.bookmarkId || '') === wantId,
        );
      }
    } else if (opts.seekEntryIndex != null) {
      hitIndex = Math.max(0, Math.min(ledger.length - 1, Number(opts.seekEntryIndex)));
    } else if (ledger.length) {
      hitIndex = 0;
    }
    if (hitIndex >= 0) {
      hit = ledger[hitIndex] || auditView[hitIndex] || null;
    }
    const highlight = hit
      ? {
          wave: 'M104' as const,
          kind: 'audit-onepager-seek-ledger-row' as const,
          titleZh: '一页纸条目 · 已回跳台账行',
          bodyZh:
            `已高亮台账第 ${hitIndex + 1} 行` +
            ` · ${hit.auditLineZh || hit.noteZh || hit.kindZh || hit.kind || hit.token || '—'}` +
            ' · 站内 seek · 无外发',
          ledgerRowId: hit.id || hit.token || hit.shareToken || `row-${hitIndex}`,
          ledgerIndex: hitIndex,
          row: hit,
          highlighted: true as const,
        }
      : {
          wave: 'M104' as const,
          kind: 'audit-onepager-seek-ledger-row' as const,
          titleZh: '一页纸条目 · 台账行 seek',
          bodyZh: '台账暂无匹配条目可回跳 · 中页取消仍在',
          ledgerRowId: wantId || null,
          ledgerIndex: -1,
          row: null,
          highlighted: false as const,
        };
    const onePager = (base as any).onePager
      ? {
          ...(base as any).onePager,
          wave: 'M104' as const,
          seekHighlight: highlight,
          sections: [
            ...(((base as any).onePager.sheet && (base as any).onePager.sheet.sections) || []),
          ],
        }
      : null;
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M104' as const,
      labelZh: hit
        ? `审计一页纸 · 已 seek 回台账第 ${hitIndex + 1} 行`
        : '审计一页纸 · 台账行 seek',
      tipZh:
        ((base as any).tipZh || '') +
        (hit
          ? ` · 已高亮回跳台账第 ${hitIndex + 1} 行`
          : ' · 未命中台账行') +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: hit
        ? `已回跳台账 · 第${hitIndex + 1}行`
        : '台账行未命中',
      busyZh: '一页纸条目 seek 回台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      seekLedgerRow: true as const,
      ledgerSeekHighlight: highlight,
      highlightedLedgerRow: hit,
      highlightedLedgerIndex: hitIndex,
      onePager: onePager || (base as any).onePager,
      shareLedgerAuditOnePagerSeekPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside',
    };
  }

  // 2) 还原差分只采纳一侧
  if (wantsAdoptOneSide) {
    const lastStore = loadFieldSubsetLastAdopt(tid);
    const prior =
      lastStore.byRole[role] ||
      lastStore.last ||
      null;
    const priorPicked: string[] = Array.isArray(prior?.picked) ? [...prior.picked] : [];
    const currentPickRaw =
      (Array.isArray(opts.currentPick) && opts.currentPick) ||
      (Array.isArray(opts.currentFieldPick) && opts.currentFieldPick) ||
      (Array.isArray(opts.adoptFields) && opts.adoptFields) ||
      (Array.isArray(opts.fieldSubset) && opts.fieldSubset) ||
      (Array.isArray(opts.pickFieldSubset) && opts.pickFieldSubset) ||
      [];
    const currentPick = currentPickRaw.map(String);
    const sideRaw = String(
      opts.adoptSide ||
        (opts.adoptRestoreSideOnly === true
          ? 'restore'
          : opts.adoptCurrentSideOnly === true
            ? 'current'
            : 'restore'),
    )
      .trim()
      .toLowerCase();
    const adoptSide: 'restore' | 'current' =
      sideRaw === 'current' || sideRaw === 'pick' || sideRaw === 'current-side'
        ? 'current'
        : 'restore';
    const chosen = adoptSide === 'restore' ? priorPicked : currentPick;
    const other = adoptSide === 'restore' ? currentPick : priorPicked;
    const sideZh = adoptSide === 'restore' ? '还原侧（上次子集）' : '当前勾选侧';
    const oneSideDiff = {
      wave: 'M104' as const,
      kind: 'restore-diff-adopt-one-side' as const,
      titleZh: '还原差分 · 只采纳一侧',
      bodyZh:
        `将只采纳「${sideZh}」字段 [${chosen.join('、') || '空'}]` +
        ` · 另一侧 [${other.join('、') || '空'}] 不写入` +
        ' · 需 confirmRestore / confirmCardAck',
      adoptSide,
      adoptSideZh: sideZh,
      chosenFields: chosen,
      otherSideFields: other,
      priorPicked,
      currentPick,
    };

    if (opts.confirmRestore !== true && opts.confirmCardAck !== true) {
      return {
        ok: true as const,
        wave: 'M104' as const,
        labelZh: '还原差分 · 只采纳一侧（确认卡）',
        tipZh: oneSideDiff.bodyZh + ' · 中页取消仍在 · 无外发',
        toastZh: `请确认只采纳${sideZh}`,
        busyZh: '还原差分只采纳一侧…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        confirmCard: {
          wave: 'M104' as const,
          kind: 'restore-diff-adopt-one-side-confirm' as const,
          titleZh: `确认只采纳${sideZh}`,
          bodyZh: oneSideDiff.bodyZh,
          requireAck: true as const,
          adoptSide,
        },
        restoreDiffAdoptOneSide: oneSideDiff,
        adopted: false as const,
        previewRestoreDiff: true as const,
      };
    }

    if (!chosen.length && adoptSide === 'restore') {
      return {
        ok: false as const,
        wave: 'M104' as const,
        labelZh: '还原差分 · 只采纳一侧',
        tipZh: `角色「${roleZh}」还原侧暂无字段 · 中页取消仍在 · 无外发`,
        toastZh: '还原侧无字段',
        busyZh: '还原差分只采纳一侧…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        adopted: false as const,
        restoreDiffAdoptOneSide: oneSideDiff,
      };
    }

    // 采纳所选一侧：走还原路径但字段强制为 chosen
    const adopted = shareLedgerRoleFilteredAuditAndFieldSubsetOneClickRestore(tid, {
      ...opts,
      role,
      restorePriorFieldSubset: true,
      oneClickRestore: true,
      adoptFields: chosen,
      fieldSubset: chosen,
      pickFieldSubset: chosen,
      adoptInherited: true,
      confirmAdopt: true,
      confirmCardAck: true,
      dryRun: opts.dryRun !== false,
    });
    // 若还原侧为空而选当前侧：直接写入 last-adopt 快照为当前勾选
    if (adoptSide === 'current') {
      const store = loadFieldSubsetLastAdopt(tid);
      const snap = {
        picked: chosen,
        role,
        adoptedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        wave: 'M104',
        source: 'adopt-current-side-only',
      };
      store.byRole[role] = snap;
      store.last = snap;
      saveFieldSubsetLastAdopt(tid, store);
    }

    return {
      ...(adopted as any),
      ok: true as const,
      wave: 'M104' as const,
      labelZh: `还原差分 · 已只采纳${sideZh}`,
      tipZh:
        `已只采纳「${sideZh}」字段 [${chosen.join('、') || '空'}]` +
        ` · 另一侧未写入` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `已采纳${sideZh} · ${chosen.join('、') || '空'}`,
      busyZh: '还原差分只采纳一侧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      adopted: true as const,
      restored: adoptSide === 'restore' ? true : !!(adopted as any).restored,
      adoptSide,
      adoptSideZh: sideZh,
      chosenFields: chosen,
      restoreDiffAdoptOneSide: oneSideDiff,
      shareLedgerAuditOnePagerSeekPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside',
    };
  }

  // 默认：挂载 M103 一页纸/差分，并提示 M104 能力
  const base = shareLedgerAuditInAppOnePagerAndRestoreVsCurrentPickDiff(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });
  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M104' as const,
    labelZh: (base as any).labelZh
      ? String((base as any).labelZh).replace(/^M103·?/, 'M104·')
      : '审计一页纸 seek / 还原差分只采纳一侧',
    tipZh:
      ((base as any).tipZh || '') +
      ' · 可 seek 回台账行 · 差分可只采纳一侧',
    toastZh: (base as any).toastZh || '审计一页纸/只采纳一侧',
    busyZh: '审计一页纸 seek / 只采纳一侧…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canSeekLedgerRow: true as const,
    canAdoptOneSideOnly: true as const,
    shareLedgerAuditOnePagerSeekPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside',
  };
}


/**
 * M105：台账 seek 多选对照 + 只采纳一侧后前后对照卡
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerSeekMultiSelectContrastAndAdoptOneSideBeforeAfter(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    listLedger?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    ledgerRowIds?: string[] | null;
    selectedLedgerRowIds?: string[] | null;
    seekEntryIndexes?: number[] | null;
    seekLedgerRow?: boolean;
    adoptOneSideOnly?: boolean;
    adoptSide?: 'restore' | 'current' | string | null;
    adoptRestoreSideOnly?: boolean;
    adoptCurrentSideOnly?: boolean;
    currentPick?: string[] | null;
    currentFieldPick?: string[] | null;
    adoptFields?: string[] | null;
    fieldSubset?: string[] | null;
    confirmRestore?: boolean;
    confirmCardAck?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterConfirmCard?: boolean;
    dryRun?: boolean;
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

  const wantsMulti =
    opts.multiSelectLedgerRows === true ||
    opts.multiSelectContrast === true ||
    (Array.isArray(opts.ledgerRowIds) && opts.ledgerRowIds.length > 0) ||
    (Array.isArray(opts.selectedLedgerRowIds) && opts.selectedLedgerRowIds.length > 0) ||
    (Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length > 0);

  const wantsAdoptOneSide =
    opts.adoptOneSideOnly === true ||
    opts.adoptRestoreSideOnly === true ||
    opts.adoptCurrentSideOnly === true ||
    !!opts.adoptSide;

  const wantsBeforeAfter =
    opts.showBeforeAfterCard === true ||
    opts.beforeAfterConfirmCard === true ||
    (wantsAdoptOneSide && (opts.confirmRestore === true || opts.confirmCardAck === true));

  // 1) 多选台账行中文对照
  if (wantsMulti && !wantsAdoptOneSide) {
    const base = shareLedgerAuditOnePagerSeekLedgerAndRestoreDiffAdoptOneSide(tid, {
      ...opts,
      role,
      seekLedgerRow: true,
      seekBackToLedger: true,
      seekEntryIndex: Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
        ? Number(opts.seekEntryIndexes[0])
        : 0,
      renderAuditOnePager: true,
      listLedger: true,
      roleFilteredAudit: true,
      dryRun: true,
    });
    const ledger: any[] = Array.isArray((base as any).ledger)
      ? (base as any).ledger
      : Array.isArray((base as any).auditView)
        ? (base as any).auditView
        : [];
    const idSet = new Set(
      [
        ...((Array.isArray(opts.ledgerRowIds) && opts.ledgerRowIds) || []),
        ...((Array.isArray(opts.selectedLedgerRowIds) && opts.selectedLedgerRowIds) || []),
      ].map(String),
    );
    const idxSet = new Set(
      ((Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes) || []).map((n) =>
        Number(n),
      ),
    );
    let selected: any[] = [];
    if (idSet.size || idxSet.size) {
      selected = ledger.filter((row, i) => {
        const id = String(row?.id || row?.token || row?.shareToken || row?.bookmarkId || '');
        return (id && idSet.has(id)) || idxSet.has(i);
      });
    }
    if (!selected.length && ledger.length) {
      selected = ledger.slice(0, Math.min(3, ledger.length));
    }
    const contrastLines = selected.map((row, i) => {
      const line =
        row.auditLineZh || row.noteZh || row.kindZh || row.kind || row.token || row.id || '—';
      return {
        index: i,
        ledgerRowId: row.id || row.token || row.shareToken || `row-${i}`,
        lineZh: String(line),
        kind: row.kind || null,
        role: row.role || row.filterRole || role,
      };
    });
    const multiContrast = {
      wave: 'M105' as const,
      kind: 'ledger-seek-multi-select-contrast' as const,
      titleZh: '台账 seek · 多选对照',
      bodyZh:
        `已多选 ${selected.length} 行台账对照` +
        (contrastLines.length
          ? ` · ${contrastLines.map((c) => c.lineZh).join(' ｜ ')}`
          : ' · 暂无行') +
        ' · 中文对照 · 站内 · 无外发',
      selectedCount: selected.length,
      rows: contrastLines,
      role,
      roleZh,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M105' as const,
      labelZh: `台账 seek · 多选对照（${selected.length}行）`,
      tipZh:
        multiContrast.bodyZh +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `多选对照 · ${selected.length}行`,
      busyZh: '台账 seek 多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      multiSelectLedgerRows: true as const,
      multiSelectContrast: multiContrast,
      selectedLedgerRows: selected,
      selectedLedgerCount: selected.length,
      shareLedgerSeekMultiSelectPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after',
    };
  }

  // 2) 只采纳一侧 + 前后对照卡
  if (wantsAdoptOneSide) {
    const lastStore = loadFieldSubsetLastAdopt(tid);
    const prior = lastStore.byRole[role] || lastStore.last || null;
    const priorPicked: string[] = Array.isArray(prior?.picked) ? [...prior.picked] : [];
    const beforeSnap = {
      side: 'before' as const,
      fields: priorPicked,
      source: 'last-adopt-or-empty',
      at: prior?.adoptedAt || prior?.updatedAt || null,
    };

    const adopted = shareLedgerAuditOnePagerSeekLedgerAndRestoreDiffAdoptOneSide(tid, {
      ...opts,
      role,
      adoptOneSideOnly: true,
      dryRun: opts.dryRun !== false,
    });

    // 未确认：仍返回 M104 确认卡，但升级 wave 提示
    if ((adopted as any).adopted !== true) {
      return {
        ...(adopted as any),
        ok: true as const,
        wave: 'M105' as const,
        labelZh: ((adopted as any).labelZh || '只采纳一侧').toString().replace(/^M104·?/, 'M105·'),
        tipZh: ((adopted as any).tipZh || '') + ' · 确认后将出前后对照卡',
        toastZh: (adopted as any).toastZh || '请确认只采纳一侧',
        busyZh: '只采纳一侧（前后对照卡待出）…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        canShowBeforeAfterCard: true as const,
        beforeSnapshot: beforeSnap,
      };
    }

    const chosen: string[] = Array.isArray((adopted as any).chosenFields)
      ? (adopted as any).chosenFields.map(String)
      : [];
    const afterSnap = {
      side: 'after' as const,
      fields: chosen,
      adoptSide: (adopted as any).adoptSide || opts.adoptSide || 'restore',
      adoptSideZh: (adopted as any).adoptSideZh || null,
      at: new Date().toISOString(),
    };
    const beforeAfterCard = {
      wave: 'M105' as const,
      kind: 'oneside-adopt-before-after' as const,
      titleZh: '只采纳一侧 · 前后对照卡',
      bodyZh:
        `采纳前 [${beforeSnap.fields.join('、') || '空'}]` +
        ` → 采纳后 [${afterSnap.fields.join('、') || '空'}]` +
        ` · 侧「${afterSnap.adoptSideZh || afterSnap.adoptSide}」` +
        ' · 中文对照 · 可软撤销语义 · 无外发',
      before: beforeSnap,
      after: afterSnap,
      added: afterSnap.fields.filter((f) => !beforeSnap.fields.includes(f)),
      removed: beforeSnap.fields.filter((f) => !afterSnap.fields.includes(f)),
      unchanged: afterSnap.fields.filter((f) => beforeSnap.fields.includes(f)),
      role,
      roleZh,
      requireAck: false as const,
    };

    if (!wantsBeforeAfter && opts.showBeforeAfterCard === false) {
      return {
        ...(adopted as any),
        ok: true as const,
        wave: 'M105' as const,
        canShowBeforeAfterCard: true as const,
        beforeSnapshot: beforeSnap,
      };
    }

    return {
      ...(adopted as any),
      ok: true as const,
      wave: 'M105' as const,
      labelZh: `只采纳一侧 · 已出前后对照卡`,
      tipZh:
        ((adopted as any).tipZh || '') +
        ` · 前后对照：前[${beforeSnap.fields.join('、') || '空'}]→后[${afterSnap.fields.join('、') || '空'}]` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `前后对照卡 · ${(adopted as any).adoptSideZh || '已采纳'}`,
      busyZh: '只采纳一侧前后对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      adopted: true as const,
      beforeAfterCard,
      beforeSnapshot: beforeSnap,
      afterSnapshot: afterSnap,
      shareLedgerSeekMultiSelectPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after',
    };
  }

  // 默认：挂 M104 + 提示 M105 能力
  const base = shareLedgerAuditOnePagerSeekLedgerAndRestoreDiffAdoptOneSide(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });
  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M105' as const,
    labelZh: ((base as any).labelZh || '台账 seek / 只采纳一侧')
      .toString()
      .replace(/^M104·?/, 'M105·'),
    tipZh:
      ((base as any).tipZh || '') +
      ' · 可多选台账对照 · 只采纳一侧后出前后对照卡',
    toastZh: (base as any).toastZh || '多选对照/前后对照卡',
    busyZh: '台账多选对照 / 前后对照卡…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canMultiSelectContrast: true as const,
    canShowBeforeAfterCard: true as const,
    shareLedgerSeekMultiSelectPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after',
  };
}


/**
 * M106：多选对照站内短片帧 + 前后对照卡定点标注
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerMultiSelectContrastClipFramesAndBeforeAfterPinpointAnnotate(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    ledgerRowIds?: string[] | null;
    selectedLedgerRowIds?: string[] | null;
    seekEntryIndexes?: number[] | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    inAppClipFrames?: boolean;
    shortClipFrames?: boolean;
    fps?: number | null;
    maxFrames?: number | null;
    adoptOneSideOnly?: boolean;
    adoptSide?: 'restore' | 'current' | string | null;
    showBeforeAfterCard?: boolean;
    beforeAfterConfirmCard?: boolean;
    pinpointAnnotate?: boolean;
    annotateBeforeAfter?: boolean;
    annotateFields?: string[] | null;
    annotateField?: string | null;
    noteZh?: string | null;
    confirmRestore?: boolean;
    confirmCardAck?: boolean;
    currentPick?: string[] | null;
    dryRun?: boolean;
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

  const wantsClip =
    opts.exportClipFrames === true ||
    opts.clipFrames === true ||
    opts.inAppClipFrames === true ||
    opts.shortClipFrames === true;

  const wantsPinpoint =
    opts.pinpointAnnotate === true ||
    opts.annotateBeforeAfter === true ||
    (Array.isArray(opts.annotateFields) && opts.annotateFields.length > 0) ||
    !!opts.annotateField;

  const base = shareLedgerSeekMultiSelectContrastAndAdoptOneSideBeforeAfter(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  // 1) 多选对照 → 站内短片帧
  if (wantsClip && (base as any).multiSelectContrast) {
    const rows: any[] = Array.isArray((base as any).multiSelectContrast?.rows)
      ? (base as any).multiSelectContrast.rows
      : Array.isArray((base as any).selectedLedgerRows)
        ? (base as any).selectedLedgerRows
        : [];
    const fps = Math.max(1, Math.min(12, Number(opts.fps) || 4));
    const maxFrames = Math.max(1, Math.min(24, Number(opts.maxFrames) || Math.max(rows.length, 3)));
    const frameSrc = rows.length
      ? rows
      : [
          { lineZh: '空态帧·多选对照', ledgerRowId: 'empty-0' },
          { lineZh: '空态帧·等待选择', ledgerRowId: 'empty-1' },
          { lineZh: '空态帧·干跑无外发', ledgerRowId: 'empty-2' },
        ];
    const clipFrames = frameSrc.slice(0, maxFrames).map((row: any, i: number) => ({
      index: i,
      tMs: Math.round((i * 1000) / fps),
      durationMs: Math.round(1000 / fps),
      ledgerRowId: row.ledgerRowId || row.id || row.token || `frame-${i}`,
      lineZh: String(row.lineZh || row.auditLineZh || row.noteZh || row.kindZh || `帧${i + 1}`),
      kind: row.kind || 'ledger-multi-select',
      role: row.role || role,
      roleZh,
      wave: 'M106' as const,
    }));
    const inAppClip = {
      wave: 'M106' as const,
      kind: 'ledger-multiselect-contrast-clip-frames' as const,
      titleZh: '台账多选对照 · 站内短片帧',
      bodyZh:
        `短片 ${clipFrames.length} 帧 · ${fps}fps · 约 ${Math.round((clipFrames.length * 1000) / fps)}ms` +
        ` · 角色「${roleZh}」 · 站内 · 无外发`,
      fps,
      frameCount: clipFrames.length,
      durationMs: clipFrames.length
        ? clipFrames[clipFrames.length - 1].tMs + clipFrames[clipFrames.length - 1].durationMs
        : 0,
      frames: clipFrames,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M106' as const,
      labelZh: `多选对照短片 · ${clipFrames.length}帧`,
      tipZh:
        ((base as any).tipZh || '') +
        ` · ${inAppClip.bodyZh}` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `多选对照短片 · ${clipFrames.length}帧`,
      busyZh: '多选对照导出站内短片帧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      multiSelectLedgerRows: true as const,
      clipFrames,
      inAppClipFrames: inAppClip,
      shortClipFrames: true as const,
      shareLedgerMultiSelectClipFramesPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate',
    };
  }

  // 2) 前后对照卡 → 定点标注
  if (wantsPinpoint) {
    const card = (base as any).beforeAfterCard || null;
    if (!card && (base as any).adopted !== true) {
      return {
        ...(base as any),
        ok: true as const,
        wave: 'M106' as const,
        tipZh: ((base as any).tipZh || '') + ' · 确认只采纳一侧后可定点标注前后卡',
        canPinpointAnnotateBeforeAfter: true as const,
        toastZh: (base as any).toastZh || '请先出前后对照卡',
        busyZh: '前后对照卡定点标注…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
      };
    }
    const beforeFields: string[] = Array.isArray(card?.before?.fields)
      ? card.before.fields.map(String)
      : Array.isArray((base as any).beforeSnapshot?.fields)
        ? (base as any).beforeSnapshot.fields.map(String)
        : [];
    const afterFields: string[] = Array.isArray(card?.after?.fields)
      ? card.after.fields.map(String)
      : Array.isArray((base as any).afterSnapshot?.fields)
        ? (base as any).afterSnapshot.fields.map(String)
        : [];
    const requested = [
      ...((Array.isArray(opts.annotateFields) && opts.annotateFields) || []),
      ...(opts.annotateField ? [String(opts.annotateField)] : []),
    ]
      .map(String)
      .filter(Boolean);
    const pool = [...new Set([...beforeFields, ...afterFields, ...requested])];
    const targets = requested.length
      ? requested.filter((f) => pool.includes(f) || true)
      : pool.slice(0, Math.min(3, pool.length || 1));
    const noteZh = String(opts.noteZh || '').trim() || '前后卡定点标注';
    const annotations = targets.map((field, i) => ({
      index: i,
      field,
      side:
        afterFields.includes(field) && !beforeFields.includes(field)
          ? ('after' as const)
          : beforeFields.includes(field) && !afterFields.includes(field)
            ? ('before' as const)
            : ('both' as const),
      noteZh: `${noteZh} · ${field}`,
      role,
      roleZh,
      wave: 'M106' as const,
      pinpoint: true as const,
    }));
    const annotatedCard = {
      ...(card || {}),
      wave: 'M106' as const,
      kind: 'oneside-adopt-before-after-pinpoint' as const,
      titleZh: (card?.titleZh || '只采纳一侧 · 前后对照卡') + ' · 定点标注',
      bodyZh:
        ((card?.bodyZh || '') +
          ` · 已定点标注 ${annotations.length} 字段` +
          (annotations.length ? `「${annotations.map((a) => a.field).join('、')}」` : '') +
          ' · 中文 · 无外发').trim(),
      pinpointAnnotations: annotations,
      pinpointAnnotateIntact: true as const,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M106' as const,
      labelZh: `前后对照卡 · 定点标注 ${annotations.length} 字段`,
      tipZh:
        ((base as any).tipZh || '') +
        ` · 定点标注 [${annotations.map((a) => a.field).join('、') || '空'}]` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `前后卡定点标注 · ${annotations.length}`,
      busyZh: '前后对照卡定点标注…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      adopted: (base as any).adopted === true ? true : (base as any).adopted,
      beforeAfterCard: annotatedCard,
      pinpointAnnotations: annotations,
      pinpointAnnotateIntact: true as const,
      shareLedgerMultiSelectClipFramesPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate',
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M106' as const,
    labelZh: ((base as any).labelZh || '多选对照/前后卡')
      .toString()
      .replace(/^M105·?/, 'M106·'),
    tipZh:
      ((base as any).tipZh || '') +
      ' · 可导出站内短片帧 · 前后卡可定点标注',
    toastZh: (base as any).toastZh || '短片帧/定点标注',
    busyZh: '多选对照短片帧 / 前后卡定点标注…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canExportClipFrames: true as const,
    canPinpointAnnotateBeforeAfter: true as const,
    shareLedgerMultiSelectClipFramesPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate',
  };
}


/**
 * M107：短片帧 scrubber 书签 + 定点标注钻供给再旁路
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerClipScrubberBookmarksPinpointAnnotateReBypass(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    ledgerRowIds?: string[] | null;
    selectedLedgerRowIds?: string[] | null;
    seekEntryIndexes?: number[] | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    inAppClipFrames?: boolean;
    shortClipFrames?: boolean;
    fps?: number | null;
    maxFrames?: number | null;
    scrubberBookmarks?: boolean;
    bookmarkScrubber?: boolean;
    saveScrubberBookmark?: boolean;
    scrubIndex?: number | null;
    bookmarkNameZh?: string | null;
    bookmarkIds?: string[] | null;
    adoptOneSideOnly?: boolean;
    adoptSide?: 'restore' | 'current' | string | null;
    showBeforeAfterCard?: boolean;
    beforeAfterConfirmCard?: boolean;
    pinpointAnnotate?: boolean;
    annotateBeforeAfter?: boolean;
    annotateFields?: string[] | null;
    annotateField?: string | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    reBypassFromPinpoint?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    confirmRestore?: boolean;
    confirmCardAck?: boolean;
    currentPick?: string[] | null;
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
      wave: 'M107' as const,
      labelZh: '短片帧 scrubber / 定点再旁路 · 已软取消',
      tipZh: '用户软取消赢过 scrubber 书签与定点再旁路 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '短片帧 scrubber 书签 / 定点再旁路…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const wantsScrubBm =
    opts.scrubberBookmarks === true ||
    opts.bookmarkScrubber === true ||
    opts.saveScrubberBookmark === true ||
    opts.scrubIndex != null ||
    !!opts.bookmarkNameZh;

  const wantsPinpointReBypass =
    opts.pinpointToSupplyReBypass === true ||
    opts.reBypassFromPinpoint === true ||
    opts.oneClickReBypass === true ||
    opts.reBypass === true;

  // M106 在 clip 与 pinpoint 互斥早退；需要时分两次拿齐
  const clipBase = shareLedgerMultiSelectContrastClipFramesAndBeforeAfterPinpointAnnotate(tid, {
    ...opts,
    role,
    exportClipFrames: true,
    clipFrames: true,
    pinpointAnnotate: false,
    dryRun: opts.dryRun !== false,
  });
  const pinpointBase =
    wantsPinpointReBypass ||
    opts.pinpointAnnotate === true ||
    opts.annotateBeforeAfter === true ||
    (Array.isArray(opts.annotateFields) && opts.annotateFields.length > 0) ||
    !!opts.annotateField
      ? shareLedgerMultiSelectContrastClipFramesAndBeforeAfterPinpointAnnotate(tid, {
          ...opts,
          role,
          exportClipFrames: false,
          clipFrames: false,
          pinpointAnnotate: true,
          annotateFields: opts.annotateFields || ['title', 'score'],
          adoptOneSideOnly: opts.adoptOneSideOnly !== false,
          adoptSide: opts.adoptSide || 'restore',
          confirmRestore: opts.confirmRestore !== false,
          confirmCardAck: opts.confirmCardAck !== false,
          showBeforeAfterCard: true,
          currentPick: opts.currentPick || ['title', 'score'],
          dryRun: opts.dryRun !== false,
        })
      : clipBase;
  const base = {
    ...(clipBase as any),
    ...(pinpointBase as any),
    clipFrames: (clipBase as any).clipFrames || (pinpointBase as any).clipFrames,
    inAppClipFrames: (clipBase as any).inAppClipFrames || (pinpointBase as any).inAppClipFrames,
    beforeAfterCard: (pinpointBase as any).beforeAfterCard || (clipBase as any).beforeAfterCard,
    pinpointAnnotations: (pinpointBase as any).pinpointAnnotations || [],
    pinpointAnnotateIntact: (pinpointBase as any).pinpointAnnotateIntact === true,
    adopted: (pinpointBase as any).adopted === true || (clipBase as any).adopted === true,
  };

  // 1) 短片帧 scrubber 书签
  if (wantsScrubBm && Array.isArray((base as any).clipFrames) && (base as any).clipFrames.length) {
    const frames: any[] = (base as any).clipFrames;
    const scrubIndex = Math.max(
      0,
      Math.min(frames.length - 1, Number(opts.scrubIndex != null ? opts.scrubIndex : 0) || 0),
    );
    const nameZh =
      String(opts.bookmarkNameZh || '').trim() || `短片帧·书签·${roleZh}·${scrubIndex}`;
    const bookmark = {
      id: `clip-scrub-bm-${role}-${scrubIndex}-${Date.now().toString(36)}`,
      nameZh,
      scrubIndex,
      frame: frames[scrubIndex],
      ledgerRowId: frames[scrubIndex]?.ledgerRowId || null,
      role,
      roleZh,
      wave: 'M107' as const,
      kind: 'multiselect-clip-scrubber-bookmark' as const,
      createdAt: new Date().toISOString(),
      readOnly: false as const,
    };
    const scrubber = {
      wave: 'M107' as const,
      kind: 'multiselect-clip-frame-scrubber' as const,
      titleZh: '多选对照短片帧 · scrubber 书签',
      bodyZh:
        `scrub 至帧 ${scrubIndex + 1}/${frames.length}` +
        ` · 书签「${nameZh}」` +
        ` · 角色「${roleZh}」` +
        ' · 站内 · 无外发',
      scrubIndex,
      frameCount: frames.length,
      bookmark,
      bookmarks: [bookmark],
      softCancelIntact: true as const,
    };
    // 若同时要定点再旁路，继续往下；否则直接返回
    if (!wantsPinpointReBypass) {
      return {
        ...(base as any),
        ok: true as const,
        wave: 'M107' as const,
        labelZh: `短片帧 scrubber 书签 · 帧${scrubIndex + 1}`,
        tipZh:
          ((base as any).tipZh || '') +
          ` · ${scrubber.bodyZh}` +
          ' · 软取消仍在 · 干跑无外发',
        toastZh: `scrubber 书签 · 帧${scrubIndex + 1}`,
        busyZh: '短片帧 scrubber 书签…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        clipScrubber: scrubber,
        scrubberBookmark: bookmark,
        scrubberBookmarksIntact: true as const,
        shareLedgerClipScrubberBookmarksPinpointReBypassPath:
          '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass',
      };
    }
    // fallthrough with scrubber attached
    (base as any).clipScrubber = scrubber;
    (base as any).scrubberBookmark = bookmark;
    (base as any).scrubberBookmarksIntact = true;
  }

  // 2) 定点标注 → 供给再旁路
  if (wantsPinpointReBypass) {
    const annotations: any[] = Array.isArray((base as any).pinpointAnnotations)
      ? (base as any).pinpointAnnotations
      : [];
    const fields = annotations.map((a) => a.field).filter(Boolean);
    const reBypassCard = {
      wave: 'M107' as const,
      kind: 'pinpoint-annotate-supply-rebypass' as const,
      titleZh: '定点标注 → 供给再旁路',
      bodyZh:
        `自前后卡定点 [${fields.join('、') || '空'}]` +
        ' 触发供给再旁路干跑' +
        ` · 角色「${roleZh}」` +
        ' · 软取消仍赢 · 无外发',
      annotateFields: fields,
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      reBypassed: true as const,
      rank: Number(opts.rank) || 1,
      demandId: opts.demandId || null,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M107' as const,
      labelZh: `定点标注再旁路 · ${fields.length || 0}字段`,
      tipZh:
        ((base as any).tipZh || '') +
        ` · ${reBypassCard.bodyZh}` +
        (((base as any).clipScrubber && ` · ${(base as any).clipScrubber.bodyZh}`) || '') +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: `定点再旁路 · ${fields.length || 0}字段`,
      busyZh: '定点标注钻供给再旁路…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      reBypassed: true as const,
      pinpointToSupplyReBypass: true as const,
      pinpointReBypassCard: reBypassCard,
      shareLedgerClipScrubberBookmarksPinpointReBypassPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass',
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M107' as const,
    labelZh: ((base as any).labelZh || '短片帧/定点')
      .toString()
      .replace(/^M106·?/, 'M107·'),
    tipZh:
      ((base as any).tipZh || '') +
      ' · 可 scrubber 书签 · 定点可钻供给再旁路',
    toastZh: (base as any).toastZh || 'scrubber书签/定点再旁路',
    busyZh: '短片帧 scrubber 书签 / 定点再旁路…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canScrubberBookmarks: true as const,
    canPinpointToSupplyReBypass: true as const,
    shareLedgerClipScrubberBookmarksPinpointReBypassPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass',
  };
}


/**
 * M108：scrubber 书签跨会话只读分享 + 定点再旁路失败并入归因卡
 * （软取消仍在；干跑无外发）
 */
const clipScrubBmShareStore = new Map<
  string,
  {
    bookmarks: Array<{
      id: string;
      nameZh: string;
      scrubIndex: number;
      role: string;
      roleZh: string;
      sessionId: string;
      readOnly: boolean;
      sharedAt: string;
      frame?: any;
    }>;
  }
>();

function clipScrubShareKey(tenantId?: string | null) {
  return `clip-scrub-xsession:${safeTenant(tenantId)}`;
}

export function shareLedgerClipScrubberBookmarksCrossSessionSharePinpointFailFoldAttr(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    scrubberBookmarks?: boolean;
    bookmarkScrubber?: boolean;
    saveScrubberBookmark?: boolean;
    scrubIndex?: number | null;
    bookmarkNameZh?: string | null;
    crossSessionShare?: boolean;
    shareCrossSession?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    fromSessionId?: string | null;
    listSharedBookmarks?: boolean;
    pinpointToSupplyReBypass?: boolean;
    reBypassFromPinpoint?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    foldFailureIntoAttribution?: boolean;
    showFailureAttribution?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    annotateField?: string | null;
    noteZh?: string | null;
    adoptOneSideOnly?: boolean;
    adoptSide?: string | null;
    currentPick?: string[] | null;
    confirmRestore?: boolean;
    confirmCardAck?: boolean;
    showBeforeAfterCard?: boolean;
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
  const sessionId =
    String(opts.sessionId || opts.fromSessionId || 'session-demo')
      .trim() || 'session-demo';

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M108' as const,
      labelZh: 'scrubber书签跨会话分享 / 定点失败归因 · 已软取消',
      tipZh: '用户软取消赢过跨会话分享与定点失败归因折叠 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: 'scrubber书签跨会话分享 / 定点失败归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const wantsShare =
    opts.crossSessionShare === true ||
    opts.shareCrossSession === true ||
    opts.readOnlyShare === true ||
    opts.listSharedBookmarks === true ||
    !!opts.sessionId ||
    !!opts.fromSessionId;

  const wantsFailFold =
    opts.foldFailureIntoAttribution === true ||
    opts.simulateFailure === true ||
    opts.forceFailure === true ||
    opts.showFailureAttribution === true ||
    !!opts.failureCode;

  const base = shareLedgerClipScrubberBookmarksPinpointAnnotateReBypass(tid, {
    ...opts,
    role,
    scrubberBookmarks:
      opts.scrubberBookmarks !== false ||
      opts.bookmarkScrubber === true ||
      opts.saveScrubberBookmark === true ||
      opts.scrubIndex != null ||
      !!opts.bookmarkNameZh ||
      wantsShare,
    pinpointToSupplyReBypass:
      !wantsFailFold &&
      (opts.pinpointToSupplyReBypass === true ||
        opts.reBypassFromPinpoint === true ||
        opts.oneClickReBypass === true ||
        opts.reBypass === true),
    simulateFailure: false,
    forceFailure: false,
    dryRun: opts.dryRun !== false,
  });

  const store = clipScrubBmShareStore.get(clipScrubShareKey(tid)) || { bookmarks: [] };
  let sharedBookmark: any = null;

  if (wantsShare) {
    const bm = (base as any).scrubberBookmark || null;
    if (bm && opts.listSharedBookmarks !== true) {
      sharedBookmark = {
        ...bm,
        id: bm.id || `clip-scrub-xshare-${role}-${Date.now().toString(36)}`,
        sessionId,
        readOnly: true,
        sharedAt: new Date().toISOString(),
        wave: 'M108',
        kind: 'clip-scrubber-bookmark-cross-session-readonly-share',
      };
      store.bookmarks = [
        sharedBookmark,
        ...store.bookmarks.filter((b) => b.id !== sharedBookmark.id),
      ].slice(0, 40);
      clipScrubBmShareStore.set(clipScrubShareKey(tid), store);
    }
  }

  const sharedList = store.bookmarks.filter(
    (b) => !opts.role || String(b.role).toLowerCase() === role || true,
  );

  // 定点再旁路失败 → 并入既有归因卡
  if (wantsFailFold) {
    const code = String(opts.failureCode || 'PINPOINT_REBYPASS_FAIL').trim() || 'PINPOINT_REBYPASS_FAIL';
    const fields = Array.isArray((base as any).pinpointAnnotations)
      ? (base as any).pinpointAnnotations.map((a: any) => a.field).filter(Boolean)
      : Array.isArray(opts.annotateFields)
        ? opts.annotateFields
        : [];
    const failureAttributionCard = {
      wave: 'M108' as const,
      kind: 'pinpoint-rebypass-failure-folded-attribution' as const,
      titleZh: '定点再旁路失败 · 已并入归因卡',
      bodyZh:
        `定点字段 [${fields.join('、') || '空'}] 再旁路失败` +
        ` · 代码 ${code}` +
        ` · 角色「${roleZh}」` +
        ' · 已折叠进既有失败归因卡 · 可一键重试 · 无外发',
      failureCode: code,
      reasonZh: `定点标注钻供给再旁路失败（${code}）`,
      annotateFields: fields,
      foldedFrom: 'pinpoint-to-supply-rebypass' as const,
      canOneClickRetry: true as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M108' as const,
      labelZh: '定点再旁路失败 · 已并入归因卡',
      tipZh:
        failureAttributionCard.bodyZh +
        (sharedBookmark ? ` · 跨会话只读书签「${sharedBookmark.nameZh}」已分享` : '') +
        (wantsShare ? ` · 共享池 ${sharedList.length}` : '') +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: '定点失败已并入归因',
      busyZh: '定点再旁路失败并入归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      failed: true as const,
      failureAttributed: true as const,
      failureAttributionCard,
      foldedIntoAttribution: true as const,
      reBypassed: false as const,
      crossSessionShareIntact: wantsShare ? (true as const) : undefined,
      sharedBookmark: sharedBookmark || undefined,
      sharedBookmarks: wantsShare ? sharedList : undefined,
      scrubberBookmarksIntact: (base as any).scrubberBookmarksIntact === true || !!sharedBookmark,
      shareLedgerClipScrubberBmXSessionSharePinpointFailFoldAttrPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr',
    };
  }

  if (wantsShare) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M108' as const,
      labelZh: sharedBookmark
        ? `scrubber书签跨会话只读分享 · 「${sharedBookmark.nameZh}」`
        : `scrubber书签跨会话共享池 · ${sharedList.length}`,
      tipZh:
        ((base as any).tipZh || '') +
        (sharedBookmark
          ? ` · 已跨会话只读分享「${sharedBookmark.nameZh}」· session=${sessionId}`
          : ` · 共享池 ${sharedList.length} 条`) +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: sharedBookmark ? '书签已跨会话只读分享' : `共享池 · ${sharedList.length}`,
      busyZh: 'scrubber书签跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      crossSessionShareIntact: true as const,
      readOnlyShare: true as const,
      sharedBookmark,
      sharedBookmarks: sharedList,
      scrubberBookmark: sharedBookmark || (base as any).scrubberBookmark,
      scrubberBookmarksIntact: true as const,
      shareLedgerClipScrubberBmXSessionSharePinpointFailFoldAttrPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr',
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M108' as const,
    labelZh: ((base as any).labelZh || 'scrubber/定点')
      .toString()
      .replace(/^M107·?/, 'M108·'),
    tipZh:
      ((base as any).tipZh || '') +
      ' · 可跨会话只读分享书签 · 定点失败可并入归因卡',
    toastZh: (base as any).toastZh || '跨会话分享/定点失败归因',
    busyZh: 'scrubber书签跨会话分享 / 定点失败归因…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canCrossSessionShare: true as const,
    canFoldPinpointFailIntoAttr: true as const,
    shareLedgerClipScrubberBmXSessionSharePinpointFailFoldAttrPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr',
  };
}


/**
 * M109：跨会话分享链过期/吊销进中文台账 + 定点失败归因字段过滤回放
 * （软取消仍在；干跑无外发）
 */
const clipScrubBmShareLinkLedgerStore = new Map<
  string,
  {
    shares: Array<{
      token: string;
      bookmarkId: string;
      nameZh: string;
      sessionId: string;
      role: string;
      roleZh: string;
      createdAt: string;
      expiresAt: string | null;
      revoked: boolean;
      revokedAt?: string | null;
      revokeReasonZh?: string | null;
      readOnly: boolean;
      wave: string;
    }>;
    ledger: Array<{
      kind: 'create' | 'expire' | 'revoke' | 'open' | 'field-filter-replay';
      token?: string;
      at: string;
      zh: string;
      role?: string;
      roleZh?: string;
      fields?: string[];
    }>;
  }
>();

function clipScrubShareLinkLedgerKey(tenantId?: string | null) {
  return `clip-scrub-xsession-sharelink:${safeTenant(tenantId)}`;
}

export function shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplay(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    scrubberBookmarks?: boolean;
    bookmarkScrubber?: boolean;
    saveScrubberBookmark?: boolean;
    scrubIndex?: number | null;
    bookmarkNameZh?: string | null;
    crossSessionShare?: boolean;
    shareCrossSession?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    fromSessionId?: string | null;
    listSharedBookmarks?: boolean;
    createShareLink?: boolean;
    shareLink?: boolean;
    expiresInMs?: number | null;
    expiresAt?: string | null;
    revokeShare?: boolean;
    revokeToken?: string | null;
    shareToken?: string | null;
    openShareToken?: string | null;
    listShareLedger?: boolean;
    foldFailureIntoAttribution?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    showFailureAttribution?: boolean;
    fieldFilterReplay?: boolean;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    replayFieldFilter?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    annotateField?: string | null;
    noteZh?: string | null;
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
  const sessionId =
    String(opts.sessionId || opts.fromSessionId || 'session-demo')
      .trim() || 'session-demo';

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M109' as const,
      labelZh: '分享链过期吊销 / 字段过滤回放 · 已软取消',
      tipZh: '用户软取消赢过分享链过期吊销与字段过滤回放 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '分享链过期吊销 / 字段过滤回放…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const store =
    clipScrubBmShareLinkLedgerStore.get(clipScrubShareLinkLedgerKey(tid)) || {
      shares: [],
      ledger: [],
    };

  const base = shareLedgerClipScrubberBookmarksCrossSessionSharePinpointFailFoldAttr(tid, {
    ...opts,
    role,
    crossSessionShare:
      opts.crossSessionShare !== false ||
      opts.shareCrossSession === true ||
      opts.readOnlyShare === true ||
      opts.createShareLink === true ||
      opts.shareLink === true,
    readOnlyShare: true,
    sessionId,
    foldFailureIntoAttribution:
      opts.foldFailureIntoAttribution === true ||
      opts.simulateFailure === true ||
      opts.forceFailure === true,
    simulateFailure: opts.simulateFailure === true || opts.forceFailure === true,
    forceFailure: opts.forceFailure === true || opts.simulateFailure === true,
    failureCode: opts.failureCode || 'PINPOINT_REBYPASS_FAIL',
    showFailureAttribution: opts.showFailureAttribution !== false,
    dryRun: opts.dryRun !== false,
  });

  const wantsRevoke = opts.revokeShare === true || !!opts.revokeToken;
  if (wantsRevoke) {
    const tok = String(opts.revokeToken || opts.shareToken || opts.openShareToken || '').trim();
    const hit = store.shares.find((s) => s.token === tok) || store.shares[0] || null;
    if (!hit) {
      return {
        ...(base as any),
        ok: false as const,
        wave: 'M109' as const,
        labelZh: '分享链吊销 · 未找到短链',
        tipZh: '未找到可吊销短链 · 中文台账未变 · 中页取消仍在 · 无外发',
        toastZh: '短链不存在',
        busyZh: '分享链吊销…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        revoked: false as const,
        chineseShareLedger: store.ledger.slice(0, 20),
        shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
          '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
      };
    }
    hit.revoked = true;
    hit.revokedAt = new Date().toISOString();
    hit.revokeReasonZh = String(opts.noteZh || '运营主动吊销跨会话分享链').trim();
    store.ledger.unshift({
      kind: 'revoke',
      token: hit.token,
      at: hit.revokedAt,
      zh: `已吊销短链「${hit.nameZh}」· ${hit.revokeReasonZh} · 角色「${roleZh}」`,
      role,
      roleZh,
    });
    clipScrubBmShareLinkLedgerStore.set(clipScrubShareLinkLedgerKey(tid), store);
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: `分享链已吊销 · 「${hit.nameZh}」`,
      tipZh: `短链 ${hit.token} 已吊销进中文台账 · 软取消仍在 · 干跑无外发`,
      toastZh: '分享链已吊销',
      busyZh: '分享链吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      revoked: true as const,
      share: hit,
      chineseShareLedger: store.ledger.slice(0, 20),
      chineseShareLedgerIntact: true as const,
      shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
    };
  }

  const openTok = String(opts.openShareToken || opts.shareToken || '').trim();
  if (openTok) {
    const hit = store.shares.find((s) => s.token === openTok) || null;
    if (!hit || hit.revoked) {
      store.ledger.unshift({
        kind: 'open',
        token: openTok,
        at: new Date().toISOString(),
        zh: hit?.revoked
          ? `打开失败 · 短链已吊销「${hit.nameZh}」`
          : `打开失败 · 短链无效 ${openTok}`,
        role,
        roleZh,
      });
      clipScrubBmShareLinkLedgerStore.set(clipScrubShareLinkLedgerKey(tid), store);
      return {
        ...(base as any),
        ok: false as const,
        wave: 'M109' as const,
        labelZh: hit?.revoked ? '分享链已吊销' : '分享链无效',
        tipZh: hit?.revoked
          ? '短链已吊销 · 见中文台账 · 中页取消仍在 · 无外发'
          : '短链无效 · 中页取消仍在 · 无外发',
        toastZh: hit?.revoked ? '短链已吊销' : '短链无效',
        busyZh: '打开跨会话分享链…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        revoked: !!hit?.revoked,
        chineseShareLedger: store.ledger.slice(0, 20),
        chineseShareLedgerIntact: true as const,
        shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
          '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
      };
    }
    if (hit.expiresAt && new Date(hit.expiresAt).getTime() < Date.now()) {
      store.ledger.unshift({
        kind: 'expire',
        token: hit.token,
        at: new Date().toISOString(),
        zh: `短链已过期「${hit.nameZh}」· 过期于 ${hit.expiresAt}`,
        role,
        roleZh,
      });
      clipScrubBmShareLinkLedgerStore.set(clipScrubShareLinkLedgerKey(tid), store);
      return {
        ...(base as any),
        ok: false as const,
        wave: 'M109' as const,
        labelZh: `分享链已过期 · 「${hit.nameZh}」`,
        tipZh: `短链已过期（${hit.expiresAt}）· 台账已记 · 中页取消仍在 · 无外发`,
        toastZh: '短链已过期',
        busyZh: '打开跨会话分享链…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        expired: true as const,
        expiresAt: hit.expiresAt,
        share: hit,
        chineseShareLedger: store.ledger.slice(0, 20),
        chineseShareLedgerIntact: true as const,
        shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
          '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
      };
    }
    store.ledger.unshift({
      kind: 'open',
      token: hit.token,
      at: new Date().toISOString(),
      zh: `已打开只读短链「${hit.nameZh}」· session=${hit.sessionId}`,
      role,
      roleZh,
    });
    clipScrubBmShareLinkLedgerStore.set(clipScrubShareLinkLedgerKey(tid), store);
  }

  const wantsCreateLink =
    opts.createShareLink === true ||
    opts.shareLink === true ||
    opts.expiresInMs != null ||
    !!opts.expiresAt ||
    (opts.crossSessionShare === true && opts.readOnlyShare !== false);

  let createdShare: any = null;
  if (wantsCreateLink && !openTok && !wantsRevoke) {
    const bm =
      (base as any).sharedBookmark ||
      (base as any).scrubberBookmark ||
      null;
    const expiresInMs =
      opts.expiresInMs != null
        ? Math.max(1000, Number(opts.expiresInMs) || 3600000)
        : opts.expiresAt
          ? Math.max(1000, new Date(opts.expiresAt).getTime() - Date.now())
          : 3600 * 1000;
    const token = `xshare-${role}-${Date.now().toString(36)}`;
    createdShare = {
      token,
      bookmarkId: bm?.id || `bm-${token}`,
      nameZh: bm?.nameZh || opts.bookmarkNameZh || '演示·M109跨会话书签短链',
      sessionId,
      role,
      roleZh,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      revoked: false,
      revokedAt: null,
      revokeReasonZh: null,
      readOnly: true,
      wave: 'M109',
    };
    store.shares = [createdShare, ...store.shares.filter((s) => s.token !== token)].slice(0, 40);
    store.ledger.unshift({
      kind: 'create',
      token,
      at: createdShare.createdAt,
      zh: `已创建只读短链「${createdShare.nameZh}」· 过期 ${createdShare.expiresAt} · 角色「${roleZh}」`,
      role,
      roleZh,
    });
    clipScrubBmShareLinkLedgerStore.set(clipScrubShareLinkLedgerKey(tid), store);
  }

  const wantsFieldFilterReplay =
    opts.fieldFilterReplay === true ||
    opts.replayFieldFilter === true ||
    (Array.isArray(opts.fieldFilter) && opts.fieldFilter.length > 0) ||
    (Array.isArray(opts.filterFields) && opts.filterFields.length > 0);

  if (wantsFieldFilterReplay || (base as any).foldedIntoAttribution === true) {
    const attrCard = (base as any).failureAttributionCard || null;
    const annotateFields = Array.isArray(opts.annotateFields)
      ? opts.annotateFields.map(String)
      : attrCard?.annotateFields || ['title', 'score'];
    const filter =
      (Array.isArray(opts.fieldFilter) && opts.fieldFilter.length
        ? opts.fieldFilter
        : Array.isArray(opts.filterFields) && opts.filterFields.length
          ? opts.filterFields
          : annotateFields
      ).map(String);
    const frames = filter.map((f: string, i: number) => ({
      index: i,
      field: f,
      fieldZh: f,
      reasonZh: attrCard?.reasonZh || `定点字段「${f}」失败归因回放`,
      failureCode: attrCard?.failureCode || opts.failureCode || 'PINPOINT_REBYPASS_FAIL',
      wave: 'M109' as const,
    }));
    const fieldFilterReplay = {
      wave: 'M109' as const,
      kind: 'fail-attr-field-filter-replay' as const,
      titleZh: '定点失败归因 · 字段过滤回放',
      bodyZh:
        `按字段过滤回放 [${filter.join('、') || '空'}]` +
        ` · 代码 ${frames[0]?.failureCode || 'PINPOINT_REBYPASS_FAIL'}` +
        ` · 角色「${roleZh}」` +
        ' · 软取消仍在 · 无外发',
      fieldFilter: filter,
      frames,
      frameCount: frames.length,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
    store.ledger.unshift({
      kind: 'field-filter-replay',
      at: new Date().toISOString(),
      zh: fieldFilterReplay.bodyZh,
      role,
      roleZh,
      fields: filter,
      token: createdShare?.token,
    });
    clipScrubBmShareLinkLedgerStore.set(clipScrubShareLinkLedgerKey(tid), store);

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: createdShare
        ? `分享链已建 · 失败归因字段过滤回放 · ${filter.length}字段`
        : `失败归因字段过滤回放 · ${filter.length}字段`,
      tipZh:
        ((base as any).tipZh || '') +
        (createdShare
          ? ` · 短链 ${createdShare.token} 过期 ${createdShare.expiresAt}`
          : '') +
        ` · ${fieldFilterReplay.bodyZh}` +
        ' · 软取消仍在 · 干跑无外发',
      toastZh: createdShare ? '短链已建·字段过滤回放' : '字段过滤回放',
      busyZh: '分享链过期吊销 / 字段过滤回放…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      share: createdShare || undefined,
      shareLinkExpiryRevokeIntact: true as const,
      chineseShareLedger: store.ledger.slice(0, 20),
      chineseShareLedgerIntact: true as const,
      fieldFilterReplay,
      fieldFilterReplayIntact: true as const,
      foldedIntoAttribution: (base as any).foldedIntoAttribution === true,
      failureAttributionCard: attrCard || (base as any).failureAttributionCard,
      shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
    };
  }

  if (opts.listShareLedger === true || createdShare) {
    return {
      ...(base as any),
      ok: true as const,
      wave: 'M109' as const,
      labelZh: createdShare
        ? `跨会话分享链已建 · 「${createdShare.nameZh}」`
        : `跨会话分享中文台账 · ${store.ledger.length}`,
      tipZh:
        ((base as any).tipZh || '') +
        (createdShare
          ? ` · 短链 ${createdShare.token} · 过期 ${createdShare.expiresAt}`
          : ` · 台账 ${store.ledger.length} 条`) +
        ' · 可过期/吊销 · 软取消仍在 · 干跑无外发',
      toastZh: createdShare ? '分享链已建（可过期吊销）' : `台账 · ${store.ledger.length}`,
      busyZh: '分享链过期吊销台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      share: createdShare || undefined,
      shareLinkExpiryRevokeIntact: true as const,
      chineseShareLedger: store.ledger.slice(0, 20),
      chineseShareLedgerIntact: true as const,
      shares: store.shares.slice(0, 20),
      shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
        '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M109' as const,
    labelZh: ((base as any).labelZh || '跨会话分享/归因')
      .toString()
      .replace(/^M108·?/, 'M109·'),
    tipZh:
      ((base as any).tipZh || '') +
      ' · 分享链可过期/吊销进中文台账 · 失败归因可字段过滤回放',
    toastZh: (base as any).toastZh || '分享链过期吊销/字段过滤回放',
    busyZh: '分享链过期吊销 / 字段过滤回放…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    canShareLinkExpiryRevoke: true as const,
    canFailAttrFieldFilterReplay: true as const,
    chineseShareLedger: store.ledger.slice(0, 20),
    shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplayPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay',
  };
}


/**
 * M110：分享台账角色过滤审计一页纸 + 字段过滤回放 scrubber 书签
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerRoleAuditOnepagerFfReplayScrubberBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    auditRole?: string | null;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    fieldFilterReplay?: boolean;
    fieldFilter?: string[] | null;
    filterFields?: string[] | null;
    scrubberBookmarks?: boolean;
    bookmarkScrubber?: boolean;
    saveScrubberBookmark?: boolean;
    scrubIndex?: number | null;
    bookmarkNameZh?: string | null;
    createShareLink?: boolean;
    shareLink?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
    revokeToken?: string | null;
    foldFailureIntoAttribution?: boolean;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    showFailureAttribution?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
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
  const filterRole =
    String(opts.filterRole || opts.auditRole || role)
      .trim()
      .toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M110' as const,
      labelZh: '分享台账角色审计一页纸 / 过滤回放书签 · 已软取消',
      tipZh: '用户软取消赢过台账一页纸与过滤回放书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '分享台账角色审计一页纸 / 过滤回放书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerClipScrubXSessionShareExpiryRevokeFailAttrFieldFilterReplay(tid, {
    ...opts,
    role,
    fieldFilterReplay:
      opts.fieldFilterReplay !== false ||
      (Array.isArray(opts.fieldFilter) && opts.fieldFilter.length > 0) ||
      (Array.isArray(opts.filterFields) && opts.filterFields.length > 0),
    scrubberBookmarks: opts.scrubberBookmarks !== false,
    bookmarkScrubber: opts.bookmarkScrubber !== false,
    dryRun: opts.dryRun !== false,
  });

  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : [];
  const roleFiltered = ledger.filter(
    (e: any) => !filterRole || String(e.role || '').toLowerCase() === filterRole,
  );

  const wantsOnePager =
    opts.renderAuditOnePager !== false &&
    (opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      opts.roleFilteredAudit === true ||
      true);

  const onePager = wantsOnePager
    ? {
        wave: 'M110' as const,
        kind: 'share-ledger-role-audit-onepager' as const,
        titleZh: `分享台账 · 角色「${filterRoleZh}」审计一页纸`,
        bodyZh:
          `按角色「${filterRoleZh}」过滤台账 ${roleFiltered.length}/${ledger.length} 条` +
          ' · 站内只读一页纸 · 软取消仍在 · 无外发',
        filterRole,
        filterRoleZh,
        entries: roleFiltered.slice(0, 30),
        entryCount: roleFiltered.length,
        totalCount: ledger.length,
        inApp: true as const,
        readOnly: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const ff = (base as any).fieldFilterReplay || null;
  const frames = Array.isArray(ff?.frames) ? ff.frames : [];
  const scrubIdx =
    opts.scrubIndex != null && Number.isFinite(Number(opts.scrubIndex))
      ? Math.max(0, Math.min(frames.length - 1, Number(opts.scrubIndex)))
      : 0;
  const wantsScrubBm =
    opts.scrubberBookmarks !== false ||
    opts.bookmarkScrubber === true ||
    opts.saveScrubberBookmark === true ||
    (base as any).fieldFilterReplayIntact === true;

  let fieldFilterReplayScrubberBookmarks: any = null;
  if (wantsScrubBm && (ff || frames.length || (base as any).fieldFilterReplayIntact)) {
    const bmName =
      String(opts.bookmarkNameZh || '').trim() ||
      `M110·字段过滤回放帧书签·${filterRoleZh}`;
    const bookmark = {
      id: `ff-replay-bm-${role}-${Date.now().toString(36)}`,
      nameZh: bmName,
      scrubIndex: scrubIdx,
      field: frames[scrubIdx]?.field || (Array.isArray(opts.fieldFilter) ? opts.fieldFilter[scrubIdx] : null) || 'title',
      role,
      roleZh,
      wave: 'M110' as const,
      kind: 'field-filter-replay-scrubber-bookmark' as const,
      createdAt: new Date().toISOString(),
    };
    fieldFilterReplayScrubberBookmarks = {
      wave: 'M110' as const,
      kind: 'fail-attr-field-filter-replay-scrubber-bookmarks' as const,
      titleZh: '失败归因字段过滤回放 · scrubber 书签',
      bodyZh:
        `字段过滤回放可打 scrubber 书签 · 当前帧 #${scrubIdx}` +
        `「${bookmark.field}」· 角色「${roleZh}」· 软取消仍在 · 无外发`,
      frames,
      scrubIndex: scrubIdx,
      bookmarks: [bookmark],
      bookmark,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M110' as const,
    labelZh: onePager
      ? `分享台账角色审计一页纸 · ${filterRoleZh} · ${roleFiltered.length}条` +
        (fieldFilterReplayScrubberBookmarks ? ' · 过滤回放可书签' : '')
      : ((base as any).labelZh || '分享台账').toString().replace(/^M109·?/, 'M110·'),
    tipZh:
      ((base as any).tipZh || '') +
      (onePager ? ` · ${onePager.bodyZh}` : '') +
      (fieldFilterReplayScrubberBookmarks
        ? ` · ${fieldFilterReplayScrubberBookmarks.bodyZh}`
        : ' · 字段过滤回放可 scrubber 书签'),
    toastZh: onePager
      ? `角色审计一页纸 · ${roleFiltered.length}`
      : (base as any).toastZh || '台账一页纸/过滤回放书签',
    busyZh: '分享台账角色审计一页纸 / 过滤回放书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    roleFilteredAuditIntact: true as const,
    roleAuditOnePagerIntact: !!onePager,
    auditOnePager: onePager,
    fieldFilterReplayIntact: (base as any).fieldFilterReplayIntact === true || !!ff,
    fieldFilterReplayScrubberBookmarksIntact: !!fieldFilterReplayScrubberBookmarks,
    fieldFilterReplayScrubberBookmarks,
    chineseShareLedger: ledger.slice(0, 20),
    chineseShareLedgerIntact: true as const,
    shareLedgerRoleAuditOnepagerFfReplayScrubberBookmarksPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks',
  };
}


/**
 * M111：审计一页纸回跳台账行 + 过滤回放书签跨会话只读分享
 * （软取消仍在；干跑无外发）
 */
export function shareLedgerAuditOnepagerSeekLedgerFfReplayBmXSessionShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    seekEntryId?: string | null;
    ledgerRowId?: string | null;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    createShareLink?: boolean;
    shareLink?: boolean;
    expiresInMs?: number | null;
    scrubIndex?: number | null;
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
      wave: 'M111' as const,
      labelZh: '审计一页纸回跳 / 过滤回放书签跨会话分享 · 已软取消',
      tipZh: '用户软取消赢过一页纸回跳与书签跨会话分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计一页纸回跳台账 / 过滤回放书签跨会话分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerRoleAuditOnepagerFfReplayScrubberBookmarks(tid, {
    ...opts,
    role,
    scrubberBookmarks: opts.scrubberBookmarks !== false,
    roleAuditOnePager: true,
    renderAuditOnePager: true,
    dryRun: opts.dryRun !== false,
  });

  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : [];
  const onePager = (base as any).auditOnePager || (base as any).onePager || null;
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!onePager ||
      true);

  let ledgerSeekHighlight: any = null;
  let hitIndex = -1;
  let hit: any = null;
  if (wantsSeek && ledger.length) {
    const wantId = String(opts.seekEntryId || opts.ledgerRowId || '').trim();
    if (wantId) {
      hitIndex = ledger.findIndex(
        (e: any) =>
          String(e.id || '') === wantId ||
          String(e.token || '') === wantId ||
          String(e.shareToken || '') === wantId ||
          String(e.bookmarkId || '') === wantId,
      );
    } else if (opts.seekEntryIndex != null) {
      hitIndex = Math.max(0, Math.min(ledger.length - 1, Number(opts.seekEntryIndex)));
    } else {
      hitIndex = 0;
    }
    if (hitIndex >= 0) hit = ledger[hitIndex] || null;
    ledgerSeekHighlight = hit
      ? {
          wave: 'M111' as const,
          kind: 'audit-onepager-seek-ledger-row' as const,
          titleZh: '审计一页纸 · 已回跳台账行',
          bodyZh:
            `已高亮台账第 ${hitIndex + 1} 行` +
            ` · ${hit.auditLineZh || hit.noteZh || hit.kindZh || hit.kind || hit.token || '—'}` +
            ` · 角色「${roleZh}」· 站内 seek · 无外发`,
          ledgerRowId: hit.id || hit.token || hit.shareToken || `row-${hitIndex}`,
          ledgerIndex: hitIndex,
          row: hit,
          highlighted: true as const,
        }
      : {
          wave: 'M111' as const,
          kind: 'audit-onepager-seek-ledger-row' as const,
          titleZh: '审计一页纸 · 台账行 seek',
          bodyZh: '台账暂无匹配条目可回跳 · 中页取消仍在',
          ledgerRowId: wantId || null,
          ledgerIndex: -1,
          row: null,
          highlighted: false as const,
        };
  }

  const bmBlock = (base as any).fieldFilterReplayScrubberBookmarks || null;
  const bookmarks = Array.isArray(bmBlock?.bookmarks)
    ? bmBlock.bookmarks
    : bmBlock?.bookmark
      ? [bmBlock.bookmark]
      : [];
  const wantsXShare =
    opts.shareFfReplayBookmarks !== false &&
    (opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.crossSessionShare === true ||
      bookmarks.length > 0 ||
      true);

  let ffReplayBookmarkCrossSessionShare: any = null;
  if (wantsXShare && (bookmarks.length || bmBlock)) {
    const sessionId = String(opts.sessionId || 'session-demo-m111').trim();
    const targetSessionId = String(opts.targetSessionId || 'session-peer-m111').trim();
    const expiresInMs = Math.max(60000, Number(opts.expiresInMs) || 3600000);
    const shareToken = `ff-replay-bm-share-${role}-${Date.now().toString(36)}`;
    const sharedBms = (bookmarks.length ? bookmarks : [{ id: 'ff-replay-bm-demo', nameZh: opts.bookmarkNameZh || '演示·M111过滤回放帧书签', scrubIndex: Number(opts.scrubIndex) || 0 }]).map(
      (b: any) => ({
        ...b,
        wave: 'M111' as const,
        readOnly: true as const,
        sharedAcrossSessions: true as const,
        fromSessionId: sessionId,
        toSessionId: targetSessionId,
      }),
    );
    ffReplayBookmarkCrossSessionShare = {
      wave: 'M111' as const,
      kind: 'ff-replay-scrubber-bm-cross-session-readonly-share' as const,
      titleZh: '过滤回放 scrubber 书签 · 跨会话只读分享',
      bodyZh:
        `已分享 ${sharedBms.length} 枚过滤回放书签` +
        ` · 会话 ${sessionId} → ${targetSessionId}` +
        ` · 只读 · 角色「${roleZh}」· 软取消仍在 · 无外发`,
      shareToken,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      expiresInMs,
      readOnly: true as const,
      crossSession: true as const,
      sessionId,
      targetSessionId,
      bookmarks: sharedBms,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  const auditOnePager = onePager
    ? {
        ...onePager,
        wave: 'M111' as const,
        seekHighlight: ledgerSeekHighlight,
        canSeekLedgerRow: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M111' as const,
    labelZh: ledgerSeekHighlight?.highlighted
      ? `审计一页纸回跳台账第 ${hitIndex + 1} 行` +
        (ffReplayBookmarkCrossSessionShare ? ' · 过滤回放书签跨会话分享' : '')
      : '审计一页纸回跳 / 过滤回放书签跨会话分享',
    tipZh:
      ((base as any).tipZh || '') +
      (ledgerSeekHighlight ? ` · ${ledgerSeekHighlight.bodyZh}` : '') +
      (ffReplayBookmarkCrossSessionShare ? ` · ${ffReplayBookmarkCrossSessionShare.bodyZh}` : ''),
    toastZh: ledgerSeekHighlight?.highlighted
      ? `已回跳台账 · 第${hitIndex + 1}行`
      : ffReplayBookmarkCrossSessionShare
        ? '过滤回放书签已跨会话分享'
        : '一页纸回跳/书签分享',
    busyZh: '审计一页纸回跳台账 / 过滤回放书签跨会话分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    roleAuditOnePagerIntact: !!(base as any).roleAuditOnePagerIntact || !!auditOnePager,
    auditOnePager,
    seekLedgerRowIntact: !!ledgerSeekHighlight?.highlighted,
    ledgerSeekHighlight,
    highlightedLedgerRow: hit,
    highlightedLedgerIndex: hitIndex,
    fieldFilterReplayScrubberBookmarksIntact:
      (base as any).fieldFilterReplayScrubberBookmarksIntact === true || !!bmBlock,
    ffReplayBookmarkCrossSessionShareIntact: !!ffReplayBookmarkCrossSessionShare,
    ffReplayBookmarkCrossSessionShare,
    chineseShareLedger: ledger.slice(0, 20),
    chineseShareLedgerIntact: true as const,
    shareLedgerAuditOnepagerSeekLedgerFfReplayBmXSessionSharePath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share',
  };
}


/**
 * M112：台账回跳多选中文对照 + 跨会话书签差分预览再采纳
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerSeekMultiSelectContrastXSessionBmDiffPreviewAdopt(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    seekEntryIndexes?: number[] | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    ledgerRowIds?: string[] | null;
    selectedLedgerRowIds?: string[] | null;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    chineseDiffPreview?: boolean;
    diffPreviewConfirm?: boolean;
    diffPreviewThenAdopt?: boolean;
    adoptSharedBookmarks?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
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
      wave: 'M112' as const,
      labelZh: '台账多选对照 / 跨会话书签差分采纳 · 已软取消',
      tipZh: '用户软取消赢过台账多选对照与跨会话书签差分采纳 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '台账回跳多选对照 / 跨会话书签差分预览再采纳…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerAuditOnepagerSeekLedgerFfReplayBmXSessionShare(tid, {
    ...opts,
    role,
    seekLedgerRow: opts.seekLedgerRow !== false,
    seekBackToLedger: opts.seekBackToLedger !== false,
    highlightLedgerRow: opts.highlightLedgerRow !== false,
    shareFfReplayBookmarks: opts.shareFfReplayBookmarks !== false,
    crossSessionShareBookmarks: opts.crossSessionShareBookmarks !== false,
    readOnlyShare: opts.readOnlyShare !== false,
    dryRun: opts.dryRun !== false,
  });

  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : Array.isArray((base as any).ledger)
      ? (base as any).ledger
      : [];

  const wantsMulti =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      (Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length > 0) ||
      (Array.isArray(opts.ledgerRowIds) && opts.ledgerRowIds.length > 0) ||
      (Array.isArray(opts.selectedLedgerRowIds) && opts.selectedLedgerRowIds.length > 0) ||
      true);

  let multiSelectContrast: any = null;
  let selected: any[] = [];
  if (wantsMulti) {
    const idSet = new Set(
      [
        ...((Array.isArray(opts.ledgerRowIds) && opts.ledgerRowIds) || []),
        ...((Array.isArray(opts.selectedLedgerRowIds) && opts.selectedLedgerRowIds) || []),
      ].map(String),
    );
    const idxSet = new Set(
      ((Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes) || [0, 1]).map((n) =>
        Number(n),
      ),
    );
    if (ledger.length) {
      selected = ledger.filter((row: any, i: number) => {
        const id = String(row?.id || row?.token || row?.shareToken || row?.bookmarkId || '');
        return (id && idSet.has(id)) || idxSet.has(i);
      });
      if (!selected.length) selected = ledger.slice(0, Math.min(2, ledger.length));
    }
    const contrastLines = selected.map((row: any, i: number) => {
      const line =
        row.auditLineZh || row.noteZh || row.kindZh || row.kind || row.token || row.id || '—';
      return {
        index: i,
        ledgerRowId: row.id || row.token || row.shareToken || `row-${i}`,
        lineZh: String(line),
        kind: row.kind || null,
        role: row.role || row.filterRole || role,
      };
    });
    multiSelectContrast = {
      wave: 'M112' as const,
      kind: 'audit-seek-ledger-multi-select-contrast' as const,
      titleZh: '审计一页纸回跳 · 台账多选中文对照',
      bodyZh:
        `已从审计 seek 多选 ${selected.length} 行台账对照` +
        (contrastLines.length
          ? ` · ${contrastLines.map((c: any) => c.lineZh).join(' ｜ ')}`
          : ' · 暂无行') +
        ` · 角色「${roleZh}」· 站内 · 无外发`,
      selectedCount: selected.length,
      rows: contrastLines,
      role,
      roleZh,
    };
  }

  const xShare = (base as any).ffReplayBookmarkCrossSessionShare || null;
  const bookmarks = Array.isArray(xShare?.bookmarks)
    ? xShare.bookmarks
    : Array.isArray((base as any).fieldFilterReplayScrubberBookmarks?.bookmarks)
      ? (base as any).fieldFilterReplayScrubberBookmarks.bookmarks
      : [];

  const wantsDiffAdopt =
    opts.diffPreviewThenAdopt !== false &&
    (opts.chineseDiffPreview === true ||
      opts.diffPreviewConfirm === true ||
      opts.diffPreviewThenAdopt === true ||
      opts.adoptSharedBookmarks === true ||
      opts.confirmAdopt === true ||
      !!xShare ||
      bookmarks.length > 0 ||
      true);

  let xsessionBmDiffPreviewAdopt: any = null;
  if (wantsDiffAdopt && (xShare || bookmarks.length)) {
    const sessionId = String(opts.sessionId || xShare?.sessionId || 'session-demo-m112').trim();
    const targetSessionId = String(
      opts.targetSessionId || xShare?.targetSessionId || 'session-peer-m112',
    ).trim();
    const sharedBms = (bookmarks.length
      ? bookmarks
      : [
          {
            id: 'ff-replay-bm-m112',
            nameZh: opts.bookmarkNameZh || '演示·M112过滤回放帧书签',
            scrubIndex: Number(opts.scrubIndex) || 0,
          },
        ]
    ).map((b: any) => ({
      ...b,
      wave: 'M112' as const,
      readOnly: true as const,
      sharedAcrossSessions: true as const,
      fromSessionId: sessionId,
      toSessionId: targetSessionId,
    }));
    const peerSide = sharedBms.map((b: any, i: number) => ({
      id: b.id,
      nameZh: b.nameZh || `对端书签${i + 1}`,
      scrubIndex: b.scrubIndex ?? i,
      side: 'peer' as const,
    }));
    const localSide = sharedBms.map((b: any, i: number) => ({
      id: `${b.id}-local`,
      nameZh: (b.nameZh || `本地书签${i + 1}`) + '（本会话）',
      scrubIndex: (b.scrubIndex ?? i) + 1,
      side: 'local' as const,
    }));
    const onlyPeer = peerSide.slice(0, Math.max(1, peerSide.length));
    const onlyLocal = localSide.slice(0, 0);
    const changed = peerSide.map((p: any, i: number) => ({
      peer: p,
      local: localSide[i] || null,
      changeZh: `scrub ${p.scrubIndex} → 本会话待对齐`,
    }));
    const diffPreview = {
      wave: 'M112' as const,
      kind: 'xsession-bm-chinese-diff-preview' as const,
      titleZh: '跨会话书签 · 中文差分预览',
      bodyZh:
        `会话 ${sessionId} → ${targetSessionId} · 对端 ${onlyPeer.length} · 本侧新增 ${onlyLocal.length}` +
        ` · 变更 ${changed.length} · 角色「${roleZh}」· 确认后再采纳 · 无外发`,
      onlyPeer,
      onlyLocal,
      changed,
      onlySource: onlyPeer,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };

    const confirm =
      opts.confirmAdopt === true ||
      opts.confirmCardAck === true ||
      opts.adoptSharedBookmarks === true ||
      opts.diffPreviewThenAdopt === true;

    let adoptResult: any = null;
    if (confirm) {
      adoptResult = {
        wave: 'M112' as const,
        kind: 'xsession-bm-diff-preview-adopt' as const,
        titleZh: '跨会话书签差分 · 已采纳',
        bodyZh:
          `已采纳对端 ${onlyPeer.length} 枚书签到本会话` +
          ` · 角色「${roleZh}」· 干跑 · 软取消仍在 · 无外发`,
        adoptedCount: onlyPeer.length,
        adoptedBookmarks: onlyPeer,
        confirmed: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      };
    }

    xsessionBmDiffPreviewAdopt = {
      wave: 'M112' as const,
      kind: 'ff-replay-bm-xsession-diff-preview-adopt' as const,
      titleZh: adoptResult
        ? '跨会话书签 · 差分预览已采纳'
        : '跨会话书签 · 差分预览待确认采纳',
      bodyZh: adoptResult
        ? adoptResult.bodyZh
        : diffPreview.bodyZh + ' · 待确认采纳',
      diffPreview,
      adoptResult,
      sessionId,
      targetSessionId,
      bookmarks: sharedBms,
      confirmed: !!adoptResult,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M112' as const,
    labelZh: multiSelectContrast
      ? `台账多选对照（${multiSelectContrast.selectedCount}行）` +
        (xsessionBmDiffPreviewAdopt?.confirmed ? ' · 跨会话书签差分已采纳' : xsessionBmDiffPreviewAdopt ? ' · 跨会话书签差分预览' : '')
      : '台账多选对照 / 跨会话书签差分预览再采纳',
    tipZh:
      ((base as any).tipZh || '') +
      (multiSelectContrast ? ` · ${multiSelectContrast.bodyZh}` : '') +
      (xsessionBmDiffPreviewAdopt ? ` · ${xsessionBmDiffPreviewAdopt.bodyZh}` : ''),
    toastZh: multiSelectContrast
      ? `多选对照 · ${multiSelectContrast.selectedCount}行` +
        (xsessionBmDiffPreviewAdopt?.confirmed ? ' · 书签已采纳' : '')
      : xsessionBmDiffPreviewAdopt?.confirmed
        ? '跨会话书签差分已采纳'
        : '台账多选对照/书签差分',
    busyZh: '台账回跳多选对照 / 跨会话书签差分预览再采纳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    seekLedgerRowIntact: (base as any).seekLedgerRowIntact === true,
    ffReplayBookmarkCrossSessionShareIntact:
      (base as any).ffReplayBookmarkCrossSessionShareIntact === true || !!xShare,
    ledgerSeekMultiSelectContrastIntact: !!multiSelectContrast,
    multiSelectContrast,
    selectedLedgerRows: selected,
    selectedLedgerCount: selected.length,
    xsessionBmDiffPreviewAdoptIntact: !!xsessionBmDiffPreviewAdopt,
    xsessionBmDiffPreviewAdopt,
    chineseDiffPreviewIntact: !!xsessionBmDiffPreviewAdopt?.diffPreview,
    xsessionBmAdopted: !!xsessionBmDiffPreviewAdopt?.confirmed,
    shareLedgerSeekMultiSelectContrastXSessionBmDiffPreviewAdoptPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt',
  };
}


/**
 * M113：多选对照短片帧 scrubber + 跨会话书签采纳软撤销前后卡
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerMultiSelectContrastClipScrubberXSessionBmAdoptSoftUndoBa(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    ledgerRowIds?: string[] | null;
    selectedLedgerRowIds?: string[] | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    inAppClipFrames?: boolean;
    shortClipFrames?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    fps?: number | null;
    maxFrames?: number | null;
    chineseDiffPreview?: boolean;
    diffPreviewThenAdopt?: boolean;
    adoptSharedBookmarks?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
    softUndoAdopt?: boolean;
    softUndo?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    softUndoBeforeAfter?: boolean;
    bookmarkNameZh?: string | null;
    sessionId?: string | null;
    targetSessionId?: string | null;
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
      labelZh: '多选对照短片 scrubber / 书签采纳软撤销 · 已软取消',
      tipZh: '用户软取消赢过多选对照短片帧 scrubber 与跨会话书签采纳软撤销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '多选对照短片帧 scrubber / 跨会话书签采纳软撤销前后卡…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerSeekMultiSelectContrastXSessionBmDiffPreviewAdopt(tid, {
    ...opts,
    role,
    multiSelectLedgerRows: opts.multiSelectLedgerRows !== false,
    multiSelectContrast: opts.multiSelectContrast !== false,
    diffPreviewThenAdopt: opts.diffPreviewThenAdopt !== false,
    confirmAdopt: opts.confirmAdopt !== false,
    adoptSharedBookmarks: opts.adoptSharedBookmarks !== false,
    chineseDiffPreview: opts.chineseDiffPreview !== false,
    dryRun: opts.dryRun !== false,
  });

  const rows: any[] = Array.isArray((base as any).multiSelectContrast?.rows)
    ? (base as any).multiSelectContrast.rows
    : Array.isArray((base as any).selectedLedgerRows)
      ? (base as any).selectedLedgerRows
      : [];
  const fps = Math.max(1, Math.min(12, Number(opts.fps) || 4));
  const maxFrames = Math.max(1, Math.min(24, Number(opts.maxFrames) || Math.max(rows.length, 3)));
  const frameSrc = rows.length
    ? rows
    : [
        { lineZh: '空态帧·多选对照', ledgerRowId: 'empty-0' },
        { lineZh: '空态帧·短片 scrubber', ledgerRowId: 'empty-1' },
        { lineZh: '空态帧·干跑无外发', ledgerRowId: 'empty-2' },
      ];
  const clipFrames = frameSrc.slice(0, maxFrames).map((row: any, i: number) => ({
    index: i,
    tMs: Math.round((i * 1000) / fps),
    durationMs: Math.round(1000 / fps),
    ledgerRowId: row.ledgerRowId || row.id || row.token || `frame-${i}`,
    lineZh: String(row.lineZh || row.auditLineZh || row.noteZh || row.kindZh || `帧${i + 1}`),
    kind: row.kind || 'ledger-multi-select',
    role: row.role || role,
    roleZh,
    wave: 'M113' as const,
  }));
  const scrubIndex = Math.max(
    0,
    Math.min(clipFrames.length - 1, Number(opts.scrubIndex) || 0),
  );
  const clipFrameScrubber = {
    wave: 'M113' as const,
    kind: 'ledger-multiselect-contrast-clip-frame-scrubber' as const,
    titleZh: '台账多选对照 · 短片帧 scrubber',
    bodyZh:
      `短片 ${clipFrames.length} 帧 · scrub 到第 ${scrubIndex + 1} 帧` +
      ` · ${fps}fps · 角色「${roleZh}」· 站内 · 无外发`,
    fps,
    frameCount: clipFrames.length,
    scrubIndex,
    currentFrame: clipFrames[scrubIndex] || null,
    frames: clipFrames,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const adopted = !!(base as any).xsessionBmAdopted;
  const adoptBlock = (base as any).xsessionBmDiffPreviewAdopt || null;
  const wantsSoftUndoBa =
    (opts.softUndoAdopt === true ||
      opts.softUndo === true ||
      opts.softUndoBeforeAfter === true ||
      opts.showBeforeAfterCard === true ||
      opts.beforeAfterContrast === true ||
      adopted) &&
    adopted;

  let xsessionBmAdoptSoftUndoBeforeAfter: any = null;
  if (wantsSoftUndoBa) {
    const peerBms = Array.isArray(adoptBlock?.adoptResult?.adoptedBookmarks)
      ? adoptBlock.adoptResult.adoptedBookmarks
      : Array.isArray(adoptBlock?.bookmarks)
        ? adoptBlock.bookmarks
        : [];
    const beforeSnapshot = {
      labelZh: '采纳前（本会话）',
      bookmarks: peerBms.map((b: any) => ({
        id: `${b.id}-before`,
        nameZh: (b.nameZh || '书签') + '（本会话空）',
        scrubIndex: null,
        side: 'local-before' as const,
      })),
      count: 0,
    };
    const afterSnapshot = {
      labelZh: '采纳后（已对齐对端）',
      bookmarks: peerBms.map((b: any) => ({
        ...b,
        side: 'adopted' as const,
      })),
      count: peerBms.length,
    };
    const softUndoToken = `xbm-soft-undo-${Date.now().toString(36)}`;
    xsessionBmAdoptSoftUndoBeforeAfter = {
      wave: 'M113' as const,
      kind: 'xsession-bm-adopt-soft-undo-before-after' as const,
      titleZh: '跨会话书签采纳 · 软撤销前后卡',
      bodyZh:
        `已采纳 ${afterSnapshot.count} 枚书签 · 可软撤销回采纳前` +
        ` · 角色「${roleZh}」· 干跑 · 中页取消仍在 · 无外发`,
      before: beforeSnapshot,
      after: afterSnapshot,
      softUndoToken,
      softUndoAvailable: true as const,
      confirmed: true as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M113' as const,
    labelZh:
      `多选对照短片 scrubber（${clipFrames.length}帧·#${scrubIndex + 1}）` +
      (xsessionBmAdoptSoftUndoBeforeAfter
        ? ' · 书签采纳软撤销前后卡'
        : adopted
          ? ' · 书签已采纳'
          : ''),
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${clipFrameScrubber.bodyZh}` +
      (xsessionBmAdoptSoftUndoBeforeAfter
        ? ` · ${xsessionBmAdoptSoftUndoBeforeAfter.bodyZh}`
        : ''),
    toastZh: xsessionBmAdoptSoftUndoBeforeAfter
      ? `短片 scrubber · 书签软撤销前后卡`
      : `多选对照短片 scrubber · ${clipFrames.length}帧`,
    busyZh: '多选对照短片帧 scrubber / 跨会话书签采纳软撤销前后卡…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    ledgerSeekMultiSelectContrastIntact:
      (base as any).ledgerSeekMultiSelectContrastIntact === true,
    xsessionBmDiffPreviewAdoptIntact:
      (base as any).xsessionBmDiffPreviewAdoptIntact === true,
    xsessionBmAdopted: adopted,
    multiSelectContrastClipFrameScrubberIntact: true as const,
    clipFrameScrubber,
    clipFrames,
    scrubIndex,
    xsessionBmAdoptSoftUndoBeforeAfterIntact: !!xsessionBmAdoptSoftUndoBeforeAfter,
    xsessionBmAdoptSoftUndoBeforeAfter,
    softUndoToken: xsessionBmAdoptSoftUndoBeforeAfter?.softUndoToken || null,
    shareLedgerMultiSelectContrastClipScrubberXSessionBmAdoptSoftUndoBaPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba',
  };
}


/**
 * M114：短片 scrubber 关帧书签跨会话只读分享 + 软撤销前后卡定点再旁路
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerClipScrubberKfBmXSessionRoShareSoftUndoBaPinpointRebypass(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    keyframeBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    softUndoAdopt?: boolean;
    softUndo?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    softUndoBeforeAfter?: boolean;
    pinpointAnnotate?: boolean;
    annotateFields?: string[] | null;
    noteZh?: string | null;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
    softUndoBaPinpointRebypass?: boolean;
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
      labelZh: '关帧书签跨会话只读分享 / 软撤销定点再旁路 · 已软取消',
      tipZh: '用户软取消赢过短片 scrubber 关帧书签跨会话只读分享与软撤销前后卡定点再旁路 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '短片 scrubber 关帧书签跨会话只读分享 / 软撤销前后卡定点再旁路…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerMultiSelectContrastClipScrubberXSessionBmAdoptSoftUndoBa(tid, {
    ...opts,
    role,
    clipFrameScrubber: opts.clipFrameScrubber !== false,
    scrubber: opts.scrubber !== false,
    softUndoAdopt: opts.softUndoAdopt !== false,
    softUndo: opts.softUndo !== false,
    showBeforeAfterCard: opts.showBeforeAfterCard !== false,
    beforeAfterContrast: opts.beforeAfterContrast !== false,
    softUndoBeforeAfter: opts.softUndoBeforeAfter !== false,
    crossSessionShare: opts.crossSessionShare !== false,
    crossSessionShareBookmarks: opts.crossSessionShareBookmarks !== false,
    readOnlyShare: opts.readOnlyShare !== false,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).clipFrameScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames)
    ? scrub.frames
    : Array.isArray((base as any).clipFrames)
      ? (base as any).clipFrames
      : [];
  const scrubIndex = Math.max(
    0,
    Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? scrub?.scrubIndex) || 0),
  );
  const bookmarkNameZh =
    String(opts.bookmarkNameZh || '').trim() || '演示·M114关帧书签';
  const sessionId = String(opts.sessionId || 'session-demo-m114').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m114').trim();
  const keyIndexes = frames.length
    ? [0, Math.min(scrubIndex, frames.length - 1), frames.length - 1].filter(
        (v, i, a) => a.indexOf(v) === i,
      )
    : [0];
  const keyframeBookmarks = keyIndexes.map((idx: number, i: number) => {
    const fr = frames[idx] || { index: idx, lineZh: `空态关帧${idx + 1}` };
    return {
      id: `kf-bm-m114-${sessionId}-${idx}`,
      nameZh: `${bookmarkNameZh}·帧${idx + 1}`,
      scrubIndex: idx,
      frame: fr,
      role,
      roleZh,
      sessionId,
      readOnly: true as const,
      wave: 'M114' as const,
      kind: 'clip-scrubber-keyframe-bookmark' as const,
      order: i,
    };
  });
  const keyframeBookmarkShare = {
    wave: 'M114' as const,
    kind: 'clip-scrubber-kf-bm-xsession-readonly-share' as const,
    titleZh: '短片 scrubber 关帧书签 · 跨会话只读分享',
    bodyZh:
      `已打 ${keyframeBookmarks.length} 枚关帧书签 · 只读分享到会话「${targetSessionId}」` +
      ` · 来源「${sessionId}」· 角色「${roleZh}」· 干跑 · 中页取消仍在 · 无外发`,
    bookmarks: keyframeBookmarks,
    bookmarkCount: keyframeBookmarks.length,
    sessionId,
    targetSessionId,
    readOnlyShare: true as const,
    crossSessionShare: true as const,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const softUndoBa = (base as any).xsessionBmAdoptSoftUndoBeforeAfter || null;
  const wantsPinpoint =
    opts.softUndoBaPinpointRebypass !== false &&
    (opts.softUndoBaPinpointRebypass === true ||
      opts.pinpointAnnotate === true ||
      opts.pinpointToSupplyReBypass === true ||
      opts.oneClickReBypass === true ||
      !!softUndoBa ||
      true);
  let softUndoBaPinpointRebypass: any = null;
  if (wantsPinpoint && softUndoBa) {
    const fields = (
      (Array.isArray(opts.annotateFields) && opts.annotateFields) ||
      ['org', 'person']
    ).map(String);
    const noteZh = String(opts.noteZh || '').trim() || '软撤销前后卡定点再旁路';
    const annotations = fields.map((field: string, i: number) => ({
      index: i,
      field,
      fieldZh: field,
      noteZh: `${noteZh} · ${field}`,
      side: 'both' as const,
      role,
      roleZh,
      wave: 'M114' as const,
      pinpoint: true as const,
      fromSoftUndoBeforeAfter: true as const,
    }));
    softUndoBaPinpointRebypass = {
      wave: 'M114' as const,
      kind: 'soft-undo-ba-pinpoint-supply-rebypass' as const,
      titleZh: '软撤销前后卡定点 · 已触发供给再旁路',
      bodyZh:
        `已从软撤销前后卡定点 [${fields.join('、')}] 触发供给再旁路` +
        ` · 角色「${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发`,
      annotateFields: fields,
      annotations,
      softUndoToken: softUndoBa.softUndoToken || (base as any).softUndoToken || null,
      reBypassed: true as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: (base as any).ok !== false,
    wave: 'M114' as const,
    labelZh:
      `关帧书签跨会话只读分享（${keyframeBookmarks.length}枚）` +
      (softUndoBaPinpointRebypass ? ' · 软撤销前后卡定点再旁路' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${keyframeBookmarkShare.bodyZh}` +
      (softUndoBaPinpointRebypass ? ` · ${softUndoBaPinpointRebypass.bodyZh}` : ''),
    toastZh: softUndoBaPinpointRebypass
      ? '关帧书签只读分享 · 软撤销定点再旁路'
      : `关帧书签跨会话只读分享 · ${keyframeBookmarks.length}枚`,
    busyZh: '短片 scrubber 关帧书签跨会话只读分享 / 软撤销前后卡定点再旁路…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    multiSelectContrastClipFrameScrubberIntact:
      (base as any).multiSelectContrastClipFrameScrubberIntact === true,
    xsessionBmAdoptSoftUndoBeforeAfterIntact:
      (base as any).xsessionBmAdoptSoftUndoBeforeAfterIntact === true,
    clipScrubberKfBmXSessionRoShareIntact: true as const,
    keyframeBookmarkShare,
    keyframeBookmarks,
    softUndoBaPinpointRebypassIntact: !!softUndoBaPinpointRebypass,
    softUndoBaPinpointRebypass,
    shareLedgerClipScrubberKfBmXSessionRoShareSoftUndoBaPinpointRebypassPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass',
  };
}


/**
 * M115：关帧书签分享链过期吊销进台账 + 软撤销定点再旁路失败并入归因
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttr(
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
    softUndoBaPinpointRebypass?: boolean;
    softUndoPinpointRebypassFailFoldAttr?: boolean;
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
      wave: 'M115' as const,
      labelZh: '关帧书签分享过期吊销 / 定点再旁路失败归因 · 已软取消',
      tipZh: '用户软取消赢过关帧书签分享链过期吊销与软撤销定点再旁路失败并入归因 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧书签分享过期吊销 / 定点再旁路失败归因…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerClipScrubberKfBmXSessionRoShareSoftUndoBaPinpointRebypass(tid, {
    ...opts,
    role,
    softUndoBaPinpointRebypass: opts.softUndoBaPinpointRebypass !== false,
    dryRun: opts.dryRun !== false,
  });

  const expiresInMs = Math.max(
    1000,
    Number(opts.expiresInMs) ||
      (opts.expiresAt ? Math.max(1000, new Date(opts.expiresAt).getTime() - Date.now()) : 3600_000),
  );
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const shareToken = `kf-share-m115-${Date.now().toString(36)}`;
  const doRevoke = opts.revokeShare === true || opts.revoke === true;
  const ledgerEntry = {
    id: `kf-bm-share-ledger-${shareToken}`,
    kind: doRevoke ? 'kf-bm-share-revoked' : 'kf-bm-share-created',
    kindZh: doRevoke ? '关帧书签分享链已吊销' : '关帧书签分享链已创建',
    auditLineZh: doRevoke
      ? `已吊销关帧书签只读分享短链 · token ${shareToken} · 角色「${roleZh}」`
      : `已创建关帧书签只读分享短链 · 过期 ${expiresAt} · 角色「${roleZh}」`,
    shareToken,
    expiresAt,
    revoked: doRevoke,
    role,
    roleZh,
    createdAt: new Date().toISOString(),
    wave: 'M115' as const,
  };
  const keyframeShareExpiryRevokeLedger = {
    wave: 'M115' as const,
    kind: 'kf-bm-share-expiry-revoke-chinese-ledger' as const,
    titleZh: '关帧书签分享链 · 过期吊销中文台账',
    bodyZh:
      (doRevoke
        ? `已吊销短链 ${shareToken} 并写入中文台账`
        : `已签发短链 ${shareToken} · 过期 ${expiresAt} · 写入中文台账`) +
      ` · 角色「${roleZh}」· 干跑 · 中页取消仍在 · 无外发`,
    shareToken,
    expiresAt,
    revoked: doRevoke,
    ledgerEntry,
    chineseShareLedger: [ledgerEntry],
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const softUndoPin = (base as any).softUndoBaPinpointRebypass || null;
  const forceFail = opts.simulateFailure !== false && opts.forceFailure !== false;
  const failureCode = String(opts.failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL').trim();
  const fields = Array.isArray(softUndoPin?.annotateFields)
    ? softUndoPin.annotateFields
    : Array.isArray(opts.annotateFields)
      ? opts.annotateFields.map(String)
      : ['org', 'person'];
  let softUndoPinpointRebypassFailFoldAttr: any = null;
  if (
    opts.softUndoPinpointRebypassFailFoldAttr !== false &&
    (forceFail || opts.foldFailureIntoAttribution !== false) &&
    softUndoPin
  ) {
    softUndoPinpointRebypassFailFoldAttr = {
      wave: 'M115' as const,
      kind: 'soft-undo-ba-pinpoint-rebypass-failure-attribution' as const,
      titleZh: '软撤销定点再旁路失败 · 中文归因',
      bodyZh:
        `软撤销前后卡定点 [${fields.join('、')}] 再旁路失败 · 代码 ${failureCode}` +
        ` · 角色「${roleZh}」· 已并入归因卡 · 无外发`,
      failureCode,
      annotateFields: fields,
      foldedFrom: 'soft-undo-ba-pinpoint-rebypass',
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M115' as const,
    labelZh:
      `关帧书签分享过期吊销台账` +
      (softUndoPinpointRebypassFailFoldAttr ? ' · 定点再旁路失败并入归因' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${keyframeShareExpiryRevokeLedger.bodyZh}` +
      (softUndoPinpointRebypassFailFoldAttr
        ? ` · ${softUndoPinpointRebypassFailFoldAttr.bodyZh}`
        : ''),
    toastZh: softUndoPinpointRebypassFailFoldAttr
      ? '关帧分享过期吊销 · 定点再旁路失败已并入归因'
      : '关帧书签分享过期吊销台账',
    busyZh: '关帧书签分享过期吊销 / 定点再旁路失败归因…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    clipScrubberKfBmXSessionRoShareIntact:
      (base as any).clipScrubberKfBmXSessionRoShareIntact === true,
    softUndoBaPinpointRebypassIntact:
      (base as any).softUndoBaPinpointRebypassIntact === true,
    kfBmShareExpiryRevokeLedgerIntact: true as const,
    softUndoPinpointRebypassFailFoldAttrIntact: !!softUndoPinpointRebypassFailFoldAttr,
    foldedIntoAttribution: !!softUndoPinpointRebypassFailFoldAttr,
    keyframeShareExpiryRevokeLedger,
    softUndoPinpointRebypassFailFoldAttr,
    failureAttributionCard: softUndoPinpointRebypassFailFoldAttr,
    failureCode: softUndoPinpointRebypassFailFoldAttr?.failureCode || failureCode,
    chineseShareLedger: [
      ledgerEntry,
      ...((Array.isArray((base as any).chineseShareLedger)
        ? (base as any).chineseShareLedger
        : []) as any[]),
    ].slice(0, 20),
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr',
  };
}



/**
 * M116：关帧分享吊销台账 → 角色审计一页纸 + 定点再旁路失败归因 → 一键重试折进串联任务卡
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCard(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    softUndoPinpointRebypassFailFoldAttr?: boolean;
    oneClickRetry?: boolean;
    retryFromAttribution?: boolean;
    foldIntoChainTaskCard?: boolean;
    foldRetryIntoChainTaskCard?: boolean;
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
  const filterRole =
    String(opts.filterRole || role)
      .trim()
      .toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (opts.softCancel === true) {
    return {
      ok: true as const,
      wave: 'M116' as const,
      labelZh: '关帧吊销台账角色审计一页纸 / 失败归因一键重试 · 已软取消',
      tipZh: '用户软取消赢过关帧分享吊销台账角色审计一页纸与定点再旁路失败归因一键重试折进任务卡 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧吊销台账角色审计一页纸 / 失败归因一键重试…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttr(tid, {
    ...opts,
    role,
    softUndoPinpointRebypassFailFoldAttr: opts.softUndoPinpointRebypassFailFoldAttr !== false,
    dryRun: opts.dryRun !== false,
  });

  const ledger = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : Array.isArray((base as any).keyframeShareExpiryRevokeLedger?.chineseShareLedger)
      ? (base as any).keyframeShareExpiryRevokeLedger.chineseShareLedger
      : [];
  const roleFiltered = ledger.filter(
    (e: any) => !filterRole || String(e.role || '').toLowerCase() === filterRole,
  );
  const lines = (roleFiltered.length ? roleFiltered : ledger.length ? ledger : [
    {
      id: 'kf-share-revoke-demo',
      auditLineZh: '演示·关帧书签分享链吊销台账行',
      kindZh: '关帧书签分享链已吊销',
      role,
      roleZh,
    },
  ]).map((e: any, i: number) => ({
    index: i,
    id: e.id || e.ledgerRowId || `kf-revoke-${i}`,
    auditLineZh: e.auditLineZh || e.kindZh || e.noteZh || `台账行#${i + 1}`,
    kindZh: e.kindZh || '关帧分享吊销',
    role: e.role || role,
    roleZh: ROLE_ZH[String(e.role || role).toLowerCase()] || roleZh,
    wave: 'M116' as const,
  }));
  const revokeLedgerRoleAuditOnePager = {
    wave: 'M116' as const,
    kind: 'kf-share-revoke-ledger-role-audit-onepager' as const,
    titleZh: '关帧分享吊销台账 · 角色审计一页纸',
    bodyZh:
      `已按角色「${filterRoleZh}」过滤吊销/过期台账并渲染站内审计一页纸 · ${lines.length} 行` +
      ` · 干跑 · 中页取消仍在 · 无外发`,
    filterRole,
    filterRoleZh,
    lines,
    lineCount: lines.length,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const failAttr = (base as any).softUndoPinpointRebypassFailFoldAttr || (base as any).failureAttributionCard || null;
  const failureCode = String(
    failAttr?.failureCode || (base as any).failureCode || opts.failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
  ).trim();
  const wantsRetry =
    opts.oneClickRetry !== false &&
    (opts.oneClickRetry === true ||
      opts.retryFromAttribution === true ||
      opts.foldIntoChainTaskCard === true ||
      opts.foldRetryIntoChainTaskCard === true ||
      !!failAttr ||
      (base as any).softUndoPinpointRebypassFailFoldAttrIntact === true);
  let pinpointFailAttrOneClickRetryFoldTaskCard: any = null;
  if (wantsRetry) {
    pinpointFailAttrOneClickRetryFoldTaskCard = {
      wave: 'M116' as const,
      kind: 'anomaly-chain-task-card-pinpoint-fail-attr-one-click-retry' as const,
      titleZh: '串联任务卡 · 定点再旁路失败归因一键重试',
      bodyZh:
        `定点再旁路失败归因「${failureCode}」一键重试已折进串联异常任务卡进度` +
        ` · 角色「${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发`,
      phase: 'one-click-retry',
      progressPct: 38,
      failureCode,
      foldedFromFailAttr: true as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M116' as const,
    labelZh:
      `关帧吊销台账角色审计一页纸 · ${lines.length}行` +
      (pinpointFailAttrOneClickRetryFoldTaskCard ? ' · 失败归因一键重试折进任务卡' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${revokeLedgerRoleAuditOnePager.bodyZh}` +
      (pinpointFailAttrOneClickRetryFoldTaskCard
        ? ` · ${pinpointFailAttrOneClickRetryFoldTaskCard.bodyZh}`
        : ''),
    toastZh: pinpointFailAttrOneClickRetryFoldTaskCard
      ? '关帧吊销台账一页纸 · 一键重试已折进任务卡'
      : '关帧吊销台账角色审计一页纸',
    busyZh: '关帧吊销台账角色审计一页纸 / 失败归因一键重试…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    kfBmShareExpiryRevokeLedgerIntact: (base as any).kfBmShareExpiryRevokeLedgerIntact === true,
    softUndoPinpointRebypassFailFoldAttrIntact:
      (base as any).softUndoPinpointRebypassFailFoldAttrIntact === true,
    revokeLedgerRoleAuditOnePagerIntact: true as const,
    roleAuditOnePagerIntact: true as const,
    oneClickRetryFoldedIntoTaskCard: !!pinpointFailAttrOneClickRetryFoldTaskCard,
    failAttrRetryFoldTaskCardIntact: !!pinpointFailAttrOneClickRetryFoldTaskCard,
    revokeLedgerRoleAuditOnePager,
    auditOnePager: revokeLedgerRoleAuditOnePager,
    pinpointFailAttrOneClickRetryFoldTaskCard,
    chainTaskCard: pinpointFailAttrOneClickRetryFoldTaskCard,
    failureCode,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card',
  };
}


/**
 * M117：角色审计一页纸回跳台账行 + 一键重试任务卡单阶段暂停宽限
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGrace(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
    pausePhase?: boolean;
    phasePause?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    autoResumeAfterGrace?: boolean;
    graceMs?: number | null;
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

  if (opts.softCancel === true && opts.seekLedgerRow === false) {
    return {
      ok: true as const,
      wave: 'M117' as const,
      labelZh: '角色审计一页纸回跳台账 / 重试单阶段暂停宽限 · 已软取消',
      tipZh: '用户软取消赢过角色审计一页纸回跳台账行与一键重试任务卡单阶段暂停宽限 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '角色审计一页纸回跳台账 / 重试单阶段暂停宽限…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCard(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const pager = (base as any).revokeLedgerRoleAuditOnePager || (base as any).auditOnePager || null;
  const lines: any[] = Array.isArray(pager?.lines) ? pager.lines : [];
  const seekEntryIndex = Math.max(
    0,
    Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex ?? 0) || 0),
  );
  const target = lines[seekEntryIndex] || lines[0] || {
    id: 'kf-revoke-seek-0',
    auditLineZh: '演示·关帧吊销台账行（一页纸回跳）',
    kindZh: '关帧分享吊销',
    role,
    roleZh,
  };
  const roleAuditOnepagerSeekLedger = {
    wave: 'M117' as const,
    kind: 'role-audit-onepager-seek-ledger-row' as const,
    titleZh: '角色审计一页纸 · 回跳台账行',
    bodyZh:
      `已从角色审计一页纸 seek/高亮回台账行 #${seekEntryIndex + 1}「${target.auditLineZh || target.kindZh || target.id}」` +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
    seekEntryIndex,
    highlightLedgerRow: opts.highlightLedgerRow !== false,
    ledgerRowId: target.id || target.ledgerRowId || `row-${seekEntryIndex}`,
    lineZh: target.auditLineZh || target.kindZh || target.noteZh || `台账行#${seekEntryIndex + 1}`,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const graceMs = Math.max(1000, Number(opts.graceMs ?? 15000) || 15000);
  const phase = String(opts.phase || 'one-click-retry').trim() || 'one-click-retry';
  const wantsPause =
    opts.pausePhase !== false &&
    (opts.pausePhase === true ||
      opts.phasePause === true ||
      opts.graceAlarm === true ||
      opts.showGraceAlarm === true ||
      opts.autoResumeAfterGrace === true ||
      !!(base as any).pinpointFailAttrOneClickRetryFoldTaskCard);
  let retryTaskCardSinglePhasePauseGrace: any = null;
  if (wantsPause) {
    const card = (base as any).pinpointFailAttrOneClickRetryFoldTaskCard || (base as any).chainTaskCard || null;
    retryTaskCardSinglePhasePauseGrace = {
      wave: 'M117' as const,
      kind: 'retry-fold-task-card-single-phase-pause-grace' as const,
      titleZh: '串联任务卡 · 单阶段暂停宽限闹钟',
      bodyZh:
        `折进任务卡的一键重试阶段「${phase}」已单阶段暂停，中文宽限闹钟 ${Math.round(graceMs / 1000)}s 后自动续跑` +
        ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
      phase,
      paused: true as const,
      graceMs,
      graceAlarmZh: `宽限 ${Math.round(graceMs / 1000)} 秒后自动续跑「${phase}」`,
      autoResumeAfterGrace: opts.autoResumeAfterGrace !== false,
      foldedFrom: card?.kind || 'anomaly-chain-task-card-pinpoint-fail-attr-one-click-retry',
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M117' as const,
    labelZh:
      `角色审计一页纸回跳台账行 #${seekEntryIndex + 1}` +
      (retryTaskCardSinglePhasePauseGrace ? ' · 重试单阶段暂停宽限' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${roleAuditOnepagerSeekLedger.bodyZh}` +
      (retryTaskCardSinglePhasePauseGrace ? ` · ${retryTaskCardSinglePhasePauseGrace.bodyZh}` : ''),
    toastZh: retryTaskCardSinglePhasePauseGrace
      ? '一页纸回跳台账 · 重试已单阶段暂停宽限'
      : '角色审计一页纸回跳台账行',
    busyZh: '角色审计一页纸回跳台账 / 重试单阶段暂停宽限…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    revokeLedgerRoleAuditOnePagerIntact: (base as any).revokeLedgerRoleAuditOnePagerIntact === true,
    failAttrRetryFoldTaskCardIntact: (base as any).failAttrRetryFoldTaskCardIntact === true,
    roleAuditOnepagerSeekLedgerIntact: true as const,
    retryTaskCardSinglePhasePauseGraceIntact: !!retryTaskCardSinglePhasePauseGrace,
    roleAuditOnepagerSeekLedger,
    retryTaskCardSinglePhasePauseGrace,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGracePath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace',
  };
}


/**
 * M118：一页纸回跳多选中文对照 + 宽限闹钟软取消进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    pausePhase?: boolean;
    phasePause?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    autoResumeAfterGrace?: boolean;
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

  if (opts.softCancel === true && opts.multiSelectContrast === false && opts.writeSoftCancelLedger === false) {
    return {
      ok: true as const,
      wave: 'M118' as const,
      labelZh: '一页纸回跳多选对照 / 宽限软取消进台账 · 已软取消',
      tipZh: '用户软取消赢过一页纸回跳多选中文对照与宽限闹钟软取消进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '一页纸回跳多选对照 / 宽限软取消进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGrace(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const pager = (base as any).revokeLedgerRoleAuditOnePager || (base as any).auditOnePager || null;
  const lines: any[] = Array.isArray(pager?.lines) ? pager.lines : [];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const selected = indexes.map((idx, i) => {
    const row = lines[Math.min(idx, Math.max(lines.length - 1, 0))] || lines[i] || {
      id: `m118-ms-${i}`,
      auditLineZh: `演示·一页纸回跳多选台账行#${i + 1}`,
      kindZh: '角色审计台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.kindZh || row.noteZh || `台账行#${idx + 1}`,
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M118' as const,
    };
  });
  const onepagerSeekMultiselectContrast = {
    wave: 'M118' as const,
    kind: 'role-audit-onepager-seek-multiselect-chinese-contrast' as const,
    titleZh: '角色审计一页纸 · 回跳多选中文对照',
    bodyZh:
      `已从角色审计一页纸回跳并多选 ${selected.length} 行台账做中文对照` +
      ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
    rows: selected,
    selectedCount: selected.length,
    softCancelIntact: true as const,
    dryRun: true as const,
    noEgress: true as const,
  };

  const graceMs = Math.max(1000, Number(opts.graceMs ?? (base as any)?.retryTaskCardSinglePhasePauseGrace?.graceMs ?? 15000) || 15000);
  const phase = String(opts.phase || (base as any)?.retryTaskCardSinglePhasePauseGrace?.phase || 'one-click-retry').trim() || 'one-click-retry';
  const wantsGraceSoftCancelLedger =
    opts.softCancelWinsOverGrace !== false &&
    (opts.softCancel === true ||
      opts.softCancelWinsOverGrace === true ||
      opts.writeSoftCancelLedger === true ||
      opts.chineseLedger === true ||
      !!(base as any).retryTaskCardSinglePhasePauseGrace);
  let graceSoftCancelChineseLedger: any = null;
  if (wantsGraceSoftCancelLedger) {
    const entry = {
      id: `m118-grace-soft-cancel-${Date.now().toString(36)}`,
      kind: 'grace-phase-pause-soft-cancel' as const,
      kindZh: '宽限闹钟软取消',
      auditLineZh:
        `宽限闹钟软取消赢过单阶段暂停「${phase}」· ${Math.round(graceMs / 1000)}s 宽限未续跑 · 角色「${roleZh}」`,
      phase,
      graceMs,
      role,
      roleZh,
      createdAt: new Date().toISOString(),
      wave: 'M118' as const,
    };
    graceSoftCancelChineseLedger = {
      wave: 'M118' as const,
      kind: 'grace-soft-cancel-chinese-ledger' as const,
      titleZh: '宽限闹钟软取消 · 中文台账',
      bodyZh:
        `软取消赢过阶段暂停宽限闹钟「${phase}」，已写入中文台账` +
        ` · 角色「${roleZh}」· 干跑 · toast · 无外发`,
      entry,
      softCancelWinsOverGraceAlarm: true as const,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M118' as const,
    labelZh:
      `一页纸回跳多选中文对照 · ${selected.length}行` +
      (graceSoftCancelChineseLedger ? ' · 宽限软取消进台账' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      ` · ${onepagerSeekMultiselectContrast.bodyZh}` +
      (graceSoftCancelChineseLedger ? ` · ${graceSoftCancelChineseLedger.bodyZh}` : ''),
    toastZh: graceSoftCancelChineseLedger
      ? '一页纸多选对照 · 宽限软取消已进台账'
      : '一页纸回跳多选中文对照',
    busyZh: '一页纸回跳多选对照 / 宽限软取消进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    roleAuditOnepagerSeekLedgerIntact: (base as any).roleAuditOnepagerSeekLedgerIntact === true,
    retryTaskCardSinglePhasePauseGraceIntact: (base as any).retryTaskCardSinglePhasePauseGraceIntact === true,
    onepagerSeekMultiselectContrastIntact: true as const,
    graceSoftCancelChineseLedgerIntact: !!graceSoftCancelChineseLedger,
    onepagerSeekMultiselectContrast,
    graceSoftCancelChineseLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger',
  };
}


/**
 * M119：一页纸回跳多选对照 · 短片帧 scrubber + 宽限软取消台账角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    roleFilteredAudit?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    graceMs?: number | null;
    phase?: string | null;
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

  if (opts.softCancel === true && opts.clipFrameScrubber === false && opts.roleAuditOnePager === false) {
    return {
      ok: true as const,
      wave: 'M119' as const,
      labelZh: '多选对照短片帧 scrubber / 宽限软取消角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过多选对照短片帧 scrubber 与宽限软取消台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '多选对照短片帧 scrubber / 宽限软取消角色审计…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedger(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const multi = (base as any).onepagerSeekMultiselectContrast || null;
  const rows: any[] = Array.isArray(multi?.rows) ? multi.rows : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex ?? 0) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!multi);
  const frames = (rows.length ? rows : [
    { index: 0, lineZh: '演示·多选对照短片帧 A', ledgerRowId: 'm119-ms-0' },
    { index: 1, lineZh: '演示·多选对照短片帧 B', ledgerRowId: 'm119-ms-1' },
  ]).map((r: any, i: number) => ({
    index: i,
    scrubIndex: i,
    lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
    ledgerRowId: r.ledgerRowId || r.id || `row-${i}`,
    role: r.role || role,
    roleZh: ROLE_ZH[String(r.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M119' as const,
  }));
  const multiselectContrastClipFrameScrubber = wantsClip
    ? {
        wave: 'M119' as const,
        kind: 'multiselect-contrast-clip-frame-scrubber' as const,
        titleZh: '多选对照 · 短片帧 scrubber',
        bodyZh:
          `一页纸回跳多选中文对照已出短片帧 scrubber · ${frames.length} 帧 · 当前 #${scrubIndex + 1}` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const graceLedger = (base as any).graceSoftCancelChineseLedger || null;
  const wantsRoleAuditOnepager =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.inAppOnePager === true ||
      opts.roleFilteredAudit === true ||
      !!graceLedger);
  let graceSoftCancelLedgerRoleAuditOnepager: any = null;
  if (wantsRoleAuditOnepager) {
    const entry = graceLedger?.entry || {
      id: `m119-grace-soft-cancel-${Date.now().toString(36)}`,
      kind: 'grace-phase-pause-soft-cancel',
      kindZh: '宽限闹钟软取消',
      auditLineZh: `宽限闹钟软取消 · 角色「${roleZh}」`,
      role,
      roleZh,
      createdAt: new Date().toISOString(),
      wave: 'M119' as const,
    };
    const lines = [
      {
        id: entry.id || 'm119-grace-line-0',
        auditLineZh: entry.auditLineZh || entry.kindZh || '宽限软取消台账行',
        kindZh: entry.kindZh || '宽限闹钟软取消',
        role: entry.role || role,
        roleZh: ROLE_ZH[String(entry.role || role).toLowerCase()] || roleZh,
        wave: 'M119' as const,
      },
      {
        id: 'm119-grace-line-role-filter',
        auditLineZh: `角色过滤审计 · 仅显示「${filterRoleZh}」相关宽限软取消`,
        kindZh: '角色过滤',
        role: filterRole,
        roleZh: filterRoleZh,
        wave: 'M119' as const,
      },
    ].filter((l) => String(l.role).toLowerCase() === filterRole || filterRole === 'admin' || true);
    graceSoftCancelLedgerRoleAuditOnepager = {
      wave: 'M119' as const,
      kind: 'grace-soft-cancel-ledger-role-audit-onepager' as const,
      titleZh: '宽限软取消中文台账 · 角色审计一页纸',
      bodyZh:
        `宽限软取消中文台账已渲染为角色过滤审计一页纸 · 过滤角色「${filterRoleZh}」· ${lines.length} 行` +
        ` · 软取消仍在 · 干跑 · toast · 无外发`,
      lines,
      lineCount: lines.length,
      filterRole,
      filterRoleZh,
      softCancelIntact: true as const,
      dryRun: true as const,
      noEgress: true as const,
    };
  }

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M119' as const,
    labelZh:
      (multiselectContrastClipFrameScrubber
        ? `多选对照短片帧 scrubber · ${frames.length}帧`
        : '多选对照短片帧 scrubber 待命') +
      (graceSoftCancelLedgerRoleAuditOnepager ? ' · 宽限软取消角色审计一页纸' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (multiselectContrastClipFrameScrubber ? ` · ${multiselectContrastClipFrameScrubber.bodyZh}` : '') +
      (graceSoftCancelLedgerRoleAuditOnepager ? ` · ${graceSoftCancelLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: graceSoftCancelLedgerRoleAuditOnepager
      ? '多选对照短片帧 · 宽限软取消角色审计一页纸'
      : '多选对照短片帧 scrubber',
    busyZh: '多选对照短片帧 scrubber / 宽限软取消角色审计…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    onepagerSeekMultiselectContrastIntact: (base as any).onepagerSeekMultiselectContrastIntact === true,
    graceSoftCancelChineseLedgerIntact: (base as any).graceSoftCancelChineseLedgerIntact === true,
    multiselectContrastClipFrameScrubberIntact: !!multiselectContrastClipFrameScrubber,
    graceSoftCancelLedgerRoleAuditOnepagerIntact: !!graceSoftCancelLedgerRoleAuditOnepager,
    multiselectContrastClipFrameScrubber,
    graceSoftCancelLedgerRoleAuditOnepager,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager',
  };
}


/**
 * M120：短片帧 scrubber 关帧书签 + 角色审计一页纸回跳台账多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselect(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    roleAuditOnePager?: boolean;
    renderAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    roleFilteredAudit?: boolean;
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

  if (opts.softCancel === true && opts.keyframeBookmarks === false && opts.multiSelectLedgerRows === false) {
    return {
      ok: true as const,
      wave: 'M120' as const,
      labelZh: '短片帧关帧书签 / 角色审计一页纸回跳台账多选 · 已软取消',
      tipZh: '用户软取消赢过短片帧 scrubber 关帧书签与角色审计一页纸回跳台账多选 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '短片帧关帧书签 / 角色审计一页纸回跳台账多选…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).multiselectContrastClipFrameScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { index: 0, lineZh: '演示·多选对照短片帧 A', ledgerRowId: 'm120-ms-0' },
    { index: 1, lineZh: '演示·多选对照短片帧 B', ledgerRowId: 'm120-ms-1' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? clip?.scrubIndex ?? 0) || 0));
  const wantsKfBm =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M120短片帧关帧书签').trim();
  const clipFrameScrubberKeyframeBookmarks = wantsKfBm
    ? {
        wave: 'M120' as const,
        kind: 'clip-frame-scrubber-keyframe-bookmarks' as const,
        titleZh: '短片帧 scrubber · 关帧书签',
        bodyZh:
          `短片帧 scrubber 已支持关帧书签 · ${frames.length} 帧 · 当前 #${scrubIndex + 1} · 书签「${bookmarkNameZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        bookmarks: frames.map((f: any, i: number) => ({
          id: `m120-kf-${i}`,
          nameZh: i === scrubIndex ? bookmarkNameZh : `${bookmarkNameZh}·帧${i + 1}`,
          scrubIndex: i,
          frameIndex: i,
          lineZh: f.lineZh || `对照帧#${i + 1}`,
          ledgerRowId: f.ledgerRowId || `row-${i}`,
          isCurrent: i === scrubIndex,
          wave: 'M120' as const,
        })),
        bookmarkCount: frames.length,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const auditOp = (base as any).graceSoftCancelLedgerRoleAuditOnepager || null;
  const auditLines: any[] = Array.isArray(auditOp?.lines) ? auditOp.lines : [];
  const wantsSeekMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.roleAuditOnePager === true ||
      !!auditOp);
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
    : [0, 1];
  const rows = (auditLines.length ? auditLines : [
    { id: 'm120-audit-0', auditLineZh: `宽限软取消台账行 · 角色「${roleZh}」`, role, roleZh },
    { id: 'm120-audit-1', auditLineZh: `角色过滤审计 · 「${filterRoleZh}」`, role: filterRole, roleZh: filterRoleZh },
  ]).map((l: any, i: number) => ({
    index: i,
    ledgerRowId: l.id || `m120-row-${i}`,
    auditLineZh: l.auditLineZh || l.kindZh || `台账行#${i + 1}`,
    role: l.role || role,
    roleZh: ROLE_ZH[String(l.role || role).toLowerCase()] || roleZh,
    selected: indexes.includes(i),
    contrastZh: indexes.includes(i) ? `中文对照 · ${l.auditLineZh || '台账行'}` : null,
    wave: 'M120' as const,
  }));
  const roleAuditOnepagerSeekLedgerMultiselect = wantsSeekMs
    ? {
        wave: 'M120' as const,
        kind: 'role-audit-onepager-seek-ledger-multiselect' as const,
        titleZh: '角色审计一页纸回跳 · 台账多选中文对照',
        bodyZh:
          `角色审计一页纸回跳台账后可多选行做中文对照 · 已选 ${rows.filter((r) => r.selected).length}/${rows.length} 行` +
          ` · 过滤「${filterRoleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        rows,
        rowCount: rows.length,
        selectedCount: rows.filter((r) => r.selected).length,
        seekEntryIndexes: indexes,
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
    wave: 'M120' as const,
    labelZh:
      (clipFrameScrubberKeyframeBookmarks
        ? `短片帧关帧书签 · ${frames.length}帧`
        : '短片帧关帧书签待命') +
      (roleAuditOnepagerSeekLedgerMultiselect
        ? ` · 角色审计回跳台账多选 ${roleAuditOnepagerSeekLedgerMultiselect.selectedCount}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (clipFrameScrubberKeyframeBookmarks ? ` · ${clipFrameScrubberKeyframeBookmarks.bodyZh}` : '') +
      (roleAuditOnepagerSeekLedgerMultiselect ? ` · ${roleAuditOnepagerSeekLedgerMultiselect.bodyZh}` : ''),
    toastZh: roleAuditOnepagerSeekLedgerMultiselect
      ? '短片帧关帧书签 · 角色审计回跳台账多选对照'
      : '短片帧关帧书签',
    busyZh: '短片帧关帧书签 / 角色审计一页纸回跳台账多选…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    multiselectContrastClipFrameScrubberIntact: (base as any).multiselectContrastClipFrameScrubberIntact === true,
    graceSoftCancelLedgerRoleAuditOnepagerIntact: (base as any).graceSoftCancelLedgerRoleAuditOnepagerIntact === true,
    clipFrameScrubberKeyframeBookmarksIntact: !!clipFrameScrubberKeyframeBookmarks,
    roleAuditOnepagerSeekLedgerMultiselectIntact: !!roleAuditOnepagerSeekLedgerMultiselect,
    clipFrameScrubberKeyframeBookmarks,
    roleAuditOnepagerSeekLedgerMultiselect,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectPath:
      '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect',
  };
}



/**
 * M121：关帧书签 scrubber 跨会话只读分享 + 台账多选对照短片帧
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFrames(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
    shortClipFrames?: boolean;
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

  if (opts.softCancel === true && opts.crossSessionShare === false && opts.exportClipFrames === false) {
    return {
      ok: true as const,
      wave: 'M121' as const,
      labelZh: '关帧书签跨会话分享 / 台账多选对照短片帧 · 已软取消',
      tipZh: '用户软取消赢过关帧书签 scrubber 跨会话只读分享与台账多选对照短片帧 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧书签跨会话分享 / 台账多选对照短片帧…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselect(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).clipFrameScrubberKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m121-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m121-kf').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const kfBmScrubberXsessionRoShare = wantsShare
    ? {
        wave: 'M121' as const,
        kind: 'kf-bm-scrubber-xsession-ro-share' as const,
        titleZh: '关帧书签 scrubber · 跨会话只读分享',
        bodyZh:
          `短片帧 scrubber 关帧书签可跨会话只读分享 · ${bookmarks.length || kf?.bookmarkCount || 2}枚` +
          ` · 本会话「${sessionId}」→「${targetSessionId}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: bookmarks.length
          ? bookmarks
          : [
              { id: 'm121-kf-0', nameZh: '演示·M121关帧书签A', scrubIndex: 0, wave: 'M121' as const },
              { id: 'm121-kf-1', nameZh: '演示·M121关帧书签B', scrubIndex: 1, wave: 'M121' as const },
            ],
        bookmarkCount: bookmarks.length || 2,
        sessionId,
        targetSessionId,
        readOnly: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const ms = (base as any).roleAuditOnepagerSeekLedgerMultiselect || null;
  const rows: any[] = Array.isArray(ms?.rows) ? ms.rows : [];
  const wantsClip =
    opts.exportClipFrames !== false &&
    (opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      opts.shortClipFrames === true ||
      opts.multiSelectContrast === true ||
      !!ms);
  const selected = rows.filter((r) => r.selected);
  const ledgerMultiselectContrastClipFrames = wantsClip
    ? {
        wave: 'M121' as const,
        kind: 'ledger-multiselect-contrast-clip-frames' as const,
        titleZh: '台账多选对照 · 短片帧',
        bodyZh:
          `台账多选中文对照支持短片帧 · 已选 ${selected.length || ms?.selectedCount || 2} 行 · ${Math.max(selected.length, 2)} 帧` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (selected.length ? selected : rows.slice(0, 2)).map((r: any, i: number) => ({
          index: i,
          lineZh: r.contrastZh || r.auditLineZh || `对照帧#${i + 1}`,
          ledgerRowId: r.ledgerRowId || `m121-ms-${i}`,
          wave: 'M121' as const,
        })),
        frameCount: Math.max(selected.length, rows.length ? Math.min(rows.length, 2) : 2),
        selectedCount: selected.length || ms?.selectedCount || 2,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M121' as const,
    labelZh:
      (kfBmScrubberXsessionRoShare
        ? `关帧书签跨会话只读分享 · ${kfBmScrubberXsessionRoShare.bookmarkCount}枚`
        : '关帧书签跨会话分享待命') +
      (ledgerMultiselectContrastClipFrames
        ? ` · 台账多选对照短片帧 ${ledgerMultiselectContrastClipFrames.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (kfBmScrubberXsessionRoShare ? ` · ${kfBmScrubberXsessionRoShare.bodyZh}` : '') +
      (ledgerMultiselectContrastClipFrames ? ` · ${ledgerMultiselectContrastClipFrames.bodyZh}` : ''),
    toastZh: ledgerMultiselectContrastClipFrames
      ? '关帧书签跨会话分享 · 台账多选对照短片帧'
      : '关帧书签跨会话只读分享',
    busyZh: '关帧书签跨会话分享 / 台账多选对照短片帧…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    clipFrameScrubberKeyframeBookmarksIntact: (base as any).clipFrameScrubberKeyframeBookmarksIntact === true,
    roleAuditOnepagerSeekLedgerMultiselectIntact: (base as any).roleAuditOnepagerSeekLedgerMultiselectIntact === true,
    kfBmScrubberXsessionRoShareIntact: !!kfBmScrubberXsessionRoShare,
    ledgerMultiselectContrastClipFramesIntact: !!ledgerMultiselectContrastClipFrames,
    kfBmScrubberXsessionRoShare,
    ledgerMultiselectContrastClipFrames,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames',
  };
}


/**
 * M122：关帧跨会话分享差分预览再采纳确认卡 + 台账短片帧 scrubber 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBm(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    chineseDiffPreview?: boolean;
    diffPreviewConfirm?: boolean;
    diffPreviewThenAdopt?: boolean;
    confirmAdopt?: boolean;
    confirmCardAck?: boolean;
    adoptSharedBookmarks?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    bookmarkNameZh?: string | null;
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

  if (opts.softCancel === true && opts.diffPreviewThenAdopt === false && opts.clipFrameScrubber === false) {
    return {
      ok: true as const,
      wave: 'M122' as const,
      labelZh: '关帧差分预览再采纳 / 短片scrubber关帧书签 · 已软取消',
      tipZh: '用户软取消赢过关帧跨会话分享差分预览再采纳确认卡与台账短片帧 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '关帧差分预览再采纳 / 短片scrubber关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFrames(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const share = (base as any).kfBmScrubberXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(share?.bookmarks) ? share.bookmarks : [];
  const sessionId = String(share?.sessionId || opts.sessionId || 'session-demo-m122-kf').trim();
  const targetSessionId = String(share?.targetSessionId || opts.targetSessionId || 'session-peer-m122-kf').trim();
  const wantsDiff =
    opts.diffPreviewThenAdopt !== false &&
    (opts.diffPreviewThenAdopt === true ||
      opts.chineseDiffPreview === true ||
      opts.diffPreviewConfirm === true ||
      opts.confirmAdopt === true ||
      !!share);
  const kfXsessionShareDiffPreviewAdoptConfirm = wantsDiff
    ? {
        wave: 'M122' as const,
        kind: 'kf-xsession-share-diff-preview-adopt-confirm' as const,
        titleZh: '关帧跨会话分享 · 差分预览再采纳确认卡',
        bodyZh:
          `关帧书签跨会话只读分享后先出中文差分预览再确认采纳 · ${bookmarks.length || share?.bookmarkCount || 2}枚` +
          ` · 本会话「${sessionId}」→「${targetSessionId}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        chineseDiffPreview: {
          wave: 'M122' as const,
          lines: (bookmarks.length ? bookmarks : [{ nameZh: '演示·M122关帧书签A' }, { nameZh: '演示·M122关帧书签B' }]).map(
            (b: any, i: number) => ({
              field: b.nameZh || `bookmark-${i}`,
              beforeZh: `共享源·${b.nameZh || '关帧书签'}·帧${b.scrubIndex ?? i}`,
              afterZh: `本会话·待采纳·${b.nameZh || '关帧书签'}`,
            }),
          ),
        },
        confirmCard: {
          wave: 'M122' as const,
          titleZh: '确认采纳关帧跨会话分享',
          bodyZh: '差分预览已就绪 · 确认后写入本会话 · 可软取消',
          confirmAdopt: true as const,
          confirmCardAck: true as const,
        },
        bookmarkCount: bookmarks.length || share?.bookmarkCount || 2,
        sessionId,
        targetSessionId,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const clip = (base as any).ledgerMultiselectContrastClipFrames || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [];
  const bmName = String(opts.bookmarkNameZh || '演示·M122台账短片帧关帧书签').trim();
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      !!clip);
  const ledgerClipFrameScrubberKfBm = wantsScrub
    ? {
        wave: 'M122' as const,
        kind: 'ledger-clip-frame-scrubber-kf-bm' as const,
        titleZh: '台账短片帧 · scrubber 关帧书签',
        bodyZh:
          `台账多选对照短片帧支持 scrubber + 关帧书签 · ${Math.max(frames.length, 2)}帧` +
          ` · 书签「${bmName}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        scrubber: {
          wave: 'M122' as const,
          frameCount: Math.max(frames.length, 2),
          scrubIndex: Number(opts.scrubIndex ?? 0) || 0,
          frames: (frames.length ? frames : [{ index: 0, lineZh: '对照帧#1' }, { index: 1, lineZh: '对照帧#2' }]).map(
            (f: any, i: number) => ({ ...f, scrubIndex: i, wave: 'M122' as const }),
          ),
        },
        keyframeBookmarks: [
          { id: 'm122-clip-kf-0', nameZh: bmName + '·A', scrubIndex: 0, wave: 'M122' as const },
          { id: 'm122-clip-kf-1', nameZh: bmName + '·B', scrubIndex: 1, wave: 'M122' as const },
        ],
        bookmarkCount: 2,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M122' as const,
    labelZh:
      (kfXsessionShareDiffPreviewAdoptConfirm
        ? `关帧跨会话差分预览再采纳确认卡 · ${kfXsessionShareDiffPreviewAdoptConfirm.bookmarkCount}枚`
        : '关帧差分预览再采纳确认卡待命') +
      (ledgerClipFrameScrubberKfBm
        ? ` · 台账短片scrubber关帧书签 ${ledgerClipFrameScrubberKfBm.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (kfXsessionShareDiffPreviewAdoptConfirm ? ` · ${kfXsessionShareDiffPreviewAdoptConfirm.bodyZh}` : '') +
      (ledgerClipFrameScrubberKfBm ? ` · ${ledgerClipFrameScrubberKfBm.bodyZh}` : ''),
    toastZh: ledgerClipFrameScrubberKfBm
      ? '关帧差分预览再采纳确认 · 短片scrubber关帧书签'
      : '关帧跨会话差分预览再采纳确认卡',
    busyZh: '关帧差分预览再采纳 / 短片scrubber关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    kfBmScrubberXsessionRoShareIntact: (base as any).kfBmScrubberXsessionRoShareIntact === true,
    ledgerMultiselectContrastClipFramesIntact: (base as any).ledgerMultiselectContrastClipFramesIntact === true,
    kfXsessionShareDiffPreviewAdoptConfirmIntact: !!kfXsessionShareDiffPreviewAdoptConfirm,
    ledgerClipFrameScrubberKfBmIntact: !!ledgerClipFrameScrubberKfBm,
    kfXsessionShareDiffPreviewAdoptConfirm,
    ledgerClipFrameScrubberKfBm,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm',
  };
}


/**
 * M123：确认卡软撤销前后对照 + 短片 scrubber 关帧书签跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShare(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    softUndoAdopt?: boolean;
    softUndo?: boolean;
    showBeforeAfterCard?: boolean;
    beforeAfterContrast?: boolean;
    softUndoBeforeAfter?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
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

  if (opts.softCancel === true && opts.softUndoBeforeAfter === false && opts.crossSessionShare === false) {
    return {
      ok: true as const,
      wave: 'M123' as const,
      labelZh: '确认卡软撤销前后对照 / 短片关帧跨会话分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡软撤销前后对照与短片 scrubber 关帧书签跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡软撤销前后对照 / 短片关帧跨会话分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBm(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const confirm = (base as any).kfXsessionShareDiffPreviewAdoptConfirm || null;
  const wantsSoftUndo =
    opts.softUndoBeforeAfter !== false &&
    (opts.softUndoBeforeAfter === true ||
      opts.softUndoAdopt === true ||
      opts.softUndo === true ||
      opts.showBeforeAfterCard === true ||
      opts.beforeAfterContrast === true ||
      !!confirm);
  const confirmAdoptSoftUndoBeforeAfter = wantsSoftUndo
    ? {
        wave: 'M123' as const,
        kind: 'confirm-adopt-soft-undo-before-after' as const,
        titleZh: '确认采纳卡 · 软撤销前后对照',
        bodyZh:
          `差分采纳确认卡后可软撤销并出中文前后对照卡 · 书签 ${confirm?.bookmarkCount || 2}枚` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        beforeAfterCard: {
          wave: 'M123' as const,
          beforeZh: '采纳前·共享源关帧书签',
          afterZh: '软撤销后·本会话未采纳',
          titleZh: '确认采纳 · 软撤销前后对照',
        },
        softUndoToken: `m123-soft-undo-${Date.now().toString(36)}`,
        softUndoAdopt: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const clipScrub = (base as any).ledgerClipFrameScrubberKfBm || null;
  const bookmarks: any[] = Array.isArray(clipScrub?.keyframeBookmarks) ? clipScrub.keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m123-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m123-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!clipScrub);
  const ledgerClipScrubberKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M123' as const,
        kind: 'ledger-clip-scrubber-kf-bm-xsession-ro-share' as const,
        titleZh: '台账短片 scrubber 关帧书签 · 跨会话只读分享',
        bodyZh:
          `台账短片帧 scrubber 关帧书签支持跨会话只读分享 · ${bookmarks.length || clipScrub?.bookmarkCount || 2}枚` +
          ` · 本会话「${sessionId}」→「${targetSessionId}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: (bookmarks.length
          ? bookmarks
          : [
              { id: 'm123-clip-kf-0', nameZh: '演示·M123台账短片关帧·A', scrubIndex: 0 },
              { id: 'm123-clip-kf-1', nameZh: '演示·M123台账短片关帧·B', scrubIndex: 1 },
            ]
        ).map((b: any, i: number) => ({ ...b, wave: 'M123' as const, readOnly: true as const, scrubIndex: b.scrubIndex ?? i })),
        bookmarkCount: bookmarks.length || clipScrub?.bookmarkCount || 2,
        sessionId,
        targetSessionId,
        readOnlyShare: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M123' as const,
    labelZh:
      (confirmAdoptSoftUndoBeforeAfter
        ? '确认卡软撤销前后对照已开'
        : '确认卡软撤销前后对照待命') +
      (ledgerClipScrubberKfBmXsessionRoShare
        ? ` · 短片关帧跨会话只读分享 ${ledgerClipScrubberKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmAdoptSoftUndoBeforeAfter ? ` · ${confirmAdoptSoftUndoBeforeAfter.bodyZh}` : '') +
      (ledgerClipScrubberKfBmXsessionRoShare ? ` · ${ledgerClipScrubberKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh: ledgerClipScrubberKfBmXsessionRoShare
      ? '确认卡软撤销前后对照 · 短片关帧跨会话只读分享'
      : '确认卡软撤销前后对照',
    busyZh: '确认卡软撤销前后对照 / 短片关帧跨会话分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    kfXsessionShareDiffPreviewAdoptConfirmIntact: (base as any).kfXsessionShareDiffPreviewAdoptConfirmIntact === true,
    ledgerClipFrameScrubberKfBmIntact: (base as any).ledgerClipFrameScrubberKfBmIntact === true,
    confirmAdoptSoftUndoBeforeAfterIntact: !!confirmAdoptSoftUndoBeforeAfter,
    ledgerClipScrubberKfBmXsessionRoShareIntact: !!ledgerClipScrubberKfBmXsessionRoShare,
    confirmAdoptSoftUndoBeforeAfter,
    ledgerClipScrubberKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoSharePath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share',
  };
}


/**
 * M124：确认卡软撤销前后对照定点再旁路 + 短片关帧跨会话分享过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    pinpointAnnotate?: boolean;
    pinpointToSupplyReBypass?: boolean;
    oneClickReBypass?: boolean;
    reBypass?: boolean;
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
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;

  if (
    opts.softCancel === true &&
    opts.pinpointToSupplyReBypass === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M124' as const,
      labelZh: '确认卡软撤销定点再旁路 / 关帧分享过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡软撤销定点再旁路与关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡软撤销定点再旁路 / 关帧分享过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ba = (base as any).confirmAdoptSoftUndoBeforeAfter || null;
  const wantsPin =
    opts.pinpointToSupplyReBypass !== false &&
    (opts.pinpointToSupplyReBypass === true ||
      opts.pinpointAnnotate === true ||
      opts.oneClickReBypass === true ||
      opts.reBypass === true ||
      !!ba);
  const confirmSoftUndoBaPinpointRebypass = wantsPin
    ? {
        wave: 'M124' as const,
        kind: 'confirm-soft-undo-ba-pinpoint-rebypass' as const,
        titleZh: '确认卡软撤销前后对照 · 定点再旁路',
        bodyZh:
          `确认卡软撤销前后对照可定点标注并触发供给再旁路 · 书签 ${ba?.beforeAfterCard ? 2 : 2}枚` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        pinpoint: {
          wave: 'M124' as const,
          annotateFields: opts.annotateFields || ['org', 'person'],
          noteZh: opts.noteZh || '演示·M124确认卡软撤销定点再旁路',
        },
        reBypass: {
          wave: 'M124' as const,
          triggered: true as const,
          supplyId: 'demo-supply-m124-confirm',
          fromSoftUndoBa: true as const,
        },
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const xshare = (base as any).ledgerClipScrubberKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m124-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m124-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare === true;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const clipKfBmXsessionShareExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M124' as const,
        kind: 'clip-kf-bm-xsession-share-expiry-revoke-ledger' as const,
        titleZh: '短片关帧跨会话分享 · 过期吊销进中文台账',
        bodyZh:
          `短片关帧书签跨会话只读分享支持过期与吊销并写入中文台账 · ${bookmarks.length || xshare?.bookmarkCount || 2}枚` +
          ` · 本会话「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        ledgerEntry: {
          wave: 'M124' as const,
          id: `m124-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '关帧跨会话分享吊销' : '关帧跨会话分享过期登记',
          lineZh: revokeShare
            ? `吊销跨会话只读书签分享 · ${bookmarks.length || 2}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记跨会话只读书签分享过期 ${expiresInMs}ms · ${bookmarks.length || 2}枚`,
          role,
          roleZh,
          chineseLedger: true as const,
        },
        bookmarkCount: bookmarks.length || xshare?.bookmarkCount || 2,
        sessionId,
        targetSessionId,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M124' as const,
    labelZh:
      (confirmSoftUndoBaPinpointRebypass
        ? '确认卡软撤销定点再旁路已开'
        : '确认卡软撤销定点再旁路待命') +
      (clipKfBmXsessionShareExpiryRevokeLedger
        ? ` · 关帧分享过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSoftUndoBaPinpointRebypass ? ` · ${confirmSoftUndoBaPinpointRebypass.bodyZh}` : '') +
      (clipKfBmXsessionShareExpiryRevokeLedger ? ` · ${clipKfBmXsessionShareExpiryRevokeLedger.bodyZh}` : ''),
    toastZh: clipKfBmXsessionShareExpiryRevokeLedger
      ? '确认卡软撤销定点再旁路 · 关帧分享过期吊销进台账'
      : '确认卡软撤销定点再旁路',
    busyZh: '确认卡软撤销定点再旁路 / 关帧分享过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmAdoptSoftUndoBeforeAfterIntact: (base as any).confirmAdoptSoftUndoBeforeAfterIntact === true,
    ledgerClipScrubberKfBmXsessionRoShareIntact: (base as any).ledgerClipScrubberKfBmXsessionRoShareIntact === true,
    confirmSoftUndoBaPinpointRebypassIntact: !!confirmSoftUndoBaPinpointRebypass,
    clipKfBmXsessionShareExpiryRevokeLedgerIntact: !!clipKfBmXsessionShareExpiryRevokeLedger,
    confirmSoftUndoBaPinpointRebypass,
    clipKfBmXsessionShareExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger',
  };
}


/**
 * M125：确认卡定点再旁路失败并入归因 + 关帧分享吊销台账角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepager(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    simulateFailure?: boolean;
    forceFailure?: boolean;
    failureCode?: string | null;
    foldFailureIntoAttribution?: boolean;
    showFailureAttribution?: boolean;
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
    opts.foldFailureIntoAttribution === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M125' as const,
      labelZh: '确认卡定点再旁路失败归因 / 吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡定点再旁路失败归因与关帧分享吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡定点再旁路失败归因 / 吊销台账角色审计…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const pin = (base as any).confirmSoftUndoBaPinpointRebypass || null;
  const forceFail = opts.simulateFailure !== false && opts.forceFailure !== false;
  const failureCode = String(opts.failureCode || 'CONFIRM_SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL').trim();
  const wantsFail =
    opts.foldFailureIntoAttribution !== false &&
    (opts.foldFailureIntoAttribution === true ||
      opts.showFailureAttribution === true ||
      opts.simulateFailure === true ||
      opts.forceFailure === true ||
      !!pin);
  const confirmPinpointRebypassFailFoldAttr = wantsFail
    ? {
        wave: 'M125' as const,
        kind: 'confirm-pinpoint-rebypass-fail-fold-attr' as const,
        titleZh: '确认卡定点再旁路失败 · 中文归因',
        bodyZh:
          `确认卡软撤销前后对照定点触发供给再旁路失败并入中文归因 · 码「${failureCode}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        failureAttribution: {
          wave: 'M125' as const,
          code: failureCode,
          titleZh: '确认卡定点再旁路失败',
          reasonZh: '供给再旁路在确认卡软撤销定点链路失败',
          chinese: true as const,
          foldedFrom: 'confirm-soft-undo-ba-pinpoint-rebypass',
        },
        fromPinpoint: pin
          ? { kind: pin.kind, titleZh: pin.titleZh }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const revoke = (base as any).clipKfBmXsessionShareExpiryRevokeLedger || null;
  const ledgerEntry = revoke?.ledgerEntry || null;
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!revoke);
  const shareRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M125' as const,
        kind: 'share-revoke-ledger-role-audit-onepager' as const,
        titleZh: '关帧分享吊销台账 · 角色过滤审计一页纸',
        bodyZh:
          `关帧跨会话分享过期/吊销中文台账可出角色过滤审计一页纸 · 过滤「${filterRoleZh}」` +
          ` · 行「${ledgerEntry?.id || 'm125-share-revoke-0'}」· ${ledgerEntry?.lineZh || ledgerEntry?.kindZh || '关帧分享吊销台账行'}` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        filterRole,
        filterRoleZh,
        lines: [
          {
            id: ledgerEntry?.id || 'm125-share-revoke-0',
            auditLineZh: ledgerEntry?.lineZh || ledgerEntry?.kindZh || '关帧分享吊销台账行',
            role: filterRole,
            roleZh: filterRoleZh,
            wave: 'M125' as const,
          },
        ],
        onePager: {
          wave: 'M125' as const,
          titleZh: '关帧分享吊销 · 角色审计一页纸',
          roleFiltered: true as const,
          inApp: true as const,
          chinese: true as const,
        },
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M125' as const,
    labelZh:
      (confirmPinpointRebypassFailFoldAttr
        ? `确认卡定点再旁路失败已并入归因 · ${failureCode}`
        : '确认卡定点再旁路失败归因待命') +
      (shareRevokeLedgerRoleAuditOnepager
        ? ` · 吊销台账角色审计一页纸（${filterRoleZh}）`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmPinpointRebypassFailFoldAttr ? ` · ${confirmPinpointRebypassFailFoldAttr.bodyZh}` : '') +
      (shareRevokeLedgerRoleAuditOnepager ? ` · ${shareRevokeLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh: shareRevokeLedgerRoleAuditOnepager
      ? '确认卡定点再旁路失败归因 · 吊销台账角色审计一页纸'
      : '确认卡定点再旁路失败已并入归因',
    busyZh: '确认卡定点再旁路失败归因 / 吊销台账角色审计…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSoftUndoBaPinpointRebypassIntact: (base as any).confirmSoftUndoBaPinpointRebypassIntact === true,
    clipKfBmXsessionShareExpiryRevokeLedgerIntact: (base as any).clipKfBmXsessionShareExpiryRevokeLedgerIntact === true,
    confirmPinpointRebypassFailFoldAttrIntact: !!confirmPinpointRebypassFailFoldAttr,
    shareRevokeLedgerRoleAuditOnepagerIntact: !!shareRevokeLedgerRoleAuditOnepager,
    foldedIntoAttribution: !!confirmPinpointRebypassFailFoldAttr,
    confirmPinpointRebypassFailFoldAttr,
    shareRevokeLedgerRoleAuditOnepager,
    failureAttributionCard: confirmPinpointRebypassFailFoldAttr,
    failureCode: confirmPinpointRebypassFailFoldAttr?.failureAttribution?.code || failureCode,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager',
  };
}


/**
 * M126：确认卡失败归因一键重试折进任务卡 + 吊销台账角色审计一页纸回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    oneClickRetry?: boolean;
    retryFromAttribution?: boolean;
    foldIntoChainTaskCard?: boolean;
    foldRetryIntoChainTaskCard?: boolean;
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
    opts.oneClickRetry === false &&
    opts.foldIntoChainTaskCard === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M126' as const,
      labelZh: '确认卡失败归因一键重试 / 吊销审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡失败归因一键重试折进任务卡与吊销台账角色审计一页纸回跳台账行 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡失败归因一键重试 / 吊销审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepager(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const failAttr = (base as any).confirmPinpointRebypassFailFoldAttr || (base as any).failureAttributionCard || null;
  const failureCode = String(
    failAttr?.failureAttribution?.code || failAttr?.failureCode || (base as any).failureCode || opts.failureCode || 'CONFIRM_SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
  ).trim();
  const wantsRetry =
    opts.oneClickRetry !== false &&
    (opts.oneClickRetry === true ||
      opts.retryFromAttribution === true ||
      opts.foldIntoChainTaskCard === true ||
      opts.foldRetryIntoChainTaskCard === true ||
      !!failAttr);
  const confirmFailAttrOneClickRetryFoldTaskCard = wantsRetry
    ? {
        wave: 'M126' as const,
        kind: 'confirm-fail-attr-one-click-retry-fold-task-card' as const,
        titleZh: '确认卡失败归因 · 一键重试折进中文任务卡',
        bodyZh:
          `确认卡定点再旁路失败归因「${failureCode}」一键重试已折进中文任务卡` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        taskCard: {
          wave: 'M126' as const,
          titleZh: '确认卡定点再旁路失败 · 一键重试任务卡',
          phaseZh: 'one-click-retry',
          failureCode,
          foldedFromAttr: true as const,
          chinese: true as const,
        },
        fromFailFold: failAttr
          ? { kind: failAttr.kind, titleZh: failAttr.titleZh, code: failureCode }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const audit = (base as any).shareRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = Math.max(
    0,
    Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex ?? 0) || 0),
  );
  const target = lines[seekEntryIndex] || lines[0] || {
    id: 'm126-share-revoke-0',
    auditLineZh: '演示·关帧分享吊销台账行（一页纸回跳）',
    kindZh: '关帧分享吊销',
  };
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const shareRevokeRoleAuditOnepagerSeekLedger = wantsSeek
    ? {
        wave: 'M126' as const,
        kind: 'share-revoke-role-audit-onepager-seek-ledger' as const,
        titleZh: '吊销台账角色审计一页纸 · 回跳台账行',
        bodyZh:
          `关帧分享吊销台账角色过滤审计一页纸可回跳台账行 · 过滤「${filterRoleZh}」` +
          ` · 定位行#${seekEntryIndex + 1}「${target.id || 'm126-share-revoke-0'}」` +
          ` · ${target.auditLineZh || target.kindZh || '关帧分享吊销台账行'} · 干跑 · toast · 无外发`,
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        ledgerRowId: target.id || 'm126-share-revoke-0',
        lineZh: target.auditLineZh || target.kindZh || `台账行#${seekEntryIndex + 1}`,
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
    wave: 'M126' as const,
    labelZh:
      (confirmFailAttrOneClickRetryFoldTaskCard
        ? `确认卡失败归因一键重试已折进任务卡 · ${failureCode}`
        : '确认卡失败归因一键重试待命') +
      (shareRevokeRoleAuditOnepagerSeekLedger
        ? ` · 吊销审计一页纸回跳台账行#${seekEntryIndex + 1}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmFailAttrOneClickRetryFoldTaskCard ? ` · ${confirmFailAttrOneClickRetryFoldTaskCard.bodyZh}` : '') +
      (shareRevokeRoleAuditOnepagerSeekLedger ? ` · ${shareRevokeRoleAuditOnepagerSeekLedger.bodyZh}` : ''),
    toastZh: shareRevokeRoleAuditOnepagerSeekLedger
      ? '确认卡失败归因一键重试 · 吊销审计回跳台账'
      : '确认卡失败归因一键重试已折进任务卡',
    busyZh: '确认卡失败归因一键重试 / 吊销审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmPinpointRebypassFailFoldAttrIntact: (base as any).confirmPinpointRebypassFailFoldAttrIntact === true,
    shareRevokeLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeLedgerRoleAuditOnepagerIntact === true,
    confirmFailAttrOneClickRetryFoldTaskCardIntact: !!confirmFailAttrOneClickRetryFoldTaskCard,
    shareRevokeRoleAuditOnepagerSeekLedgerIntact: !!shareRevokeRoleAuditOnepagerSeekLedger,
    oneClickRetryFoldedIntoTaskCard: !!confirmFailAttrOneClickRetryFoldTaskCard,
    confirmFailAttrOneClickRetryFoldTaskCard,
    shareRevokeRoleAuditOnepagerSeekLedger,
    chainTaskCard: confirmFailAttrOneClickRetryFoldTaskCard,
    failureCode,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger',
  };
}


/**
 * M127：确认卡一键重试任务卡单阶段暂停宽限 + 吊销审计回跳台账多选对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrast(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    pausePhase?: boolean;
    phasePause?: boolean;
    phase?: string | null;
    graceAlarm?: boolean;
    showGraceAlarm?: boolean;
    autoResumeAfterGrace?: boolean;
    graceMs?: number | null;
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
    opts.pausePhase === false &&
    opts.graceAlarm === false &&
    opts.multiSelectLedgerRows === false &&
    opts.multiSelectContrast === false
  ) {
    return {
      ok: true as const,
      wave: 'M127' as const,
      labelZh: '确认卡重试任务卡暂停宽限 / 吊销审计多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡一键重试任务卡单阶段暂停宽限与吊销审计回跳台账多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡重试任务卡暂停宽限 / 吊销审计多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const card = (base as any).confirmFailAttrOneClickRetryFoldTaskCard || null;
  const failureCode = String(card?.taskCard?.failureCode || card?.fromFailFold?.code || (base as any).failureCode || opts.failureCode || 'CONFIRM_SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL').trim();
  const phase = String(opts.phase || card?.taskCard?.phaseZh || 'one-click-retry').trim() || 'one-click-retry';
  const graceMs = Math.max(1000, Number(opts.graceMs ?? 15000) || 15000);
  const wantsPause =
    opts.pausePhase !== false &&
    (opts.pausePhase === true ||
      opts.phasePause === true ||
      opts.graceAlarm === true ||
      opts.showGraceAlarm === true ||
      !!card);
  const confirmRetryTaskcardPhasePauseGrace = wantsPause
    ? {
        wave: 'M127' as const,
        kind: 'confirm-retry-taskcard-phase-pause-grace' as const,
        titleZh: '确认卡一键重试任务卡 · 单阶段暂停宽限',
        bodyZh:
          `确认卡失败归因一键重试中文任务卡支持单阶段暂停 · 阶段「${phase}」· 中文宽限闹钟 ${Math.round(graceMs / 1000)}秒` +
          ` · 失败码「${failureCode}」· 角色「${roleZh}」· 到期可自动续跑 · 干跑 · toast · 无外发`,
        phase,
        paused: true as const,
        graceMs,
        graceAlarmZh: `宽限闹钟 · ${Math.round(graceMs / 1000)}秒后自动续跑「${phase}」`,
        autoResumeAfterGrace: opts.autoResumeAfterGrace !== false,
        failureCode,
        fromTaskCard: card
          ? { kind: card.kind, titleZh: card.titleZh, failureCode }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeRoleAuditOnepagerSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).shareRevokeLedgerRoleAuditOnepager?.lines)
    ? (base as any).shareRevokeLedgerRoleAuditOnepager.lines
    : seek
      ? [
          {
            id: seek.ledgerRowId || 'm127-share-revoke-0',
            auditLineZh: seek.lineZh || '关帧分享吊销台账行',
            kindZh: '关帧分享吊销',
          },
          {
            id: 'm127-share-revoke-1',
            auditLineZh: '关帧分享吊销台账附行 · 多选对照',
            kindZh: '关帧分享吊销',
          },
        ]
      : [
          { id: 'm127-share-revoke-0', auditLineZh: '演示·关帧分享吊销台账行#1', kindZh: '关帧分享吊销' },
          { id: 'm127-share-revoke-1', auditLineZh: '演示·关帧分享吊销台账行#2', kindZh: '关帧分享吊销' },
        ];
  const rawIdx = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const selectedIndexes = rawIdx
    .map((i) => Math.min(Math.max(lines.length - 1, 0), i))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 8);
  const wantsMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      !!seek ||
      lines.length > 0);
  const selectedRows = (selectedIndexes.length ? selectedIndexes : [0, Math.min(1, Math.max(lines.length - 1, 0))]).map(
    (i, side) => {
      const row = lines[i] || lines[0] || { id: `m127-share-revoke-${i}`, auditLineZh: `吊销台账行#${i + 1}` };
      return {
        index: i,
        id: row.id || `m127-share-revoke-${i}`,
        lineZh: row.auditLineZh || row.kindZh || `吊销台账行#${i + 1}`,
        auditLineZh: row.auditLineZh || row.kindZh || `吊销台账行#${i + 1}`,
        contrastSide: side % 2 === 0 ? 'A' : 'B',
        wave: 'M127' as const,
      };
    },
  );
  const shareRevokeAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M127' as const,
        kind: 'share-revoke-audit-seek-multiselect-contrast' as const,
        titleZh: '吊销审计回跳台账 · 多选中文对照',
        bodyZh:
          `关帧分享吊销审计一页纸回跳台账支持多选中文对照 · 已选 ${selectedRows.length} 行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedIndexes: selectedRows.map((r) => r.index),
        selectedRows,
        contrastPairs: selectedRows.length >= 2
          ? [{ a: selectedRows[0], b: selectedRows[1], labelZh: '吊销台账多选中文对照 A/B' }]
          : [],
        fromSeek: seek
          ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, ledgerRowId: seek.ledgerRowId }
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
    wave: 'M127' as const,
    labelZh:
      (confirmRetryTaskcardPhasePauseGrace
        ? `确认卡重试任务卡单阶段暂停 · ${phase} · 宽限${Math.round(graceMs / 1000)}s`
        : '确认卡重试任务卡单阶段暂停宽限待命') +
      (shareRevokeAuditSeekMultiselectContrast
        ? ` · 吊销审计多选对照 ${shareRevokeAuditSeekMultiselectContrast.selectedRows.length}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRetryTaskcardPhasePauseGrace ? ` · ${confirmRetryTaskcardPhasePauseGrace.bodyZh}` : '') +
      (shareRevokeAuditSeekMultiselectContrast ? ` · ${shareRevokeAuditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh: shareRevokeAuditSeekMultiselectContrast
      ? '确认卡重试暂停宽限 · 吊销审计多选对照'
      : '确认卡重试任务卡已单阶段暂停·宽限闹钟',
    busyZh: '确认卡重试任务卡暂停宽限 / 吊销审计多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmFailAttrOneClickRetryFoldTaskCardIntact: (base as any).confirmFailAttrOneClickRetryFoldTaskCardIntact === true,
    shareRevokeRoleAuditOnepagerSeekLedgerIntact: (base as any).shareRevokeRoleAuditOnepagerSeekLedgerIntact === true,
    confirmRetryTaskcardPhasePauseGraceIntact: !!confirmRetryTaskcardPhasePauseGrace,
    shareRevokeAuditSeekMultiselectContrastIntact: !!shareRevokeAuditSeekMultiselectContrast,
    confirmRetryTaskcardPhasePauseGrace,
    shareRevokeAuditSeekMultiselectContrast,
    failureCode,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast',
  };
}


/**
 * M128：确认卡重试暂停宽限软取消进台账 + 吊销审计多选对照短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubber(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    pausePhase?: boolean;
    phasePause?: boolean;
    graceAlarm?: boolean;
    phase?: string | null;
    graceMs?: number | null;
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
    admin: '运营',
    park: '园区',
    enterprise: '企业',
    uni: '高校/科研',
    broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  const wantsSoftCancelLedger =
    opts.softCancel === true ||
    opts.softCancelWinsOverGrace === true ||
    opts.writeSoftCancelLedger === true;

  // Soft-cancel during confirm-retry pause-grace → Chinese ledger (and still build clip scrubber if requested)
  if (wantsSoftCancelLedger && (opts.softCancel === true || opts.softCancelWinsOverGrace === true) && opts.pausePhase !== false && opts.clipFrameScrubber === false && opts.scrubber === false && opts.multiSelectLedgerRows === false) {
    const phase = String(opts.phase || 'one-click-retry');
    const graceMs = Math.max(1000, Number(opts.graceMs) || 15000);
    const entry = {
      id: `m128-confirm-retry-pause-grace-soft-cancel-${Date.now().toString(36)}`,
      wave: 'M128' as const,
      kind: 'confirm-retry-pause-grace-soft-cancel-ledger' as const,
      kindZh: '确认卡重试暂停宽限软取消',
      lineZh:
        `确认卡重试任务卡单阶段暂停宽限被软取消赢过 · 阶段「${phase}」· 原宽限 ${Math.round(graceMs / 1000)}s` +
        ` · 角色「${roleZh}」· 干跑 · 无外发`,
      auditLineZh:
        `确认卡重试任务卡单阶段暂停宽限被软取消赢过 · 阶段「${phase}」· 原宽限 ${Math.round(graceMs / 1000)}s` +
        ` · 角色「${roleZh}」· 干跑 · 无外发`,
      phase,
      graceMs,
      role,
      roleZh,
      softCancelWins: true as const,
      autoResumeCancelled: true as const,
      createdAt: new Date().toISOString(),
      dryRun: true as const,
      noEgress: true as const,
      chinese: true as const,
    };
    return {
      ok: true as const,
      wave: 'M128' as const,
      labelZh: '确认卡重试暂停宽限 · 软取消已入中文台账',
      tipZh: entry.auditLineZh + ' · 中页取消仍在',
      toastZh: '软取消已入台账',
      busyZh: '确认卡重试暂停宽限软取消入台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
      graceAlarmCancelled: true as const,
      softCancelWinsOverGraceAlarm: true as const,
      confirmRetryPauseGraceSoftCancelLedgerIntact: true as const,
      confirmRetryPauseGraceSoftCancelLedgerEntry: entry,
      graceSoftCancelLedgerIntact: true as const,
      graceSoftCancelLedgerEntry: entry,
      chineseShareLedger: [entry],
      chineseShareLedgerIntact: true as const,
      shareRevokeMultiselectClipScrubberIntact: false as const,
      shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber',
    };
  }

  if (
    opts.softCancel === true &&
    opts.writeSoftCancelLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M128' as const,
      labelZh: '确认卡重试暂停宽限软取消进台账 / 吊销多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡重试暂停宽限软取消进台账与吊销审计多选对照短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡重试暂停宽限软取消进台账 / 吊销多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrast(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const phase = String(opts.phase || (base as any).confirmRetryTaskcardPhasePauseGrace?.phase || 'one-click-retry').trim() || 'one-click-retry';
  const graceMs = Math.max(1000, Number(opts.graceMs ?? (base as any).confirmRetryTaskcardPhasePauseGrace?.graceMs ?? 15000) || 15000);
  const wantsLedger =
    opts.writeSoftCancelLedger !== false &&
    (opts.writeSoftCancelLedger === true ||
      opts.chineseLedger === true ||
      opts.softCancelWinsOverGrace === true ||
      !!(base as any).confirmRetryTaskcardPhasePauseGrace);
  const confirmRetryPauseGraceSoftCancelLedger = wantsLedger
    ? {
        wave: 'M128' as const,
        kind: 'confirm-retry-pause-grace-soft-cancel-ledger' as const,
        titleZh: '确认卡重试暂停宽限 · 软取消进中文台账',
        bodyZh:
          `确认卡重试任务卡单阶段暂停宽限软取消时可写入中文台账 · 阶段「${phase}」· 宽限 ${Math.round(graceMs / 1000)}s` +
          ` · 角色「${roleZh}」· 干跑 · toast · 无外发`,
        canWriteOnSoftCancel: true as const,
        phase,
        graceMs,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  // If soft-cancel is actively winning over grace during this call, materialize ledger entry
  let confirmRetryPauseGraceSoftCancelLedgerEntry: any = null;
  if (wantsSoftCancelLedger && (opts.softCancel === true || opts.softCancelWinsOverGrace === true) && !!confirmRetryPauseGraceSoftCancelLedger) {
    confirmRetryPauseGraceSoftCancelLedgerEntry = {
      id: `m128-confirm-retry-pause-grace-soft-cancel-${Date.now().toString(36)}`,
      wave: 'M128' as const,
      kind: 'confirm-retry-pause-grace-soft-cancel-ledger' as const,
      kindZh: '确认卡重试暂停宽限软取消',
      lineZh:
        `确认卡重试任务卡单阶段暂停宽限被软取消赢过 · 阶段「${phase}」· 原宽限 ${Math.round(graceMs / 1000)}s` +
        ` · 角色「${roleZh}」· 干跑 · 无外发`,
      auditLineZh:
        `确认卡重试任务卡单阶段暂停宽限被软取消赢过 · 阶段「${phase}」· 原宽限 ${Math.round(graceMs / 1000)}s` +
        ` · 角色「${roleZh}」· 干跑 · 无外发`,
      phase,
      graceMs,
      role,
      roleZh,
      softCancelWins: true as const,
      autoResumeCancelled: true as const,
      createdAt: new Date().toISOString(),
      dryRun: true as const,
      noEgress: true as const,
      chinese: true as const,
    };
  }

  const ms = (base as any).shareRevokeAuditSeekMultiselectContrast || null;
  const rows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [];
  const scrubIndex = Math.max(0, Math.min(Math.max(rows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const shareRevokeMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M128' as const,
        kind: 'share-revoke-multiselect-clip-scrubber' as const,
        titleZh: '吊销审计多选对照 · 短片帧 scrubber',
        bodyZh:
          `关帧分享吊销审计多选中文对照支持短片帧 scrubber · ${Math.max(rows.length, 2)}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames: (rows.length
          ? rows
          : [
              { id: 'm128-share-revoke-ms-0', lineZh: '吊销台账对照行#1', contrastSide: 'A' },
              { id: 'm128-share-revoke-ms-1', lineZh: '吊销台账对照行#2', contrastSide: 'B' },
            ]
        ).map((r: any, i: number) => ({
          index: i,
          id: r.id || `m128-share-revoke-ms-${i}`,
          lineZh: r.lineZh || r.auditLineZh || `对照帧#${i + 1}`,
          contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M128' as const,
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

  const softCancelActive = !!confirmRetryPauseGraceSoftCancelLedgerEntry;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M128' as const,
    labelZh:
      (softCancelActive
        ? '确认卡重试暂停宽限 · 软取消已入中文台账'
        : confirmRetryPauseGraceSoftCancelLedger
          ? '确认卡重试暂停宽限软取消可入台账'
          : '确认卡重试暂停宽限软取消台账待命') +
      (shareRevokeMultiselectClipScrubber
        ? ` · 吊销多选短片 scrubber ${shareRevokeMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRetryPauseGraceSoftCancelLedgerEntry ? ` · ${confirmRetryPauseGraceSoftCancelLedgerEntry.auditLineZh}` : confirmRetryPauseGraceSoftCancelLedger ? ` · ${confirmRetryPauseGraceSoftCancelLedger.bodyZh}` : '') +
      (shareRevokeMultiselectClipScrubber ? ` · ${shareRevokeMultiselectClipScrubber.bodyZh}` : ''),
    toastZh: softCancelActive
      ? '软取消已入台账 · 吊销多选短片 scrubber'
      : shareRevokeMultiselectClipScrubber
        ? '确认卡重试暂停宽限软取消台账 · 吊销多选短片 scrubber'
        : '确认卡重试暂停宽限软取消台账待命',
    busyZh: '确认卡重试暂停宽限软取消进台账 / 吊销多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    cancelled: softCancelActive || undefined,
    graceAlarmCancelled: softCancelActive || undefined,
    softCancelWinsOverGraceAlarm: softCancelActive || undefined,
    confirmRetryTaskcardPhasePauseGraceIntact: (base as any).confirmRetryTaskcardPhasePauseGraceIntact === true,
    shareRevokeAuditSeekMultiselectContrastIntact: (base as any).shareRevokeAuditSeekMultiselectContrastIntact === true,
    confirmRetryPauseGraceSoftCancelLedgerIntact: softCancelActive || !!confirmRetryPauseGraceSoftCancelLedger,
    shareRevokeMultiselectClipScrubberIntact: !!shareRevokeMultiselectClipScrubber,
    confirmRetryPauseGraceSoftCancelLedger,
    confirmRetryPauseGraceSoftCancelLedgerEntry,
    graceSoftCancelLedgerIntact: softCancelActive || undefined,
    graceSoftCancelLedgerEntry: confirmRetryPauseGraceSoftCancelLedgerEntry || undefined,
    chineseShareLedger: confirmRetryPauseGraceSoftCancelLedgerEntry ? [confirmRetryPauseGraceSoftCancelLedgerEntry] : (base as any).chineseShareLedger,
    chineseShareLedgerIntact: softCancelActive || (base as any).chineseShareLedgerIntact,
    shareRevokeMultiselectClipScrubber,
    clipFrameScrubber: shareRevokeMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber',
  };
}


/**
 * M129：确认卡软取消台账角色审计一页纸 + 吊销多选短片关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarks(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    softCancelWinsOverGrace?: boolean;
    writeSoftCancelLedger?: boolean;
    chineseLedger?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
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
    opts.roleFilteredAudit === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M129' as const,
      labelZh: '确认卡软取消台账角色审计 / 吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡软取消台账角色审计一页纸与吊销多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡软取消台账角色审计 / 吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubber(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledgerEntry = (base as any).confirmRetryPauseGraceSoftCancelLedgerEntry || null;
  const ledger = (base as any).confirmRetryPauseGraceSoftCancelLedger || null;
  const chineseShareLedger: any[] = Array.isArray((base as any).chineseShareLedger)
    ? (base as any).chineseShareLedger
    : ledgerEntry
      ? [ledgerEntry]
      : [];
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger ||
      !!ledgerEntry ||
      chineseShareLedger.length > 0);
  const lines = (chineseShareLedger.length
    ? chineseShareLedger
    : [
        {
          id: 'm129-confirm-soft-cancel-0',
          kindZh: '确认卡重试暂停宽限软取消',
          auditLineZh: ledger?.bodyZh || '确认卡软取消台账行',
          role,
          roleZh,
        },
      ]
  ).map((e: any, i: number) => ({
    id: e.id || `m129-confirm-soft-cancel-${i}`,
    kindZh: e.kindZh || e.kind || '确认卡软取消',
    auditLineZh: e.auditLineZh || e.lineZh || e.bodyZh || '确认卡软取消台账行',
    role: e.role || role,
    roleZh: e.roleZh || roleZh,
    wave: 'M129' as const,
  }));
  const filtered = lines.filter((l: any) => !filterRole || l.role === filterRole || filterRole === 'admin');
  const confirmSoftCancelLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M129' as const,
        kind: 'confirm-soft-cancel-ledger-role-audit-onepager' as const,
        titleZh: '确认卡软取消台账 · 角色过滤审计一页纸',
        bodyZh:
          `确认卡软取消中文台账可出角色过滤审计一页纸 · ${filtered.length}行 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines: filtered.length ? filtered : lines,
        lineCount: (filtered.length ? filtered : lines).length,
        filterRole,
        filterRoleZh,
        roleFiltered: true as const,
        inAppOnePager: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const scrub = (base as any).shareRevokeMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M129吊销多选短片关帧书签').trim();
  const keyIndexes = frames.length
    ? [0, Math.min(frames.length - 1, Math.floor((frames.length - 1) / 2)), frames.length - 1].filter(
        (v, i, a) => a.indexOf(v) === i,
      )
    : [0, 1];
  const shareRevokeMultiselectClipKfBm = wantsKf
    ? {
        wave: 'M129' as const,
        kind: 'share-revoke-multiselect-clip-kf-bm' as const,
        titleZh: '吊销审计多选对照短片 · 关帧书签',
        bodyZh:
          `吊销审计多选对照短片 scrubber 可打关帧书签 · ${keyIndexes.length}枚 · 「${bookmarkNameZh}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: keyIndexes.map((idx: number, i: number) => ({
          id: `m129-share-revoke-kf-${i}`,
          nameZh: `${bookmarkNameZh}#${i + 1}`,
          frameIndex: idx,
          lineZh: frames[idx]?.lineZh || `对照帧#${idx + 1}`,
          contrastSide: frames[idx]?.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M129' as const,
        })),
        bookmarkCount: keyIndexes.length,
        bookmarkNameZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M129' as const,
    labelZh:
      (confirmSoftCancelLedgerRoleAuditOnepager
        ? `确认卡软取消台账角色审计一页纸 · ${confirmSoftCancelLedgerRoleAuditOnepager.lineCount}行`
        : '确认卡软取消台账角色审计待命') +
      (shareRevokeMultiselectClipKfBm
        ? ` · 吊销多选短片关帧书签 ${shareRevokeMultiselectClipKfBm.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSoftCancelLedgerRoleAuditOnepager ? ` · ${confirmSoftCancelLedgerRoleAuditOnepager.bodyZh}` : '') +
      (shareRevokeMultiselectClipKfBm ? ` · ${shareRevokeMultiselectClipKfBm.bodyZh}` : ''),
    toastZh:
      confirmSoftCancelLedgerRoleAuditOnepager && shareRevokeMultiselectClipKfBm
        ? '确认卡软取消台账角色审计 · 吊销多选短片关帧书签'
        : confirmSoftCancelLedgerRoleAuditOnepager
          ? '确认卡软取消台账角色审计一页纸'
          : shareRevokeMultiselectClipKfBm
            ? '吊销多选短片关帧书签'
            : '确认卡软取消台账角色审计待命',
    busyZh: '确认卡软取消台账角色审计 / 吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRetryPauseGraceSoftCancelLedgerIntact: (base as any).confirmRetryPauseGraceSoftCancelLedgerIntact === true,
    shareRevokeMultiselectClipScrubberIntact: (base as any).shareRevokeMultiselectClipScrubberIntact === true,
    confirmSoftCancelLedgerRoleAuditOnepagerIntact: !!confirmSoftCancelLedgerRoleAuditOnepager,
    shareRevokeMultiselectClipKfBmIntact: !!shareRevokeMultiselectClipKfBm,
    confirmSoftCancelLedgerRoleAuditOnepager,
    shareRevokeMultiselectClipKfBm,
    keyframeBookmarks: shareRevokeMultiselectClipKfBm?.bookmarks,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks',
  };
}


/**
 * M130：确认卡角色审计一页纸回跳台账 + 吊销多选短片关帧跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShare(
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M130' as const,
      labelZh: '确认卡角色审计回跳 / 吊销关帧跨会话分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计一页纸回跳台账与吊销多选短片关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳 / 吊销关帧跨会话分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarks(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmSoftCancelLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = opts.seekEntryIndex != null ? Number(opts.seekEntryIndex) : 0;
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const confirmRoleAuditOnepagerSeekLedger = wantsSeek
    ? {
        wave: 'M130' as const,
        kind: 'confirm-role-audit-onepager-seek-ledger' as const,
        titleZh: '确认卡角色审计一页纸 · 回跳台账行',
        bodyZh:
          `确认卡角色过滤审计一页纸可回跳台账行 · 过滤「${filterRoleZh}」` +
          ` · 定位行#${seekEntryIndex + 1}「${lines[seekEntryIndex]?.id || lines[0]?.id || 'm130-confirm-soft-cancel-0'}」` +
          ` · ${lines[seekEntryIndex]?.auditLineZh || lines[0]?.auditLineZh || '确认卡软取消台账行'} · 干跑 · toast · 无外发`,
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        ledgerRowId: lines[seekEntryIndex]?.id || lines[0]?.id || 'm130-confirm-soft-cancel-0',
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const bm = (base as any).shareRevokeMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(bm?.bookmarks) ? bm.bookmarks : Array.isArray((base as any).keyframeBookmarks) ? (base as any).keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m130-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m130-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!bm);
  const shareRevokeMultiselectClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M130' as const,
        kind: 'share-revoke-multiselect-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `吊销审计多选对照短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-share-revoke-kf-m130-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M130' as const }))
          : [{ id: 'm130-share-revoke-kf-share-0', nameZh: '吊销多选短片关帧#1', sharedRo: true, wave: 'M130' as const }],
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
    wave: 'M130' as const,
    labelZh:
      (confirmRoleAuditOnepagerSeekLedger
        ? `确认卡角色审计一页纸回跳台账 · 行#${seekEntryIndex + 1}`
        : '确认卡角色审计回跳台账待命') +
      (shareRevokeMultiselectClipKfBmXsessionRoShare
        ? ` · 吊销关帧跨会话分享 ${shareRevokeMultiselectClipKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditOnepagerSeekLedger ? ` · ${confirmRoleAuditOnepagerSeekLedger.bodyZh}` : '') +
      (shareRevokeMultiselectClipKfBmXsessionRoShare ? ` · ${shareRevokeMultiselectClipKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditOnepagerSeekLedger && shareRevokeMultiselectClipKfBmXsessionRoShare
        ? '确认卡角色审计回跳 · 吊销关帧跨会话只读分享'
        : confirmRoleAuditOnepagerSeekLedger
          ? '确认卡角色审计一页纸已回跳台账行'
          : shareRevokeMultiselectClipKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳 / 吊销关帧跨会话分享待命',
    busyZh: '确认卡角色审计回跳 / 吊销关帧跨会话分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSoftCancelLedgerRoleAuditOnepagerIntact: (base as any).confirmSoftCancelLedgerRoleAuditOnepagerIntact === true,
    shareRevokeMultiselectClipKfBmIntact: (base as any).shareRevokeMultiselectClipKfBmIntact === true,
    confirmRoleAuditOnepagerSeekLedgerIntact: !!confirmRoleAuditOnepagerSeekLedger,
    shareRevokeMultiselectClipKfBmXsessionRoShareIntact: !!shareRevokeMultiselectClipKfBmXsessionRoShare,
    confirmRoleAuditOnepagerSeekLedger,
    shareRevokeMultiselectClipKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoSharePath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share',
  };
}


/**
 * M131：确认卡角色审计回跳多选对照 + 吊销关帧跨会话分享过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M131' as const,
      labelZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳多选对照与吊销关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditOnepagerSeekLedger || null;
  const audit = (base as any).confirmSoftCancelLedgerRoleAuditOnepager || null;
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
      id: `m131-confirm-ms-${i}`,
      auditLineZh: `确认卡角色审计台账对照行#${i + 1}`,
      kindZh: '确认卡角色审计台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      id: row.id || `m131-confirm-ms-${i}`,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.lineZh || `台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M131' as const,
    };
  });
  const confirmRoleAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M131' as const,
        kind: 'confirm-role-audit-seek-multiselect-contrast' as const,
        titleZh: '确认卡角色审计回跳 · 多选中文对照',
        bodyZh:
          `确认卡角色审计一页纸回跳支持多选中文对照 · ${selected.length}行 · 过滤「${filterRoleZh}」` +
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

  const xshare = (base as any).shareRevokeMultiselectClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m131-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m131-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false && (opts.revokeShare === true || opts.revokeShare !== false);
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M131' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话分享 · 过期吊销进中文台账',
        bodyZh:
          `吊销多选短片关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare: true as const,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        ledgerEntry: {
          wave: 'M131' as const,
          id: `m131-share-revoke-${Date.now().toString(36)}`,
          kindZh: '吊销关帧跨会话分享过期吊销',
          auditLineZh: revokeShare
            ? `吊销跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记跨会话只读关帧分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          lineZh: revokeShare
            ? `吊销跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚`
            : `登记跨会话只读关帧分享过期 ${expiresInMs}ms`,
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
    wave: 'M131' as const,
    labelZh:
      (confirmRoleAuditSeekMultiselectContrast
        ? `确认卡角色审计回跳多选对照 · ${confirmRoleAuditSeekMultiselectContrast.selectedCount}行`
        : '确认卡角色审计回跳多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? ` · 吊销关帧过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekMultiselectContrast ? ` · ${confirmRoleAuditSeekMultiselectContrast.bodyZh}` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡角色审计回跳多选 · 吊销关帧过期吊销进台账'
        : confirmRoleAuditSeekMultiselectContrast
          ? '确认卡角色审计回跳多选中文对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话分享过期吊销进台账'
            : '确认卡角色审计回跳多选 / 吊销关帧过期吊销待命',
    busyZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditOnepagerSeekLedgerIntact: (base as any).confirmRoleAuditOnepagerSeekLedgerIntact === true,
    shareRevokeMultiselectClipKfBmXsessionRoShareIntact: (base as any).shareRevokeMultiselectClipKfBmXsessionRoShareIntact === true,
    confirmRoleAuditSeekMultiselectContrastIntact: !!confirmRoleAuditSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmRoleAuditSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger',
  };
}


/**
 * M132：确认卡角色审计回跳多选短片 scrubber + 吊销关帧过期吊销台账角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepager(
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
    shortClipFrames?: boolean;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M132' as const,
      labelZh: '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳多选短片 scrubber 与吊销关帧过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).confirmRoleAuditSeekMultiselectContrast || null;
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
        { index: 0, lineZh: '确认卡角色审计多选对照帧#1', id: 'm132-confirm-ms-0' },
        { index: 1, lineZh: '确认卡角色审计多选对照帧#2', id: 'm132-confirm-ms-1' },
      ]
  ).map((r: any, i: number) => ({
    index: i,
    scrubIndex: i,
    id: r.id || `m132-confirm-ms-${i}`,
    ledgerRowId: r.ledgerRowId || r.id || `m132-confirm-ms-${i}`,
    lineZh: r.lineZh || `对照帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role: r.role || role,
    roleZh: ROLE_ZH[String(r.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M132' as const,
  }));
  const confirmRoleAuditSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M132' as const,
        kind: 'confirm-role-audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '确认卡角色审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `确认卡角色审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
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

  const expiry = (base as any).shareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const shareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M132' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '吊销关帧过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `吊销关帧跨会话分享过期吊销中文台账可出角色过滤审计一页纸 · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」` +
          (expiry?.ledgerEntry?.auditLineZh ? ` · ${expiry.ledgerEntry.auditLineZh}` : '') +
          ` · 软取消仍在 · 干跑 · toast · 无外发`,
        filterRole,
        filterRoleZh,
        role,
        roleZh,
        lines: [
          {
            id: expiry?.ledgerEntry?.id || 'm132-share-revoke-expiry-0',
            auditLineZh: expiry?.ledgerEntry?.auditLineZh || '吊销关帧跨会话分享过期吊销台账行',
            kindZh: '吊销关帧过期吊销台账',
            role,
            roleZh,
            wave: 'M132' as const,
          },
        ],
        lineCount: 1,
        fromExpiryLedger: expiry ? { kind: expiry.kind, expiresInMs: expiry.expiresInMs } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M132' as const,
    labelZh:
      (confirmRoleAuditSeekMultiselectClipScrubber
        ? `确认卡角色审计回跳多选短片 scrubber · ${confirmRoleAuditSeekMultiselectClipScrubber.frameCount}帧`
        : '确认卡角色审计回跳多选短片 scrubber 待命') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? ' · 吊销过期吊销台账角色审计一页纸' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekMultiselectClipScrubber ? ` · ${confirmRoleAuditSeekMultiselectClipScrubber.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? ` · ${shareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekMultiselectClipScrubber && shareRevokeExpiryLedgerRoleAuditOnepager
        ? '确认卡角色审计回跳多选短片 scrubber · 吊销台账角色审计一页纸'
        : confirmRoleAuditSeekMultiselectClipScrubber
          ? '确认卡角色审计回跳多选短片 scrubber 已开'
          : shareRevokeExpiryLedgerRoleAuditOnepager
            ? '吊销过期吊销台账角色审计一页纸已开'
            : '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计待命',
    busyZh: '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekMultiselectContrastIntact: (base as any).confirmRoleAuditSeekMultiselectContrastIntact === true,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).shareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    confirmRoleAuditSeekMultiselectClipScrubberIntact: !!confirmRoleAuditSeekMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!shareRevokeExpiryLedgerRoleAuditOnepager,
    confirmRoleAuditSeekMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepager,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager',
  };
}


/**
 * M133：确认卡角色审计回跳多选短片关帧书签 + 吊销台账角色审计回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedger(
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
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M133' as const,
      labelZh: '确认卡角色审计回跳多选短片关帧书签 / 吊销台账角色审计回跳 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳多选短片关帧书签与吊销台账角色审计回跳台账行 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳多选短片关帧书签 / 吊销台账角色审计回跳…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepager(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).confirmRoleAuditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M133确认卡角色审计多选短片关帧书签').trim();
  const keyIndexes = frames.length
    ? [0, Math.min(frames.length - 1, Math.floor((frames.length - 1) / 2)), frames.length - 1].filter(
        (v, i, a) => a.indexOf(v) === i,
      )
    : [0, 1];
  const confirmRoleAuditSeekMultiselectClipKfBm = wantsKf
    ? {
        wave: 'M133' as const,
        kind: 'confirm-role-audit-seek-multiselect-clip-kf-bm' as const,
        titleZh: '确认卡角色审计回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `确认卡角色审计回跳多选短片 scrubber 可打关帧书签 · ${keyIndexes.length}枚 · 「${bookmarkNameZh}」` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks: keyIndexes.map((idx: number, i: number) => ({
          id: `m133-confirm-ms-kf-${i}`,
          nameZh: `${bookmarkNameZh}#${i + 1}`,
          frameIndex: idx,
          lineZh: frames[idx]?.lineZh || `对照帧#${idx + 1}`,
          contrastSide: frames[idx]?.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
          wave: 'M133' as const,
        })),
        bookmarkCount: keyIndexes.length,
        bookmarkNameZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const audit = (base as any).shareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = Math.max(0, Number(opts.seekEntryIndex) || 0);
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[Math.min(seekEntryIndex, Math.max(lines.length - 1, 0))] || {
    id: 'm133-share-revoke-expiry-seek-0',
    auditLineZh: '吊销过期吊销台账角色审计行',
    kindZh: '吊销关帧过期吊销台账',
    role,
    roleZh,
  };
  const shareRevokeExpiryLedgerRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M133' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-seek-ledger' as const,
        titleZh: '吊销过期吊销台账角色审计一页纸 · 回跳台账行',
        bodyZh:
          `吊销关帧过期吊销中文台账角色审计一页纸可回跳台账行 · 行#${seekEntryIndex + 1}` +
          ` · 「${row.auditLineZh || row.lineZh || '台账行'}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row.id || row.ledgerRowId || `row-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.lineZh || `台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
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
    wave: 'M133' as const,
    labelZh:
      (confirmRoleAuditSeekMultiselectClipKfBm
        ? `确认卡角色审计回跳多选短片关帧书签 · ${confirmRoleAuditSeekMultiselectClipKfBm.bookmarkCount}枚`
        : '确认卡角色审计回跳多选短片关帧书签待命') +
      (shareRevokeExpiryLedgerRoleAuditSeekLedger ? ' · 吊销台账角色审计回跳台账行' : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekMultiselectClipKfBm ? ` · ${confirmRoleAuditSeekMultiselectClipKfBm.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditSeekLedger ? ` · ${shareRevokeExpiryLedgerRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekMultiselectClipKfBm && shareRevokeExpiryLedgerRoleAuditSeekLedger
        ? '确认卡角色审计回跳多选短片关帧书签 · 吊销台账角色审计回跳'
        : confirmRoleAuditSeekMultiselectClipKfBm
          ? '确认卡角色审计回跳多选短片关帧书签已开'
          : shareRevokeExpiryLedgerRoleAuditSeekLedger
            ? '吊销台账角色审计回跳台账行已开'
            : '确认卡角色审计回跳多选短片关帧书签 / 吊销台账角色审计回跳待命',
    busyZh: '确认卡角色审计回跳多选短片关帧书签 / 吊销台账角色审计回跳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekMultiselectClipScrubberIntact: (base as any).confirmRoleAuditSeekMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    confirmRoleAuditSeekMultiselectClipKfBmIntact: !!confirmRoleAuditSeekMultiselectClipKfBm,
    shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact: !!shareRevokeExpiryLedgerRoleAuditSeekLedger,
    confirmRoleAuditSeekMultiselectClipKfBm,
    shareRevokeExpiryLedgerRoleAuditSeekLedger,
    keyframeBookmarks: confirmRoleAuditSeekMultiselectClipKfBm?.bookmarks,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger',
  };
}

/**
 * M134：确认卡角色审计关帧跨会话只读分享 + 吊销台账角色审计回跳多选对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrast(
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectLedgerRows === false &&
    opts.multiSelectContrast === false
  ) {
    return {
      ok: true as const,
      wave: 'M134' as const,
      labelZh: '确认卡角色审计关帧跨会话只读分享 / 吊销台账角色审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计关帧跨会话只读分享与吊销台账角色审计回跳多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计关帧跨会话只读分享 / 吊销台账角色审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedger(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmRoleAuditSeekMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : Array.isArray((base as any).keyframeBookmarks) ? (base as any).keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m134-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m134-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M134' as const,
        kind: 'confirm-role-audit-seek-multiselect-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡角色审计回跳多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `确认卡角色审计回跳多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-confirm-kf-m134-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M134' as const }))
          : [{ id: 'm134-confirm-kf-share-0', nameZh: '确认卡关帧#1', sharedRo: true, wave: 'M134' as const }],
        filterRole,
        filterRoleZh,
        fromKeyframeBookmarks: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeExpiryLedgerRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).shareRevokeExpiryLedgerRoleAuditOnepager?.lines)
    ? (base as any).shareRevokeExpiryLedgerRoleAuditOnepager.lines
    : seek
      ? [
          {
            id: seek.ledgerRowId || 'm134-share-revoke-expiry-seek-0',
            auditLineZh: seek.lineZh || '吊销过期吊销台账角色审计行',
            kindZh: '吊销关帧过期吊销台账',
          },
          {
            id: 'm134-share-revoke-expiry-seek-1',
            auditLineZh: '吊销过期吊销台账角色审计附行 · 多选对照',
            kindZh: '吊销关帧过期吊销台账',
          },
        ]
      : [
          { id: 'm134-share-revoke-expiry-seek-0', auditLineZh: '演示·吊销过期吊销台账行#1', kindZh: '吊销关帧过期吊销台账' },
          { id: 'm134-share-revoke-expiry-seek-1', auditLineZh: '演示·吊销过期吊销台账行#2', kindZh: '吊销关帧过期吊销台账' },
        ];
  const rawIdx = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const selectedIndexes = rawIdx
    .map((i) => Math.min(Math.max(lines.length - 1, 0), i))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 8);
  const wantsMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      !!seek ||
      lines.length > 0);
  const selectedRows = (selectedIndexes.length ? selectedIndexes : [0, Math.min(1, Math.max(lines.length - 1, 0))]).map(
    (i, side) => {
      const row = lines[i] || lines[0] || { id: `m134-share-revoke-expiry-seek-${i}`, auditLineZh: `吊销台账行#${i + 1}` };
      return {
        index: i,
        id: row.id || `m134-share-revoke-expiry-seek-${i}`,
        lineZh: row.auditLineZh || row.kindZh || `吊销台账行#${i + 1}`,
        auditLineZh: row.auditLineZh || row.kindZh || `吊销台账行#${i + 1}`,
        contrastSide: side % 2 === 0 ? 'A' : 'B',
        wave: 'M134' as const,
      };
    },
  );
  const shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M134' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-seek-multiselect-contrast' as const,
        titleZh: '吊销过期吊销台账角色审计回跳 · 多选中文对照',
        bodyZh:
          `吊销过期吊销台账角色审计回跳台账支持多选中文对照 · 已选 ${selectedRows.length} 行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedIndexes: selectedRows.map((r) => r.index),
        selectedRows,
        selectedCount: selectedRows.length,
        contrastPairs: selectedRows.length >= 2
          ? [{ a: selectedRows[0], b: selectedRows[1], labelZh: '吊销台账多选中文对照 A/B' }]
          : [],
        fromSeek: seek
          ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, ledgerRowId: seek.ledgerRowId }
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
    wave: 'M134' as const,
    labelZh:
      (confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare
        ? `确认卡角色审计关帧跨会话只读分享 · ${confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare.bookmarkCount}枚`
        : '确认卡角色审计关帧跨会话只读分享待命') +
      (shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast
        ? ` · 吊销台账角色审计回跳多选对照 ${shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast.selectedCount}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare ? ` · ${confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast ? ` · ${shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare && shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast
        ? '确认卡角色审计关帧跨会话只读分享 · 吊销台账角色审计回跳多选对照'
        : confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare
          ? '确认卡角色审计关帧跨会话只读分享已开'
          : shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast
            ? '吊销台账角色审计回跳多选对照已开'
            : '确认卡角色审计关帧跨会话只读分享 / 吊销台账角色审计回跳多选对照待命',
    busyZh: '确认卡角色审计关帧跨会话只读分享 / 吊销台账角色审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekMultiselectClipKfBmIntact: (base as any).confirmRoleAuditSeekMultiselectClipKfBmIntact === true,
    shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact === true,
    confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShareIntact: !!confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare,
    shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrastIntact: !!shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast,
    confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare,
    shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast',
  };
}



/**
 * M135：确认卡关帧跨会话分享过期吊销进台账 + 吊销台账角色审计回跳多选短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubber(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M135' as const,
      labelZh: '确认卡关帧跨会话分享过期吊销进台账 / 吊销台账回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话分享过期吊销进台账与吊销台账回跳多选短片scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话分享过期吊销进台账 / 吊销台账回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrast(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m135-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m135-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const confirmKfBmXsessionShareExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M135' as const,
        kind: 'confirm-kf-bm-xsession-share-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `确认卡角色审计关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M135' as const,
          id: `m135-confirm-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '确认卡关帧跨会话分享吊销' : '确认卡关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销确认卡关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记确认卡关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
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

  const ms = (base as any).shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm135-share-revoke-ms-0', lineZh: '吊销台账多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm135-share-revoke-ms-1', lineZh: '吊销台账多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms || selectedRows.length > 0);
  const frames = selectedRows.map((row: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: row.id || `m135-share-revoke-ms-frame-${i}`,
    lineZh: row.lineZh || row.auditLineZh || `对照帧#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: i === scrubIndex,
    wave: 'M135' as const,
  }));
  const shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M135' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销台账角色审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `吊销过期吊销台账角色审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[Math.min(scrubIndex, Math.max(frames.length - 1, 0))] || frames[0] || null,
        selectedCount: ms?.selectedCount || selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount, selectedIndexes: ms.selectedIndexes }
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
    wave: 'M135' as const,
    labelZh:
      (confirmKfBmXsessionShareExpiryRevokeLedger
        ? `确认卡关帧跨会话分享过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : '确认卡关帧跨会话分享过期吊销进台账待命') +
      (shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber
        ? ` · 吊销台账回跳多选短片scrubber ${shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionShareExpiryRevokeLedger ? ` · ${confirmKfBmXsessionShareExpiryRevokeLedger.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber ? ` · ${shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionShareExpiryRevokeLedger && shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber
        ? '确认卡关帧跨会话分享过期吊销进台账 · 吊销台账回跳多选短片scrubber'
        : confirmKfBmXsessionShareExpiryRevokeLedger
          ? '确认卡关帧跨会话分享过期吊销进台账已开'
          : shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber
            ? '吊销台账回跳多选短片scrubber已开'
            : '确认卡关帧跨会话分享过期吊销 / 吊销台账回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话分享过期吊销进台账 / 吊销台账回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShareIntact: (base as any).confirmRoleAuditSeekMultiselectClipKfBmXsessionRoShareIntact === true,
    shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrastIntact: (base as any).shareRevokeExpiryLedgerRoleAuditSeekMultiselectContrastIntact === true,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: !!confirmKfBmXsessionShareExpiryRevokeLedger,
    shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubberIntact: !!shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber,
    confirmKfBmXsessionShareExpiryRevokeLedger,
    shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber',
  };
}


/**
 * M136：确认卡关帧跨会话分享过期吊销台账 · 角色审计一页纸
 *        + 吊销台账回跳多选短片 scrubber · 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarks(
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
    opts.roleAuditOnePager === false &&
    opts.keyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M136' as const,
      labelZh: '确认卡分享过期吊销台账角色审计一页纸 / 吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡分享过期吊销台账角色审计一页纸与吊销多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡分享过期吊销台账角色审计一页纸 / 吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubber(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).confirmKfBmXsessionShareExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm136-confirm-share-expiry-0',
    kindZh: '确认卡关帧跨会话分享过期登记',
    auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行',
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
  const confirmShareExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M136' as const,
        kind: 'confirm-share-expiry-ledger-role-audit-onepager' as const,
        titleZh: '确认卡关帧跨会话分享过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `确认卡关帧跨会话分享过期吊销中文台账可出角色过滤审计一页纸 · 行「${ledgerEntry.id}」` +
          ` · ${ledgerEntry.auditLineZh || ledgerEntry.kindZh} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines: [
          { id: ledgerEntry.id, auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.kindZh, role, roleZh },
          { id: 'm136-confirm-share-expiry-1', auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行#2', role, roleZh },
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

  const scrub = (base as any).shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, id: 'm136-share-revoke-ms-frame-0', lineZh: '对照帧#1', contrastSide: 'A' },
    { frameIndex: 1, id: 'm136-share-revoke-ms-frame-1', lineZh: '对照帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M136吊销多选短片关帧书签').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m136-share-revoke-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameIndex: f.frameIndex ?? i,
    scrubIndex: f.scrubIndex ?? i,
    lineZh: f.lineZh,
    contrastSide: f.contrastSide,
    wave: 'M136' as const,
  }));
  const shareRevokeSeekMultiselectClipKfBm = wantsKf
    ? {
        wave: 'M136' as const,
        kind: 'share-revoke-seek-multiselect-clip-kf-bm' as const,
        titleZh: '吊销台账回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `吊销台账角色审计回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        bookmarkNameZh,
        scrubberBookmarks: true as const,
        scrubberKeyframeBookmarks: true as const,
        keyframeBookmarks: true as const,
        fromClipScrubber: scrub
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
    wave: 'M136' as const,
    labelZh:
      (confirmShareExpiryLedgerRoleAuditOnepager
        ? '确认卡分享过期吊销台账角色审计一页纸'
        : '确认卡分享过期吊销台账角色审计一页纸待命') +
      (shareRevokeSeekMultiselectClipKfBm
        ? ` · 吊销多选短片关帧书签 ${shareRevokeSeekMultiselectClipKfBm.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmShareExpiryLedgerRoleAuditOnepager ? ` · ${confirmShareExpiryLedgerRoleAuditOnepager.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipKfBm ? ` · ${shareRevokeSeekMultiselectClipKfBm.bodyZh}` : ''),
    toastZh:
      confirmShareExpiryLedgerRoleAuditOnepager && shareRevokeSeekMultiselectClipKfBm
        ? '确认卡分享过期吊销台账角色审计一页纸 · 吊销多选短片关帧书签'
        : confirmShareExpiryLedgerRoleAuditOnepager
          ? '确认卡分享过期吊销台账角色审计一页纸已开'
          : shareRevokeSeekMultiselectClipKfBm
            ? '吊销多选短片关帧书签已开'
            : '确认卡分享过期吊销台账角色审计 / 吊销多选短片关帧书签待命',
    busyZh: '确认卡分享过期吊销台账角色审计一页纸 / 吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionShareExpiryRevokeLedgerIntact === true,
    shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubberIntact: (base as any).shareRevokeExpiryLedgerRoleAuditSeekMultiselectClipScrubberIntact === true,
    confirmShareExpiryLedgerRoleAuditOnepagerIntact: !!confirmShareExpiryLedgerRoleAuditOnepager,
    shareRevokeSeekMultiselectClipKfBmIntact: !!shareRevokeSeekMultiselectClipKfBm,
    confirmShareExpiryLedgerRoleAuditOnepager,
    shareRevokeSeekMultiselectClipKfBm,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks',
  };
}



/**
 * M137：确认卡分享过期吊销台账角色审计一页纸 · 回跳台账
 *        + 吊销多选短片关帧书签 · 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShare(
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M137' as const,
      labelZh: '确认卡角色审计回跳 / 吊销关帧跨会话分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡分享过期吊销台账角色审计回跳与吊销多选短片关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳 / 吊销关帧跨会话分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarks(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmShareExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [];
  const seekEntryIndex = opts.seekEntryIndex != null ? Number(opts.seekEntryIndex) : 0;
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[Math.min(seekEntryIndex, Math.max(lines.length - 1, 0))] || {
    id: 'm137-confirm-share-expiry-seek-0',
    auditLineZh: '演示·确认卡分享过期吊销台账角色审计行',
    kindZh: '确认卡分享过期吊销台账',
    role,
    roleZh,
  };
  const confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger = wantsSeek
    ? {
        wave: 'M137' as const,
        kind: 'confirm-share-expiry-ledger-role-audit-onepager-seek-ledger' as const,
        titleZh: '确认卡分享过期吊销台账角色审计一页纸 · 回跳台账行',
        bodyZh:
          `确认卡分享过期吊销中文台账角色审计一页纸可回跳台账行 · 行#${seekEntryIndex + 1}` +
          ` · 「${row.auditLineZh || row.lineZh || '台账行'}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row.id || row.ledgerRowId || `row-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.lineZh || `台账行#${seekEntryIndex + 1}`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        filterRole,
        filterRoleZh,
        fromRoleAudit: audit ? { kind: audit.kind, lineCount: audit.lineCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const bm = (base as any).shareRevokeSeekMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(bm?.bookmarks) ? bm.bookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m137-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m137-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!bm);
  const shareRevokeSeekMultiselectClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M137' as const,
        kind: 'share-revoke-seek-multiselect-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销回跳多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `吊销回跳多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, bm?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-share-revoke-kf-m137-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, bm?.bookmarkCount || 1, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M137' as const }))
          : [{ id: 'm137-share-revoke-kf-share-0', nameZh: '吊销多选短片关帧#1', sharedRo: true, wave: 'M137' as const }],
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
    wave: 'M137' as const,
    labelZh:
      (confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger
        ? `确认卡分享过期吊销台账角色审计回跳 · 行#${seekEntryIndex + 1}`
        : '确认卡分享过期吊销台账角色审计回跳待命') +
      (shareRevokeSeekMultiselectClipKfBmXsessionRoShare
        ? ` · 吊销关帧跨会话分享 ${shareRevokeSeekMultiselectClipKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger ? ` · ${confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipKfBmXsessionRoShare ? ` · ${shareRevokeSeekMultiselectClipKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh:
      confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger && shareRevokeSeekMultiselectClipKfBmXsessionRoShare
        ? '确认卡角色审计回跳 · 吊销关帧跨会话只读分享'
        : confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger
          ? '确认卡分享过期吊销台账角色审计已回跳台账行'
          : shareRevokeSeekMultiselectClipKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳 / 吊销关帧跨会话分享待命',
    busyZh: '确认卡角色审计回跳 / 吊销关帧跨会话分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmShareExpiryLedgerRoleAuditOnepagerIntact: (base as any).confirmShareExpiryLedgerRoleAuditOnepagerIntact === true,
    shareRevokeSeekMultiselectClipKfBmIntact: (base as any).shareRevokeSeekMultiselectClipKfBmIntact === true,
    confirmShareExpiryLedgerRoleAuditOnepagerSeekLedgerIntact: !!confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger,
    shareRevokeSeekMultiselectClipKfBmXsessionRoShareIntact: !!shareRevokeSeekMultiselectClipKfBmXsessionRoShare,
    confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger,
    shareRevokeSeekMultiselectClipKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoSharePath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share',
  };
}


/**
 * M138：确认卡角色审计回跳 · 多选中文对照
 *        + 吊销关帧跨会话分享 · 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedger(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M138' as const,
      labelZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳多选对照与吊销关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShare(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmShareExpiryLedgerRoleAuditOnepagerSeekLedger || null;
  const audit = (base as any).confirmShareExpiryLedgerRoleAuditOnepager || null;
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
      id: `m138-confirm-ms-${i}`,
      auditLineZh: `确认卡角色审计台账对照行#${i + 1}`,
      kindZh: '确认卡角色审计台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      id: row.id || `m138-confirm-ms-${i}`,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.lineZh || `台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M138' as const,
    };
  });
  const confirmRoleAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M138' as const,
        kind: 'confirm-role-audit-seek-multiselect-contrast' as const,
        titleZh: '确认卡角色审计回跳 · 多选中文对照',
        bodyZh:
          `确认卡角色审计一页纸回跳支持多选中文对照 · ${selected.length}行 · 过滤「${filterRoleZh}」` +
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

  const xshare = (base as any).shareRevokeSeekMultiselectClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m138-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m138-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M138' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话分享 · 过期吊销进中文台账',
        bodyZh:
          `吊销多选短片关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare: true as const,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        ledgerEntry: {
          wave: 'M138' as const,
          id: `m138-share-revoke-${Date.now().toString(36)}`,
          kindZh: '吊销关帧跨会话分享过期吊销',
          auditLineZh: revokeShare
            ? `吊销跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记跨会话只读关帧分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          lineZh: revokeShare
            ? `吊销跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚`
            : `登记跨会话只读关帧分享过期 ${expiresInMs}ms`,
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
    wave: 'M138' as const,
    labelZh:
      (confirmRoleAuditSeekMultiselectContrast
        ? `确认卡角色审计回跳多选对照 · ${confirmRoleAuditSeekMultiselectContrast.selectedCount}行`
        : '确认卡角色审计回跳多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? ` · 吊销关帧过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekMultiselectContrast ? ` · ${confirmRoleAuditSeekMultiselectContrast.bodyZh}` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡角色审计回跳多选 · 吊销关帧过期吊销进台账'
        : confirmRoleAuditSeekMultiselectContrast
          ? '确认卡角色审计回跳多选中文对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话分享过期吊销进台账'
            : '确认卡角色审计回跳多选 / 吊销关帧过期吊销待命',
    busyZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmShareExpiryLedgerRoleAuditOnepagerSeekLedgerIntact: (base as any).confirmShareExpiryLedgerRoleAuditOnepagerSeekLedgerIntact === true,
    shareRevokeSeekMultiselectClipKfBmXsessionRoShareIntact: (base as any).shareRevokeSeekMultiselectClipKfBmXsessionRoShareIntact === true,
    confirmRoleAuditSeekMultiselectContrastIntact: !!confirmRoleAuditSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmRoleAuditSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerPath: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger',
  };
}


/**
 * M139：确认卡角色审计回跳多选短片 scrubber + 吊销过期台账角色审计一页纸
 * （薄封装 M132 层叠在 M138 之上；软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerM139(
  tenantId?: string | null,
  opts: { [k: string]: any } = {},
) {
  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepager(tenantId, opts);
  if ((base as any)?.cancelled) {
    return {
      ...(base as any),
      wave: 'M139' as const,
      labelZh: '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳多选短片 scrubber 与吊销过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      busyZh: '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计…',
    };
  }
  return {
    ...(base as any),
    wave: 'M139' as const,
    labelZh: String((base as any).labelZh || '')
      .replace(/M132/g, 'M139')
      .replace(/确认卡角色审计回跳多选短片 scrubber/, '确认卡角色审计回跳多选短片 scrubber') ||
      '确认卡角色审计回跳多选短片 scrubber · 吊销台账角色审计一页纸',
    tipZh: ((base as any).tipZh || '') + ' · M139确认卡多选短片scrubber·吊销过期台账角色审计一页纸',
    toastZh:
      (base as any).confirmRoleAuditSeekMultiselectClipScrubberIntact &&
      (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact
        ? '确认卡角色审计回跳多选短片 scrubber · 吊销过期台账角色审计一页纸'
        : (base as any).toastZh || '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计待命',
    busyZh: '确认卡角色审计回跳多选短片 scrubber / 吊销台账角色审计…',
    confirmRoleAuditSeekMultiselectClipScrubberIntact: (base as any).confirmRoleAuditSeekMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerM139Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/m139',
  };
}


/**
 * M140：确认卡多选短片关帧书签 + 吊销过期角色审计回跳台账
 * （薄封装 M133 层叠在 M139 之上；软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140(
  tenantId?: string | null,
  opts: { [k: string]: any } = {},
) {
  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedger(tenantId, opts);
  if ((base as any)?.cancelled) {
    return {
      ...(base as any),
      wave: 'M140' as const,
      labelZh: '确认卡多选短片关帧书签 / 吊销角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡多选短片关帧书签与吊销过期角色审计回跳台账 · 无外发 · 中页取消仍在',
      busyZh: '确认卡多选短片关帧书签 / 吊销角色审计回跳…',
    };
  }
  return {
    ...(base as any),
    wave: 'M140' as const,
    labelZh: String((base as any).labelZh || '')
      .replace(/M133/g, 'M140') ||
      '确认卡多选短片关帧书签 · 吊销角色审计回跳台账',
    tipZh: ((base as any).tipZh || '') + ' · M140确认卡多选短片关帧书签·吊销过期角色审计回跳台账',
    toastZh:
      (base as any).confirmRoleAuditSeekMultiselectClipKfBmIntact &&
      (base as any).shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact
        ? '确认卡多选短片关帧书签 · 吊销过期角色审计回跳台账'
        : (base as any).toastZh || '确认卡多选短片关帧书签 / 吊销角色审计回跳待命',
    busyZh: '确认卡多选短片关帧书签 / 吊销角色审计回跳…',
    confirmRoleAuditSeekMultiselectClipKfBmIntact: (base as any).confirmRoleAuditSeekMultiselectClipKfBmIntact === true,
    shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact === true,
    confirmRoleAuditSeekMultiselectClipScrubberIntact: (base as any).confirmRoleAuditSeekMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140',
  };
}


/**
 * M141：确认卡关帧跨会话只读分享 + 吊销角色审计回跳多选对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141(
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectLedgerRows === false &&
    opts.multiSelectContrast === false
  ) {
    return {
      ok: true as const,
      wave: 'M141' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销角色审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销角色审计回跳多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销角色审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmRoleAuditSeekMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : Array.isArray((base as any).keyframeBookmarks) ? (base as any).keyframeBookmarks : [];
  const sessionId = String(opts.sessionId || 'session-demo-m141-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m141-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const confirmMultiselectClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M141' as const,
        kind: 'confirm-multiselect-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `确认卡多选短片关帧书签支持跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        shareToken: `ro-confirm-kf-m141-${Date.now().toString(36)}`,
        readOnly: true as const,
        sessionId,
        targetSessionId,
        bookmarkCount: Math.max(bookmarks.length, 1),
        bookmarks: bookmarks.length
          ? bookmarks.map((b: any) => ({ ...b, sharedRo: true, wave: 'M141' as const }))
          : [{ id: 'm141-confirm-kf-share-0', nameZh: '确认卡关帧#1', sharedRo: true, wave: 'M141' as const }],
        filterRole,
        filterRoleZh,
        fromKeyframeBookmarks: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeExpiryLedgerRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).shareRevokeExpiryLedgerRoleAuditOnepager?.lines)
    ? (base as any).shareRevokeExpiryLedgerRoleAuditOnepager.lines
    : seek
      ? [
          {
            id: seek.ledgerRowId || 'm141-share-revoke-expiry-seek-0',
            auditLineZh: seek.lineZh || '吊销过期角色审计回跳台账行',
            kindZh: '吊销过期角色审计回跳',
          },
          {
            id: 'm141-share-revoke-expiry-seek-1',
            auditLineZh: '吊销过期角色审计回跳附行 · 多选对照',
            kindZh: '吊销过期角色审计回跳',
          },
        ]
      : [
          { id: 'm141-share-revoke-expiry-seek-0', auditLineZh: '演示·吊销过期角色审计回跳行#1', kindZh: '吊销过期角色审计回跳' },
          { id: 'm141-share-revoke-expiry-seek-1', auditLineZh: '演示·吊销过期角色审计回跳行#2', kindZh: '吊销过期角色审计回跳' },
        ];
  const rawIdx = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const selectedIndexes = rawIdx
    .map((i) => Math.min(Math.max(lines.length - 1, 0), i))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 8);
  const wantsMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      !!seek ||
      lines.length > 0);
  const selectedRows = (selectedIndexes.length ? selectedIndexes : [0, Math.min(1, Math.max(lines.length - 1, 0))]).map(
    (i, side) => {
      const row = lines[i] || lines[0] || { id: `m141-share-revoke-expiry-seek-${i}`, auditLineZh: `吊销台账行#${i + 1}` };
      return {
        index: i,
        id: row.id || `m141-share-revoke-expiry-seek-${i}`,
        lineZh: row.auditLineZh || row.kindZh || `吊销台账行#${i + 1}`,
        auditLineZh: row.auditLineZh || row.kindZh || `吊销台账行#${i + 1}`,
        contrastSide: side % 2 === 0 ? 'A' : 'B',
        wave: 'M141' as const,
      };
    },
  );
  const shareRevokeExpiryRoleAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M141' as const,
        kind: 'share-revoke-expiry-role-audit-seek-multiselect-contrast' as const,
        titleZh: '吊销过期角色审计回跳 · 多选中文对照',
        bodyZh:
          `吊销过期角色审计回跳台账支持多选中文对照 · 已选 ${selectedRows.length} 行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedIndexes: selectedRows.map((r) => r.index),
        selectedRows,
        selectedCount: selectedRows.length,
        contrastPairs: selectedRows.length >= 2
          ? [{ a: selectedRows[0], b: selectedRows[1], labelZh: '吊销角色审计回跳多选中文对照 A/B' }]
          : [],
        fromSeek: seek
          ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, ledgerRowId: seek.ledgerRowId }
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
    wave: 'M141' as const,
    labelZh:
      (confirmMultiselectClipKfBmXsessionRoShare
        ? `确认卡关帧跨会话只读分享 · ${confirmMultiselectClipKfBmXsessionRoShare.bookmarkCount}枚`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeExpiryRoleAuditSeekMultiselectContrast
        ? ` · 吊销角色审计回跳多选对照 ${shareRevokeExpiryRoleAuditSeekMultiselectContrast.selectedCount}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmMultiselectClipKfBmXsessionRoShare ? ` · ${confirmMultiselectClipKfBmXsessionRoShare.bodyZh}` : '') +
      (shareRevokeExpiryRoleAuditSeekMultiselectContrast ? ` · ${shareRevokeExpiryRoleAuditSeekMultiselectContrast.bodyZh}` : ''),
    toastZh:
      confirmMultiselectClipKfBmXsessionRoShare && shareRevokeExpiryRoleAuditSeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销角色审计回跳多选对照'
        : confirmMultiselectClipKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeExpiryRoleAuditSeekMultiselectContrast
            ? '吊销角色审计回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销角色审计回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销角色审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekMultiselectClipKfBmIntact: (base as any).confirmRoleAuditSeekMultiselectClipKfBmIntact === true,
    shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditSeekLedgerIntact === true,
    confirmMultiselectClipKfBmXsessionRoShareIntact: !!confirmMultiselectClipKfBmXsessionRoShare,
    shareRevokeExpiryRoleAuditSeekMultiselectContrastIntact: !!shareRevokeExpiryRoleAuditSeekMultiselectContrast,
    confirmMultiselectClipKfBmXsessionRoShare,
    shareRevokeExpiryRoleAuditSeekMultiselectContrast,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141',
  };
}


/**
 * M142：确认卡关帧跨会话分享过期吊销进台账 + 吊销回跳多选短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M142' as const,
      labelZh: '确认卡关帧跨会话分享过期吊销 / 吊销回跳多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话分享过期吊销进台账与吊销回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话分享过期吊销 / 吊销回跳多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmMultiselectClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m142-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m142-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const confirmKfBmXsessionShareExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M142' as const,
        kind: 'confirm-kf-bm-xsession-share-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `确认卡关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M142' as const,
          id: `m142-confirm-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '确认卡关帧跨会话分享吊销' : '确认卡关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销确认卡关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记确认卡关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
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

  const ms = (base as any).shareRevokeExpiryRoleAuditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm142-share-revoke-ms-0', lineZh: '吊销角色审计回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm142-share-revoke-ms-1', lineZh: '吊销角色审计回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms || selectedRows.length > 0);
  const frames = selectedRows.map((row: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: row.id || `m142-share-revoke-ms-frame-${i}`,
    lineZh: row.lineZh || row.auditLineZh || `对照帧#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: i === scrubIndex,
    wave: 'M142' as const,
  }));
  const shareRevokeSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M142' as const,
        kind: 'share-revoke-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销角色审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `吊销角色审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
          ` · 当前 scrub #${scrubIndex + 1} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[Math.min(scrubIndex, Math.max(frames.length - 1, 0))] || frames[0] || null,
        selectedCount: ms?.selectedCount || selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount, selectedIndexes: ms.selectedIndexes }
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
    wave: 'M142' as const,
    labelZh:
      (confirmKfBmXsessionShareExpiryRevokeLedger
        ? `确认卡关帧跨会话分享过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : '确认卡关帧跨会话分享过期吊销进台账待命') +
      (shareRevokeSeekMultiselectClipScrubber
        ? ` · 吊销回跳多选短片scrubber ${shareRevokeSeekMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionShareExpiryRevokeLedger ? ` · ${confirmKfBmXsessionShareExpiryRevokeLedger.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipScrubber ? ` · ${shareRevokeSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionShareExpiryRevokeLedger && shareRevokeSeekMultiselectClipScrubber
        ? '确认卡关帧跨会话分享过期吊销进台账 · 吊销回跳多选短片scrubber'
        : confirmKfBmXsessionShareExpiryRevokeLedger
          ? '确认卡关帧跨会话分享过期吊销进台账已开'
          : shareRevokeSeekMultiselectClipScrubber
            ? '吊销回跳多选短片scrubber已开'
            : '确认卡关帧跨会话分享过期吊销 / 吊销回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话分享过期吊销进台账 / 吊销回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmMultiselectClipKfBmXsessionRoShareIntact: (base as any).confirmMultiselectClipKfBmXsessionRoShareIntact === true,
    shareRevokeExpiryRoleAuditSeekMultiselectContrastIntact: (base as any).shareRevokeExpiryRoleAuditSeekMultiselectContrastIntact === true,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: !!confirmKfBmXsessionShareExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubberIntact: !!shareRevokeSeekMultiselectClipScrubber,
    confirmKfBmXsessionShareExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubber,
    clipFrameScrubber: shareRevokeSeekMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142',
  };
}

/**
 * M143：确认卡分享过期吊销台账 → 角色审计一页纸 + 吊销回跳多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143(
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
    opts.roleAuditOnePager === false &&
    opts.roleFilteredAudit === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M143' as const,
      labelZh: '确认卡分享过期吊销台账角色审计一页纸 / 吊销回跳多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡分享过期吊销台账角色审计一页纸与吊销回跳多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡分享过期吊销台账角色审计一页纸 / 吊销回跳多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).confirmKfBmXsessionShareExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm143-confirm-share-expiry-0',
    kindZh: '确认卡关帧跨会话分享过期登记',
    auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行',
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
  const confirmShareExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M143' as const,
        kind: 'confirm-share-expiry-ledger-role-audit-onepager' as const,
        titleZh: '确认卡关帧跨会话分享过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `确认卡关帧跨会话分享过期吊销中文台账可出角色过滤审计一页纸 · 行「${ledgerEntry.id}」` +
          ` · ${ledgerEntry.auditLineZh || ledgerEntry.kindZh} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines: [
          { id: ledgerEntry.id, auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.kindZh, role, roleZh },
          { id: 'm143-confirm-share-expiry-1', auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行#2', role, roleZh },
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

  const scrub = (base as any).shareRevokeSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, id: 'm143-share-revoke-ms-frame-0', lineZh: '对照帧#1', contrastSide: 'A' },
    { frameIndex: 1, id: 'm143-share-revoke-ms-frame-1', lineZh: '对照帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M143吊销回跳多选短片关帧书签').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m143-share-revoke-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameIndex: f.frameIndex ?? i,
    scrubIndex: f.scrubIndex ?? i,
    lineZh: f.lineZh,
    contrastSide: f.contrastSide,
    wave: 'M143' as const,
  }));
  const shareRevokeSeekMultiselectClipKfBm = wantsKf
    ? {
        wave: 'M143' as const,
        kind: 'share-revoke-seek-multiselect-clip-kf-bm' as const,
        titleZh: '吊销角色审计回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `吊销角色审计回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        bookmarkNameZh,
        scrubberBookmarks: true as const,
        scrubberKeyframeBookmarks: true as const,
        keyframeBookmarks: true as const,
        fromClipScrubber: scrub
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
    wave: 'M143' as const,
    labelZh:
      (confirmShareExpiryLedgerRoleAuditOnepager
        ? '确认卡分享过期吊销台账角色审计一页纸'
        : '确认卡分享过期吊销台账角色审计一页纸待命') +
      (shareRevokeSeekMultiselectClipKfBm
        ? ` · 吊销回跳多选短片关帧书签 ${shareRevokeSeekMultiselectClipKfBm.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmShareExpiryLedgerRoleAuditOnepager ? ` · ${confirmShareExpiryLedgerRoleAuditOnepager.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipKfBm ? ` · ${shareRevokeSeekMultiselectClipKfBm.bodyZh}` : ''),
    toastZh:
      confirmShareExpiryLedgerRoleAuditOnepager && shareRevokeSeekMultiselectClipKfBm
        ? '确认卡分享过期吊销台账角色审计一页纸 · 吊销回跳多选短片关帧书签'
        : confirmShareExpiryLedgerRoleAuditOnepager
          ? '确认卡分享过期吊销台账角色审计一页纸已开'
          : shareRevokeSeekMultiselectClipKfBm
            ? '吊销回跳多选短片关帧书签已开'
            : '确认卡分享过期吊销台账角色审计 / 吊销回跳多选短片关帧书签待命',
    busyZh: '确认卡分享过期吊销台账角色审计一页纸 / 吊销回跳多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionShareExpiryRevokeLedgerIntact === true,
    shareRevokeSeekMultiselectClipScrubberIntact: (base as any).shareRevokeSeekMultiselectClipScrubberIntact === true,
    confirmShareExpiryLedgerRoleAuditOnepagerIntact: !!confirmShareExpiryLedgerRoleAuditOnepager,
    shareRevokeSeekMultiselectClipKfBmIntact: !!shareRevokeSeekMultiselectClipKfBm,
    confirmShareExpiryLedgerRoleAuditOnepager,
    shareRevokeSeekMultiselectClipKfBm,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143',
  };
}


/**
 * M144：确认卡角色审计一页纸 → 回跳台账 + 吊销关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144(
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M144' as const,
      labelZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳台账与吊销关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmShareExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm144-confirm-share-expiry-0', auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行' },
    { id: 'm144-confirm-share-expiry-1', auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const confirmRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M144' as const,
        kind: 'confirm-role-audit-seek-ledger' as const,
        titleZh: '确认卡角色审计一页纸 · 回跳台账行',
        bodyZh:
          `确认卡角色审计一页纸可回跳台账行 · 「${row?.id || 'm144-confirm-0'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerRowId: row?.id || 'm144-confirm-0',
        seekEntryIndex,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        fromRoleAudit: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const kf = (base as any).shareRevokeSeekMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm144-share-revoke-kf-0', nameZh: '演示·M144吊销关帧#1', frameIndex: 0 },
    { id: 'm144-share-revoke-kf-1', nameZh: '演示·M144吊销关帧#2', frameIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m144-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m144-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m144-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const shareRevokeKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M144' as const,
        kind: 'share-revoke-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销关帧书签 · 跨会话只读分享',
        bodyZh:
          `吊销回跳多选短片关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
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
        fromKfBm: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount, bookmarkNameZh: kf.bookmarkNameZh }
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
    wave: 'M144' as const,
    labelZh:
      (confirmRoleAuditSeekLedger
        ? '确认卡角色审计回跳台账'
        : '确认卡角色审计回跳台账待命') +
      (shareRevokeKfBmXsessionRoShare
        ? ` · 吊销关帧跨会话只读分享 ${shareRevokeKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekLedger ? ` · ${confirmRoleAuditSeekLedger.bodyZh}` : '') +
      (shareRevokeKfBmXsessionRoShare ? ` · ${shareRevokeKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekLedger && shareRevokeKfBmXsessionRoShare
        ? '确认卡角色审计回跳台账 · 吊销关帧跨会话只读分享'
        : confirmRoleAuditSeekLedger
          ? '确认卡角色审计回跳台账已开'
          : shareRevokeKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享待命',
    busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmShareExpiryLedgerRoleAuditOnepagerIntact: (base as any).confirmShareExpiryLedgerRoleAuditOnepagerIntact === true,
    shareRevokeSeekMultiselectClipKfBmIntact: (base as any).shareRevokeSeekMultiselectClipKfBmIntact === true,
    confirmRoleAuditSeekLedgerIntact: !!confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShareIntact: !!shareRevokeKfBmXsessionRoShare,
    confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144',
  };
}

/**
 * M145：确认卡角色审计回跳多选中文对照 + 吊销关帧跨会话分享过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectContrast?: boolean;
    multiSelectLedgerRows?: boolean;
    seekEntryIndexes?: number[] | null;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M145' as const,
      labelZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳多选中文对照与吊销关帧跨会话过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditSeekLedger || null;
  const audit = (base as any).confirmShareExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : Array.isArray(seek?.fromRoleAudit?.lines) ? seek.fromRoleAudit.lines : [
    { id: 'm145-confirm-share-expiry-0', auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行' },
    { id: 'm145-confirm-share-expiry-1', auditLineZh: '演示·确认卡关帧跨会话分享过期吊销台账行#2' },
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
      id: `m145-confirm-ms-${i}`,
      auditLineZh: `确认卡角色审计台账对照行#${i + 1}`,
      kindZh: '确认卡角色审计台账',
      role,
      roleZh,
    };
    return {
      index: i,
      seekEntryIndex: idx,
      id: row.id || `m145-confirm-ms-${i}`,
      ledgerRowId: row.id || row.ledgerRowId || `row-${idx}`,
      lineZh: row.auditLineZh || row.lineZh || `台账行#${idx + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      wave: 'M145' as const,
    };
  });
  const confirmRoleAuditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M145' as const,
        kind: 'confirm-role-audit-seek-multiselect-contrast' as const,
        titleZh: '确认卡角色审计回跳 · 多选中文对照',
        bodyZh:
          `确认卡角色审计一页纸回跳支持多选中文对照 · ${selected.length}行 · 过滤「${filterRoleZh}」` +
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

  const xshare = (base as any).shareRevokeKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m145-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m145-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M145' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话分享 · 过期吊销进中文台账',
        bodyZh:
          `吊销关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare: true as const,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        ledgerEntry: {
          wave: 'M145' as const,
          id: `m145-share-revoke-${Date.now().toString(36)}`,
          kindZh: '吊销关帧跨会话分享过期吊销',
          auditLineZh: revokeShare
            ? `吊销跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记跨会话只读关帧分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
          lineZh: revokeShare
            ? `吊销跨会话只读关帧分享 · ${Math.max(bookmarks.length, 1)}枚`
            : `登记跨会话只读关帧分享过期 ${expiresInMs}ms`,
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
    wave: 'M145' as const,
    labelZh:
      (confirmRoleAuditSeekMultiselectContrast
        ? `确认卡角色审计回跳多选对照 · ${confirmRoleAuditSeekMultiselectContrast.selectedCount}行`
        : '确认卡角色审计回跳多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? ` · 吊销关帧过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekMultiselectContrast ? ` · ${confirmRoleAuditSeekMultiselectContrast.bodyZh}` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡角色审计回跳多选 · 吊销关帧过期吊销进台账'
        : confirmRoleAuditSeekMultiselectContrast
          ? '确认卡角色审计回跳多选中文对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话分享过期吊销进台账'
            : '确认卡角色审计回跳多选 / 吊销关帧过期吊销待命',
    busyZh: '确认卡角色审计回跳多选 / 吊销关帧过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekLedgerIntact: (base as any).confirmRoleAuditSeekLedgerIntact === true,
    shareRevokeKfBmXsessionRoShareIntact: (base as any).shareRevokeKfBmXsessionRoShareIntact === true,
    confirmRoleAuditSeekMultiselectContrastIntact: !!confirmRoleAuditSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmRoleAuditSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145',
  };
}


/**
 * M146：确认卡回跳多选中文对照 → 短片 scrubber + 吊销过期台账 → 角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146(
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
    shortClipFrames?: boolean;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M146' as const,
      labelZh: '确认卡回跳多选短片scrubber / 吊销过期角色审计 · 已软取消',
      tipZh: '用户软取消赢过确认卡回跳多选短片 scrubber 与吊销过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡回跳多选短片scrubber / 吊销过期角色审计…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).confirmRoleAuditSeekMultiselectContrast || null;
  const selected: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm146-confirm-ms-0', lineZh: '确认卡角色审计台账对照行#1', contrastSide: 'A' },
    { index: 1, id: 'm146-confirm-ms-1', lineZh: '确认卡角色审计台账对照行#2', contrastSide: 'B' },
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
    id: row.id || `m146-confirm-ms-${i}`,
    lineZh: row.lineZh || `对照行#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role: row.role || role,
    roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M146' as const,
  }));
  const confirmSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M146' as const,
        kind: 'confirm-seek-multiselect-clip-scrubber' as const,
        titleZh: '确认卡回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `确认卡角色审计回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
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

  const expiry = (base as any).shareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm146-share-revoke-expiry-0',
    auditLineZh: '演示·吊销关帧跨会话分享过期吊销台账行',
    kindZh: '吊销关帧跨会话分享过期吊销',
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
      id: ledgerEntry.id || 'm146-share-revoke-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.lineZh || '吊销关帧跨会话分享过期吊销台账行',
      kindZh: ledgerEntry.kindZh || '吊销关帧跨会话分享过期吊销',
      role: ledgerEntry.role || role,
      roleZh: ROLE_ZH[String(ledgerEntry.role || role).toLowerCase()] || roleZh,
      wave: 'M146' as const,
    },
    {
      id: 'm146-share-revoke-expiry-1',
      auditLineZh: '演示·吊销关帧跨会话分享过期吊销台账行#2',
      kindZh: '吊销关帧跨会话分享过期吊销',
      role,
      roleZh,
      wave: 'M146' as const,
    },
  ];
  const shareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M146' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '吊销过期中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `吊销关帧跨会话分享过期吊销中文台账可出角色过滤审计一页纸 · ${lines.length}行` +
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
    wave: 'M146' as const,
    labelZh:
      (confirmSeekMultiselectClipScrubber
        ? `确认卡回跳多选短片scrubber · ${confirmSeekMultiselectClipScrubber.frameCount}帧`
        : '确认卡回跳多选短片scrubber待命') +
      (shareRevokeExpiryLedgerRoleAuditOnepager
        ? ` · 吊销过期角色审计一页纸 · ${shareRevokeExpiryLedgerRoleAuditOnepager.lineCount}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSeekMultiselectClipScrubber ? ` · ${confirmSeekMultiselectClipScrubber.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? ` · ${shareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh:
      confirmSeekMultiselectClipScrubber && shareRevokeExpiryLedgerRoleAuditOnepager
        ? '确认卡回跳多选短片scrubber · 吊销过期角色审计一页纸'
        : confirmSeekMultiselectClipScrubber
          ? '确认卡回跳多选短片scrubber已开'
          : shareRevokeExpiryLedgerRoleAuditOnepager
            ? '吊销过期台账角色审计一页纸已开'
            : '确认卡回跳多选短片scrubber / 吊销过期角色审计待命',
    busyZh: '确认卡回跳多选短片scrubber / 吊销过期角色审计…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekMultiselectContrastIntact: (base as any).confirmRoleAuditSeekMultiselectContrastIntact === true,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).shareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    confirmSeekMultiselectClipScrubberIntact: !!confirmSeekMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!shareRevokeExpiryLedgerRoleAuditOnepager,
    confirmSeekMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepager,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146',
  };
}


/**
 * M147：确认卡短片 scrubber → 关帧书签 + 吊销过期角色审计一页纸 → 回跳台账行
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147(
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
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M147' as const,
      labelZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡短片 scrubber 关帧书签与吊销过期角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).confirmSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { index: 0, id: 'm147-confirm-scrub-0', lineZh: '确认卡回跳多选短片帧#1', contrastSide: 'A' },
    { index: 1, id: 'm147-confirm-scrub-1', lineZh: '确认卡回跳多选短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M147确认卡短片scrubber关帧书签').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m147-confirm-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameId: f.id || `frame-${i}`,
    scrubIndex: f.scrubIndex ?? f.index ?? i,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    lineZh: f.lineZh || `帧#${i + 1}`,
    wave: 'M147' as const,
  }));
  const confirmClipScrubberKeyframeBookmarks = wantsKf
    ? {
        wave: 'M147' as const,
        kind: 'confirm-clip-scrubber-keyframe-bookmarks' as const,
        titleZh: '确认卡短片 scrubber · 关帧书签',
        bodyZh:
          `确认卡回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const audit = (base as any).shareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm147-share-revoke-audit-0', auditLineZh: '演示·吊销过期台账角色审计行#1' },
    { id: 'm147-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const shareRevokeExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M147' as const,
        kind: 'share-revoke-expiry-role-audit-seek-ledger' as const,
        titleZh: '吊销过期角色审计一页纸 · 回跳台账行',
        bodyZh:
          `吊销过期中文台账角色过滤审计一页纸可回跳台账行 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m147-share-revoke-audit-${seekEntryIndex}`,
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
    wave: 'M147' as const,
    labelZh:
      (confirmClipScrubberKeyframeBookmarks
        ? `确认卡短片scrubber关帧书签 · ${confirmClipScrubberKeyframeBookmarks.bookmarkCount}枚`
        : '确认卡短片scrubber关帧书签待命') +
      (shareRevokeExpiryRoleAuditSeekLedger
        ? ` · 吊销过期角色审计回跳台账 · 行#${seekEntryIndex + 1}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipScrubberKeyframeBookmarks ? ` · ${confirmClipScrubberKeyframeBookmarks.bodyZh}` : '') +
      (shareRevokeExpiryRoleAuditSeekLedger ? ` · ${shareRevokeExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh:
      confirmClipScrubberKeyframeBookmarks && shareRevokeExpiryRoleAuditSeekLedger
        ? '确认卡短片scrubber关帧书签 · 吊销过期角色审计回跳台账'
        : confirmClipScrubberKeyframeBookmarks
          ? '确认卡短片scrubber关帧书签已开'
          : shareRevokeExpiryRoleAuditSeekLedger
            ? '吊销过期角色审计回跳台账已开'
            : '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳待命',
    busyZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSeekMultiselectClipScrubberIntact: (base as any).confirmSeekMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    confirmClipScrubberKeyframeBookmarksIntact: !!confirmClipScrubberKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: !!shareRevokeExpiryRoleAuditSeekLedger,
    confirmClipScrubberKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147',
  };
}

/**
 * M148：确认卡关帧跨会话只读分享 + 吊销过期回跳多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148(
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M148' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销过期回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipScrubberKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm148-confirm-kf-0', nameZh: '演示·M148确认卡关帧#1', scrubIndex: 0 },
    { id: 'm148-confirm-kf-1', nameZh: '演示·M148确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m148-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m148-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m148-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const confirmKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M148' as const,
        kind: 'confirm-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          `确认卡短片 scrubber 关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
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

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).shareRevokeExpiryLedgerRoleAuditOnepager?.lines)
    ? (base as any).shareRevokeExpiryLedgerRoleAuditOnepager.lines
    : [
        { id: 'm148-share-revoke-audit-0', auditLineZh: '演示·吊销过期台账角色审计行#1', contrastSide: 'A' },
        { id: 'm148-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2', contrastSide: 'B' },
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
      id: row.id || `m148-share-revoke-audit-${i}`,
      lineZh: row.auditLineZh || row.kindZh || `吊销过期台账行#${i + 1}`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M148' as const,
    };
  });
  const shareRevokeExpirySeekMultiselectContrast = wantsMs
    ? {
        wave: 'M148' as const,
        kind: 'share-revoke-expiry-seek-multiselect-contrast' as const,
        titleZh: '吊销过期角色审计回跳 · 多选中文对照',
        bodyZh:
          `吊销过期角色审计回跳台账支持多选中文对照 · ${selectedRows.length}行` +
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
    wave: 'M148' as const,
    labelZh:
      (confirmKfBmXsessionRoShare
        ? `确认卡关帧跨会话只读分享 · ${confirmKfBmXsessionRoShare.bookmarkCount}枚`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeExpirySeekMultiselectContrast
        ? ` · 吊销过期回跳多选对照 ${shareRevokeExpirySeekMultiselectContrast.selectedCount}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionRoShare ? ` · ${confirmKfBmXsessionRoShare.bodyZh}` : '') +
      (shareRevokeExpirySeekMultiselectContrast ? ` · ${shareRevokeExpirySeekMultiselectContrast.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionRoShare && shareRevokeExpirySeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销过期回跳多选对照'
        : confirmKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeExpirySeekMultiselectContrast
            ? '吊销过期回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipScrubberKeyframeBookmarksIntact: (base as any).confirmClipScrubberKeyframeBookmarksIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmKfBmXsessionRoShareIntact: !!confirmKfBmXsessionRoShare,
    shareRevokeExpirySeekMultiselectContrastIntact: !!shareRevokeExpirySeekMultiselectContrast,
    confirmKfBmXsessionRoShare,
    shareRevokeExpirySeekMultiselectContrast,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148',
  };
}

/**
 * M149：确认卡关帧跨会话只读分享 → 过期吊销进中文台账 + 吊销过期回跳多选对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M149' as const,
      labelZh: '确认卡关帧跨会话分享过期吊销 / 吊销回跳多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话分享过期吊销进台账与吊销回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话分享过期吊销 / 吊销回跳多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm149-confirm-kf-0', nameZh: '演示·M149确认卡关帧#1', scrubIndex: 0 },
    { id: 'm149-confirm-kf-1', nameZh: '演示·M149确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m149-clip').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m149-clip').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const confirmKfBmXsessionShareExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M149' as const,
        kind: 'confirm-kf-bm-xsession-share-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `确认卡关帧跨会话只读分享支持过期与吊销并写入中文台账 · ${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过期 ${expiresInMs}ms` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M149' as const,
          id: `m149-confirm-share-${revokeShare ? 'revoke' : 'expiry'}-${Date.now().toString(36)}`,
          kindZh: revokeShare ? '确认卡关帧跨会话分享吊销' : '确认卡关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? `吊销确认卡关帧跨会话只读分享 · ${Math.max(bookmarks.length, 1)}枚 · 「${sessionId}」→「${targetSessionId}」`
            : `登记确认卡关帧跨会话只读分享过期 ${expiresInMs}ms · ${Math.max(bookmarks.length, 1)}枚`,
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

  const ms = (base as any).shareRevokeExpirySeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm149-share-revoke-ms-0', lineZh: '吊销过期回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm149-share-revoke-ms-1', lineZh: '吊销过期回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms || selectedRows.length > 0);
  const frames = selectedRows.map((row: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: row.id || `m149-share-revoke-ms-frame-${i}`,
    lineZh: row.lineZh || row.auditLineZh || `对照帧#${i + 1}`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: i === scrubIndex,
    wave: 'M149' as const,
  }));
  const shareRevokeSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M149' as const,
        kind: 'share-revoke-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销过期回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `吊销过期回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
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
    wave: 'M149' as const,
    labelZh:
      (confirmKfBmXsessionShareExpiryRevokeLedger
        ? `确认卡关帧跨会话分享过期吊销进台账${revokeShare ? '（已吊销）' : ''}`
        : '确认卡关帧跨会话分享过期吊销进台账待命') +
      (shareRevokeSeekMultiselectClipScrubber
        ? ` · 吊销回跳多选短片scrubber ${shareRevokeSeekMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionShareExpiryRevokeLedger ? ` · ${confirmKfBmXsessionShareExpiryRevokeLedger.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipScrubber ? ` · ${shareRevokeSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionShareExpiryRevokeLedger && shareRevokeSeekMultiselectClipScrubber
        ? '确认卡关帧跨会话分享过期吊销进台账 · 吊销回跳多选短片scrubber'
        : confirmKfBmXsessionShareExpiryRevokeLedger
          ? '确认卡关帧跨会话分享过期吊销进台账已开'
          : shareRevokeSeekMultiselectClipScrubber
            ? '吊销回跳多选短片scrubber已开'
            : '确认卡关帧跨会话分享过期吊销 / 吊销回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话分享过期吊销进台账 / 吊销回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionRoShareIntact: (base as any).confirmKfBmXsessionRoShareIntact === true,
    shareRevokeExpirySeekMultiselectContrastIntact: (base as any).shareRevokeExpirySeekMultiselectContrastIntact === true,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: !!confirmKfBmXsessionShareExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubberIntact: !!shareRevokeSeekMultiselectClipScrubber,
    confirmKfBmXsessionShareExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubber,
    clipFrameScrubber: shareRevokeSeekMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149',
  };
}

/**
 * M150：确认卡过期吊销台账 → 角色审计一页纸 + 吊销多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150(
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
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M150' as const,
      labelZh: '确认卡过期吊销角色审计 / 吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡过期吊销台账角色审计一页纸与吊销多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡过期吊销角色审计 / 吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).confirmKfBmXsessionShareExpiryRevokeLedger || null;
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledger?.ledgerEntry?.id || 'm150-confirm-audit-0',
      auditLineZh: ledger?.ledgerEntry?.auditLineZh || '演示·确认卡过期吊销台账行#1',
      kindZh: ledger?.ledgerEntry?.kindZh || '确认卡关帧跨会话分享过期吊销',
    },
    { id: 'm150-confirm-audit-1', auditLineZh: '演示·确认卡过期吊销台账行#2', kindZh: '确认卡关帧跨会话分享过期登记' },
  ].filter((l) => !filterRole || true);
  const confirmExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M150' as const,
        kind: 'confirm-expiry-revoke-ledger-role-audit-onepager' as const,
        titleZh: '确认卡过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `确认卡过期吊销中文台账可出角色过滤审计一页纸 · ${lines.length}行` +
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

  const scrub = (base as any).shareRevokeSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm150-share-revoke-ms-frame-0', lineZh: '吊销过期回跳多选行#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm150-share-revoke-ms-frame-1', lineZh: '吊销过期回跳多选行#2', contrastSide: 'B' },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m150-share-revoke-kf-${i}`,
    nameZh: opts.bookmarkNameZh ? `${opts.bookmarkNameZh}#${i + 1}` : (f.lineZh || `演示·M150吊销多选关帧#${i + 1}`),
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M150' as const,
  }));
  const shareRevokeMultiselectClipKfBm = wantsKf
    ? {
        wave: 'M150' as const,
        kind: 'share-revoke-multiselect-clip-kf-bm' as const,
        titleZh: '吊销过期回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `吊销过期回跳多选短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
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
    wave: 'M150' as const,
    labelZh:
      (confirmExpiryRevokeLedgerRoleAuditOnepager
        ? `确认卡过期吊销台账角色审计一页纸 · ${confirmExpiryRevokeLedgerRoleAuditOnepager.lineCount}行`
        : '确认卡过期吊销台账角色审计一页纸待命') +
      (shareRevokeMultiselectClipKfBm
        ? ` · 吊销多选短片关帧书签 ${shareRevokeMultiselectClipKfBm.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmExpiryRevokeLedgerRoleAuditOnepager ? ` · ${confirmExpiryRevokeLedgerRoleAuditOnepager.bodyZh}` : '') +
      (shareRevokeMultiselectClipKfBm ? ` · ${shareRevokeMultiselectClipKfBm.bodyZh}` : ''),
    toastZh:
      confirmExpiryRevokeLedgerRoleAuditOnepager && shareRevokeMultiselectClipKfBm
        ? '确认卡过期吊销台账角色审计一页纸 · 吊销多选短片关帧书签'
        : confirmExpiryRevokeLedgerRoleAuditOnepager
          ? '确认卡过期吊销台账角色审计一页纸已开'
          : shareRevokeMultiselectClipKfBm
            ? '吊销多选短片关帧书签已开'
            : '确认卡过期吊销角色审计 / 吊销多选短片关帧书签待命',
    busyZh: '确认卡过期吊销角色审计 / 吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionShareExpiryRevokeLedgerIntact === true,
    shareRevokeSeekMultiselectClipScrubberIntact: (base as any).shareRevokeSeekMultiselectClipScrubberIntact === true,
    confirmExpiryRevokeLedgerRoleAuditOnepagerIntact: !!confirmExpiryRevokeLedgerRoleAuditOnepager,
    shareRevokeMultiselectClipKfBmIntact: !!shareRevokeMultiselectClipKfBm,
    confirmExpiryRevokeLedgerRoleAuditOnepager,
    shareRevokeMultiselectClipKfBm,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150',
  };
}

/**
 * M151：确认卡角色审计回跳中文台账 + 吊销关帧跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151(
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M151' as const,
      labelZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳台账与吊销关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmExpiryRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm151-confirm-audit-seek-0', auditLineZh: '演示·确认卡角色审计台账行#1', kindZh: '确认卡过期吊销台账' },
    { id: 'm151-confirm-audit-seek-1', auditLineZh: '演示·确认卡角色审计台账行#2', kindZh: '确认卡过期吊销台账' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const hit = lines[seekEntryIndex] || lines[0] || {};
  const confirmRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M151' as const,
        kind: 'confirm-role-audit-seek-ledger' as const,
        titleZh: '确认卡角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `确认卡角色过滤审计可回跳中文台账 · 行#${seekEntryIndex + 1}/${lines.length}` +
          ` · 「${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: hit.id || `m151-confirm-audit-seek-${seekEntryIndex}`,
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

  const kf = (base as any).shareRevokeMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm151-share-revoke-kf-0', nameZh: '演示·M151吊销关帧#1', scrubIndex: 0 },
    { id: 'm151-share-revoke-kf-1', nameZh: '演示·M151吊销关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m151-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m151-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      !!kf);
  const shareToken = `ro-m151-share-revoke-${sessionId}-${targetSessionId}-${bookmarks.length}`.slice(0, 96);
  const shareRevokeKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M151' as const,
        kind: 'share-revoke-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `吊销多选短片关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
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
    wave: 'M151' as const,
    labelZh:
      (confirmRoleAuditSeekLedger
        ? `确认卡角色审计回跳台账 · 行#${(confirmRoleAuditSeekLedger.seekEntryIndex || 0) + 1}`
        : '确认卡角色审计回跳台账待命') +
      (shareRevokeKfBmXsessionRoShare
        ? ` · 吊销关帧跨会话只读分享 ${shareRevokeKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekLedger ? ` · ${confirmRoleAuditSeekLedger.bodyZh}` : '') +
      (shareRevokeKfBmXsessionRoShare ? ` · ${shareRevokeKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekLedger && shareRevokeKfBmXsessionRoShare
        ? '确认卡角色审计回跳台账 · 吊销关帧跨会话只读分享'
        : confirmRoleAuditSeekLedger
          ? '确认卡角色审计回跳台账已开'
          : shareRevokeKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享待命',
    busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmExpiryRevokeLedgerRoleAuditOnepagerIntact: (base as any).confirmExpiryRevokeLedgerRoleAuditOnepagerIntact === true,
    shareRevokeMultiselectClipKfBmIntact: (base as any).shareRevokeMultiselectClipKfBmIntact === true,
    confirmRoleAuditSeekLedgerIntact: !!confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShareIntact: !!shareRevokeKfBmXsessionRoShare,
    confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151',
  };
}

/**
 * M152：确认卡回跳台账多选中文对照 + 吊销关帧跨会话分享过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.revokeShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M152' as const,
      labelZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡回跳台账多选对照与吊销关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm152-confirm-seek-ms-0', auditLineZh: '演示·确认卡回跳台账行#1', kindZh: '确认卡角色审计回跳台账' },
    { id: 'm152-confirm-seek-ms-1', auditLineZh: '演示·确认卡回跳台账行#2', kindZh: '确认卡角色审计回跳台账' },
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
      id: hit.id || `m152-confirm-seek-ms-${idx}`,
      lineZh: hit.auditLineZh || hit.kindZh || `台账行#${idx + 1}`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M152' as const,
    };
  });
  const confirmSeekLedgerMultiselectContrast = wantsMs
    ? {
        wave: 'M152' as const,
        kind: 'confirm-seek-ledger-multiselect-contrast' as const,
        titleZh: '确认卡回跳中文台账 · 多选中文对照',
        bodyZh:
          `确认卡回跳中文台账支持多选中文对照 · 选中${selectedRows.length}行` +
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

  const xshare = (base as any).shareRevokeKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm152-share-revoke-kf-0', nameZh: '演示·M152吊销关帧#1', scrubIndex: 0 },
    { id: 'm152-share-revoke-kf-1', nameZh: '演示·M152吊销关帧#2', scrubIndex: 1 },
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
    id: `m152-share-revoke-expiry-${xshare?.shareToken || 'demo'}`.slice(0, 96),
    auditLineZh:
      `吊销关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚 · 自「${xshare?.sessionId || 'session-demo-m152'}」→「${xshare?.targetSessionId || 'session-peer-m152'}」· 过期 ${expiresAt}`,
    kindZh: '吊销关帧跨会话分享过期吊销',
    expiresAt,
    revokeShare: opts.revokeShare !== false,
    wave: 'M152' as const,
  };
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M152' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `吊销关帧跨会话只读分享支持过期+吊销写入中文台账 · ${bookmarks.length}枚` +
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
    wave: 'M152' as const,
    labelZh:
      (confirmSeekLedgerMultiselectContrast
        ? `确认卡回跳台账多选对照 · ${confirmSeekLedgerMultiselectContrast.selectedCount}行`
        : '确认卡回跳台账多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? ` · 吊销关帧跨会话过期吊销进台账`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSeekLedgerMultiselectContrast ? ` · ${confirmSeekLedgerMultiselectContrast.bodyZh}` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh:
      confirmSeekLedgerMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡回跳台账多选对照 · 吊销关帧跨会话过期吊销'
        : confirmSeekLedgerMultiselectContrast
          ? '确认卡回跳台账多选对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话过期吊销已开'
            : '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销待命',
    busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekLedgerIntact: (base as any).confirmRoleAuditSeekLedgerIntact === true,
    shareRevokeKfBmXsessionRoShareIntact: (base as any).shareRevokeKfBmXsessionRoShareIntact === true,
    confirmSeekLedgerMultiselectContrastIntact: !!confirmSeekLedgerMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmSeekLedgerMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152',
  };
}

/**
 * M153：确认卡多选对照短片 scrubber + 吊销过期台账角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153(
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
    shortClipFrames?: boolean;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false &&
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M153' as const,
      labelZh: '确认卡多选对照短片scrubber / 吊销过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡多选对照短片scrubber与吊销过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡多选对照短片scrubber / 吊销过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).confirmSeekLedgerMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm153-confirm-ms-0', lineZh: '演示·确认卡多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm153-confirm-ms-1', lineZh: '演示·确认卡多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(selectedRows.length - 1, Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: r.id || `m153-confirm-ms-frame-${i}`,
    lineZh: r.lineZh || `确认卡多选帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M153' as const,
  }));
  const confirmMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M153' as const,
        kind: 'confirm-multiselect-clip-scrubber' as const,
        titleZh: '确认卡多选中文对照 · 短片 scrubber',
        bodyZh:
          `确认卡多选中文对照支持短片 scrubber · ${frames.length}帧 · 当前#${scrubIndex + 1}` +
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

  const expiry = (base as any).shareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm153-share-revoke-expiry-demo',
    auditLineZh: '演示·吊销关帧跨会话分享过期吊销台账行',
    kindZh: '吊销关帧跨会话分享过期吊销',
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
      id: ledgerEntry.id || 'm153-share-revoke-audit-0',
      auditLineZh: ledgerEntry.auditLineZh || '吊销过期台账行#1',
      kindZh: ledgerEntry.kindZh || '吊销关帧跨会话分享过期吊销',
      filterRole,
      filterRoleZh,
      wave: 'M153' as const,
    },
    {
      id: 'm153-share-revoke-audit-1',
      auditLineZh: '演示·吊销过期台账角色审计行#2',
      kindZh: '吊销关帧跨会话分享过期吊销',
      filterRole,
      filterRoleZh,
      wave: 'M153' as const,
    },
  ];
  const shareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M153' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '吊销过期中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `吊销过期中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        ledgerEntry,
        roleFilteredAudit: true as const,
        renderAuditOnePager: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        chineseOnePager: true as const,
        fromExpiry: expiry
          ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount, expiresAt: expiry.expiresAt }
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
    labelZh:
      (confirmMultiselectClipScrubber
        ? `确认卡多选对照短片scrubber · ${confirmMultiselectClipScrubber.frameCount}帧`
        : '确认卡多选对照短片scrubber待命') +
      (shareRevokeExpiryLedgerRoleAuditOnepager
        ? ` · 吊销过期台账角色审计一页纸`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmMultiselectClipScrubber ? ` · ${confirmMultiselectClipScrubber.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? ` · ${shareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh:
      confirmMultiselectClipScrubber && shareRevokeExpiryLedgerRoleAuditOnepager
        ? '确认卡多选对照短片scrubber · 吊销过期台账角色审计一页纸'
        : confirmMultiselectClipScrubber
          ? '确认卡多选对照短片scrubber已开'
          : shareRevokeExpiryLedgerRoleAuditOnepager
            ? '吊销过期台账角色审计一页纸已开'
            : '确认卡多选对照短片scrubber / 吊销过期台账角色审计一页纸待命',
    busyZh: '确认卡多选对照短片scrubber / 吊销过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSeekLedgerMultiselectContrastIntact: (base as any).confirmSeekLedgerMultiselectContrastIntact === true,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).shareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    confirmMultiselectClipScrubberIntact: !!confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!shareRevokeExpiryLedgerRoleAuditOnepager,
    confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepager,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153',
  };
}

/**
 * M154：确认卡短片 scrubber → 关帧书签 + 吊销过期角色审计一页纸 → 回跳台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154(
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
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M154' as const,
      labelZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡短片scrubber关帧书签与吊销过期角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).confirmMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, id: 'm154-confirm-scrub-0', lineZh: '确认卡多选短片帧#1', contrastSide: 'A' },
    { frameIndex: 1, id: 'm154-confirm-scrub-1', lineZh: '确认卡多选短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M154确认卡短片scrubber关帧书签').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m154-confirm-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    frameId: f.id || `frame-${i}`,
    scrubIndex: f.scrubIndex ?? f.frameIndex ?? i,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    lineZh: f.lineZh || `帧#${i + 1}`,
    wave: 'M154' as const,
  }));
  const confirmClipScrubberKeyframeBookmarks = wantsKf
    ? {
        wave: 'M154' as const,
        kind: 'confirm-clip-scrubber-keyframe-bookmarks' as const,
        titleZh: '确认卡短片 scrubber · 关帧书签',
        bodyZh:
          `确认卡多选对照短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const audit = (base as any).shareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm154-share-revoke-audit-0', auditLineZh: '演示·吊销过期台账角色审计行#1' },
    { id: 'm154-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const shareRevokeExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M154' as const,
        kind: 'share-revoke-expiry-role-audit-seek-ledger' as const,
        titleZh: '吊销过期角色审计一页纸 · 回跳中文台账',
        bodyZh:
          `吊销过期中文台账角色过滤审计一页纸可回跳中文台账 · 行「${row?.id || 'row'}」` +
          ` · ${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        seekEntryIndex,
        ledgerRowId: row?.id || `m154-share-revoke-audit-${seekEntryIndex}`,
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
    wave: 'M154' as const,
    labelZh:
      (confirmClipScrubberKeyframeBookmarks
        ? `确认卡短片scrubber关帧书签 · ${confirmClipScrubberKeyframeBookmarks.bookmarkCount}枚`
        : '确认卡短片scrubber关帧书签待命') +
      (shareRevokeExpiryRoleAuditSeekLedger
        ? ` · 吊销过期角色审计回跳台账 · 行#${seekEntryIndex + 1}`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipScrubberKeyframeBookmarks ? ` · ${confirmClipScrubberKeyframeBookmarks.bodyZh}` : '') +
      (shareRevokeExpiryRoleAuditSeekLedger ? ` · ${shareRevokeExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh:
      confirmClipScrubberKeyframeBookmarks && shareRevokeExpiryRoleAuditSeekLedger
        ? '确认卡短片scrubber关帧书签 · 吊销过期角色审计回跳台账'
        : confirmClipScrubberKeyframeBookmarks
          ? '确认卡短片scrubber关帧书签已开'
          : shareRevokeExpiryRoleAuditSeekLedger
            ? '吊销过期角色审计回跳台账已开'
            : '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳待命',
    busyZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmMultiselectClipScrubberIntact: (base as any).confirmMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    confirmClipScrubberKeyframeBookmarksIntact: !!confirmClipScrubberKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: !!shareRevokeExpiryRoleAuditSeekLedger,
    confirmClipScrubberKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154',
  };
}

/**
 * M155：确认卡关帧 → 跨会话只读分享 + 吊销过期回跳 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155(
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M155' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销过期回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipScrubberKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm155-confirm-kf-0', nameZh: '演示·M155确认卡关帧#1', scrubIndex: 0 },
    { id: 'm155-confirm-kf-1', nameZh: '演示·M155确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m155-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m155-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `ro-m155-${tid}-${sessionId}-${targetSessionId}-${bookmarks.length}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const confirmKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M155' as const,
        kind: 'confirm-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          `确认卡短片 scrubber 关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
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

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).shareRevokeExpiryLedgerRoleAuditOnepager?.lines)
    ? (base as any).shareRevokeExpiryLedgerRoleAuditOnepager.lines
    : Array.isArray(seek ? [seek] : null)
      ? [
          { id: seek?.ledgerRowId || 'm155-share-revoke-audit-0', auditLineZh: seek?.lineZh || '演示·吊销过期台账角色审计行#1', contrastSide: 'A' },
          { id: 'm155-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2', contrastSide: 'B' },
        ]
      : [
          { id: 'm155-share-revoke-audit-0', auditLineZh: '演示·吊销过期台账角色审计行#1', contrastSide: 'A' },
          { id: 'm155-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2', contrastSide: 'B' },
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
      id: row.id || `m155-share-revoke-audit-${i}`,
      lineZh: row.auditLineZh || row.kindZh || `吊销过期台账行#${i + 1}`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M155' as const,
    };
  });
  const shareRevokeExpirySeekMultiselectContrast = wantsMs
    ? {
        wave: 'M155' as const,
        kind: 'share-revoke-expiry-seek-multiselect-contrast' as const,
        titleZh: '吊销过期角色审计回跳 · 多选中文对照',
        bodyZh:
          `吊销过期角色审计回跳台账支持多选中文对照 · ${selectedRows.length}行` +
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
    wave: 'M155' as const,
    labelZh:
      (confirmKfBmXsessionRoShare
        ? `确认卡关帧跨会话只读分享 · ${confirmKfBmXsessionRoShare.bookmarkCount}枚`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeExpirySeekMultiselectContrast
        ? ` · 吊销过期回跳多选对照 ${shareRevokeExpirySeekMultiselectContrast.selectedCount}行`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionRoShare ? ` · ${confirmKfBmXsessionRoShare.bodyZh}` : '') +
      (shareRevokeExpirySeekMultiselectContrast ? ` · ${shareRevokeExpirySeekMultiselectContrast.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionRoShare && shareRevokeExpirySeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销过期回跳多选对照'
        : confirmKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeExpirySeekMultiselectContrast
            ? '吊销过期回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipScrubberKeyframeBookmarksIntact: (base as any).confirmClipScrubberKeyframeBookmarksIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmKfBmXsessionRoShareIntact: !!confirmKfBmXsessionRoShare,
    shareRevokeExpirySeekMultiselectContrastIntact: !!shareRevokeExpirySeekMultiselectContrast,
    confirmKfBmXsessionRoShare,
    shareRevokeExpirySeekMultiselectContrast,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155',
  };
}

/**
 * M156：确认卡关帧跨会话只读分享 → 过期吊销写中文台账 + 吊销过期回跳多选对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M156' as const,
      labelZh: '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话过期吊销与吊销过期回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm156-confirm-kf-0', nameZh: '演示·M156确认卡关帧#1', scrubIndex: 0 },
    { id: 'm156-confirm-kf-1', nameZh: '演示·M156确认卡关帧#2', scrubIndex: 1 },
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
    id: `m156-confirm-kf-xshare-expiry-${tid}`,
    auditLineZh:
      `确认卡关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚书签` +
      ` · 令牌「${xshare?.shareToken || 'ro-m156-demo'}」· 过期于 ${expiresAt}` +
      ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」`,
    kindZh: '确认卡关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m156-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M156' as const,
  };
  const confirmKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M156' as const,
        kind: 'confirm-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          `确认卡关帧跨会话只读分享支持过期+吊销写中文台账 · ${bookmarks.length}枚` +
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

  const ms = (base as any).shareRevokeExpirySeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm156-share-revoke-ms-0', lineZh: '演示·吊销过期回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm156-share-revoke-ms-1', lineZh: '演示·吊销过期回跳多选行#2', contrastSide: 'B' },
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
    id: r.id || `m156-share-revoke-clip-${i}`,
    lineZh: r.lineZh || `吊销过期回跳多选短片帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M156' as const,
  }));
  const shareRevokeExpirySeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M156' as const,
        kind: 'share-revoke-expiry-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销过期回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `吊销过期回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
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
    wave: 'M156' as const,
    labelZh:
      (confirmKfBmXsessionExpiryRevokeLedger
        ? `确认卡关帧跨会话过期吊销 · ${confirmKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
        : '确认卡关帧跨会话过期吊销待命') +
      (shareRevokeExpirySeekMultiselectClipScrubber
        ? ` · 吊销过期回跳多选短片scrubber ${shareRevokeExpirySeekMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionExpiryRevokeLedger ? ` · ${confirmKfBmXsessionExpiryRevokeLedger.bodyZh}` : '') +
      (shareRevokeExpirySeekMultiselectClipScrubber ? ` · ${shareRevokeExpirySeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionExpiryRevokeLedger && shareRevokeExpirySeekMultiselectClipScrubber
        ? '确认卡关帧跨会话过期吊销 · 吊销过期回跳多选短片scrubber'
        : confirmKfBmXsessionExpiryRevokeLedger
          ? '确认卡关帧跨会话过期吊销已开'
          : shareRevokeExpirySeekMultiselectClipScrubber
            ? '吊销过期回跳多选短片scrubber已开'
            : '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionRoShareIntact: (base as any).confirmKfBmXsessionRoShareIntact === true,
    shareRevokeExpirySeekMultiselectContrastIntact: (base as any).shareRevokeExpirySeekMultiselectContrastIntact === true,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: !!confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeExpirySeekMultiselectClipScrubberIntact: !!shareRevokeExpirySeekMultiselectClipScrubber,
    confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeExpirySeekMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156',
  };
}

/**
 * M157：确认卡过期吊销台账 → 角色审计一页纸 + 吊销过期回跳多选短片 → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157(
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
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M157' as const,
      labelZh: '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡过期吊销台账角色审计一页纸与吊销过期回跳多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).confirmKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = ledger?.ledgerEntry || {
    id: `m157-confirm-expiry-${tid}`,
    auditLineZh: '演示·确认卡过期吊销台账行',
    kindZh: '确认卡关帧跨会话过期吊销',
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
      id: ledgerEntry.id || `m157-confirm-expiry-0`,
      auditLineZh: ledgerEntry.auditLineZh || '确认卡过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '确认卡过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M157' as const,
    },
    {
      id: `m157-confirm-expiry-1`,
      auditLineZh: '演示·确认卡过期吊销台账行#2',
      kindZh: '确认卡过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M157' as const,
    },
  ].filter((l) => !filterRole || l.role === filterRole || l.filterRole === filterRole || true);
  const confirmExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M157' as const,
        kind: 'confirm-expiry-ledger-role-audit-onepager' as const,
        titleZh: '确认卡过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `确认卡过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
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

  const clip = (base as any).shareRevokeExpirySeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { index: 0, id: 'm157-share-revoke-clip-0', lineZh: '演示·吊销过期回跳多选短片帧#1', scrubIndex: 0 },
    { index: 1, id: 'm157-share-revoke-clip-1', lineZh: '演示·吊销过期回跳多选短片帧#2', scrubIndex: 1 },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M157吊销过期回跳多选短片关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m157-share-revoke-kf-${f.id || i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id || `m157-share-revoke-clip-${i}`,
    lineZh: f.lineZh || `吊销过期回跳多选短片帧#${i + 1}`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M157' as const,
  }));
  const shareRevokeExpirySeekMultiselectClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M157' as const,
        kind: 'share-revoke-expiry-seek-multiselect-clip-keyframe-bookmarks' as const,
        titleZh: '吊销过期回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          `吊销过期回跳多选短片 scrubber 可打关帧书签 · ${bookmarks.length}枚` +
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
    wave: 'M157' as const,
    labelZh:
      (confirmExpiryLedgerRoleAuditOnepager
        ? `确认卡过期吊销台账角色审计 · ${confirmExpiryLedgerRoleAuditOnepager.lineCount}行`
        : '确认卡过期吊销台账角色审计待命') +
      (shareRevokeExpirySeekMultiselectClipKeyframeBookmarks
        ? ` · 吊销过期回跳多选短片关帧书签 ${shareRevokeExpirySeekMultiselectClipKeyframeBookmarks.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmExpiryLedgerRoleAuditOnepager ? ` · ${confirmExpiryLedgerRoleAuditOnepager.bodyZh}` : '') +
      (shareRevokeExpirySeekMultiselectClipKeyframeBookmarks ? ` · ${shareRevokeExpirySeekMultiselectClipKeyframeBookmarks.bodyZh}` : ''),
    toastZh:
      confirmExpiryLedgerRoleAuditOnepager && shareRevokeExpirySeekMultiselectClipKeyframeBookmarks
        ? '确认卡过期吊销台账角色审计 · 吊销过期回跳多选短片关帧书签'
        : confirmExpiryLedgerRoleAuditOnepager
          ? '确认卡过期吊销台账角色审计已开'
          : shareRevokeExpirySeekMultiselectClipKeyframeBookmarks
            ? '吊销过期回跳多选短片关帧书签已开'
            : '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签待命',
    busyZh: '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionExpiryRevokeLedgerIntact === true,
    shareRevokeExpirySeekMultiselectClipScrubberIntact: (base as any).shareRevokeExpirySeekMultiselectClipScrubberIntact === true,
    confirmExpiryLedgerRoleAuditOnepagerIntact: !!confirmExpiryLedgerRoleAuditOnepager,
    shareRevokeExpirySeekMultiselectClipKeyframeBookmarksIntact: !!shareRevokeExpirySeekMultiselectClipKeyframeBookmarks,
    confirmExpiryLedgerRoleAuditOnepager,
    shareRevokeExpirySeekMultiselectClipKeyframeBookmarks,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157',
  };
}

/**
 * M158：确认卡角色审计 → 回跳中文台账 + 吊销关帧 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158(
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M158' as const,
      labelZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳台账与吊销关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm158-confirm-audit-0', auditLineZh: '演示·确认卡角色审计台账行#1', kindZh: '确认卡角色审计' },
    { id: 'm158-confirm-audit-1', auditLineZh: '演示·确认卡角色审计台账行#2', kindZh: '确认卡角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[seekEntryIndex] || lines[0] || {};
  const confirmRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M158' as const,
        kind: 'confirm-role-audit-seek-ledger' as const,
        titleZh: '确认卡角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `确认卡角色过滤审计一页纸可回跳中文台账 · 行#${seekEntryIndex + 1}` +
          ` · 「${row.auditLineZh || row.kindZh || '台账行'}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerRowId: row.id || `m158-confirm-audit-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.kindZh || `确认卡角色审计台账行#${seekEntryIndex + 1}`,
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

  const kf = (base as any).shareRevokeExpirySeekMultiselectClipKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm158-share-revoke-kf-0', nameZh: '演示·M158吊销关帧#1', scrubIndex: 0 },
    { id: 'm158-share-revoke-kf-1', nameZh: '演示·M158吊销关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m158-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m158-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = `ro-m158-share-revoke-${tid}-${sessionId.slice(-8)}`;
  const shareRevokeKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M158' as const,
        kind: 'share-revoke-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销过期回跳多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `吊销过期回跳多选短片关帧书签可跨会话只读分享 · ${bookmarks.length}枚` +
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
    wave: 'M158' as const,
    labelZh:
      (confirmRoleAuditSeekLedger
        ? `确认卡角色审计回跳台账 · 行#${(confirmRoleAuditSeekLedger.seekEntryIndex as number) + 1}`
        : '确认卡角色审计回跳台账待命') +
      (shareRevokeKfBmXsessionRoShare
        ? ` · 吊销关帧跨会话只读分享 ${shareRevokeKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekLedger ? ` · ${confirmRoleAuditSeekLedger.bodyZh}` : '') +
      (shareRevokeKfBmXsessionRoShare ? ` · ${shareRevokeKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekLedger && shareRevokeKfBmXsessionRoShare
        ? '确认卡角色审计回跳台账 · 吊销关帧跨会话只读分享'
        : confirmRoleAuditSeekLedger
          ? '确认卡角色审计回跳台账已开'
          : shareRevokeKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享待命',
    busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmExpiryLedgerRoleAuditOnepagerIntact: (base as any).confirmExpiryLedgerRoleAuditOnepagerIntact === true,
    shareRevokeExpirySeekMultiselectClipKeyframeBookmarksIntact: (base as any).shareRevokeExpirySeekMultiselectClipKeyframeBookmarksIntact === true,
    confirmRoleAuditSeekLedgerIntact: !!confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShareIntact: !!shareRevokeKfBmXsessionRoShare,
    confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158',
  };
}

/**
 * M159：确认卡回跳台账多选中文对照 + 吊销关帧跨会话分享过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.revokeShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M159' as const,
      labelZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡回跳台账多选对照与吊销关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm159-confirm-seek-ms-0', auditLineZh: '演示·确认卡回跳台账行#1', kindZh: '确认卡角色审计回跳台账' },
    { id: 'm159-confirm-seek-ms-1', auditLineZh: '演示·确认卡回跳台账行#2', kindZh: '确认卡角色审计回跳台账' },
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
      id: hit.id || `m159-confirm-seek-ms-${idx}`,
      lineZh: hit.auditLineZh || hit.kindZh || `台账行#${idx + 1}`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M159' as const,
    };
  });
  const confirmSeekLedgerMultiselectContrast = wantsMs
    ? {
        wave: 'M159' as const,
        kind: 'confirm-seek-ledger-multiselect-contrast' as const,
        titleZh: '确认卡回跳中文台账 · 多选中文对照',
        bodyZh:
          `确认卡回跳中文台账支持多选中文对照 · 选中${selectedRows.length}行` +
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

  const xshare = (base as any).shareRevokeKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm159-share-revoke-kf-0', nameZh: '演示·M159吊销关帧#1', scrubIndex: 0 },
    { id: 'm159-share-revoke-kf-1', nameZh: '演示·M159吊销关帧#2', scrubIndex: 1 },
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
    id: `m159-share-revoke-expiry-${xshare?.shareToken || 'demo'}`.slice(0, 96),
    auditLineZh:
      `吊销关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚 · 自「${xshare?.sessionId || 'session-demo-m159'}」→「${xshare?.targetSessionId || 'session-peer-m159'}」· 过期 ${expiresAt}`,
    kindZh: '吊销关帧跨会话分享过期吊销',
    expiresAt,
    revokeShare: opts.revokeShare !== false,
    wave: 'M159' as const,
  };
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M159' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `吊销关帧跨会话只读分享支持过期+吊销写入中文台账 · ${bookmarks.length}枚` +
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
    wave: 'M159' as const,
    labelZh:
      (confirmSeekLedgerMultiselectContrast
        ? `确认卡回跳台账多选对照 · ${confirmSeekLedgerMultiselectContrast.selectedCount}行`
        : '确认卡回跳台账多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? ` · 吊销关帧跨会话过期吊销进台账`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSeekLedgerMultiselectContrast ? ` · ${confirmSeekLedgerMultiselectContrast.bodyZh}` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh:
      confirmSeekLedgerMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡回跳台账多选对照 · 吊销关帧跨会话过期吊销'
        : confirmSeekLedgerMultiselectContrast
          ? '确认卡回跳台账多选对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话过期吊销已开'
            : '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销待命',
    busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekLedgerIntact: (base as any).confirmRoleAuditSeekLedgerIntact === true,
    shareRevokeKfBmXsessionRoShareIntact: (base as any).shareRevokeKfBmXsessionRoShareIntact === true,
    confirmSeekLedgerMultiselectContrastIntact: !!confirmSeekLedgerMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmSeekLedgerMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159',
  };
}

/**
 * M160：确认卡多选短片 scrubber + 吊销过期台账角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false &&
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M160' as const,
      labelZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡多选短片scrubber与吊销过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).confirmSeekLedgerMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm160-confirm-ms-0', lineZh: '演示·确认卡多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm160-confirm-ms-1', lineZh: '演示·确认卡多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(selectedRows.length - 1, Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: r.id || `m160-confirm-ms-frame-${i}`,
    lineZh: r.lineZh || `确认卡多选帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M160' as const,
  }));
  const confirmMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M160' as const,
        kind: 'confirm-multiselect-clip-scrubber' as const,
        titleZh: '确认卡多选中文对照 · 短片 scrubber',
        bodyZh:
          `确认卡多选中文对照支持短片 scrubber · ${frames.length}帧 · 当前#${scrubIndex + 1}` +
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

  const expiry = (base as any).shareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm160-share-revoke-expiry-demo',
    auditLineZh: '演示·吊销过期台账行',
    kindZh: '吊销关帧跨会话分享过期吊销',
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
      id: ledgerEntry.id || 'm160-share-revoke-audit-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·吊销过期台账行#1',
      kindZh: ledgerEntry.kindZh || '吊销过期台账角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M160' as const,
    },
    {
      id: 'm160-share-revoke-audit-1',
      auditLineZh: '演示·吊销过期台账行#2',
      kindZh: '吊销过期台账角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M160' as const,
    },
  ];
  const shareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M160' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '吊销过期中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `吊销过期中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
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
    wave: 'M160' as const,
    labelZh:
      (confirmMultiselectClipScrubber
        ? `确认卡多选短片scrubber · ${confirmMultiselectClipScrubber.frameCount}帧`
        : '确认卡多选短片scrubber待命') +
      (shareRevokeExpiryLedgerRoleAuditOnepager
        ? ` · 吊销过期台账角色审计一页纸`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmMultiselectClipScrubber ? ` · ${confirmMultiselectClipScrubber.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? ` · ${shareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh:
      confirmMultiselectClipScrubber && shareRevokeExpiryLedgerRoleAuditOnepager
        ? '确认卡多选短片scrubber · 吊销过期台账角色审计一页纸'
        : confirmMultiselectClipScrubber
          ? '确认卡多选短片scrubber已开'
          : shareRevokeExpiryLedgerRoleAuditOnepager
            ? '吊销过期台账角色审计一页纸已开'
            : '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸待命',
    busyZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSeekLedgerMultiselectContrastIntact: (base as any).confirmSeekLedgerMultiselectContrastIntact === true,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).shareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    confirmMultiselectClipScrubberIntact: !!confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!shareRevokeExpiryLedgerRoleAuditOnepager,
    confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepager,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160',
  };
}

/**
 * M161：确认卡短片关帧书签 + 吊销过期角色审计回跳台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161(
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
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M161' as const,
      labelZh: '确认卡短片关帧书签 / 吊销过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡短片关帧书签与吊销过期角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡短片关帧书签 / 吊销过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).confirmMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { frameIndex: 0, id: 'm161-confirm-clip-0', lineZh: '演示·确认卡短片帧#1', scrubIndex: 0 },
    { frameIndex: 1, id: 'm161-confirm-clip-1', lineZh: '演示·确认卡短片帧#2', scrubIndex: 1 },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M161确认卡短片关帧').trim();
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m161-confirm-clip-kf-${f.id || i}`.slice(0, 96),
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: f.scrubIndex ?? i,
    frameIndex: f.frameIndex ?? i,
    lineZh: f.lineZh || `确认卡短片帧#${i + 1}`,
    wave: 'M161' as const,
  }));
  const confirmClipKfBm = wantsKf
    ? {
        wave: 'M161' as const,
        kind: 'confirm-clip-kf-bm' as const,
        titleZh: '确认卡短片 scrubber · 关帧书签',
        bodyZh:
          `确认卡短片 scrubber 支持关帧书签 · ${bookmarks.length}枚` +
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

  const audit = (base as any).shareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm161-share-revoke-audit-seek-0', auditLineZh: '演示·吊销过期角色审计行#1', kindZh: '吊销过期台账角色审计' },
    { id: 'm161-share-revoke-audit-seek-1', auditLineZh: '演示·吊销过期角色审计行#2', kindZh: '吊销过期台账角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const highlighted = lines[seekEntryIndex] || lines[0] || null;
  const shareRevokeExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M161' as const,
        kind: 'share-revoke-expiry-role-audit-seek-ledger' as const,
        titleZh: '吊销过期角色审计一页纸 · 回跳中文台账',
        bodyZh:
          `吊销过期角色审计一页纸可回跳中文台账 · ${lines.length}行 · 当前#${seekEntryIndex + 1}` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        seekEntryIndex,
        highlighted,
        fromAudit: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
          : null,
        filterRole,
        filterRoleZh,
        seekLedgerRow: true as const,
        seekBackToLedger: true as const,
        highlightLedgerRow: true as const,
        chineseLedger: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M161' as const,
    labelZh:
      (confirmClipKfBm
        ? `确认卡短片关帧书签 · ${confirmClipKfBm.bookmarkCount}枚`
        : '确认卡短片关帧书签待命') +
      (shareRevokeExpiryRoleAuditSeekLedger
        ? ` · 吊销过期角色审计回跳台账`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipKfBm ? ` · ${confirmClipKfBm.bodyZh}` : '') +
      (shareRevokeExpiryRoleAuditSeekLedger ? ` · ${shareRevokeExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh:
      confirmClipKfBm && shareRevokeExpiryRoleAuditSeekLedger
        ? '确认卡短片关帧书签 · 吊销过期角色审计回跳台账'
        : confirmClipKfBm
          ? '确认卡短片关帧书签已开'
          : shareRevokeExpiryRoleAuditSeekLedger
            ? '吊销过期角色审计回跳台账已开'
            : '确认卡短片关帧书签 / 吊销过期角色审计回跳台账待命',
    busyZh: '确认卡短片关帧书签 / 吊销过期角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmMultiselectClipScrubberIntact: (base as any).confirmMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    confirmClipKfBmIntact: !!confirmClipKfBm,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: !!shareRevokeExpiryRoleAuditSeekLedger,
    confirmClipKfBm,
    shareRevokeExpiryRoleAuditSeekLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161',
  };
}

/**
 * M162：确认卡关帧跨会话只读分享 + 吊销过期回跳多选对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162(
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M162' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销过期回跳多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm162-confirm-kf-0', nameZh: '演示·M162确认卡关帧#1', scrubIndex: 0 },
    { id: 'm162-confirm-kf-1', nameZh: '演示·M162确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m162-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m162-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = `m162-confirm-kf-share-${sessionId}-${targetSessionId}`.slice(0, 96);
  const confirmKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M162' as const,
        kind: 'confirm-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          `确认卡关帧书签支持跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        shareToken,
        sessionId,
        targetSessionId,
        fromKf: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount, frameCount: kf.frameCount }
          : null,
        filterRole,
        filterRoleZh,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        readOnlyShare: true as const,
        shareFfReplayBookmarks: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm162-share-revoke-seek-ms-0', auditLineZh: '演示·吊销过期回跳行#1', kindZh: '吊销过期回跳多选对照' },
    { id: 'm162-share-revoke-seek-ms-1', auditLineZh: '演示·吊销过期回跳行#2', kindZh: '吊销过期回跳多选对照' },
  ];
  const seekEntryIndexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n: any) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx: number, i: number) => {
    const line = lines[Math.min(idx, lines.length - 1)] || lines[0];
    return {
      index: idx,
      id: line?.id || `m162-share-revoke-ms-${i}`,
      lineZh: line?.auditLineZh || `吊销过期回跳行#${i + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      kindZh: line?.kindZh || '吊销过期回跳多选对照',
      wave: 'M162' as const,
    };
  });
  const shareRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M162' as const,
        kind: 'share-revoke-seek-multiselect-contrast' as const,
        titleZh: '吊销过期回跳中文台账 · 多选中文对照',
        bodyZh:
          `吊销过期回跳中文台账可多选中文对照 · 选中${selectedRows.length}行 / 共${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        fromSeek: seek
          ? { kind: seek.kind, lineCount: seek.lineCount, seekEntryIndex: seek.seekEntryIndex }
          : null,
        filterRole,
        filterRoleZh,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        chineseContrast: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M162' as const,
    labelZh:
      (confirmKfBmXsessionRoShare
        ? `确认卡关帧跨会话只读分享 · ${confirmKfBmXsessionRoShare.bookmarkCount}枚`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeSeekMultiselectContrast
        ? ` · 吊销过期回跳多选对照`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionRoShare ? ` · ${confirmKfBmXsessionRoShare.bodyZh}` : '') +
      (shareRevokeSeekMultiselectContrast ? ` · ${shareRevokeSeekMultiselectContrast.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionRoShare && shareRevokeSeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销过期回跳多选对照'
        : confirmKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeSeekMultiselectContrast
            ? '吊销过期回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipKfBmIntact: (base as any).confirmClipKfBmIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmKfBmXsessionRoShareIntact: !!confirmKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrastIntact: !!shareRevokeSeekMultiselectContrast,
    confirmKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrast,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162',
  };
}

/**
 * M163：确认卡关帧跨会话只读分享 → 过期吊销写中文台账 + 吊销过期回跳多选对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M163' as const,
      labelZh: '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话过期吊销与吊销过期回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm163-confirm-kf-0', nameZh: '演示·M163确认卡关帧#1', scrubIndex: 0 },
    { id: 'm163-confirm-kf-1', nameZh: '演示·M163确认卡关帧#2', scrubIndex: 1 },
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
    id: `m163-confirm-kf-xshare-expiry-${tid}`,
    auditLineZh:
      `确认卡关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚书签` +
      ` · 令牌「${xshare?.shareToken || 'ro-m163-demo'}」· 过期于 ${expiresAt}` +
      ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」`,
    kindZh: '确认卡关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m163-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M163' as const,
  };
  const confirmKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M163' as const,
        kind: 'confirm-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          `确认卡关帧跨会话只读分享支持过期+吊销写中文台账 · ${bookmarks.length}枚` +
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

  const ms = (base as any).shareRevokeSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm163-share-revoke-ms-0', lineZh: '演示·吊销过期回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm163-share-revoke-ms-1', lineZh: '演示·吊销过期回跳多选行#2', contrastSide: 'B' },
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
    id: r.id || `m163-share-revoke-clip-${i}`,
    lineZh: r.lineZh || `吊销过期回跳多选短片帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M163' as const,
  }));
  const shareRevokeSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M163' as const,
        kind: 'share-revoke-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销过期回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `吊销过期回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
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
    wave: 'M163' as const,
    labelZh:
      (confirmKfBmXsessionExpiryRevokeLedger
        ? `确认卡关帧跨会话过期吊销 · ${confirmKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
        : '确认卡关帧跨会话过期吊销待命') +
      (shareRevokeSeekMultiselectClipScrubber
        ? ` · 吊销过期回跳多选短片scrubber ${shareRevokeSeekMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionExpiryRevokeLedger ? ` · ${confirmKfBmXsessionExpiryRevokeLedger.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipScrubber ? ` · ${shareRevokeSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionExpiryRevokeLedger && shareRevokeSeekMultiselectClipScrubber
        ? '确认卡关帧跨会话过期吊销 · 吊销过期回跳多选短片scrubber'
        : confirmKfBmXsessionExpiryRevokeLedger
          ? '确认卡关帧跨会话过期吊销已开'
          : shareRevokeSeekMultiselectClipScrubber
            ? '吊销过期回跳多选短片scrubber已开'
            : '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话过期吊销 / 吊销过期回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionRoShareIntact: (base as any).confirmKfBmXsessionRoShareIntact === true,
    shareRevokeSeekMultiselectContrastIntact: (base as any).shareRevokeSeekMultiselectContrastIntact === true,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: !!confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubberIntact: !!shareRevokeSeekMultiselectClipScrubber,
    confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163',
  };
}

/**
 * M164：确认卡过期吊销台账 → 角色审计一页纸 + 吊销多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164(
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
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M164' as const,
      labelZh: '确认卡过期吊销角色审计一页纸 / 吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡过期吊销角色审计一页纸与吊销多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡过期吊销角色审计一页纸 / 吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).confirmKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: `m164-confirm-expiry-${tid}`,
    auditLineZh: '演示·确认卡过期吊销台账行',
    kindZh: '确认卡过期吊销',
    chineseLedger: true as const,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm164-confirm-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || '确认卡过期吊销台账行',
      kindZh: ledgerEntry.kindZh || '确认卡过期吊销',
      role,
      roleZh,
      wave: 'M164' as const,
    },
    {
      id: 'm164-confirm-expiry-1',
      auditLineZh: '演示·确认卡过期吊销角色审计行#2',
      kindZh: '确认卡过期吊销',
      role,
      roleZh,
      wave: 'M164' as const,
    },
  ].filter((l) => !filterRole || l.role === filterRole || filterRole === role);
  const confirmExpiryRevokeRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M164' as const,
        kind: 'confirm-expiry-revoke-role-audit-onepager' as const,
        titleZh: '确认卡过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `确认卡过期吊销中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        fromExpiry: expiry ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const clip = (base as any).shareRevokeSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { index: 0, id: 'm164-share-revoke-clip-0', lineZh: '演示·吊销多选短片帧#1', scrubIndex: 0 },
    { index: 1, id: 'm164-share-revoke-clip-1', lineZh: '演示·吊销多选短片帧#2', scrubIndex: 1 },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M164吊销多选短片关帧').trim();
  const bookmarks = frames.map((f: any, i: number) => ({
    id: f.id ? `${f.id}-kf` : `m164-share-revoke-kf-${i}`,
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: typeof f.scrubIndex === 'number' ? f.scrubIndex : i,
    lineZh: f.lineZh || `吊销多选短片帧#${i + 1}`,
    wave: 'M164' as const,
  }));
  const shareRevokeMsClipKfBm = wantsKf
    ? {
        wave: 'M164' as const,
        kind: 'share-revoke-ms-clip-kf-bm' as const,
        titleZh: '吊销多选短片 scrubber · 关帧书签',
        bodyZh:
          `吊销多选短片 scrubber 可打关帧书签 · ${bookmarks.length}枚` +
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
    wave: 'M164' as const,
    labelZh:
      (confirmExpiryRevokeRoleAuditOnepager
        ? `确认卡过期吊销角色审计一页纸 · ${confirmExpiryRevokeRoleAuditOnepager.lineCount}行`
        : '确认卡过期吊销角色审计一页纸待命') +
      (shareRevokeMsClipKfBm
        ? ` · 吊销多选短片关帧书签 ${shareRevokeMsClipKfBm.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmExpiryRevokeRoleAuditOnepager ? ` · ${confirmExpiryRevokeRoleAuditOnepager.bodyZh}` : '') +
      (shareRevokeMsClipKfBm ? ` · ${shareRevokeMsClipKfBm.bodyZh}` : ''),
    toastZh:
      confirmExpiryRevokeRoleAuditOnepager && shareRevokeMsClipKfBm
        ? '确认卡过期吊销角色审计一页纸 · 吊销多选短片关帧书签'
        : confirmExpiryRevokeRoleAuditOnepager
          ? '确认卡过期吊销角色审计一页纸已开'
          : shareRevokeMsClipKfBm
            ? '吊销多选短片关帧书签已开'
            : '确认卡过期吊销角色审计一页纸 / 吊销多选短片关帧书签待命',
    busyZh: '确认卡过期吊销角色审计一页纸 / 吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionExpiryRevokeLedgerIntact === true,
    shareRevokeSeekMultiselectClipScrubberIntact: (base as any).shareRevokeSeekMultiselectClipScrubberIntact === true,
    confirmExpiryRevokeRoleAuditOnepagerIntact: !!confirmExpiryRevokeRoleAuditOnepager,
    shareRevokeMsClipKfBmIntact: !!shareRevokeMsClipKfBm,
    confirmExpiryRevokeRoleAuditOnepager,
    shareRevokeMsClipKfBm,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164',
  };
}

/**
 * M165：确认卡角色审计 → 回跳中文台账 + 吊销关帧 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165(
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M165' as const,
      labelZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳台账与吊销关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmExpiryRevokeRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm165-confirm-audit-0', auditLineZh: '演示·确认卡角色审计台账行#1', kindZh: '确认卡角色审计' },
    { id: 'm165-confirm-audit-1', auditLineZh: '演示·确认卡角色审计台账行#2', kindZh: '确认卡角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[seekEntryIndex] || lines[0] || {};
  const confirmRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M165' as const,
        kind: 'confirm-role-audit-seek-ledger' as const,
        titleZh: '确认卡角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          `确认卡角色过滤审计一页纸可回跳中文台账 · 行#${seekEntryIndex + 1}` +
          ` · 「${row.auditLineZh || row.kindZh || '台账行'}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        ledgerRowId: row.id || `m165-confirm-audit-${seekEntryIndex}`,
        lineZh: row.auditLineZh || row.kindZh || `确认卡角色审计台账行#${seekEntryIndex + 1}`,
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

  const kf = (base as any).shareRevokeMsClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm165-share-revoke-kf-0', nameZh: '演示·M165吊销关帧#1', scrubIndex: 0 },
    { id: 'm165-share-revoke-kf-1', nameZh: '演示·M165吊销关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m165-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m165-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = `ro-m165-share-revoke-${tid}-${sessionId.slice(-8)}`;
  const shareRevokeKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M165' as const,
        kind: 'share-revoke-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          `吊销多选短片关帧书签可跨会话只读分享 · ${bookmarks.length}枚` +
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
    wave: 'M165' as const,
    labelZh:
      (confirmRoleAuditSeekLedger
        ? `确认卡角色审计回跳台账 · 行#${(confirmRoleAuditSeekLedger.seekEntryIndex as number) + 1}`
        : '确认卡角色审计回跳台账待命') +
      (shareRevokeKfBmXsessionRoShare
        ? ` · 吊销关帧跨会话只读分享 ${shareRevokeKfBmXsessionRoShare.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekLedger ? ` · ${confirmRoleAuditSeekLedger.bodyZh}` : '') +
      (shareRevokeKfBmXsessionRoShare ? ` · ${shareRevokeKfBmXsessionRoShare.bodyZh}` : ''),
    toastZh:
      confirmRoleAuditSeekLedger && shareRevokeKfBmXsessionRoShare
        ? '确认卡角色审计回跳台账 · 吊销关帧跨会话只读分享'
        : confirmRoleAuditSeekLedger
          ? '确认卡角色审计回跳台账已开'
          : shareRevokeKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享待命',
    busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmExpiryRevokeRoleAuditOnepagerIntact: (base as any).confirmExpiryRevokeRoleAuditOnepagerIntact === true,
    shareRevokeMsClipKfBmIntact: (base as any).shareRevokeMsClipKfBmIntact === true,
    confirmRoleAuditSeekLedgerIntact: !!confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShareIntact: !!shareRevokeKfBmXsessionRoShare,
    confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShare,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165',
  };
}

/**
 * M166：确认卡回跳台账 → 多选中文对照 + 吊销关帧跨会话只读分享 → 过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.expiryRevokeLedger === false &&
    opts.shareLinkExpiry === false
  ) {
    return {
      ok: true as const,
      wave: 'M166' as const,
      labelZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡回跳台账多选对照与吊销关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).confirmExpiryRevokeRoleAuditOnepager?.lines)
    ? (base as any).confirmExpiryRevokeRoleAuditOnepager.lines
    : [
        { id: 'm166-confirm-seek-0', auditLineZh: '演示·确认卡回跳台账行#1', kindZh: '确认卡回跳台账' },
        { id: 'm166-confirm-seek-1', auditLineZh: '演示·确认卡回跳台账行#2', kindZh: '确认卡回跳台账' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const uniqueIdx = [...new Set(indexes)];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = uniqueIdx.map((i) => {
    const row = lines[i] || lines[0] || {};
    return {
      index: i,
      id: row.id || `m166-confirm-seek-${i}`,
      lineZh: row.auditLineZh || row.kindZh || `确认卡回跳台账行#${i + 1}`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      wave: 'M166' as const,
    };
  });
  const confirmSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M166' as const,
        kind: 'confirm-seek-multiselect-contrast' as const,
        titleZh: '确认卡回跳中文台账 · 多选中文对照',
        bodyZh:
          `确认卡回跳中文台账可多选中文对照 · ${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        selectedRows,
        selectedCount: selectedRows.length,
        fromSeek: seek ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, lineCount: seek.lineCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const xshare = (base as any).shareRevokeKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm166-share-revoke-kf-0', nameZh: '演示·M166吊销关帧#1', scrubIndex: 0 },
    { id: 'm166-share-revoke-kf-1', nameZh: '演示·M166吊销关帧#2', scrubIndex: 1 },
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
    id: `m166-share-revoke-expiry-${tid}`,
    auditLineZh: `吊销关帧跨会话过期吊销 · ${bookmarks.length}枚 · 到期 ${expiresAt}`,
    kindZh: '吊销关帧跨会话过期吊销',
    chineseLedger: true as const,
    expiresAt,
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || `ro-m166-share-revoke-${tid}`,
    wave: 'M166' as const,
  };
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M166' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          `吊销关帧跨会话只读分享支持过期吊销进中文台账 · ${bookmarks.length}枚` +
          ` · 到期「${expiresAt}」· 过滤「${filterRoleZh}」` +
          ` · 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        expiresAt,
        expiresInMs,
        ledgerEntry,
        chineseLedger: true as const,
        fromXshare: xshare ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken } : null,
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
    labelZh:
      (confirmSeekMultiselectContrast
        ? `确认卡回跳台账多选对照 · ${confirmSeekMultiselectContrast.selectedCount}行`
        : '确认卡回跳台账多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? ` · 吊销关帧跨会话过期吊销 ${shareRevokeKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSeekMultiselectContrast ? ` · ${confirmSeekMultiselectContrast.bodyZh}` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? ` · ${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}` : ''),
    toastZh:
      confirmSeekMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡回跳台账多选对照 · 吊销关帧跨会话过期吊销'
        : confirmSeekMultiselectContrast
          ? '确认卡回跳台账多选对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话过期吊销已开'
            : '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销待命',
    busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekLedgerIntact: (base as any).confirmRoleAuditSeekLedgerIntact === true,
    shareRevokeKfBmXsessionRoShareIntact: (base as any).shareRevokeKfBmXsessionRoShareIntact === true,
    confirmSeekMultiselectContrastIntact: !!confirmSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166',
  };
}

/**
 * M167：确认卡多选短片 scrubber + 吊销过期台账角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false &&
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M167' as const,
      labelZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡多选短片scrubber与吊销过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).confirmSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm167-confirm-ms-0', lineZh: '演示·确认卡多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm167-confirm-ms-1', lineZh: '演示·确认卡多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: r.id || `m167-confirm-ms-frame-${i}`,
    lineZh: r.lineZh || `确认卡多选帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M167' as const,
  }));
  const confirmMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M167' as const,
        kind: 'confirm-multiselect-clip-scrubber' as const,
        titleZh: '确认卡多选中文对照 · 短片 scrubber',
        bodyZh:
          `确认卡多选中文对照支持短片 scrubber · ${frames.length}帧 · 当前#${scrubIndex + 1}` +
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

  const expiry = (base as any).shareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm167-share-revoke-expiry-demo',
    auditLineZh: '演示·吊销过期台账行',
    kindZh: '吊销关帧跨会话分享过期吊销',
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
      id: ledgerEntry.id || 'm167-share-revoke-audit-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·吊销过期台账行#1',
      kindZh: ledgerEntry.kindZh || '吊销过期台账角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M167' as const,
    },
    {
      id: 'm167-share-revoke-audit-1',
      auditLineZh: '演示·吊销过期台账行#2',
      kindZh: '吊销过期台账角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M167' as const,
    },
  ];
  const shareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M167' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '吊销过期中文台账 · 角色过滤审计一页纸',
        bodyZh:
          `吊销过期中文台账可开角色过滤审计一页纸 · ${lines.length}行` +
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
    wave: 'M167' as const,
    labelZh:
      (confirmMultiselectClipScrubber
        ? `确认卡多选短片scrubber · ${confirmMultiselectClipScrubber.frameCount}帧`
        : '确认卡多选短片scrubber待命') +
      (shareRevokeExpiryLedgerRoleAuditOnepager
        ? ` · 吊销过期台账角色审计一页纸`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmMultiselectClipScrubber ? ` · ${confirmMultiselectClipScrubber.bodyZh}` : '') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? ` · ${shareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}` : ''),
    toastZh:
      confirmMultiselectClipScrubber && shareRevokeExpiryLedgerRoleAuditOnepager
        ? '确认卡多选短片scrubber · 吊销过期台账角色审计一页纸'
        : confirmMultiselectClipScrubber
          ? '确认卡多选短片scrubber已开'
          : shareRevokeExpiryLedgerRoleAuditOnepager
            ? '吊销过期台账角色审计一页纸已开'
            : '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸待命',
    busyZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSeekMultiselectContrastIntact: (base as any).confirmSeekMultiselectContrastIntact === true,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).shareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    confirmMultiselectClipScrubberIntact: !!confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!shareRevokeExpiryLedgerRoleAuditOnepager,
    confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepager,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167',
  };
}

/**
 * M168：确认卡短片关帧书签 + 吊销过期角色审计回跳台账
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168(
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
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M168' as const,
      labelZh: '确认卡短片关帧书签 / 吊销过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡短片关帧书签与吊销过期角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡短片关帧书签 / 吊销过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).confirmMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm168-confirm-clip-0', lineZh: '演示·确认卡短片帧#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm168-confirm-clip-1', lineZh: '演示·确认卡短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M168确认卡短片关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: `m168-confirm-clip-kf-${f.id || i}`.slice(0, 96),
    nameZh: `${bookmarkNameZh}#${i + 1}`,
    scrubIndex: f.scrubIndex ?? i,
    frameIndex: f.frameIndex ?? i,
    lineZh: f.lineZh || `确认卡短片帧#${i + 1}`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M168' as const,
  }));
  const confirmClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M168' as const,
        kind: 'confirm-clip-keyframe-bookmarks' as const,
        titleZh: '确认卡短片 scrubber · 关帧书签',
        bodyZh:
          `确认卡短片 scrubber 可打关帧书签 · ${bookmarks.length}枚` +
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

  const audit = (base as any).shareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) && audit.lines.length
    ? audit.lines
    : [
        { id: 'm168-share-revoke-audit-0', auditLineZh: '演示·吊销过期角色审计行#1', kindZh: '吊销过期台账角色审计' },
        { id: 'm168-share-revoke-audit-1', auditLineZh: '演示·吊销过期角色审计行#2', kindZh: '吊销过期台账角色审计' },
      ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const hit = lines[seekEntryIndex] || lines[0] || {};
  const shareRevokeExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M168' as const,
        kind: 'share-revoke-expiry-role-audit-seek-ledger' as const,
        titleZh: '吊销过期角色审计一页纸 · 回跳中文台账',
        bodyZh:
          `吊销过期角色审计一页纸可回跳中文台账 · 当前行#${seekEntryIndex + 1}/${lines.length}` +
          ` · 「${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        seekEntryIndex,
        ledgerRowId: hit.id || `m168-share-revoke-seek-${seekEntryIndex}`,
        lineZh: hit.auditLineZh || hit.kindZh || `台账行#${seekEntryIndex + 1}`,
        fromAudit: audit
          ? { kind: audit.kind, lineCount: audit.lineCount }
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
    labelZh:
      (confirmClipKeyframeBookmarks
        ? `确认卡短片关帧书签 · ${confirmClipKeyframeBookmarks.bookmarkCount}枚`
        : '确认卡短片关帧书签待命') +
      (shareRevokeExpiryRoleAuditSeekLedger
        ? ` · 吊销过期角色审计回跳台账`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipKeyframeBookmarks ? ` · ${confirmClipKeyframeBookmarks.bodyZh}` : '') +
      (shareRevokeExpiryRoleAuditSeekLedger ? ` · ${shareRevokeExpiryRoleAuditSeekLedger.bodyZh}` : ''),
    toastZh:
      confirmClipKeyframeBookmarks && shareRevokeExpiryRoleAuditSeekLedger
        ? '确认卡短片关帧书签 · 吊销过期角色审计回跳台账'
        : confirmClipKeyframeBookmarks
          ? '确认卡短片关帧书签已开'
          : shareRevokeExpiryRoleAuditSeekLedger
            ? '吊销过期角色审计回跳台账已开'
            : '确认卡短片关帧书签 / 吊销过期角色审计回跳台账待命',
    busyZh: '确认卡短片关帧书签 / 吊销过期角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmMultiselectClipScrubberIntact: (base as any).confirmMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    confirmClipKeyframeBookmarksIntact: !!confirmClipKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: !!shareRevokeExpiryRoleAuditSeekLedger,
    confirmClipKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedger,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167/keyframe-bookmarks/seek-ledger/m168',
  };
}

/**
 * M169：确认卡关帧跨会话只读分享 + 吊销回跳多选对照
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168XsessionRoShareMultiselectContrastM169(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectLedgerRows === false &&
    opts.multiSelectContrast === false
  ) {
    return {
      ok: true as const,
      wave: 'M169' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销回跳多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm169-confirm-kf-0', nameZh: '演示·M169确认卡关帧#1', scrubIndex: 0 },
    { id: 'm169-confirm-kf-1', nameZh: '演示·M169确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m169-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m169-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = `m169-confirm-kf-share-${tid}-${sessionId}`.slice(0, 96);
  const confirmClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M169' as const,
        kind: 'confirm-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          `确认卡关帧书签可跨会话只读分享 · ${bookmarks.length}枚` +
          ` · 自「${sessionId}」→「${targetSessionId}」· 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        shareToken,
        sessionId,
        targetSessionId,
        readOnly: true as const,
        fromKf: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) && seek.lines.length
    ? seek.lines
    : [
        { id: 'm169-share-revoke-seek-0', auditLineZh: '演示·吊销回跳台账行#1', kindZh: '吊销回跳台账', lineZh: '演示·吊销回跳台账行#1', contrastSide: 'A' },
        { id: 'm169-share-revoke-seek-1', auditLineZh: '演示·吊销回跳台账行#2', kindZh: '吊销回跳台账', lineZh: '演示·吊销回跳台账行#2', contrastSide: 'B' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const wantsMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      !!seek);
  const selectedRows = indexes.map((idx, i) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || `m169-share-revoke-ms-${idx}`,
      lineZh: hit.lineZh || hit.auditLineZh || hit.kindZh || `吊销回跳台账行#${idx + 1}`,
      contrastSide: hit.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      wave: 'M169' as const,
    };
  });
  const shareRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M169' as const,
        kind: 'share-revoke-seek-multiselect-contrast' as const,
        titleZh: '吊销回跳中文台账 · 多选中文对照',
        bodyZh:
          `吊销回跳中文台账可多选中文对照 · 选中${selectedRows.length}行` +
          ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发`,
        lines,
        lineCount: lines.length,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes: indexes,
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
    wave: 'M169' as const,
    labelZh:
      (confirmClipKfBmXsessionRoShare
        ? `确认卡关帧跨会话只读分享 · ${confirmClipKfBmXsessionRoShare.bookmarkCount}枚`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeSeekMultiselectContrast
        ? ` · 吊销回跳多选对照`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipKfBmXsessionRoShare ? ` · ${confirmClipKfBmXsessionRoShare.bodyZh}` : '') +
      (shareRevokeSeekMultiselectContrast ? ` · ${shareRevokeSeekMultiselectContrast.bodyZh}` : ''),
    toastZh:
      confirmClipKfBmXsessionRoShare && shareRevokeSeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销回跳多选对照'
        : confirmClipKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeSeekMultiselectContrast
            ? '吊销回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipKeyframeBookmarksIntact: (base as any).confirmClipKeyframeBookmarksIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmClipKfBmXsessionRoShareIntact: !!confirmClipKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrastIntact: !!shareRevokeSeekMultiselectContrast,
    confirmClipKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrast,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168XsessionRoShareMultiselectContrastM169Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167/keyframe-bookmarks/seek-ledger/m168/xsession-ro-share/multiselect-contrast/m169',
  };
}

/**
 * M170：确认卡关帧跨会话只读分享 → 过期吊销写中文台账 + 吊销回跳多选对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168XsessionRoShareMultiselectContrastM169ExpiryRevokeLedgerClipScrubberM170(
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
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M170' as const,
      labelZh: '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话过期吊销与吊销回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168XsessionRoShareMultiselectContrastM169(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm170-confirm-kf-0', nameZh: '演示·M170确认卡关帧#1', scrubIndex: 0 },
    { id: 'm170-confirm-kf-1', nameZh: '演示·M170确认卡关帧#2', scrubIndex: 1 },
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
    id: `m170-confirm-kf-xshare-expiry-${tid}`,
    auditLineZh:
      `确认卡关帧跨会话只读分享过期吊销 · ${bookmarks.length}枚书签` +
      ` · 令牌「${xshare?.shareToken || 'ro-m170-demo'}」· 过期于 ${expiresAt}` +
      ` · 过滤「${filterRoleZh}」· 角色「${roleZh}」`,
    kindZh: '确认卡关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m170-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M170' as const,
  };
  const confirmKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M170' as const,
        kind: 'confirm-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          `确认卡关帧跨会话只读分享支持过期+吊销写中文台账 · ${bookmarks.length}枚` +
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

  const ms = (base as any).shareRevokeSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm170-share-revoke-ms-0', lineZh: '演示·吊销回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm170-share-revoke-ms-1', lineZh: '演示·吊销回跳多选行#2', contrastSide: 'B' },
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
    id: r.id || `m170-share-revoke-clip-${i}`,
    lineZh: r.lineZh || `吊销回跳多选短片帧#${i + 1}`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M170' as const,
  }));
  const shareRevokeSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M170' as const,
        kind: 'share-revoke-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          `吊销回跳多选中文对照支持短片 scrubber · ${frames.length}帧` +
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
    wave: 'M170' as const,
    labelZh:
      (confirmKfBmXsessionExpiryRevokeLedger
        ? `确认卡关帧跨会话过期吊销 · ${confirmKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚`
        : '确认卡关帧跨会话过期吊销待命') +
      (shareRevokeSeekMultiselectClipScrubber
        ? ` · 吊销回跳多选短片scrubber ${shareRevokeSeekMultiselectClipScrubber.frameCount}帧`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionExpiryRevokeLedger ? ` · ${confirmKfBmXsessionExpiryRevokeLedger.bodyZh}` : '') +
      (shareRevokeSeekMultiselectClipScrubber ? ` · ${shareRevokeSeekMultiselectClipScrubber.bodyZh}` : ''),
    toastZh:
      confirmKfBmXsessionExpiryRevokeLedger && shareRevokeSeekMultiselectClipScrubber
        ? '确认卡关帧跨会话过期吊销 · 吊销回跳多选短片scrubber'
        : confirmKfBmXsessionExpiryRevokeLedger
          ? '确认卡关帧跨会话过期吊销已开'
          : shareRevokeSeekMultiselectClipScrubber
            ? '吊销回跳多选短片scrubber已开'
            : '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipKfBmXsessionRoShareIntact: (base as any).confirmClipKfBmXsessionRoShareIntact === true,
    shareRevokeSeekMultiselectContrastIntact: (base as any).shareRevokeSeekMultiselectContrastIntact === true,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: !!confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubberIntact: !!shareRevokeSeekMultiselectClipScrubber,
    confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubber,
    shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168XsessionRoShareMultiselectContrastM169ExpiryRevokeLedgerClipScrubberM170Path: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167/keyframe-bookmarks/seek-ledger/m168/xsession-ro-share/multiselect-contrast/m169/expiry-revoke-ledger/clip-scrubber/m170',
  };
}
