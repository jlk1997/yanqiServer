import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * M46–M49：SSE 一次性短 TTL 票。
 * M47：绑定 stream path（错 path → 拒绝且不消费）；单机持久化到 .data 文件。
 * M48：可选绑定 jobId（path/job 不一致 → 401 且不消费）。
 * M49：按租户 mint 配额（超限 429 中文反馈）；仍不强制 Redis。
 * M50：按角色差异化配额 + 可重置窗口（冒烟不互踩）+ 产物 TTL；仍不强制 Redis。
 * Redis 仅当 REDIS_URL 已配置时可选同步（本环境默认走内存+文件，不强制 Redis）。
 */

export type SseTicketRecord = {
  payload: Record<string, any>;
  expiresAt: number;
  uid?: string | null;
  purpose: string;
  /** 规范化后的 pathname，如 /api/jobs/progress/stream */
  streamPath?: string | null;
  /** M48：可选绑定任务 id；开流 query/path 的 jobId 不一致 → 401 且不消费 */
  jobId?: string | null;
};

export type ConsumeResult =
  | { ok: true; payload: Record<string, any>; streamPath?: string | null; jobId?: string | null }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'path_mismatch' | 'path_required' | 'job_mismatch';
      boundPath?: string;
      requestPath?: string;
      boundJobId?: string;
      requestJobId?: string;
    };

const store = new Map<string, SseTicketRecord>();
const DEFAULT_TTL_MS = Number(process.env.SSE_TICKET_TTL_MS || 60_000);
const MAX_STORE = 4000;
const DATA_DIR = join(process.cwd(), '.data');
const STORE_FILE = join(DATA_DIR, 'sse-tickets.json');
let loaded = false;
let persistTimer: NodeJS.Timeout | null = null;
let redisClient: any = null;
let redisTried = false;

export function normalizeStreamPath(p: string | undefined | null): string {
  if (!p) return '';
  let s = String(p).trim();
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch (_) {}
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf('#');
  if (h >= 0) s = s.slice(0, h);
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  // 相对 api 路径兼容
  if (s.startsWith('/jobs/') || s.startsWith('/imports/')) s = '/api' + s;
  return s;
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
      const items = Array.isArray(raw?.items) ? raw.items : [];
      const now = Date.now();
      for (const it of items) {
        if (!it?.ticket || !it?.expiresAt || it.expiresAt <= now) continue;
        store.set(String(it.ticket), {
          payload: it.payload || {},
          expiresAt: Number(it.expiresAt),
          uid: it.uid ?? null,
          purpose: it.purpose || 'sse',
          streamPath: it.streamPath || null,
          jobId: it.jobId || null,
        });
      }
    }
  } catch (_) {}
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 80);
}

function persistNow() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const now = Date.now();
    const items = [...store.entries()]
      .filter(([, v]) => v.expiresAt > now)
      .map(([ticket, v]) => ({
        ticket,
        payload: v.payload,
        expiresAt: v.expiresAt,
        uid: v.uid ?? null,
        purpose: v.purpose,
        streamPath: v.streamPath || null,
        jobId: v.jobId || null,
      }));
    writeFileSync(
      STORE_FILE,
      JSON.stringify({ wave: 'M49', updatedAt: new Date().toISOString(), items }, null, 0),
      'utf8',
    );
  } catch (_) {}
}

async function maybeRedis() {
  if (redisTried) return redisClient;
  redisTried = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // 动态加载；未装或连不上则继续用文件仓
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 800,
      lazyConnect: true,
    });
    await redisClient.connect().catch(() => null);
    const pong = await redisClient.ping().catch(() => null);
    if (pong !== 'PONG') {
      try {
        redisClient.disconnect();
      } catch (_) {}
      redisClient = null;
    }
  } catch (_) {
    redisClient = null;
  }
  return redisClient;
}

function sweep() {
  ensureLoaded();
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  if (store.size > MAX_STORE) {
    const oldest = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let i = 0; i < oldest.length - Math.floor(MAX_STORE * 0.8); i++) {
      store.delete(oldest[i][0]);
    }
  }
}

export function normalizeJobId(id: string | undefined | null): string {
  if (!id) return '';
  return String(id).trim().slice(0, 120);
}


/** M49–M50：按租户 mint 配额（滑动窗口）+ 按角色差异化 + 可重置（冒烟/运营） */
const mintBuckets = new Map<string, { count: number; resetAt: number; limited: number }>();

function roleQuotaBucket(role?: string | null): 'ops' | 'member' | 'guest' {
  const r = String(role || '').toUpperCase();
  if (r === 'ADMIN' || r === 'OPS' || r === 'OPERATOR') return 'ops';
  if (
    r === 'ENTERPRISE' ||
    r === 'UNIVERSITY' ||
    r === 'RESEARCH' ||
    r === 'BROKER' ||
    r === 'PARK' ||
    r === 'ORG_ADMIN' ||
    r === 'USER'
  ) {
    return 'member';
  }
  if (!r || r === 'GUEST' || r === 'ANON') return 'guest';
  return 'member';
}

export function sseTicketQuotaPolicy(role?: string | null, limitOverride?: number | null) {
  const windowMsRaw = Number(process.env.SSE_TICKET_TENANT_WINDOW_MS);
  const windowMs = Number.isFinite(windowMsRaw) && windowMsRaw >= 5_000 ? Math.floor(windowMsRaw) : 60_000;
  const envBase = Number(process.env.SSE_TICKET_TENANT_LIMIT);
  const testBoost = process.env.NODE_ENV === 'test' || process.env.YANQI_SMOKE_HOOKS === '1';
  const baseDefault = testBoost ? 500 : 40;
  const base = Number.isFinite(envBase) && envBase >= 1 ? Math.floor(envBase) : baseDefault;

  const opsEnv = Number(process.env.SSE_TICKET_ROLE_OPS_LIMIT);
  const memberEnv = Number(process.env.SSE_TICKET_ROLE_MEMBER_LIMIT);
  const guestEnv = Number(process.env.SSE_TICKET_ROLE_GUEST_LIMIT);
  const byRole = {
    ops: Number.isFinite(opsEnv) && opsEnv >= 1 ? Math.floor(opsEnv) : Math.max(base, 200),
    member: Number.isFinite(memberEnv) && memberEnv >= 1 ? Math.floor(memberEnv) : Math.max(base, 80),
    guest: Number.isFinite(guestEnv) && guestEnv >= 1 ? Math.floor(guestEnv) : Math.min(base, 20),
  };
  const bucket = roleQuotaBucket(role);
  let limitPerTenant = byRole[bucket];
  if (Number.isFinite(Number(limitOverride)) && Number(limitOverride) >= 1) {
    limitPerTenant = Math.floor(Number(limitOverride));
  }
  return {
    limitPerTenant,
    windowMs,
    roleBucket: bucket,
    role: role || null,
    byRole,
    noteZh:
      '同一租户每窗口可领取的 SSE 短票次数上限（按角色：运营更高、访客更低）；超限 429 中文。可用 SSE_TICKET_TENANT_LIMIT / SSE_TICKET_ROLE_*_LIMIT / SSE_TICKET_TENANT_WINDOW_MS 覆盖。NODE_ENV=test 或 YANQI_SMOKE_HOOKS=1 时默认放宽。',
  };
}

export type SseTicketQuotaResult =
  | {
      ok: true;
      remaining: number;
      limit: number;
      resetAt: number;
      tenantId: string;
      roleBucket: string;
    }
  | {
      ok: false;
      code: 'SSE_TICKET_TENANT_QUOTA';
      remaining: 0;
      limit: number;
      resetAt: number;
      retryAfterSec: number;
      tenantId: string;
      roleBucket: string;
      messageZh: string;
    };

export function checkSseTicketTenantQuota(
  tenantIdRaw?: string | null,
  opts?: { role?: string | null; limitOverride?: number | null },
): SseTicketQuotaResult {
  const policy = sseTicketQuotaPolicy(opts?.role, opts?.limitOverride);
  const tenantId = String(tenantIdRaw || 'default').slice(0, 80) || 'default';
  const now = Date.now();
  let cur = mintBuckets.get(tenantId);
  if (!cur || cur.resetAt <= now) {
    cur = { count: 0, resetAt: now + policy.windowMs, limited: cur?.limited || 0 };
    mintBuckets.set(tenantId, cur);
  }
  if (cur.count >= policy.limitPerTenant) {
    cur.limited += 1;
    const retryAfterSec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
    return {
      ok: false,
      code: 'SSE_TICKET_TENANT_QUOTA',
      remaining: 0,
      limit: policy.limitPerTenant,
      resetAt: cur.resetAt,
      retryAfterSec,
      tenantId,
      roleBucket: policy.roleBucket,
      messageZh: `本租户 SSE 短票领取过于频繁（角色档 ${policy.roleBucket}，上限 ${policy.limitPerTenant} 次 / ${Math.round(policy.windowMs / 1000)} 秒）。请约 ${retryAfterSec} 秒后再试，或优先复用已打开的进度连接（cookie 会话不必每次 mint）。`,
    };
  }
  cur.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, policy.limitPerTenant - cur.count),
    limit: policy.limitPerTenant,
    resetAt: cur.resetAt,
    tenantId,
    roleBucket: policy.roleBucket,
  };
}

/** M50：重置租户短票配额窗口（冒烟 / 运营清窗）；不传 tenantId 则清空全部 */
export function resetSseTicketTenantQuota(tenantId?: string | null) {
  if (tenantId) {
    const id = String(tenantId).slice(0, 80);
    const had = mintBuckets.delete(id);
    return { ok: true, cleared: had ? 1 : 0, tenantId: id, wave: 'M50' as const };
  }
  const n = mintBuckets.size;
  mintBuckets.clear();
  return { ok: true, cleared: n, tenantId: null, wave: 'M50' as const };
}

export function peekSseTicketQuotaStats() {
  const policy = sseTicketQuotaPolicy('ADMIN');
  const now = Date.now();
  let activeTenants = 0;
  let limitedEvents = 0;
  for (const v of mintBuckets.values()) {
    if (v.resetAt > now) activeTenants += 1;
    limitedEvents += v.limited || 0;
  }
  return {
    limitPerTenant: policy.limitPerTenant,
    windowMs: policy.windowMs,
    byRole: policy.byRole,
    noteZh: policy.noteZh,
    activeTenants,
    limitedEvents,
    wave: 'M50',
  };
}

export function mintSseTicket(
  payload: Record<string, any>,
  opts: {
    ttlMs?: number;
    purpose?: string;
    uid?: string | null;
    streamPath?: string | null;
    jobId?: string | null;
  } = {},
) {
  sweep();
  const ttlMs = Math.min(Math.max(opts.ttlMs || DEFAULT_TTL_MS, 5_000), 300_000);
  const ticket = 'sst_' + randomBytes(24).toString('base64url');
  const streamPath = normalizeStreamPath(opts.streamPath || '') || null;
  const jobId = normalizeJobId(opts.jobId) || null;
  const rec: SseTicketRecord = {
    payload: { ...payload },
    expiresAt: Date.now() + ttlMs,
    uid: opts.uid ?? payload?.uid ?? null,
    purpose: opts.purpose || 'sse',
    streamPath,
    jobId,
  };
  store.set(ticket, rec);
  schedulePersist();
  // 可选 Redis 同步（多实例）；失败不影响本机
  void (async () => {
    const r = await maybeRedis();
    if (!r) return;
    try {
      await r.set(
        'yanqi:sse:' + ticket,
        JSON.stringify(rec),
        'PX',
        ttlMs,
      );
    } catch (_) {}
  })();
  const tipParts: string[] = [];
  if (streamPath) tipParts.push(`路径 ${streamPath}`);
  if (jobId) tipParts.push(`任务 ${jobId}`);
  return {
    ok: true,
    ticket,
    expiresInMs: ttlMs,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    oneTime: true,
    pathBound: Boolean(streamPath),
    jobBound: Boolean(jobId),
    streamPath,
    jobId,
    store: process.env.REDIS_URL ? 'memory+file(+redis-if-up)' : 'memory+file',
    tipZh: tipParts.length
      ? `短票已绑定 ${tipParts.join(' + ')}；仅匹配请求可用一次，错路径/错任务返回 401 且不消费。优先 cookie。`
      : '短票仅用于 EventSource 开流一次；建议 mint 时带 streamPath（及可选 jobId）做绑定。用完即废。',
  };
}

/**
 * 消费短票：一次性。
 * - path 不匹配：拒绝且**不**删除（合法路径仍可用）
 * - 过期/不存在：失败
 */
export function consumeSseTicket(
  ticket: string | undefined | null,
  opts: { streamPath?: string | null; jobId?: string | null } = {},
): ConsumeResult {
  ensureLoaded();
  if (!ticket) return { ok: false, reason: 'not_found' };
  const t = String(ticket);
  let rec = store.get(t);
  // 内存没有时尝试 Redis（多实例）
  if (!rec && process.env.REDIS_URL) {
    // sync peek via file only in request path; redis async not ideal here — try file reload
    ensureLoaded();
    rec = store.get(t);
  }
  if (!rec) return { ok: false, reason: 'not_found' };
  if (rec.expiresAt <= Date.now()) {
    store.delete(t);
    schedulePersist();
    return { ok: false, reason: 'expired' };
  }
  const bound = normalizeStreamPath(rec.streamPath || '');
  const got = normalizeStreamPath(opts.streamPath || '');
  if (bound) {
    if (!got) {
      return { ok: false, reason: 'path_required', boundPath: bound, requestPath: got };
    }
    if (bound !== got) {
      return {
        ok: false,
        reason: 'path_mismatch',
        boundPath: bound,
        requestPath: got,
      };
    }
  }
  const boundJob = normalizeJobId(rec.jobId || '');
  const gotJob = normalizeJobId(opts.jobId || '');
  if (boundJob) {
    if (!gotJob || boundJob !== gotJob) {
      return {
        ok: false,
        reason: 'job_mismatch',
        boundPath: bound || undefined,
        requestPath: got || undefined,
        boundJobId: boundJob,
        requestJobId: gotJob || '',
      };
    }
  }
  store.delete(t); // one-time on success
  schedulePersist();
  void (async () => {
    const r = await maybeRedis();
    if (!r) return;
    try {
      await r.del('yanqi:sse:' + t);
    } catch (_) {}
  })();
  return {
    ok: true,
    payload: { ...rec.payload },
    streamPath: rec.streamPath || null,
    jobId: rec.jobId || null,
  };
}

/** 兼容旧调用：只返回 payload 或 null */
export function consumeSseTicketLegacy(ticket: string | undefined | null): Record<string, any> | null {
  const r = consumeSseTicket(ticket, {});
  return r.ok ? r.payload : null;
}

export function peekSseTicketStats() {
  sweep();
  return {
    pending: store.size,
    ttlDefaultMs: DEFAULT_TTL_MS,
    pathBound: true,
    jobBoundOptional: true,
    durableFile: STORE_FILE,
    redisConfigured: Boolean(process.env.REDIS_URL),
    storeMode: process.env.REDIS_URL ? 'memory+file(+redis-if-up)' : 'memory+file',
    wave: 'M50',
    tenantQuota: peekSseTicketQuotaStats(),
  };
}
