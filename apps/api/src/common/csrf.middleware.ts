import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes } from 'crypto';

/**
 * Cookie 会话的轻量 CSRF：对会改状态的请求，要求 Header X-Yanqi-CSRF
 * 与 cookie yanqi_csrf 一致。纯 API Key / Bearer 无 cookie 时跳过。
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const method = (req.method || 'GET').toUpperCase();
    const cookie = req.headers.cookie || '';
    const hasTokenCookie = /yanqi_token=/.test(cookie);
    const m = /yanqi_csrf=([^;]+)/.exec(cookie);
    let csrf = m ? decodeURIComponent(m[1]) : '';

    if (!csrf) {
      csrf = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 32);
      res.append(
        'Set-Cookie',
        `yanqi_csrf=${encodeURIComponent(csrf)}; Path=/; SameSite=Lax`,
      );
    }

    // 读请求不校验
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    // 无 cookie 会话（纯 API Key / Bearer）不强制
    if (!hasTokenCookie) return next();

    // webhook / 公开注册登录：登录本身会设 cookie，注册登录放行
    const path = (req.originalUrl || '').split('?')[0];
    if (
      path.startsWith('/api/auth/login') ||
      path.startsWith('/api/auth/register') ||
      path.startsWith('/api/auth/bootstrap') ||
      path.startsWith('/api/billing/webhook')
    ) {
      return next();
    }

    const header = (req.headers['x-yanqi-csrf'] as string) || '';
    if (!header || header !== csrf) {
      // 兼容：运维台若尚未带 header，第一次写请求返回明确错误，前端可重试
      if (process.env.CSRF_STRICT === '1') {
        throw new ForbiddenException('缺少或错误的 X-Yanqi-CSRF（cookie 会话需带同源 CSRF）');
      }
      // 默认宽松：只打头，不拦（演示环境）；设 CSRF_STRICT=1 才硬拦
      res.setHeader('X-Yanqi-CSRF-Required', '1');
    }
    return next();
  }
}
