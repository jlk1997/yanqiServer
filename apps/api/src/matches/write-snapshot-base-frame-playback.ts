/**
 * M87：基帧差分 scrubber / 播放（多帧历史对照，干跑无外发）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  compareWriteSnapshotAgainstBaseFrame,
  readWriteSnapshotBaseFrame,
  visualizeWriteSnapshotBaseFrameDiff,
  type WriteSnapshotBaseFrameDiffViz,
} from './write-snapshot-base-frame';
import type { WriteSnapRow } from './write-snapshot-codec';

function safeTenant(tid?: string | null) {
  return String(tid || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function histPath(tenantId: string) {
  const dir = join(process.cwd(), '.data', 'tenants', safeTenant(tenantId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'write-snapshot-base-frame-diff-history.json');
}

export type BaseFrameDiffPlaybackFrame = {
  seq: number;
  at: string;
  matched: boolean;
  liveChecksum: string | null;
  liveCount: number;
  summaryZh: string;
  barZh: string;
  toastZh: string;
};

export function pushBaseFrameDiffHistory(
  tenantId: string | null | undefined,
  viz: WriteSnapshotBaseFrameDiffViz & { liveChecksum?: string | null; liveCount?: number },
): BaseFrameDiffPlaybackFrame[] {
  const p = histPath(tenantId || 'default');
  let arr: BaseFrameDiffPlaybackFrame[] = [];
  try {
    if (existsSync(p)) arr = JSON.parse(readFileSync(p, 'utf8')) || [];
  } catch (_) {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];
  const seq = (arr.length ? Number(arr[arr.length - 1].seq) || arr.length : 0) + 1;
  arr.push({
    seq,
    at: new Date().toISOString(),
    matched: Boolean(viz.matched),
    liveChecksum: (viz as any).liveChecksum || viz.checksumDiff?.livePrefix || null,
    liveCount: (viz as any).liveCount ?? viz.countDiff?.live ?? 0,
    summaryZh: viz.summaryZh,
    barZh: viz.checksumDiff?.barZh || '',
    toastZh: viz.toastZh,
  });
  while (arr.length > 32) arr.shift();
  writeFileSync(p, JSON.stringify(arr, null, 0), 'utf8');
  return arr;
}

export function readBaseFrameDiffPlayback(tenantId?: string | null) {
  const p = histPath(tenantId || 'default');
  let frames: BaseFrameDiffPlaybackFrame[] = [];
  try {
    if (existsSync(p)) frames = JSON.parse(readFileSync(p, 'utf8')) || [];
  } catch (_) {
    frames = [];
  }
  if (!Array.isArray(frames)) frames = [];
  const minSeq = frames.length ? frames[0].seq : 0;
  const maxSeq = frames.length ? frames[frames.length - 1].seq : 0;
  return {
    ok: true as const,
    wave: 'M87' as const,
    labelZh: '基帧差分 scrubber 播放',
    tipZh: frames.length
      ? `基帧差分历史 ${frames.length} 帧 · scrubber seq ${minSeq}..${maxSeq} · 可播放`
      : '尚无基帧差分历史；先对照/可视化会落盘帧',
    toastZh: frames.length ? `差分播放 ${frames.length} 帧` : '差分历史空',
    busyZh: '加载基帧差分播放…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    frames,
    scrubber: {
      enabled: frames.length > 0,
      minSeq,
      maxSeq,
      currentSeq: maxSeq,
      playbackAvailable: frames.length > 0,
      pauseSeek: true,
      intervalMs: 800,
      speedOptions: [
        { speed: 0.5, intervalMs: 1600, labelZh: '0.5×' },
        { speed: 1, intervalMs: 800, labelZh: '1×' },
        { speed: 2, intervalMs: 400, labelZh: '2×' },
      ],
      seekPath: '/api/metrics/write-snapshot-base-frame/diff-playback/seek',
      labelZh: '基帧差分播放 scrubber',
      tipZh: frames.length ? `拖动/播放对照差分帧 ${minSeq}..${maxSeq}` : '无帧可播',
      wave: 'M87' as const,
    },
  };
}

export function seekBaseFrameDiffPlayback(
  tenantId: string | null | undefined,
  body: { seq?: number; pause?: boolean } = {},
) {
  const tl = readBaseFrameDiffPlayback(tenantId);
  const seq = Number(body?.seq);
  const hit = tl.frames.find((f) => f.seq === seq) || null;
  return {
    ok: true as const,
    wave: 'M87' as const,
    labelZh: '基帧差分播放 seek',
    tipZh: hit
      ? `已定位差分帧 seq #${seq} · ${hit.matched ? '一致' : '不一致'} · ${body?.pause ? '已暂停' : '可播放'} · ${hit.summaryZh}`
      : `未找到差分帧 seq #${seq}`,
    toastZh: hit ? `差分 seek · #${seq}` : '帧不存在',
    busyZh: '基帧差分 seek…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    paused: body?.pause === true,
    seq: Number.isFinite(seq) ? seq : null,
    frame: hit,
    scrubber: tl.scrubber,
    playback: tl,
  };
}

/** 对照一次并落入播放历史 */
export function compareAndRecordBaseFrameDiffPlayback(
  tenantId: string | null | undefined,
  opts: {
    rows?: WriteSnapRow[] | null;
    checksum?: string | null;
    phase?: string | null;
    count?: number | null;
    demandId?: string | null;
  } = {},
) {
  const viz = visualizeWriteSnapshotBaseFrameDiff(tenantId, opts);
  const cmp = compareWriteSnapshotAgainstBaseFrame(tenantId, opts);
  const frames = pushBaseFrameDiffHistory(tenantId, {
    ...viz,
    liveChecksum: cmp.liveChecksum,
    liveCount: cmp.liveCount,
  } as any);
  const playback = readBaseFrameDiffPlayback(tenantId);
  return {
    ...viz,
    wave: 'M87' as const,
    labelZh: '基帧差分可视化并入播放',
    tipZh: viz.tipZh + ` · 已入播放历史 ${frames.length} 帧`,
    toastZh: viz.toastZh + ' · 可播放',
    playback,
    recordedSeq: frames.length ? frames[frames.length - 1].seq : null,
    softCancelIntact: true as const,
  };
}

export function seedDryRunBaseFrameDiffPlayback(tenantId?: string | null) {
  const base = readWriteSnapshotBaseFrame(tenantId);
  const fakeLive = base
    ? base.checksum.slice(0, -2) + 'ab'
    : 'dryrunchecksum0123456789abcdef';
  const viz = visualizeWriteSnapshotBaseFrameDiff(tenantId, {
    checksum: fakeLive,
    count: (base?.count || 0) + 1,
    phase: 'write',
    demandId: base?.demandId || 'dry-demand',
  });
  pushBaseFrameDiffHistory(tenantId, {
    ...viz,
    liveChecksum: fakeLive,
    liveCount: (base?.count || 0) + 1,
  } as any);
  // 再落一帧「一致」样（若有基帧则用基帧 checksum）
  if (base) {
    const viz2 = visualizeWriteSnapshotBaseFrameDiff(tenantId, {
      checksum: base.checksum,
      count: base.count,
      phase: 'write',
      demandId: base.demandId,
    });
    pushBaseFrameDiffHistory(tenantId, {
      ...viz2,
      liveChecksum: base.checksum,
      liveCount: base.count,
    } as any);
  }
  return readBaseFrameDiffPlayback(tenantId);
}
