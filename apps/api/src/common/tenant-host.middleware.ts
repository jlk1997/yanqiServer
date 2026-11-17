import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Host → 租户解析桩：
 * - 匹配 TenantBranding.customDomain
 * - 或子域 {code}.localhost / {code}.yanqi.local
 * 开发可用 /etc/hosts：127.0.0.1 demo.yanqi.local
 */
@Injectable()
export class TenantHostMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      const hostRaw = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
      const host = hostRaw.split(',')[0].trim().toLowerCase().split(':')[0];
      if (!host || host === '127.0.0.1' || host === 'localhost') {
        (req as any).resolvedTenantId = (req as any).resolvedTenantId || 'default';
        return next();
      }

      const byDomain = await this.prisma.tenantBranding.findFirst({
        where: { customDomain: host },
        select: { tenantId: true, productName: true, customDomain: true, domainStatus: true },
      });
      if (byDomain) {
        (req as any).resolvedTenantId = byDomain.tenantId;
        (req as any).resolvedBranding = byDomain;
        return next();
      }

      // 子域桩：xxx.yanqi.local / xxx.localhost
      const m = /^([a-z0-9_-]+)\.(yanqi\.local|localhost)$/.exec(host);
      if (m) {
        const code = m[1];
        if (code !== 'www' && code !== 'api') {
          const t = await this.prisma.tenant.findUnique({ where: { code } });
          if (t) {
            (req as any).resolvedTenantId = t.id;
            (req as any).resolvedTenantCode = t.code;
            return next();
          }
        }
      }
      (req as any).resolvedTenantId = 'default';
    } catch (_) {
      (req as any).resolvedTenantId = 'default';
    }
    return next();
  }
}
