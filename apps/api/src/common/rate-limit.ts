/** 进程内简易限流：按 key 计数，适合单机运维台 + 公开邀请页 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec?: number; remaining: number; limit: number; resetAt: number } {
  const now = Date.now();
  let cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    cur = { count: 1, resetAt: now + windowMs };
    buckets.set(key, cur);
    return { ok: true, remaining: Math.max(0, limit - 1), limit, resetAt: cur.resetAt };
  }
  if (cur.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((cur.resetAt - now) / 1000),
      remaining: 0,
      limit,
      resetAt: cur.resetAt,
    };
  }
  cur.count += 1;
  return { ok: true, remaining: Math.max(0, limit - cur.count), limit, resetAt: cur.resetAt };
}

export function clientIp(req: { headers?: any; ip?: string; socket?: any }): string {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function rateLimitPolicy() {
  return {
    publicPerIpPerWindow: Number(process.env.RATE_LIMIT_PUBLIC || 60),
    authPerIpPerWindow: Number(process.env.RATE_LIMIT_AUTH || 300),
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    noteZh: '公开接口默认每 IP 每分钟 60；已登录/运营 300。超限返回 429 + Retry-After。健康探针不计入。',
  };
}
