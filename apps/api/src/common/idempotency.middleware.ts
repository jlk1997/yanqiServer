import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';

const CRITICAL_POST = [
  '/api/matches/run',
  '/api/brokers/assign',
  '/api/brokers/remind-overdue',
  '/api/feedback/matches',
  '/api/leads/', // approve-send paths vary
  '/api/auth/login',
  '/api/imports/',
  '/api/billing/checkout',
  '/api/billing/order',
  '/api/commissions/',
  '/api/park/',
  '/api/jobs/match',
  '/api/jobs/crawl',
];

function pathOf(req: Request) {
  return (req.originalUrl || req.url || req.path || '').split('?')[0];
}

function needsIdempotency(method: string, path: string) {
  if (method !== 'POST' && method !== 'PATCH') return false;
  if (path.startsWith('/api/feedback/matches/')) return true;
  if (path.startsWith('/api/brokers/attachments/')) return true;
  if (path.includes('/approve') || path.includes('/send')) return true;
  if (path.includes('/simulate-pay') || path.includes('/transition') || path.includes('/publish-case')) return true;
  if (path.includes('/status') && (path.startsWith('/api/park/') || path.startsWith('/api/commissions/'))) return true;
  return CRITICAL_POST.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));
}

/**
 * 幂等键：客户端传 Idempotency-Key；24h 内相同键+相同路径+相同体哈希则回放缓存响应。
 * 无键时不强制（兼容旧客户端），但响应头会提示建议。
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private dir = join(process.cwd(), '.data', 'idempotency');

  constructor() {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    } catch (_) {}
  }

  private purgeOld() {
    try {
      const now = Date.now();
      for (const f of readdirSync(this.dir)) {
        const full = join(this.dir, f);
        const st = statSync(full);
        if (now - st.mtimeMs > 24 * 3600_000) unlinkSync(full);
      }
    } catch (_) {}
  }

  use(req: Request, res: Response, next: NextFunction) {
    const path = pathOf(req);
    if (!needsIdempotency(req.method, path)) return next();

    const key = String(req.headers['idempotency-key'] || '').trim().slice(0, 128);
    res.setHeader('X-Idempotency-Required-Hint', 'recommended');
    if (!key) return next();

    this.purgeOld();
    const bodyHash = createHash('sha256')
      .update(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}))
      .digest('hex')
      .slice(0, 16);
    const fileKey = createHash('sha256').update(`${key}|${req.method}|${path}|${bodyHash}`).digest('hex');
    const file = join(this.dir, fileKey + '.json');

    if (existsSync(file)) {
      try {
        const cached = JSON.parse(readFileSync(file, 'utf8'));
        res.setHeader('X-Idempotency-Replayed', '1');
        res.status(cached.status || 200).json(cached.body);
        return;
      } catch (_) {
        /* fall through */
      }
    }

    const origJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      try {
        writeFileSync(
          file,
          JSON.stringify({
            status: res.statusCode || 200,
            body,
            key,
            path,
            at: new Date().toISOString(),
          }),
        );
      } catch (_) {}
      res.setHeader('X-Idempotency-Stored', '1');
      return origJson(body);
    };
    return next();
  }
}
