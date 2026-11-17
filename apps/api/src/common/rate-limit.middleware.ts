import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { rateLimit, clientIp } from './rate-limit';

function pathOf(req: Request) {
  return (req.originalUrl || req.url || req.path || '').split('?')[0];
}

function isPublicApi(path: string) {
  if (
    path === '/api/health' ||
    path === '/api/health/live' ||
    path === '/api/health/ready' ||
    path === '/health' ||
    path === '/health/live' ||
    path === '/health/ready'
  )
    return true;
  if (path.startsWith('/api/public/')) return true;
  if (path.startsWith('/api/billing/webhook')) return true;
  if (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/register') ||
    path.startsWith('/api/auth/bootstrap')
  )
    return true;
  return false;
}

function isProbe(path: string) {
  return (
    path === '/api/health' ||
    path === '/api/health/live' ||
    path === '/api/health/ready' ||
    path === '/health' ||
    path === '/health/live' ||
    path === '/health/ready'
  );
}

/**
 * 全站公开接口限流；已登录接口也有更宽松的桶，防刷。
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = pathOf(req);
    if (!path.startsWith('/api') && !path.startsWith('/health')) return next();
    if (isProbe(path)) return next();

    const ip = clientIp(req);
    const publicHit = isPublicApi(path);
    const key = `${publicHit ? 'pub' : 'auth'}:${ip}:${path.split('/').slice(0, 4).join('/')}`;
    const limit = publicHit ? Number(process.env.RATE_LIMIT_PUBLIC || 60) : Number(process.env.RATE_LIMIT_AUTH || 300);
    const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
    const r = rateLimit(key, limit, windowMs);
    res.setHeader('X-RateLimit-Limit', String(r.limit));
    res.setHeader('X-RateLimit-Remaining', String(r.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(r.resetAt / 1000)));
    if (!r.ok) {
      res.setHeader('Retry-After', String(r.retryAfterSec || 60));
      throw new HttpException(
        {
          ok: false,
          message: '请求过于频繁，请稍后再试',
          retryAfterSec: r.retryAfterSec,
          limit: r.limit,
          hintZh: '公开接口默认每分钟 60 次；登录后更宽。可稍后重试或联系运维提高限额。',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return next();
  }
}
