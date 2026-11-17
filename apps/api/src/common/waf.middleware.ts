import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { clientIp } from './rate-limit';

const SUSPICIOUS_UA =
  /(sqlmap|nikto|nmap|masscan|dirbuster|wfuzz|acunetix|nessus|burpsuite|curl\/7\.0|python-requests\/0\.|scrapy)/i;

/**
 * 轻量 WAF：请求体大小、可疑 UA 记日志、管理接口可选 IP 白名单。
 * 不是真 WAF，只做产品基线。
 */
@Injectable()
export class WafMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (!path.startsWith('/api')) return next();

    const maxBytes = Number(process.env.WAF_MAX_BODY_BYTES || 2_000_000);
    const cl = Number(req.headers['content-length'] || 0);
    if (cl > maxBytes) {
      throw new HttpException(
        { ok: false, message: `请求体过大（上限 ${maxBytes} 字节）` },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const ua = String(req.headers['user-agent'] || '');
    const ip = clientIp(req);
    if (ua && SUSPICIOUS_UA.test(ua)) {
      console.warn(`[waf] suspicious UA ip=${ip} path=${path} ua=${ua.slice(0, 160)}`);
      (req as any).wafSuspiciousUa = true;
      res.setHeader('X-Yanqi-WAF', 'ua-flagged');
    }

    const allow = (process.env.ADMIN_IP_ALLOWLIST || '').trim();
    if (allow) {
      const adminish =
        path.startsWith('/api/tenants') ||
        path.startsWith('/api/integrations') ||
        path.startsWith('/api/imports') ||
        path.startsWith('/api/billing/reconcile') ||
        path.startsWith('/api/billing/invoices') ||
        (path.startsWith('/api/stats') && (req.method || '').toUpperCase() === 'GET');
      const key = (req.headers['x-api-key'] as string) || '';
      const hasAdminKey = key && key === (process.env.ADMIN_API_KEY || 'yanqi-admin-demo-key');
      if (adminish && hasAdminKey) {
        const list = allow.split(/[,\s]+/).filter(Boolean);
        if (list.length && !list.includes(ip) && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
          throw new HttpException(
            { ok: false, message: '管理接口 IP 不在白名单' },
            HttpStatus.FORBIDDEN,
          );
        }
      }
    }

    return next();
  }
}
