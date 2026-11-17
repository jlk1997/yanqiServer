/**
 * M52–M54：科研快照审计异步大 CSV 导出
 * - 脱敏档：full | partner | public
 * - 进度 / 取消 / 就绪后下载（同冲突异步导出交互）
 * - M53：产物 TTL + 磁盘配额 + cleanup（对齐冲突导出异步生命周期）
 * - M54：按租户隔离目录 exports/.../async/tenants/<tenantId>/ + 租户级磁盘配额
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, resolve as pathResolve, sep } from 'path';
import { randomBytes } from 'crypto';
import {
  collectResearchSnapshotAuditsForExport,
  buildResearchSnapshotAuditCsv,
  normalizeAuditRedactionTier,
  type AuditRedactionTier,
} from './research-snapshot-audit';

export type AuditExportJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'done'
  | 'failed';

export type AuditExportJob = {
  exportId: string;
  redaction: AuditRedactionTier;
  status: AuditExportJobStatus;
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
  query?: Record<string, string | null>;
  downloadPath?: string | null;
  progressPath?: string | null;
  cancelPath?: string | null;
  wave: string;
};

const DATA_DIR = join(process.cwd(), '.data');
const STORE_FILE = join(DATA_DIR, 'research-snapshot-audit-export-jobs.json');
/** 根目录；M54 起正式产物落 tenants/<id>/；根下遗留文件仍可清理 */
const OUT_ROOT = join(process.cwd(), 'exports', 'research-snapshot-audits', 'async');
const TENANTS_ROOT = join(OUT_ROOT, 'tenants');
const jobs = new Map<string, AuditExportJob>();
let loaded = false;
let persistTimer: NodeJS.Timeout | null = null;

export function researchSnapshotAuditAsyncThreshold(): number {
  const n = Number(process.env.RESEARCH_SNAPSHOT_AUDIT_ASYNC_THRESHOLD);
  if (Number.isFinite(n) && n >= 50) return Math.floor(n);
  return 500;
}

/** M53：产物默认保留 24h */
export function researchSnapshotAuditExportTtlMs(): number {
  const n = Number(process.env.RESEARCH_SNAPSHOT_AUDIT_EXPORT_TTL_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.floor(n);
  return 24 * 60 * 60 * 1000;
}

/** M53：全局异步审计导出目录磁盘配额（默认 256MB，跨租户天花板） */
export function researchSnapshotAuditExportDiskQuotaBytes(): number {
  const n = Number(process.env.RESEARCH_SNAPSHOT_AUDIT_EXPORT_DISK_QUOTA_BYTES);
  if (Number.isFinite(n) && n >= 1_000_000) return Math.floor(n);
  return 256 * 1024 * 1024;
}

/** M54：单租户磁盘配额（默认 64MB） */
export function researchSnapshotAuditExportTenantDiskQuotaBytes(): number {
  const n = Number(process.env.RESEARCH_SNAPSHOT_AUDIT_EXPORT_TENANT_DISK_QUOTA_BYTES);
  if (Number.isFinite(n) && n >= 500_000) return Math.floor(n);
  return 64 * 1024 * 1024;
}

/** 路径安全租户段 */
export function sanitizeAuditTenantDir(tenantId?: string | null): string {
  const raw = String(tenantId || 'default').trim() || 'default';
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return safe || 'default';
}

export function tenantAuditExportDir(tenantId?: string | null): string {
  return join(TENANTS_ROOT, sanitizeAuditTenantDir(tenantId));
}

type AuditArtifactFile = { name: string; path: string; size: number; mtimeMs: number; tenantId: string };

function listFilesInDir(dir: string, tenantId: string): AuditArtifactFile[] {
  if (!existsSync(dir)) return [];
  const out: AuditArtifactFile[] = [];
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
function listAllAuditArtifactFiles(): AuditArtifactFile[] {
  ensureDirs();
  const out: AuditArtifactFile[] = [];
  for (const tid of listTenantIds()) {
    out.push(...listFilesInDir(join(TENANTS_ROOT, tid), tid));
  }
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

function markAuditJobArtifactCleared(filePath: string, reasonZh: string) {
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

function purgeAuditFiles(files: AuditArtifactFile[], reasonZh: string): { removed: number; freed: number } {
  let removed = 0;
  let freed = 0;
  for (const f of files) {
    try {
      unlinkSync(f.path);
      removed += 1;
      freed += f.size;
      markAuditJobArtifactCleared(f.path, reasonZh);
    } catch (_) {}
  }
  return { removed, freed };
}

/**
 * M53/M54：清理过期审计异步导出产物 + 按租户配额 + 全局配额（最旧优先删）
 */
export function cleanupResearchSnapshotAuditExportArtifacts(opts?: {
  force?: boolean;
  tenantId?: string | null;
}): {
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
  const ttlMs = researchSnapshotAuditExportTtlMs();
  const globalQuota = researchSnapshotAuditExportDiskQuotaBytes();
  const tenantQuota = researchSnapshotAuditExportTenantDiskQuotaBytes();
  const now = Date.now();
  let removed = 0;
  let freed = 0;
  const tenantFocus = opts?.tenantId ? sanitizeAuditTenantDir(opts.tenantId) : null;
  const byTenantMap = new Map<string, { tenantId: string; bytes: number; files: number; removed: number }>();

  const bumpTenant = (tid: string, patch: Partial<{ bytes: number; files: number; removed: number }>) => {
    const cur = byTenantMap.get(tid) || { tenantId: tid, bytes: 0, files: 0, removed: 0 };
    if (patch.bytes != null) cur.bytes = patch.bytes;
    if (patch.files != null) cur.files = patch.files;
    if (patch.removed != null) cur.removed += patch.removed;
    byTenantMap.set(tid, cur);
  };

  const all = listAllAuditArtifactFiles().filter((f) => !tenantFocus || f.tenantId === tenantFocus);
  const expired = all.filter((f) => now - f.mtimeMs > ttlMs);
  const ttlPurge = purgeAuditFiles(expired, '（产物已按 TTL 清理）');
  removed += ttlPurge.removed;
  freed += ttlPurge.freed;
  for (const f of expired) bumpTenant(f.tenantId, { removed: 1 });

  const tenantIds = tenantFocus
    ? [tenantFocus]
    : [...new Set(listAllAuditArtifactFiles().map((f) => f.tenantId))];
  for (const tid of tenantIds) {
    let remain = listAllAuditArtifactFiles()
      .filter((f) => f.tenantId === tid)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = remain.reduce((s, f) => s + f.size, 0);
    const toDrop: AuditArtifactFile[] = [];
    for (const f of remain) {
      if (total <= tenantQuota) break;
      toDrop.push(f);
      total -= f.size;
    }
    if (toDrop.length) {
      const p = purgeAuditFiles(toDrop, '（产物已按租户磁盘配额清理）');
      removed += p.removed;
      freed += p.freed;
      bumpTenant(tid, { removed: p.removed });
    }
    remain = listAllAuditArtifactFiles().filter((f) => f.tenantId === tid);
    bumpTenant(tid, {
      bytes: remain.reduce((s, f) => s + f.size, 0),
      files: remain.length,
    });
  }

  let remainAll = listAllAuditArtifactFiles()
    .filter((f) => !tenantFocus || f.tenantId === tenantFocus)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let globalTotal = remainAll.reduce((s, f) => s + f.size, 0);
  const globalDrop: AuditArtifactFile[] = [];
  for (const f of remainAll) {
    if (globalTotal <= globalQuota) break;
    globalDrop.push(f);
    globalTotal -= f.size;
  }
  if (globalDrop.length) {
    const p = purgeAuditFiles(globalDrop, '（产物已按全局磁盘配额清理）');
    removed += p.removed;
    freed += p.freed;
    for (const f of globalDrop) bumpTenant(f.tenantId, { removed: 1 });
  }

  remainAll = listAllAuditArtifactFiles().filter((f) => !tenantFocus || f.tenantId === tenantFocus);
  globalTotal = remainAll.reduce((s, f) => s + f.size, 0);
  const grouped = new Map<string, AuditArtifactFile[]>();
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
    wave: 'M54',
    removed,
    freedBytes: freed,
    kept: remainAll.length,
    totalBytes: globalTotal,
    ttlMs,
    quotaBytes: globalQuota,
    tenantQuotaBytes: tenantQuota,
    byTenant,
    tipZh: `异步审计导出产物（按租户隔离 · M54）：TTL ${Math.round(ttlMs / 3600000)}h，租户配额 ${Math.round(tenantQuota / 1048576)}MB，全局天花板 ${Math.round(globalQuota / 1048576)}MB；本次删除 ${removed} 个、释放 ${Math.round(freed / 1024)}KB。`,
  };
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
          it.errorZh = '服务重启，异步审计导出中断，请重新发起';
          it.phaseZh = '已中断';
          it.percent = Math.min(99, Number(it.percent) || 0);
          it.finishedAt = new Date().toISOString();
        }
        jobs.set(String(it.exportId), it as AuditExportJob);
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
        JSON.stringify({ wave: 'M54', updatedAt: new Date().toISOString(), items }, null, 0),
        'utf8',
      );
    } catch (_) {}
  }, 60);
}

function touch(job: AuditExportJob, patch: Partial<AuditExportJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  schedulePersist();
}

export function getAuditExportJob(exportId: string): AuditExportJob | null {
  ensureLoaded();
  return jobs.get(String(exportId)) || null;
}

export function listAuditExportJobs(limit = 20): AuditExportJob[] {
  ensureLoaded();
  return [...jobs.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

export function cancelAuditExportJob(exportId: string) {
  ensureLoaded();
  const job = jobs.get(String(exportId));
  if (!job) return { ok: false, messageZh: '找不到异步审计导出任务', exportId };
  if (job.status === 'done' || job.status === 'cancelled' || job.status === 'failed') {
    return { ok: true, exportId, status: job.status, summaryZh: '任务已结束，无需取消', job };
  }
  job.cancelRequested = true;
  touch(job, { status: 'cancelling', phaseZh: '取消中', messageZh: '已请求取消，当前批次写完即停' });
  return {
    ok: true,
    exportId,
    status: 'cancelling',
    summaryZh: '已请求取消异步审计导出：当前批次写完就停，不会再生成下载文件。',
    job,
  };
}

export function auditExportJobProgress(exportId: string) {
  ensureLoaded();
  const job = jobs.get(String(exportId));
  if (!job) {
    return {
      ok: false,
      empty: true,
      bannerZh: '找不到异步审计导出任务',
      hintZh: '请重新发起异步导出',
      waiting: false,
    };
  }
  const waiting = job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';
  return {
    ok: true,
    empty: false,
    waiting,
    percent: job.percent,
    status: job.status,
    phaseZh: job.phaseZh,
    bannerZh: job.messageZh,
    hintZh: waiting
      ? '大表审计在后台脱敏生成，可取消；完成后点下载。'
      : job.status === 'done'
        ? '已就绪，可下载。'
        : job.errorZh || '',
    exportedRows: job.exportedRows,
    totalRows: job.totalRows,
    redaction: job.redaction,
    tenantId: job.tenantId || 'default',
    downloadPath: job.status === 'done' ? job.downloadPath : null,
    cancelPath: waiting ? job.cancelPath : null,
    exportId: job.exportId,
    wave: 'M54',
    job,
  };
}

export function startResearchSnapshotAuditExportAsync(opts: {
  redaction?: string | null;
  q?: string | null;
  jobId?: string | null;
  actor?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
  actorName?: string | null;
  tenantId?: string | null;
}): { ok: boolean; messageZh?: string; job?: AuditExportJob } {
  ensureLoaded();
  const redaction = normalizeAuditRedactionTier(opts.redaction);
  const tenantId = sanitizeAuditTenantDir(opts.tenantId);
  const exportId = 'rsaex_' + randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const base = `/api/jobs/research-snapshot-audits/export/jobs/${exportId}`;
  const limit = Math.min(Math.max(Number(opts.limit) || 20000, 1), 100000);
  const job: AuditExportJob = {
    exportId,
    redaction,
    status: 'queued',
    cancelRequested: false,
    percent: 0,
    phaseZh: '排队中',
    messageZh: `异步审计导出已入队（脱敏档 ${redaction} · 租户 ${tenantId}）`,
    exportedRows: 0,
    totalRows: 0,
    fileName: null,
    filePath: null,
    bytes: null,
    errorZh: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    actor: opts.actorName || null,
    tenantId,
    query: {
      q: opts.q ? String(opts.q) : null,
      jobId: opts.jobId ? String(opts.jobId) : null,
      actor: opts.actor ? String(opts.actor) : null,
      since: opts.since ? String(opts.since) : null,
      until: opts.until ? String(opts.until) : null,
      redaction,
      tenantId,
    },
    downloadPath: `${base}/download`,
    progressPath: base,
    cancelPath: `${base}/cancel`,
    wave: 'M54',
  };
  jobs.set(exportId, job);
  schedulePersist();

  void (async () => {
    try {
      touch(job, {
        status: 'running',
        phaseZh: '扫描审计',
        percent: 5,
        messageZh: `正在按条件收集审计（${redaction} · ${tenantId}）…`,
      });
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
      const collected = collectResearchSnapshotAuditsForExport({
        q: opts.q,
        jobId: opts.jobId,
        actor: opts.actor,
        since: opts.since,
        until: opts.until,
        limit,
      });
      const items = collected.items;
      job.totalRows = items.length;
      touch(job, {
        percent: 20,
        phaseZh: '脱敏写入',
        messageZh: `共 ${items.length} 条，正在按 ${redaction} 档生成 CSV…`,
        exportedRows: 0,
      });

      const chunk = Math.max(1, Math.floor(items.length / 25) || 1);
      for (let i = 0; i < items.length; i += chunk) {
        if (job.cancelRequested) {
          touch(job, {
            status: 'cancelled',
            phaseZh: '已取消',
            messageZh: '用户取消，未生成下载文件',
            finishedAt: new Date().toISOString(),
            percent: Math.min(90, 20 + Math.round((i / Math.max(items.length, 1)) * 70)),
          });
          return;
        }
        job.exportedRows = Math.min(items.length, i + chunk);
        const pct = 20 + Math.round((job.exportedRows / Math.max(items.length, 1)) * 70);
        touch(job, {
          percent: Math.min(90, pct),
          exportedRows: job.exportedRows,
          messageZh: `已处理 ${job.exportedRows}/${items.length} 条…`,
        });
        await new Promise((r) => setTimeout(r, 6));
      }

      if (job.cancelRequested) {
        touch(job, {
          status: 'cancelled',
          phaseZh: '已取消',
          messageZh: '用户取消',
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      ensureDirs();
      cleanupResearchSnapshotAuditExportArtifacts({ tenantId });
      const pack = buildResearchSnapshotAuditCsv(items, redaction);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `research-snapshot-audit-async-${redaction}-${stamp}.csv`;
      const tenantDir = tenantAuditExportDir(tenantId);
      if (!existsSync(tenantDir)) mkdirSync(tenantDir, { recursive: true });
      const filePath = join(tenantDir, fileName);
      writeFileSync(filePath, pack.csv, 'utf8');
      cleanupResearchSnapshotAuditExportArtifacts({ tenantId });
      const bytes = Buffer.byteLength(pack.csv, 'utf8');
      touch(job, {
        status: 'done',
        percent: 100,
        phaseZh: '已完成',
        messageZh: `异步审计 CSV 就绪：${items.length} 条 · 脱敏 ${redaction} · 租户 ${tenantId}`,
        exportedRows: items.length,
        fileName,
        filePath,
        bytes,
        finishedAt: new Date().toISOString(),
        downloadPath: `/api/jobs/research-snapshot-audits/export/jobs/${exportId}/download`,
      });
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
    messageZh: `异步审计导出已启动（脱敏档 ${redaction} · 租户 ${tenantId}），请看进度；完成后可下载。`,
    job,
  };
}

export function resolveAuditExportDownload(exportId: string): {
  ok: boolean;
  messageZh?: string;
  job?: AuditExportJob;
  filePath?: string;
  fileName?: string;
} {
  ensureLoaded();
  const job = jobs.get(String(exportId));
  if (!job) return { ok: false, messageZh: '找不到异步审计导出任务' };
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
  return { ok: true, job, filePath: resolved, fileName: job.fileName || 'research-snapshot-audit-async.csv' };
}

export function peekAuditExportAsyncStats() {
  ensureLoaded();
  const byStatus: Record<string, number> = {};
  for (const j of jobs.values()) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  }
  const artifacts = listAllAuditArtifactFiles();
  const byTenant: Record<string, { files: number; bytes: number }> = {};
  for (const f of artifacts) {
    const cur = byTenant[f.tenantId] || { files: 0, bytes: 0 };
    cur.files += 1;
    cur.bytes += f.size;
    byTenant[f.tenantId] = cur;
  }
  return {
    wave: 'M54',
    pending: [...jobs.values()].filter((j) =>
      ['queued', 'running', 'cancelling'].includes(j.status),
    ).length,
    totalTracked: jobs.size,
    byStatus,
    threshold: researchSnapshotAuditAsyncThreshold(),
    outRoot: OUT_ROOT,
    tenantsRoot: TENANTS_ROOT,
    tenantIsolation: true,
    redactionTiers: ['full', 'partner', 'public'],
    artifactFiles: artifacts.length,
    artifactBytes: artifacts.reduce((s, f) => s + f.size, 0),
    byTenant,
    ttlMs: researchSnapshotAuditExportTtlMs(),
    quotaBytes: researchSnapshotAuditExportDiskQuotaBytes(),
    tenantQuotaBytes: researchSnapshotAuditExportTenantDiskQuotaBytes(),
    ttlHours: Math.round(researchSnapshotAuditExportTtlMs() / 3600000),
    quotaMb: Math.round(researchSnapshotAuditExportDiskQuotaBytes() / 1048576),
    tenantQuotaMb: Math.round(researchSnapshotAuditExportTenantDiskQuotaBytes() / 1048576),
  };
}
