/**
 * M84：写库 TopN 快照跨进程基帧（checksum×phase）对照。
 * 进程重启后对照当前检查点快照与落盘基帧；无新配额子系统。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { hashWriteSnapshotRows, type WriteSnapRow } from './write-snapshot-codec';

export type WriteSnapshotBaseFrame = {
  tenantId: string;
  demandId: string | null;
  checksum: string;
  phase: 'write';
  count: number;
  at: string;
  runId?: string | null;
  tipZh: string;
  wave: 'M84';
  labelZh: string;
};

function safeTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function framePath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'write-snapshot-base-frame.json');
}

export function readWriteSnapshotBaseFrame(tenantId?: string | null): WriteSnapshotBaseFrame | null {
  const p = framePath(tenantId || 'default');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || !raw.checksum) return null;
    return {
      tenantId: safeTenant(tenantId),
      demandId: raw.demandId || null,
      checksum: String(raw.checksum),
      phase: 'write',
      count: Number(raw.count) || 0,
      at: raw.at || null,
      runId: raw.runId || null,
      tipZh: raw.tipZh || '写库快照基帧',
      wave: 'M84',
      labelZh: '写库快照跨进程基帧',
    };
  } catch {
    return null;
  }
}

export function persistWriteSnapshotBaseFrame(
  tenantId: string | null | undefined,
  opts: {
    demandId?: string | null;
    rows?: WriteSnapRow[] | null;
    checksum?: string | null;
    count?: number | null;
    runId?: string | null;
  },
): WriteSnapshotBaseFrame {
  const tid = safeTenant(tenantId);
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const checksum = opts.checksum || hashWriteSnapshotRows(rows);
  const count = opts.count != null ? Number(opts.count) : rows.length;
  const at = new Date().toISOString();
  const frame: WriteSnapshotBaseFrame = {
    tenantId: tid,
    demandId: opts.demandId || null,
    checksum,
    phase: 'write',
    count,
    at,
    runId: opts.runId || null,
    tipZh: `基帧已落盘 · checksum ${checksum.slice(0, 8)}… · ×${count} · phase=write` +
      (opts.demandId ? ` · demand ${opts.demandId}` : ''),
    wave: 'M84',
    labelZh: '写库快照跨进程基帧',
  };
  writeFileSync(framePath(tid), JSON.stringify(frame, null, 0), 'utf8');
  return frame;
}

export function compareWriteSnapshotAgainstBaseFrame(
  tenantId: string | null | undefined,
  opts: {
    rows?: WriteSnapRow[] | null;
    checksum?: string | null;
    phase?: string | null;
    count?: number | null;
    demandId?: string | null;
  } = {},
): {
  ok: boolean;
  matched: boolean;
  hasBaseFrame: boolean;
  reasonZh: string;
  tipZh: string;
  toastZh: string;
  busyZh: string;
  baseFrame: WriteSnapshotBaseFrame | null;
  liveChecksum: string | null;
  liveCount: number;
  wave: 'M84';
  labelZh: string;
  dryRun: true;
  noEgress: true;
} {
  const base = readWriteSnapshotBaseFrame(tenantId);
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const liveChecksum = opts.checksum || (rows.length ? hashWriteSnapshotRows(rows) : null);
  const liveCount = opts.count != null ? Number(opts.count) : rows.length;
  const phase = opts.phase || 'write';
  if (!base) {
    return {
      ok: true,
      matched: false,
      hasBaseFrame: false,
      reasonZh: '尚无跨进程基帧；本次写库快照可作新基帧落盘',
      tipZh: '跨进程基帧对照：无基帧可对拍（进程首轮或已清理）',
      toastZh: '无基帧',
      busyZh: '对照写库快照基帧…',
      baseFrame: null,
      liveChecksum,
      liveCount,
      wave: 'M84',
      labelZh: '写库快照×基帧对照',
      dryRun: true,
      noEgress: true,
    };
  }
  if (phase !== 'write' && phase !== base.phase) {
    return {
      ok: false,
      matched: false,
      hasBaseFrame: true,
      reasonZh: `phase 对照失败：live=${phase} / base=${base.phase}`,
      tipZh: `基帧对拍失败：phase 不一致（${phase}≠${base.phase}）`,
      toastZh: '基帧 phase 不一致',
      busyZh: '对照写库快照基帧…',
      baseFrame: base,
      liveChecksum,
      liveCount,
      wave: 'M84',
      labelZh: '写库快照×基帧对照',
      dryRun: true,
      noEgress: true,
    };
  }
  if (!liveChecksum) {
    return {
      ok: false,
      matched: false,
      hasBaseFrame: true,
      reasonZh: '当前写库快照无 checksum，无法与基帧对拍',
      tipZh: '基帧对拍失败：缺少 live checksum',
      toastZh: '缺 checksum',
      busyZh: '对照写库快照基帧…',
      baseFrame: base,
      liveChecksum: null,
      liveCount,
      wave: 'M84',
      labelZh: '写库快照×基帧对照',
      dryRun: true,
      noEgress: true,
    };
  }
  const matched = liveChecksum === base.checksum && (liveCount === 0 || liveCount === base.count || !base.count);
  return {
    ok: matched,
    matched,
    hasBaseFrame: true,
    reasonZh: matched
      ? `跨进程基帧对照通过 · ${liveChecksum.slice(0, 8)}… · ×${liveCount} · phase=write`
      : `跨进程基帧对照不一致：基帧 ${base.checksum.slice(0, 8)}…×${base.count} / 当前 ${liveChecksum.slice(0, 8)}…×${liveCount}`,
    tipZh: matched
      ? `写库快照与跨进程基帧一致（${liveChecksum.slice(0, 8)}…）`
      : `写库快照与基帧不一致；续跑将按检查点元信息再校验或回退重打分`,
    toastZh: matched ? '基帧对照通过' : '基帧对照不一致',
    busyZh: '对照写库快照基帧…',
    baseFrame: base,
    liveChecksum,
    liveCount,
    wave: 'M84',
    labelZh: '写库快照×基帧对照',
    dryRun: true,
    noEgress: true,
  };
}

/** M85：基帧 vs 当前快照差分可视化 */
export type WriteSnapshotBaseFrameDiffViz = {
  ok: boolean;
  matched: boolean;
  hasBaseFrame: boolean;
  checksumDiff: {
    basePrefix: string | null;
    livePrefix: string | null;
    divergeAt: number | null;
    equalChars: number;
    totalChars: number;
    barZh: string;
    segments: Array<{ kind: 'same' | 'diff' | 'missing'; text: string }>;
  };
  countDiff: { base: number; live: number; delta: number; tipZh: string };
  phaseDiff: { base: string | null; live: string; same: boolean };
  demandIdDiff: { base: string | null; live: string | null; same: boolean };
  summaryZh: string;
  tipZh: string;
  toastZh: string;
  busyZh: string;
  labelZh: string;
  wave: 'M85';
  dryRun: true;
  noEgress: true;
};

function checksumSegments(base: string | null, live: string | null) {
  const a = base || '';
  const b = live || '';
  const n = Math.max(a.length, b.length, 1);
  let divergeAt: number | null = null;
  let equal = 0;
  const segments: Array<{ kind: 'same' | 'diff' | 'missing'; text: string }> = [];
  let buf = '';
  let kind: 'same' | 'diff' | 'missing' | null = null;
  const flush = () => {
    if (kind && buf) segments.push({ kind, text: buf });
    buf = '';
    kind = null;
  };
  for (let i = 0; i < n; i++) {
    const ca = a[i];
    const cb = b[i];
    let k: 'same' | 'diff' | 'missing';
    if (ca == null || cb == null) k = 'missing';
    else if (ca === cb) {
      k = 'same';
      equal += 1;
    } else {
      k = 'diff';
      if (divergeAt == null) divergeAt = i;
    }
    if (kind != null && kind !== k) flush();
    kind = k;
    buf += (cb ?? ca ?? '?');
  }
  flush();
  const shown = Math.min(32, n);
  const samePct = Math.round((equal / n) * 100);
  const filled = Math.round((samePct / 100) * 12);
  const barZh = '█'.repeat(filled) + '░'.repeat(12 - filled) + ` ${samePct}%`;
  return {
    basePrefix: a ? a.slice(0, 12) : null,
    livePrefix: b ? b.slice(0, 12) : null,
    divergeAt,
    equalChars: equal,
    totalChars: n,
    barZh,
    segments: segments.map((s) => ({ ...s, text: s.text.slice(0, shown) })).slice(0, 8),
  };
}

export function visualizeWriteSnapshotBaseFrameDiff(
  tenantId?: string | null,
  opts: {
    rows?: WriteSnapRow[] | null;
    checksum?: string | null;
    phase?: string | null;
    count?: number | null;
    demandId?: string | null;
  } = {},
): WriteSnapshotBaseFrameDiffViz {
  const cmp = compareWriteSnapshotAgainstBaseFrame(tenantId, opts);
  const base = cmp.baseFrame;
  const liveChecksum = cmp.liveChecksum;
  const liveCount = cmp.liveCount;
  const livePhase = opts.phase || 'write';
  const liveDemand = opts.demandId || null;
  const checksumDiff = checksumSegments(base?.checksum || null, liveChecksum);
  const countDelta = liveCount - (base?.count || 0);
  const phaseSame = !base || base.phase === livePhase;
  const demandSame = !base || (base.demandId || null) === (liveDemand || base.demandId || null);
  const summaryZh = !cmp.hasBaseFrame
    ? '无基帧可可视化；可先落盘或匹配写库后再对照'
    : cmp.matched
      ? `基帧差分可视化：一致 · ${checksumDiff.barZh} · 行数 Δ${countDelta}`
      : `基帧差分可视化：不一致 · ${checksumDiff.barZh}` +
        (checksumDiff.divergeAt != null ? ` · 自第 ${checksumDiff.divergeAt} 字符分叉` : '') +
        ` · 行数 基${base?.count ?? 0}/现${liveCount}（Δ${countDelta}）`;
  return {
    ok: cmp.ok,
    matched: cmp.matched,
    hasBaseFrame: cmp.hasBaseFrame,
    checksumDiff,
    countDiff: {
      base: base?.count || 0,
      live: liveCount,
      delta: countDelta,
      tipZh: countDelta === 0 ? '行数一致' : `行数差 ${countDelta > 0 ? '+' : ''}${countDelta}`,
    },
    phaseDiff: { base: base?.phase || null, live: livePhase, same: phaseSame },
    demandIdDiff: { base: base?.demandId || null, live: liveDemand, same: demandSame },
    summaryZh,
    tipZh: summaryZh + ' · 干跑无外发',
    toastZh: cmp.matched ? '基帧差分·一致' : cmp.hasBaseFrame ? '基帧差分·不一致' : '无基帧',
    busyZh: '可视化基帧差分…',
    labelZh: '写库快照基帧差分可视化',
    wave: 'M85',
    dryRun: true,
    noEgress: true,
  };
}
