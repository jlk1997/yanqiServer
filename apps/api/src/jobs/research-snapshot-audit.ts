/**
 * M49–M51：科研进行中 matchedOrgIds 快照审计
 * 记录谁在何时看见了哪个 job 的进行中快照（matchedOrgCount），便于合规抽查。
 * 持久化：.data/metrics/research-snapshot-audit.jsonl + 内存环
 * M50/M51：检索（q/jobId/actor/since/until）+ 保留天数修剪
 * M52：脱敏档 full|partner|public + 大表异步导出收集器
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

export type AuditRedactionTier = 'full' | 'partner' | 'public';

export type SnapshotAuditEntry = {
  id: string;
  at: string;
  actor: string;
  actorUid?: string | null;
  tenantId?: string | null;
  orgId?: string | null;
  jobId: string;
  matchedOrgCount: number;
  matchedOrgIdsSample?: string[];
  shell: string;
  wave: string;
};


export function normalizeAuditRedactionTier(raw?: string | null): AuditRedactionTier {
  const s = String(raw || 'full').trim().toLowerCase();
  if (s === 'partner' || s === 'partner-style') return 'partner';
  if (s === 'public' || s === 'public-style' || s === 'public_style') return 'public';
  return 'full';
}

function shortHash(v: string): string {
  return createHash('sha256').update(String(v)).digest('hex').slice(0, 10);
}

function maskActor(actor: string): string {
  const s = String(actor || '');
  if (!s) return '';
  if (s.includes('@')) {
    const [u, d] = s.split('@');
    const uu = u.slice(0, 1) + '***';
    const dd = d.length > 3 ? d.slice(0, 1) + '***' + d.slice(-2) : '***';
    return uu + '@' + dd;
  }
  if (s.length <= 2) return '*';
  return s.slice(0, 1) + '***' + s.slice(-1);
}

function bucketMatchedOrgCount(n: number): string {
  const x = Math.max(0, Number(n) || 0);
  if (x === 0) return '0';
  if (x <= 3) return '1-3';
  if (x <= 10) return '4-10';
  return '10+';
}

export function redactSnapshotAuditEntry(
  e: SnapshotAuditEntry,
  tier: AuditRedactionTier,
): Record<string, string | number> {
  if (tier === 'full') {
    return {
      id: e.id,
      at: e.at,
      actor: e.actor,
      actorUid: e.actorUid || '',
      tenantId: e.tenantId || '',
      orgId: e.orgId || '',
      jobId: e.jobId,
      matchedOrgCount: e.matchedOrgCount,
      matchedOrgIdsSample: (e.matchedOrgIdsSample || []).join('|'),
      shell: e.shell,
      wave: e.wave,
      redaction: 'full',
    };
  }
  if (tier === 'partner') {
    return {
      id: e.id,
      at: e.at,
      actor: maskActor(e.actor),
      actorUid: '',
      tenantId: e.tenantId ? shortHash(String(e.tenantId)) : '',
      orgId: e.orgId ? shortHash(String(e.orgId)) : '',
      jobId: String(e.jobId || '').slice(0, 8) + (String(e.jobId || '').length > 8 ? '…' : ''),
      matchedOrgCount: e.matchedOrgCount,
      matchedOrgIdsSample: '',
      shell: e.shell,
      wave: e.wave,
      redaction: 'partner',
    };
  }
  return {
    id: shortHash(e.id),
    at: String(e.at || '').slice(0, 10),
    actor: '',
    actorUid: '',
    tenantId: '',
    orgId: '',
    jobId: '',
    matchedOrgCount: bucketMatchedOrgCount(e.matchedOrgCount) as any,
    matchedOrgIdsSample: '',
    shell: e.shell === 'research' ? 'research' : 'other',
    wave: e.wave,
    redaction: 'public',
  };
}

export function buildResearchSnapshotAuditCsv(
  items: SnapshotAuditEntry[],
  redaction: AuditRedactionTier = 'full',
): { fileName: string; csv: string; count: number; redaction: AuditRedactionTier; tipZh: string } {
  const header = [
    'id',
    'at',
    'actor',
    'actorUid',
    'tenantId',
    'orgId',
    'jobId',
    'matchedOrgCount',
    'matchedOrgIdsSample',
    'shell',
    'wave',
    'redaction',
  ];
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const e of items) {
    const row = redactSnapshotAuditEntry(e, redaction);
    lines.push(header.map((h) => esc(row[h])).join(','));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    fileName: `research-snapshot-audit-${redaction}-${stamp}.csv`,
    csv: '\uFEFF' + lines.join('\n') + '\n',
    count: items.length,
    redaction,
    tipZh: `已导出 ${items.length} 条科研快照审计 CSV（脱敏档 ${redaction}）。`,
  };
}

/** M52：大表收集（扫 jsonl，上限可到 10 万） */
export function collectResearchSnapshotAuditsForExport(opts: {
  q?: string | null;
  jobId?: string | null;
  actor?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
}): {
  ok: true;
  wave: string;
  count: number;
  items: SnapshotAuditEntry[];
  retentionDays: number;
  noteZh: string;
} {
  try {
    pruneResearchSnapshotAudits();
  } catch (_) {}
  const n = Math.min(Math.max(Number(opts.limit) || 20000, 1), 100000);
  const q = String(opts.q || '').trim().toLowerCase();
  const jobId = String(opts.jobId || '').trim();
  const actor = String(opts.actor || '').trim().toLowerCase();
  const sinceMs = opts.since ? Date.parse(String(opts.since)) : NaN;
  const untilMs = opts.until ? Date.parse(String(opts.until)) : NaN;

  const pool: SnapshotAuditEntry[] = [];
  try {
    if (existsSync(LOG_FILE)) {
      const lines = readFileSync(LOG_FILE, 'utf8').trim().split(/\n+/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0 && pool.length < n * 2; i--) {
        try {
          pool.push(JSON.parse(lines[i]));
        } catch (_) {}
      }
    }
  } catch (_) {}
  if (!pool.length) {
    for (const e of ring) pool.push(e);
  }

  const items = pool
    .filter((e) => {
      if (jobId && String(e.jobId) !== jobId) return false;
      if (actor && !String(e.actor || '').toLowerCase().includes(actor)) return false;
      const t = Date.parse(e.at);
      if (Number.isFinite(sinceMs) && Number.isFinite(t) && t < sinceMs) return false;
      if (Number.isFinite(untilMs) && Number.isFinite(t) && t > untilMs) return false;
      if (q) {
        const hay = `${e.actor} ${e.jobId} ${e.tenantId || ''} ${e.orgId || ''} ${e.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .slice(0, n);

  return {
    ok: true,
    wave: 'M52',
    count: items.length,
    items,
    retentionDays: researchSnapshotRetentionDays(),
    noteZh: '大表导出收集器：扫 jsonl；配合异步任务与脱敏档。',
  };
}


const DATA_DIR = join(process.cwd(), '.data', 'metrics');
const LOG_FILE = join(DATA_DIR, 'research-snapshot-audit.jsonl');
const INDEX_FILE = join(DATA_DIR, 'research-snapshot-audit-latest.json');
const ring: SnapshotAuditEntry[] = [];
const MAX_RING = 500;
/** 同一 actor+job 在窗口内只记一次，避免刷屏 */
const dedupe = new Map<string, number>();
const DEDUPE_MS = Number(process.env.RESEARCH_SNAPSHOT_AUDIT_DEDUPE_MS || 60_000);

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function recordResearchSnapshotAudit(input: {
  actor: string;
  actorUid?: string | null;
  tenantId?: string | null;
  orgId?: string | null;
  jobId: string;
  matchedOrgCount: number;
  matchedOrgIds?: string[];
  shell?: string;
}): SnapshotAuditEntry | null {
  const jobId = String(input.jobId || '').slice(0, 120);
  if (!jobId) return null;
  const actor = String(input.actor || 'unknown').slice(0, 120);
  const key = `${actor}::${jobId}`;
  const now = Date.now();
  const last = dedupe.get(key) || 0;
  if (now - last < DEDUPE_MS) return null;
  dedupe.set(key, now);
  if (dedupe.size > 5000) {
    for (const [k, t] of dedupe) {
      if (now - t > DEDUPE_MS * 2) dedupe.delete(k);
    }
  }
  const entry: SnapshotAuditEntry = {
    id: `rsa_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date(now).toISOString(),
    actor,
    actorUid: input.actorUid || null,
    tenantId: input.tenantId || null,
    orgId: input.orgId || null,
    jobId,
    matchedOrgCount: Math.max(0, Number(input.matchedOrgCount) || 0),
    matchedOrgIdsSample: (input.matchedOrgIds || []).slice(0, 8).map(String),
    shell: input.shell || 'research',
    wave: 'M51',
  };
  ring.unshift(entry);
  if (ring.length > MAX_RING) ring.length = MAX_RING;
  try {
    ensureDir();
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
    writeFileSync(
      INDEX_FILE,
      JSON.stringify(
        {
          wave: 'M51',
          updatedAt: entry.at,
          latest: entry,
          recentCount: ring.length,
          noteZh: '科研壳看见进行中 matchedOrgIds 快照时的审计（同 actor+job 默认 60s 去重）。',
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (_) {}
  return entry;
}

export function listResearchSnapshotAudits(limit = 40): {
  ok: true;
  wave: string;
  count: number;
  items: SnapshotAuditEntry[];
  logFile: string;
  noteZh: string;
} {
  const n = Math.min(Math.max(Number(limit) || 40, 1), 200);
  let items = ring.slice(0, n);
  if (!items.length) {
    try {
      if (existsSync(LOG_FILE)) {
        const lines = readFileSync(LOG_FILE, 'utf8').trim().split(/\n+/).filter(Boolean);
        const parsed: SnapshotAuditEntry[] = [];
        for (let i = lines.length - 1; i >= 0 && parsed.length < n; i--) {
          try {
            parsed.push(JSON.parse(lines[i]));
          } catch (_) {}
        }
        items = parsed;
      }
    } catch (_) {}
  }
  return {
    ok: true,
    wave: 'M51',
    count: items.length,
    items,
    logFile: LOG_FILE,
    noteZh: 'who / when / jobId / matchedOrgCount；用于合规抽查，不是对外展示。',
  };
}

export function peekResearchSnapshotAuditStats() {
  return {
    wave: 'M51',
    ringSize: ring.length,
    logFile: LOG_FILE,
    dedupeWindowMs: DEDUPE_MS,
  };
}


function researchSnapshotRetentionDays(override?: number): number {
  if (Number.isFinite(Number(override)) && Number(override) >= 1) return Math.floor(Number(override));
  const n = Number(process.env.RESEARCH_SNAPSHOT_AUDIT_RETENTION_DAYS);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 90;
}

/** M50：按条件检索审计（内存环 + 必要时回扫 jsonl） */
export function searchResearchSnapshotAudits(opts: {
  q?: string | null;
  jobId?: string | null;
  actor?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
}): {
  ok: true;
  wave: string;
  count: number;
  items: SnapshotAuditEntry[];
  query: Record<string, string | null>;
  retentionDays: number;
  noteZh: string;
} {
  // 写前顺带修剪，避免无限涨
  try {
    pruneResearchSnapshotAudits();
  } catch (_) {}
  const n = Math.min(Math.max(Number(opts.limit) || 40, 1), 200);
  const q = String(opts.q || '').trim().toLowerCase();
  const jobId = String(opts.jobId || '').trim();
  const actor = String(opts.actor || '').trim().toLowerCase();
  const sinceMs = opts.since ? Date.parse(String(opts.since)) : NaN;
  const untilMs = opts.until ? Date.parse(String(opts.until)) : NaN;

  let pool = ring.slice();
  if (!pool.length) {
    try {
      if (existsSync(LOG_FILE)) {
        const lines = readFileSync(LOG_FILE, 'utf8').trim().split(/\n+/).filter(Boolean);
        const parsed: SnapshotAuditEntry[] = [];
        for (let i = lines.length - 1; i >= 0 && parsed.length < 1000; i--) {
          try {
            parsed.push(JSON.parse(lines[i]));
          } catch (_) {}
        }
        pool = parsed;
      }
    } catch (_) {}
  }

  const items = pool.filter((e) => {
    if (jobId && String(e.jobId) !== jobId) return false;
    if (actor && !String(e.actor || '').toLowerCase().includes(actor)) return false;
    const t = Date.parse(e.at);
    if (Number.isFinite(sinceMs) && Number.isFinite(t) && t < sinceMs) return false;
    if (Number.isFinite(untilMs) && Number.isFinite(t) && t > untilMs) return false;
    if (q) {
      const hay = `${e.actor} ${e.jobId} ${e.tenantId || ''} ${e.orgId || ''} ${e.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).slice(0, n);

  return {
    ok: true,
    wave: 'M51',
    count: items.length,
    items,
    query: {
      q: q || null,
      jobId: jobId || null,
      actor: actor || null,
      since: opts.since ? String(opts.since) : null,
      until: opts.until ? String(opts.until) : null,
    },
    retentionDays: researchSnapshotRetentionDays(),
    noteZh: '支持 q / jobId / actor / since / until；默认保留 90 天（RESEARCH_SNAPSHOT_AUDIT_RETENTION_DAYS）。',
  };
}

/** M50：按保留天数修剪 jsonl + 环 */
export function pruneResearchSnapshotAudits(retentionDays?: number) {
  const days = researchSnapshotRetentionDays(retentionDays);
  const cutoff = Date.now() - days * 86_400_000;
  let removedRing = 0;
  for (let i = ring.length - 1; i >= 0; i--) {
    const t = Date.parse(ring[i].at);
    if (Number.isFinite(t) && t < cutoff) {
      ring.splice(i, 1);
      removedRing += 1;
    }
  }
  let removedFile = 0;
  let kept = 0;
  try {
    ensureDir();
    if (existsSync(LOG_FILE)) {
      const lines = readFileSync(LOG_FILE, 'utf8').split(/\n/);
      const out: string[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          const t = Date.parse(e.at);
          if (Number.isFinite(t) && t < cutoff) {
            removedFile += 1;
            continue;
          }
          out.push(JSON.stringify(e));
          kept += 1;
        } catch (_) {
          // drop corrupt
          removedFile += 1;
        }
      }
      writeFileSync(LOG_FILE, out.length ? out.join('\n') + '\n' : '', 'utf8');
    }
  } catch (_) {}
  return {
    ok: true,
    wave: 'M51',
    retentionDays: days,
    cutoff: new Date(cutoff).toISOString(),
    removedRing,
    removedFile,
    kept,
    tipZh: `已按 ${days} 天保留策略修剪科研快照审计。`,
  };
}

/** M51/M52：审计 CSV（检索条件 + 脱敏档 full|partner|public） */
export function exportResearchSnapshotAuditsCsv(opts: {
  q?: string | null;
  jobId?: string | null;
  actor?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
  redaction?: string | null;
}): {
  ok: true;
  wave: string;
  fileName: string;
  csv: string;
  count: number;
  retentionDays: number;
  redaction: AuditRedactionTier;
  tipZh: string;
} {
  const redaction = normalizeAuditRedactionTier(opts.redaction);
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 5000);
  const collected = collectResearchSnapshotAuditsForExport({
    q: opts.q,
    jobId: opts.jobId,
    actor: opts.actor,
    since: opts.since,
    until: opts.until,
    limit,
  });
  const pack = buildResearchSnapshotAuditCsv(collected.items, redaction);
  return {
    ok: true,
    wave: 'M52',
    fileName: pack.fileName,
    csv: pack.csv,
    count: pack.count,
    retentionDays: collected.retentionDays,
    redaction,
    tipZh: `${pack.tipZh}保留策略 ${collected.retentionDays} 天仍生效。`,
  };
}
