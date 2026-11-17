/**
 * M82：写库 TopN 快照压缩 / 增量差分，降低检查点落盘 IO。
 * 校验与软取消路径仍复用 checksum×phase 对拍。
 */

export type WriteSnapRow = {
  kind: string;
  id: string;
  orgId?: string | null;
  title?: string;
  orgName?: string;
  total: number;
  breakdown?: any;
  reason?: string;
};

export type WriteSnapMeta = {
  count: number;
  checksum: string;
  phase: 'write';
  at: string;
  tipZh?: string;
  compressed?: boolean;
  incremental?: boolean;
  format?: 'full' | 'compact-v1' | 'incremental-v1';
  bytesBefore?: number;
  bytesAfter?: number;
  baseChecksum?: string | null;
  added?: number;
  removed?: number;
  kept?: number;
  wave?: string;
};

export type IncrementalPack = {
  format: 'incremental-v1';
  baseChecksum: string;
  added: WriteSnapRow[];
  removedKeys: string[];
  kept: WriteSnapRow[];
  count: number;
};

function rowKey(r: { kind?: string; id?: string }) {
  return `${String(r.kind || '')}|${String(r.id || '')}`;
}

export function hashWriteSnapshotRows(rows: WriteSnapRow[] | null | undefined): string {
  const { createHash } = require('crypto');
  const list = Array.isArray(rows) ? rows : [];
  const canon = list
    .map((r) => `${String(r.kind || '')}|${String(r.id || '')}|${Number(r.total) || 0}|${String(r.orgId || '')}`)
    .sort()
    .join(';');
  return createHash('sha256').update(`v1|${list.length}|${canon}`).digest('hex').slice(0, 24);
}

/** 压缩：去掉重 breakdown，截断 title/reason（默认开） */
export function compactWriteSnapshotRows(rows: WriteSnapRow[]): {
  rows: WriteSnapRow[];
  bytesBefore: number;
  bytesAfter: number;
  compressed: boolean;
} {
  const compressOn = String(process.env.MATCH_WRITE_SNAP_COMPRESS ?? '1') !== '0';
  const before = Buffer.byteLength(JSON.stringify(rows), 'utf8');
  if (!compressOn) {
    return { rows, bytesBefore: before, bytesAfter: before, compressed: false };
  }
  const compact: WriteSnapRow[] = rows.map((r) => ({
    kind: String(r.kind || ''),
    id: String(r.id || ''),
    orgId: r.orgId ?? null,
    title: r.title != null ? String(r.title).slice(0, 80) : undefined,
    orgName: r.orgName != null ? String(r.orgName).slice(0, 40) : undefined,
    total: Number(r.total) || 0,
    reason: r.reason != null ? String(r.reason).slice(0, 120) : undefined,
  }));
  const after = Buffer.byteLength(JSON.stringify(compact), 'utf8');
  return {
    rows: compact,
    bytesBefore: before,
    bytesAfter: after,
    compressed: after < before,
  };
}

/** 相对上一帧做增量；节省不足 20% 则退回全量 compact */
export function maybeIncrementalWriteSnapshot(
  prevRows: WriteSnapRow[] | null | undefined,
  nextRows: WriteSnapRow[],
  prevChecksum?: string | null,
): { mode: 'full'; rows: WriteSnapRow[] } | { mode: 'incremental'; pack: IncrementalPack; rows: WriteSnapRow[] } {
  const incrOn = String(process.env.MATCH_WRITE_SNAP_INCREMENTAL ?? '1') !== '0';
  if (!incrOn || !Array.isArray(prevRows) || !prevRows.length) {
    return { mode: 'full', rows: nextRows };
  }
  const prevMap = new Map(prevRows.map((r) => [rowKey(r), r]));
  const nextMap = new Map(nextRows.map((r) => [rowKey(r), r]));
  const added: WriteSnapRow[] = [];
  const kept: WriteSnapRow[] = [];
  const removedKeys: string[] = [];
  for (const [k, r] of nextMap) {
    const p = prevMap.get(k);
    if (!p) added.push(r);
    else if (Number(p.total) !== Number(r.total) || String(p.orgId || '') !== String(r.orgId || ''))
      added.push(r);
    else kept.push(r);
  }
  for (const k of prevMap.keys()) {
    if (!nextMap.has(k)) removedKeys.push(k);
  }
  const pack: IncrementalPack = {
    format: 'incremental-v1',
    baseChecksum: prevChecksum || hashWriteSnapshotRows(prevRows),
    added,
    removedKeys,
    kept,
    count: nextRows.length,
  };
  const fullBytes = Buffer.byteLength(JSON.stringify(nextRows), 'utf8');
  const incrBytes = Buffer.byteLength(JSON.stringify(pack), 'utf8');
  if (incrBytes >= fullBytes * 0.8) {
    return { mode: 'full', rows: nextRows };
  }
  return { mode: 'incremental', pack, rows: nextRows };
}

/** 从增量包还原全量行（供校验/写库） */
export function expandIncrementalPack(
  pack: IncrementalPack,
  prevRows: WriteSnapRow[] | null | undefined,
): WriteSnapRow[] | null {
  if (!pack || pack.format !== 'incremental-v1') return null;
  const removed = new Set(pack.removedKeys || []);
  const byKey = new Map<string, WriteSnapRow>();
  for (const r of prevRows || []) {
    const k = rowKey(r);
    if (!removed.has(k)) byKey.set(k, r);
  }
  for (const r of pack.kept || []) byKey.set(rowKey(r), r);
  for (const r of pack.added || []) byKey.set(rowKey(r), r);
  const rows = [...byKey.values()];
  if (pack.count != null && rows.length !== Number(pack.count)) {
    // 仍返回，由上层 checksum 判定
  }
  return rows;
}

export function buildWriteSnapshotPersist(
  rowsIn: WriteSnapRow[],
  prev?: { rows?: WriteSnapRow[] | null; meta?: WriteSnapMeta | null } | null,
): {
  writeSnapshot: WriteSnapRow[];
  writeSnapshotMeta: WriteSnapMeta;
  writeSnapshotIncremental: IncrementalPack | null;
  progressZh: string;
} {
  const compacted = compactWriteSnapshotRows(rowsIn);
  const incr = maybeIncrementalWriteSnapshot(
    prev?.rows || null,
    compacted.rows,
    prev?.meta?.checksum || null,
  );
  const checksum = hashWriteSnapshotRows(compacted.rows);
  const at = new Date().toISOString();
  if (incr.mode === 'incremental') {
    const bytesAfter = Buffer.byteLength(JSON.stringify(incr.pack), 'utf8');
    const meta: WriteSnapMeta = {
      count: compacted.rows.length,
      checksum,
      phase: 'write',
      at,
      compressed: compacted.compressed,
      incremental: true,
      format: 'incremental-v1',
      bytesBefore: compacted.bytesBefore,
      bytesAfter,
      baseChecksum: incr.pack.baseChecksum,
      added: incr.pack.added.length,
      removed: incr.pack.removedKeys.length,
      kept: incr.pack.kept.length,
      wave: 'M82',
      tipZh: `写库快照增量×${compacted.rows.length} · +${incr.pack.added.length}/-${incr.pack.removedKeys.length}/保留${incr.pack.kept.length} · ${compacted.bytesBefore}→${bytesAfter}B · 校验 ${checksum.slice(0, 8)}…`,
    };
    return {
      writeSnapshot: compacted.rows,
      writeSnapshotMeta: meta,
      writeSnapshotIncremental: incr.pack,
      progressZh: meta.tipZh!,
    };
  }
  const meta: WriteSnapMeta = {
    count: compacted.rows.length,
    checksum,
    phase: 'write',
    at,
    compressed: compacted.compressed,
    incremental: false,
    format: compacted.compressed ? 'compact-v1' : 'full',
    bytesBefore: compacted.bytesBefore,
    bytesAfter: compacted.bytesAfter,
    baseChecksum: null,
    wave: 'M82',
    tipZh: compacted.compressed
      ? `写库快照压缩×${compacted.rows.length} · ${compacted.bytesBefore}→${compacted.bytesAfter}B · 校验 ${checksum.slice(0, 8)}…`
      : `写库快照×${compacted.rows.length} · 校验 ${checksum.slice(0, 8)}…`,
  };
  return {
    writeSnapshot: compacted.rows,
    writeSnapshotMeta: meta,
    writeSnapshotIncremental: null,
    progressZh: meta.tipZh!,
  };
}

export function resolvePersistedWriteSnapshot(prev: {
  writeSnapshot?: WriteSnapRow[] | null;
  writeSnapshotMeta?: WriteSnapMeta | null;
  writeSnapshotIncremental?: IncrementalPack | null;
  writeSnapshotPrev?: WriteSnapRow[] | null;
} | null | undefined): WriteSnapRow[] | null {
  if (!prev) return null;
  if (prev.writeSnapshotMeta?.incremental && prev.writeSnapshotIncremental) {
    const expanded = expandIncrementalPack(
      prev.writeSnapshotIncremental,
      prev.writeSnapshotPrev || prev.writeSnapshot || null,
    );
    if (expanded && expanded.length) return expanded;
  }
  return Array.isArray(prev.writeSnapshot) ? prev.writeSnapshot : null;
}
