import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

type Sample = { t: number; path: string; method: string; ms: number; status: number };

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private samples: Sample[] = [];
  private readonly maxSamples = 4000;
  private lastBacklogAlertAt = 0;
  private readonly dataDir = join(process.cwd(), '.data', 'metrics');

  constructor(private prisma: PrismaService) {
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    } catch (_) {}
  }

  record(sample: Sample) {
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  private percentile(sorted: number[], p: number) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  latencySummary(windowMs = 15 * 60_000) {
    const since = Date.now() - windowMs;
    const rows = this.samples.filter((s) => s.t >= since);
    const ms = rows.map((s) => s.ms).sort((a, b) => a - b);
    const buckets = [
      { le: 50, count: 0 },
      { le: 100, count: 0 },
      { le: 200, count: 0 },
      { le: 500, count: 0 },
      { le: 1000, count: 0 },
      { le: 3000, count: 0 },
      { le: Infinity, count: 0 },
    ];
    for (const v of ms) {
      for (const b of buckets) {
        if (v <= b.le) {
          b.count++;
          break;
        }
      }
    }
    const byPath: Record<string, number[]> = {};
    for (const s of rows) {
      const key = `${s.method} ${s.path}`;
      if (!byPath[key]) byPath[key] = [];
      byPath[key].push(s.ms);
    }
    const slowest = Object.entries(byPath)
      .map(([path, arr]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return {
          path,
          count: arr.length,
          p50: this.percentile(sorted, 50),
          p95: this.percentile(sorted, 95),
        };
      })
      .sort((a, b) => (b.p95 || 0) - (a.p95 || 0))
      .slice(0, 12);

    const summary = {
      windowMs,
      count: ms.length,
      p50: this.percentile(ms, 50),
      p95: this.percentile(ms, 95),
      p99: this.percentile(ms, 99),
      max: ms.length ? ms[ms.length - 1] : null,
      histogram: buckets.map((b) => ({
        le: b.le === Infinity ? '+Inf' : b.le,
        count: b.count,
      })),
      slowest,
      updatedAt: new Date().toISOString(),
    };
    try {
      writeFileSync(join(this.dataDir, 'latency-latest.json'), JSON.stringify(summary, null, 2));
    } catch (_) {}
    return summary;
  }

  /** 队列积压：running/queued 超时或 failed 激增时写 JobLog + 文件告警 */
  async checkQueueBacklog(actor = 'system') {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [failed24h, running, recent] = await Promise.all([
      this.prisma.jobLog.count({ where: { status: 'failed', createdAt: { gte: since } } }),
      this.prisma.jobLog.count({ where: { status: { in: ['running', 'queued', 'pending'] } } }),
      this.prisma.jobLog.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, queue: true, jobName: true, status: true, message: true, createdAt: true },
      }),
    ]);
    const alert =
      failed24h >= 8 || running >= 20
        ? {
            level: failed24h >= 20 || running >= 40 ? 'critical' : 'warn',
            message:
              failed24h >= 8
                ? `过去 24 小时失败任务 ${failed24h} 条，请看任务队列与 SMTP/采集日志。`
                : `进行中/排队任务 ${running} 条偏多，可能卡住了。`,
          }
        : null;

    const snapshot = {
      ok: !alert || alert.level !== 'critical',
      failed24h,
      runningOrQueued: running,
      alert,
      recent,
      checkedAt: new Date().toISOString(),
    };

    try {
      writeFileSync(join(this.dataDir, 'queue-backlog.json'), JSON.stringify(snapshot, null, 2));
    } catch (_) {}

    const now = Date.now();
    if (alert && now - this.lastBacklogAlertAt > 10 * 60_000) {
      this.lastBacklogAlertAt = now;
      await this.prisma.jobLog.create({
        data: {
          queue: 'ops',
          jobName: 'queue_backlog_alert',
          status: alert.level === 'critical' ? 'failed' : 'warn',
          message: alert.message,
          payload: { failed24h, running, level: alert.level, actor } as any,
        },
      });
      this.logger.warn(`queue backlog alert: ${alert.message}`);
    }
    return snapshot;
  }

  readFileSnapshot(name: string) {
    try {
      const p = join(this.dataDir, name);
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  errorRateSummary(windowMs = 15 * 60_000) {
    const since = Date.now() - windowMs;
    const window = this.samples.filter((s) => s.t >= since);
    const err = window.filter((s) => s.status >= 500).length;
    const rate = window.length ? err / window.length : 0;
    return { windowMs, total: window.length, err5xx: err, rate: Math.round(rate * 10000) / 10000 };
  }

  matchEvalLatest() {
    return this.readFileSnapshot('match-eval-latest.json');
  }
}

