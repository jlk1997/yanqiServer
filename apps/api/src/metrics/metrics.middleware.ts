import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

function normalizePath(raw: string) {
  const path = (raw || '').split('?')[0] || '/';
  return path
    .replace(/\/[a-z0-9]{20,}/gi, '/:id')
    .replace(/\/cm[a-z0-9]{20,}/gi, '/:id')
    .slice(0, 120);
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    res.on('finish', () => {
      const path = normalizePath(req.originalUrl || req.url || '');
      if (!path.startsWith('/api')) return;
      if (path.startsWith('/api/metrics')) return;
      this.metrics.record({
        t: Date.now(),
        path,
        method: (req.method || 'GET').toUpperCase(),
        ms: Date.now() - start,
        status: res.statusCode,
      });
    });
    next();
  }
}
