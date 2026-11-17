/**
 * M49–M51：冲突全量导出异步任务（大文件）
 * - 同步 CSV/ZIP 仍保留；行数 ≥ 阈值或显式 async 时走后台任务
 * - 进度 / 取消 / 就绪后下载
 * - M50：产物 TTL 清理 + 全局磁盘配额（最旧优先删）
 * - M51：按租户隔离目录 exports/.../async/tenants/<tenantId>/ + 租户级磁盘配额
 * - M52：租户配额软阈值告警徽章（near/critical/over）
 * - M53：配额告警双通道（徽章 + 通知/Webhook/邮件草稿桩）
 * 票仓/任务态：memory + 文件，不强制 Redis
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, resolve as pathResolve, sep } from 'path';
import { randomBytes } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiverMod = require('archiver');
function createZipArchive(options?: any) {
  if (archiverMod.ZipArchive) return new archiverMod.ZipArchive(options || { zlib: { level: 9 } });
  return archiverMod('zip', options || { zlib: { level: 9 } });
}

export type ConflictExportJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'done'
  | 'failed';

export type ConflictExportJob = {
  exportId: string;
  importJobId: string;
  format: 'csv' | 'zip';
  mergeStrategy: string;
  status: ConflictExportJobStatus;
  cancelRequested: boolean;
  percent: number;
  phaseZh: string;
  messageZh: string;
  exportedRows: number;
  totalRows: number;
  fileName?: string | null;
  filePath?: string | null;
  bytes?: number | null;
  errorZh?: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  actor?: string | null;
  tenantId?: string | null;
  downloadPath?: string | null;
  progressPath?: string | null;
  cancelPath?: string | null;
  streamPath?: string | null;
  wave: string;
};

const DATA_DIR = join(process.cwd(), '.data');
const STORE_FILE = join(DATA_DIR, 'conflict-export-jobs.json');
/** 根目录；M51 起正式产物落 tenants/<id>/；根下遗留文件仍可清理 */
const OUT_ROOT = join(process.cwd(), 'exports', 'conflict-exports', 'async');
const TENANTS_ROOT = join(OUT_ROOT, 'tenants');
const jobs = new Map<string, ConflictExportJob>();
let loaded = false;
let persistTimer: NodeJS.Timeout | null = null;

/** M50：产物默认保留 24h */
export function conflictExportArtifactTtlMs(): number {
  const n = Number(process.env.CONFLICT_EXPORT_TTL_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.floor(n);
  return 24 * 60 * 60 * 1000;
}

/** M50：全局异步导出目录磁盘配额（默认 512MB，跨租户天花板） */
export function conflictExportDiskQuotaBytes(): number {
  const n = Number(process.env.CONFLICT_EXPORT_DISK_QUOTA_BYTES);
  if (Number.isFinite(n) && n >= 1_000_000) return Math.floor(n);
  return 512 * 1024 * 1024;
}

/** M51：单租户磁盘配额（默认 128MB） */
export function conflictExportTenantDiskQuotaBytes(): number {
  const n = Number(process.env.CONFLICT_EXPORT_TENANT_DISK_QUOTA_BYTES);
  if (Number.isFinite(n) && n >= 500_000) return Math.floor(n);
  return 128 * 1024 * 1024;
}

/** 路径安全租户段 */
export function sanitizeTenantDir(tenantId?: string | null): string {
  const raw = String(tenantId || 'default').trim() || 'default';
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return safe || 'default';
}

export function tenantExportDir(tenantId?: string | null): string {
  return join(TENANTS_ROOT, sanitizeTenantDir(tenantId));
}

type ArtifactFile = { name: string; path: string; size: number; mtimeMs: number; tenantId: string };

function listFilesInDir(dir: string, tenantId: string): ArtifactFile[] {
  if (!existsSync(dir)) return [];
  const out: ArtifactFile[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      out.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs, tenantId });
    } catch (_) {}
  }
  return out;
}

function listTenantIds(): string[] {
  ensureDirs();
  if (!existsSync(TENANTS_ROOT)) return [];
  const ids: string[] = [];
  for (const name of readdirSync(TENANTS_ROOT)) {
    try {
      if (statSync(join(TENANTS_ROOT, name)).isDirectory()) ids.push(name);
    } catch (_) {}
  }
  return ids;
}

/** 含各租户目录 + 根目录遗留扁平文件（tenantId=_legacy） */
function listAllArtifactFiles(): ArtifactFile[] {
  ensureDirs();
  const out: ArtifactFile[] = [];
  for (const tid of listTenantIds()) {
    out.push(...listFilesInDir(join(TENANTS_ROOT, tid), tid));
  }
  // 遗留：OUT_ROOT 根下直接文件（不含 tenants 子目录）
  if (existsSync(OUT_ROOT)) {
    for (const name of readdirSync(OUT_ROOT)) {
      if (name === 'tenants') continue;
      const p = join(OUT_ROOT, name);
      try {
        const st = statSync(p);
        if (st.isFile()) out.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs, tenantId: '_legacy' });
      } catch (_) {}
    }
  }
  return out;
}

function markJobArtifactCleared(filePath: string, reasonZh: string) {
  const resolved = pathResolve(filePath);
  for (const j of jobs.values()) {
    if (j.filePath && pathResolve(j.filePath) === resolved) {
      touch(j, {
        filePath: null,
        downloadPath: null,
        messageZh: (j.messageZh || '') + reasonZh,
      });
    }
  }
}

function purgeFiles(files: ArtifactFile[], reasonZh: string): { removed: number; freed: number } {
  let removed = 0;
  let freed = 0;
  for (const f of files) {
    try {
      unlinkSync(f.path);
      removed += 1;
      freed += f.size;
      markJobArtifactCleared(f.path, reasonZh);
    } catch (_) {}
  }
  return { removed, freed };
}

/**
 * M50/M51：清理过期产物 + 按租户配额 + 全局配额（最旧优先删）
 */
export function cleanupConflictExportArtifacts(opts?: { force?: boolean; tenantId?: string | null }): {
  ok: true;
  wave: string;
  removed: number;
  freedBytes: number;
  kept: number;
  totalBytes: number;
  ttlMs: number;
  quotaBytes: number;
  tenantQuotaBytes: number;
  byTenant: Array<{ tenantId: string; bytes: number; files: number; removed: number }>;
  tipZh: string;
} {
  ensureLoaded();
  const ttlMs = conflictExportArtifactTtlMs();
  const globalQuota = conflictExportDiskQuotaBytes();
  const tenantQuota = conflictExportTenantDiskQuotaBytes();
  const now = Date.now();
  let removed = 0;
  let freed = 0;
  const tenantFocus = opts?.tenantId ? sanitizeTenantDir(opts.tenantId) : null;
  const byTenantMap = new Map<string, { tenantId: string; bytes: number; files: number; removed: number }>();

  const bumpTenant = (tid: string, patch: Partial<{ bytes: number; files: number; removed: number }>) => {
    const cur = byTenantMap.get(tid) || { tenantId: tid, bytes: 0, files: 0, removed: 0 };
    if (patch.bytes != null) cur.bytes = patch.bytes;
    if (patch.files != null) cur.files = patch.files;
    if (patch.removed != null) cur.removed += patch.removed;
    byTenantMap.set(tid, cur);
  };

  // 1) TTL
  const all = listAllArtifactFiles().filter((f) => !tenantFocus || f.tenantId === tenantFocus);
  const expired = all.filter((f) => now - f.mtimeMs > ttlMs);
  const ttlPurge = purgeFiles(expired, '（产物已按 TTL 清理）');
  removed += ttlPurge.removed;
  freed += ttlPurge.freed;
  for (const f of expired) bumpTenant(f.tenantId, { removed: 1 });

  // 2) 每租户配额
  const tenantIds = tenantFocus ? [tenantFocus] : [...new Set(listAllArtifactFiles().map((f) => f.tenantId))];
  for (const tid of tenantIds) {
    let remain = listAllArtifactFiles()
      .filter((f) => f.tenantId === tid)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = remain.reduce((s, f) => s + f.size, 0);
    const toDrop: ArtifactFile[] = [];
    for (const f of remain) {
      if (total <= tenantQuota) break;
      toDrop.push(f);
      total -= f.size;
    }
    if (toDrop.length) {
      const p = purgeFiles(toDrop, '（产物已按租户磁盘配额清理）');
      removed += p.removed;
      freed += p.freed;
      bumpTenant(tid, { removed: p.removed });
    }
    remain = listAllArtifactFiles().filter((f) => f.tenantId === tid);
    bumpTenant(tid, {
      bytes: remain.reduce((s, f) => s + f.size, 0),
      files: remain.length,
    });
  }

  // 3) 全局天花板
  let remainAll = listAllArtifactFiles()
    .filter((f) => !tenantFocus || f.tenantId === tenantFocus)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let globalTotal = remainAll.reduce((s, f) => s + f.size, 0);
  const globalDrop: ArtifactFile[] = [];
  for (const f of remainAll) {
    if (globalTotal <= globalQuota) break;
    globalDrop.push(f);
    globalTotal -= f.size;
  }
  if (globalDrop.length) {
    const p = purgeFiles(globalDrop, '（产物已按全局磁盘配额清理）');
    removed += p.removed;
    freed += p.freed;
    for (const f of globalDrop) bumpTenant(f.tenantId, { removed: 1 });
  }

  remainAll = listAllArtifactFiles().filter((f) => !tenantFocus || f.tenantId === tenantFocus);
  globalTotal = remainAll.reduce((s, f) => s + f.size, 0);
  // refresh byTenant bytes
  const grouped = new Map<string, ArtifactFile[]>();
  for (const f of remainAll) {
    const arr = grouped.get(f.tenantId) || [];
    arr.push(f);
    grouped.set(f.tenantId, arr);
  }
  for (const [tid, files] of grouped) {
    bumpTenant(tid, { bytes: files.reduce((s, f) => s + f.size, 0), files: files.length });
  }

  const byTenant = [...byTenantMap.values()].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  return {
    ok: true,
    wave: 'M53',
    removed,
    freedBytes: freed,
    kept: remainAll.length,
    totalBytes: globalTotal,
    ttlMs,
    quotaBytes: globalQuota,
    tenantQuotaBytes: tenantQuota,
    byTenant,
    tipZh: `异步冲突导出产物（按租户隔离 · M53 配额双通道）：TTL ${Math.round(ttlMs / 3600000)}h，租户配额 ${Math.round(tenantQuota / 1048576)}MB，全局天花板 ${Math.round(globalQuota / 1048576)}MB；本次删除 ${removed} 个、释放 ${Math.round(freed / 1024)}KB。`,
  };
}

export function conflictExportAsyncThreshold(): number {
  const n = Number(process.env.CONFLICT_EXPORT_ASYNC_THRESHOLD);
  if (Number.isFinite(n) && n >= 100) return Math.floor(n);
  return 5000;
}

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(OUT_ROOT)) mkdirSync(OUT_ROOT, { recursive: true });
  if (!existsSync(TENANTS_ROOT)) mkdirSync(TENANTS_ROOT, { recursive: true });
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    ensureDirs();
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
      const items = Array.isArray(raw?.items) ? raw.items : [];
      for (const it of items) {
        if (!it?.exportId) continue;
        if (it.status === 'running' || it.status === 'queued' || it.status === 'cancelling') {
          it.status = 'failed';
          it.errorZh = '服务重启，异步导出中断，请重新发起';
          it.phaseZh = '已中断';
          it.percent = Math.min(99, Number(it.percent) || 0);
          it.finishedAt = new Date().toISOString();
        }
        jobs.set(String(it.exportId), it as ConflictExportJob);
      }
    }
  } catch (_) {}
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      ensureDirs();
      const items = [...jobs.values()].slice(-200);
      writeFileSync(
        STORE_FILE,
        JSON.stringify({ wave: 'M52', updatedAt: new Date().toISOString(), items }, null, 0),
        'utf8',
      );
    } catch (_) {}
  }, 60);
}

function touch(job: ConflictExportJob, patch: Partial<ConflictExportJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  schedulePersist();
}

export function getConflictExportJob(exportId: string): ConflictExportJob | null {
  ensureLoaded();
  return jobs.get(String(exportId)) || null;
}

export function listConflictExportJobs(importJobId?: string, limit = 20): ConflictExportJob[] {
  ensureLoaded();
  let arr = [...jobs.values()];
  if (importJobId) arr = arr.filter((j) => j.importJobId === importJobId);
  arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return arr.slice(0, Math.min(Math.max(limit, 1), 50));
}

export function cancelConflictExportJob(exportId: string) {
  ensureLoaded();
  const job = jobs.get(String(exportId));
  if (!job) return { ok: false, messageZh: '找不到异步导出任务', exportId };
  if (job.status === 'done' || job.status === 'cancelled' || job.status === 'failed') {
    return {
      ok: true,
      exportId,
      status: job.status,
      summaryZh: '任务已结束，无需取消',
      job,
    };
  }
  job.cancelRequested = true;
  touch(job, { status: 'cancelling', phaseZh: '取消中', messageZh: '已请求取消，当前批次写完即停' });
  return {
    ok: true,
    exportId,
    status: 'cancelling',
    summaryZh: '已请求取消异步冲突导出：当前批次写完就停，不会再生成下载文件。',
    job,
  };
}

export function conflictExportJobProgress(exportId: string) {
  ensureLoaded();
  const job = jobs.get(String(exportId));
  if (!job) {
    return {
      ok: false,
      empty: true,
      bannerZh: '找不到异步导出任务',
      hintZh: '请重新发起异步导出',
      waiting: false,
    };
  }
  const waiting =
    job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';
  return {
    ok: true,
    empty: false,
    waiting,
    percent: job.percent,
    status: job.status,
    phaseZh: job.phaseZh,
    bannerZh: job.messageZh,
    hintZh: waiting
      ? '大文件在后台生成，可取消；完成后点下载。'
      : job.status === 'done'
        ? '已就绪，可下载。'
        : job.errorZh || '',
    exportedRows: job.exportedRows,
    totalRows: job.totalRows,
    downloadPath: job.status === 'done' ? job.downloadPath : null,
    cancelPath: waiting ? job.cancelPath : null,
    format: job.format,
    exportId: job.exportId,
    importJobId: job.importJobId,
    tenantId: job.tenantId || 'default',
    wave: 'M52',
    job,
  };
}

type BuildFns = {
  buildFullPreview: (importJobId: string, mergeStrategy?: string) => Promise<any>;
  rowsToCsv: (data: any) => string;
};

export function startConflictExportAsync(
  opts: {
    importJobId: string;
    format?: 'csv' | 'zip';
    mergeStrategy?: string;
    actor?: string | null;
    tenantId?: string | null;
    forceAsync?: boolean;
    remainingHint?: number;
  },
  build: BuildFns,
): { ok: boolean; messageZh?: string; job?: ConflictExportJob; syncSuggested?: boolean } {
  ensureLoaded();
  try {
    cleanupConflictExportArtifacts({ tenantId: opts.tenantId });
  } catch (_) {}
  const format = opts.format === 'zip' ? 'zip' : 'csv';
  const exportId = 'cex_' + randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const base = `/api/imports/enterprise/jobs/${opts.importJobId}/conflict-export/jobs/${exportId}`;
  const tenantId = sanitizeTenantDir(opts.tenantId);
  const outDir = tenantExportDir(tenantId);
  const job: ConflictExportJob = {
    exportId,
    importJobId: opts.importJobId,
    format,
    mergeStrategy: opts.mergeStrategy || 'fill-empty',
    status: 'queued',
    cancelRequested: false,
    percent: 0,
    phaseZh: '排队中',
    messageZh: `异步冲突导出已入队（租户 ${tenantId}）`,
    exportedRows: 0,
    totalRows: Math.max(0, Number(opts.remainingHint) || 0),
    fileName: null,
    filePath: null,
    bytes: null,
    errorZh: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    actor: opts.actor || null,
    tenantId,
    downloadPath: `${base}/download`,
    progressPath: base,
    cancelPath: `${base}/cancel`,
    streamPath: `${base}/stream`,
    wave: 'M52',
  };
  jobs.set(exportId, job);
  schedulePersist();

  void (async () => {
    try {
      touch(job, { status: 'running', phaseZh: '拉取冲突全量', percent: 5, messageZh: '正在计算冲突行…' });
      if (job.cancelRequested) {
        touch(job, {
          status: 'cancelled',
          phaseZh: '已取消',
          messageZh: '用户取消',
          finishedAt: new Date().toISOString(),
          percent: 0,
        });
        return;
      }
      const data = await build.buildFullPreview(opts.importJobId, opts.mergeStrategy);
      if (!(data as any)?.ok) {
        touch(job, {
          status: 'failed',
          phaseZh: '失败',
          messageZh: (data as any)?.messageZh || '冲突预览失败',
          errorZh: (data as any)?.messageZh || '冲突预览失败',
          finishedAt: new Date().toISOString(),
        });
        return;
      }
      const rows = Array.isArray((data as any).rows) ? (data as any).rows : [];
      job.totalRows = rows.length;
      touch(job, {
        percent: 25,
        phaseZh: '生成文件',
        messageZh: `共 ${rows.length} 行，正在写入 ${format.toUpperCase()}（租户 ${tenantId}）…`,
        exportedRows: 0,
      });

      const chunk = Math.max(1, Math.floor(rows.length / 20) || 1);
      for (let i = 0; i < rows.length; i += chunk) {
        if (job.cancelRequested) {
          touch(job, {
            status: 'cancelled',
            phaseZh: '已取消',
            messageZh: '用户取消，未生成下载文件',
            finishedAt: new Date().toISOString(),
            percent: Math.min(90, 25 + Math.round((i / Math.max(rows.length, 1)) * 60)),
          });
          return;
        }
        job.exportedRows = Math.min(rows.length, i + chunk);
        const pct = 25 + Math.round((job.exportedRows / Math.max(rows.length, 1)) * 60);
        touch(job, {
          percent: Math.min(85, pct),
          exportedRows: job.exportedRows,
          messageZh: `已处理 ${job.exportedRows}/${rows.length} 行…`,
        });
        await new Promise((r) => setTimeout(r, 8));
      }

      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const short = String(opts.importJobId).slice(0, 8);
      if (format === 'csv') {
        const fileName = `conflict-async-${short}-${stamp}.csv`;
        const filePath = join(outDir, fileName);
        const csvBody = build.rowsToCsv(data);
        if (job.cancelRequested) {
          touch(job, {
            status: 'cancelled',
            phaseZh: '已取消',
            messageZh: '用户取消',
            finishedAt: new Date().toISOString(),
          });
          return;
        }
        writeFileSync(filePath, csvBody, 'utf8');
        const bytes = Buffer.byteLength(csvBody, 'utf8');
        touch(job, {
          status: 'done',
          percent: 100,
          phaseZh: '已完成',
          messageZh: `异步冲突 CSV 就绪：${rows.length} 行（租户 ${tenantId}）`,
          exportedRows: rows.length,
          fileName,
          filePath,
          bytes,
          finishedAt: new Date().toISOString(),
          downloadPath: `/api/imports/enterprise/jobs/${opts.importJobId}/conflict-export/jobs/${exportId}/download`,
        });
      } else {
        const fileName = `conflict-async-${short}-${stamp}.zip`;
        const filePath = join(outDir, fileName);
        const csvBody = build.rowsToCsv(data);
        const summary = {
          wave: 'M52',
          exportId,
          jobId: opts.importJobId,
          tenantId,
          mergeStrategy: (data as any).mergeStrategy,
          counts: (data as any).counts,
          summaryZh: (data as any).summaryZh,
          exportedRows: rows.length,
          full: true,
          async: true,
          generatedAt: new Date().toISOString(),
        };
        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(filePath);
          const archive = createZipArchive({ zlib: { level: 9 } });
          output.on('close', () => resolve());
          archive.on('error', reject);
          archive.pipe(output);
          archive.append(csvBody, { name: `conflict-full-${short}.csv` });
          archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });
          archive.finalize();
        });
        if (job.cancelRequested) {
          try {
            unlinkSync(filePath);
          } catch (_) {}
          touch(job, {
            status: 'cancelled',
            phaseZh: '已取消',
            messageZh: '用户取消，文件已丢弃',
            finishedAt: new Date().toISOString(),
          });
          return;
        }
        let bytes = 0;
        try {
          bytes = require('fs').statSync(filePath).size;
        } catch (_) {}
        touch(job, {
          status: 'done',
          percent: 100,
          phaseZh: '已完成',
          messageZh: `异步冲突 ZIP 就绪：${rows.length} 行（租户 ${tenantId}）`,
          exportedRows: rows.length,
          fileName,
          filePath,
          bytes,
          finishedAt: new Date().toISOString(),
          downloadPath: `/api/imports/enterprise/jobs/${opts.importJobId}/conflict-export/jobs/${exportId}/download`,
        });
      }
      try {
        cleanupConflictExportArtifacts({ tenantId });
      } catch (_) {}
    } catch (e: any) {
      touch(job, {
        status: 'failed',
        phaseZh: '失败',
        messageZh: String(e?.message || e).slice(0, 200),
        errorZh: String(e?.message || e).slice(0, 200),
        finishedAt: new Date().toISOString(),
      });
    }
  })();

  return {
    ok: true,
    messageZh: `异步冲突导出已启动（租户 ${tenantId} 隔离目录），请看进度；完成后可下载。`,
    job,
  };
}

export function resolveAsyncDownloadFile(exportId: string): {
  ok: boolean;
  messageZh?: string;
  job?: ConflictExportJob;
  filePath?: string;
  fileName?: string;
} {
  ensureLoaded();
  const job = jobs.get(String(exportId));
  if (!job) return { ok: false, messageZh: '找不到异步导出任务' };
  if (job.status !== 'done' || !job.filePath || !existsSync(job.filePath)) {
    return {
      ok: false,
      messageZh:
        job.status === 'running' || job.status === 'queued'
          ? '文件尚未就绪，请稍候或看进度'
          : job.status === 'cancelled'
            ? '任务已取消，无下载文件'
            : '文件不可用，请重新导出',
      job,
    };
  }
  const resolved = pathResolve(job.filePath);
  const root = pathResolve(OUT_ROOT) + sep;
  if (!resolved.startsWith(root) && resolved !== pathResolve(OUT_ROOT)) {
    return { ok: false, messageZh: '非法文件路径', job };
  }
  return { ok: true, job, filePath: resolved, fileName: job.fileName || 'conflict-async.bin' };
}

export function peekConflictExportAsyncStats() {
  ensureLoaded();
  const byStatus: Record<string, number> = {};
  for (const j of jobs.values()) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  }
  const files = listAllArtifactFiles();
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const byTenant: Record<string, { files: number; bytes: number }> = {};
  for (const f of files) {
    const row = byTenant[f.tenantId] || { files: 0, bytes: 0 };
    row.files += 1;
    row.bytes += f.size;
    byTenant[f.tenantId] = row;
  }
  return {
    wave: 'M52',
    pending: [...jobs.values()].filter((j) =>
      ['queued', 'running', 'cancelling'].includes(j.status),
    ).length,
    totalTracked: jobs.size,
    byStatus,
    threshold: conflictExportAsyncThreshold(),
    outRoot: OUT_ROOT,
    tenantsRoot: TENANTS_ROOT,
    storeFile: STORE_FILE,
    artifactTtlMs: conflictExportArtifactTtlMs(),
    diskQuotaBytes: conflictExportDiskQuotaBytes(),
    tenantDiskQuotaBytes: conflictExportTenantDiskQuotaBytes(),
    tenantIsolation: true,
    artifactFiles: files.length,
    artifactBytes: totalBytes,
    byTenant,
  };
}

/** M52：软阈值（默认 80%）— 接近配额 */
export function conflictExportTenantSoftRatio(): number {
  const n = Number(process.env.CONFLICT_EXPORT_TENANT_SOFT_RATIO);
  if (Number.isFinite(n) && n > 0.1 && n < 1) return n;
  return 0.8;
}

/** M52：危急阈值（默认 95%） */
export function conflictExportTenantCriticalRatio(): number {
  const n = Number(process.env.CONFLICT_EXPORT_TENANT_CRITICAL_RATIO);
  if (Number.isFinite(n) && n > conflictExportTenantSoftRatio() && n <= 1) return n;
  return 0.95;
}

export type TenantQuotaWarnLevel = 'ok' | 'near' | 'critical' | 'over';

export type TenantQuotaWarning = {
  tenantId: string;
  bytes: number;
  files: number;
  quotaBytes: number;
  ratio: number;
  level: TenantQuotaWarnLevel;
  badgeZh: string;
  tipZh: string;
};

function levelForRatio(ratio: number, soft: number, critical: number): TenantQuotaWarnLevel {
  if (ratio >= 1) return 'over';
  if (ratio >= critical) return 'critical';
  if (ratio >= soft) return 'near';
  return 'ok';
}

function badgeZhFor(level: TenantQuotaWarnLevel, pct: number): string {
  if (level === 'over') return `超额 ${pct}%`;
  if (level === 'critical') return `危急 ${pct}%`;
  if (level === 'near') return `接近 ${pct}%`;
  return `正常 ${pct}%`;
}

/**
 * M52：导出租户配额告警（运营台徽章）
 * - near ≥ soft（默认 80%）
 * - critical ≥ critical（默认 95%）
 * - over ≥ 100%
 */
export function tenantExportQuotaWarnings(opts?: { tenantId?: string | null }): {
  ok: true;
  wave: string;
  softRatio: number;
  criticalRatio: number;
  tenantQuotaBytes: number;
  globalQuotaBytes: number;
  globalBytes: number;
  globalRatio: number;
  globalLevel: TenantQuotaWarnLevel;
  worstLevel: TenantQuotaWarnLevel;
  badgeZh: string;
  tipZh: string;
  warnings: TenantQuotaWarning[];
  tenants: TenantQuotaWarning[];
  alertingCount: number;
} {
  ensureLoaded();
  const soft = conflictExportTenantSoftRatio();
  const critical = conflictExportTenantCriticalRatio();
  const tenantQuota = conflictExportTenantDiskQuotaBytes();
  const globalQuota = conflictExportDiskQuotaBytes();
  const focus = opts?.tenantId ? sanitizeTenantDir(opts.tenantId) : null;
  const files = listAllArtifactFiles().filter((f) => !focus || f.tenantId === focus);
  const byTenant = new Map<string, { bytes: number; files: number }>();
  for (const f of files) {
    const cur = byTenant.get(f.tenantId) || { bytes: 0, files: 0 };
    cur.bytes += f.size;
    cur.files += 1;
    byTenant.set(f.tenantId, cur);
  }
  const tenants: TenantQuotaWarning[] = [...byTenant.entries()]
    .map(([tenantId, v]) => {
      const ratio = tenantQuota > 0 ? v.bytes / tenantQuota : 0;
      const level = levelForRatio(ratio, soft, critical);
      const pct = Math.round(ratio * 1000) / 10;
      return {
        tenantId,
        bytes: v.bytes,
        files: v.files,
        quotaBytes: tenantQuota,
        ratio: Math.round(ratio * 10000) / 10000,
        level,
        badgeZh: badgeZhFor(level, pct),
        tipZh:
          level === 'over'
            ? `租户 ${tenantId} 导出占用已超过配额（${Math.round(v.bytes / 1024)}KB / ${Math.round(tenantQuota / 1048576)}MB），清理或扩配额。`
            : level === 'critical'
              ? `租户 ${tenantId} 导出占用危急（${pct}%），建议尽快清理旧产物。`
              : level === 'near'
                ? `租户 ${tenantId} 导出接近配额（${pct}% ≥ ${Math.round(soft * 100)}% 软阈值）。`
                : `租户 ${tenantId} 导出占用正常（${pct}%）。`,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || a.tenantId.localeCompare(b.tenantId));

  const globalBytes = files.reduce((s, f) => s + f.size, 0);
  const globalRatio = globalQuota > 0 ? globalBytes / globalQuota : 0;
  const globalLevel = levelForRatio(globalRatio, soft, critical);
  const rank = { ok: 0, near: 1, critical: 2, over: 3 } as const;
  let worst: TenantQuotaWarnLevel = globalLevel;
  for (const t of tenants) {
    if (rank[t.level] > rank[worst]) worst = t.level;
  }
  const warnings = tenants.filter((t) => t.level !== 'ok');
  const badgeZh =
    worst === 'ok'
      ? `导出配额正常`
      : worst === 'near'
        ? `导出租户配额接近上限（${warnings.length}）`
        : worst === 'critical'
          ? `导出租户配额危急（${warnings.length}）`
          : `导出租户配额已超额（${warnings.length}）`;
  return {
    ok: true,
    wave: 'M53',
    softRatio: soft,
    criticalRatio: critical,
    tenantQuotaBytes: tenantQuota,
    globalQuotaBytes: globalQuota,
    globalBytes,
    globalRatio: Math.round(globalRatio * 10000) / 10000,
    globalLevel,
    worstLevel: worst,
    badgeZh,
    tipZh: `软阈值 ${Math.round(soft * 100)}% · 危急 ${Math.round(critical * 100)}% · 租户配额 ${Math.round(tenantQuota / 1048576)}MB · 全局 ${Math.round(globalQuota / 1048576)}MB。告警进运营台徽章（通道一）；通道二见 POST .../quota-warnings/notify（草稿/干跑，不真发）。清理仍走 cleanup，告警本身不自动删。`,
    warnings,
    tenants,
    alertingCount: warnings.length + (globalLevel !== 'ok' ? 1 : 0),
  };
}
