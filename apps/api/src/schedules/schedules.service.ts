import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { IngestService } from '../ingest/ingest.service';
import * as cron from 'node-cron';

@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private tasks = new Map<string, cron.ScheduledTask>();

  constructor(
    private prisma: PrismaService,
    private jobs: JobsService,
    private ingest: IngestService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaults();
    await this.ensureIngestSchedule();
    await this.reloadAll();
  }

  onModuleDestroy() {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }

  async ensureDefaults() {
    const count = await this.prisma.crawlSchedule.count();
    if (count > 0) return;
    await this.prisma.crawlSchedule.createMany({
      data: [
        {
          name: '高校 OpenAlex 周更',
          kind: 'openalex',
          cronExpr: '0 3 * * 1',
          enabled: true,
          payload: { batch: true },
          nextHint: '每周一 03:00 Asia/Shanghai（进程本地时区）',
        },
        {
          name: '企业 CSV 日检',
          kind: 'csv',
          cronExpr: '30 4 * * *',
          enabled: false,
          payload: {},
          nextHint: '默认关闭，放好 CSV 后再启用',
        },
        {
          name: '夜间自动匹配',
          kind: 'match',
          cronExpr: '0 2 * * *',
          enabled: true,
          payload: { minScore: 0.3 },
          nextHint: '每天 02:00',
        },
      ],
    });
  }

  async ensureIngestSchedule() {
    const existing = await this.prisma.crawlSchedule.findFirst({ where: { kind: 'ingest-clean' } });
    if (existing) return existing;
    return this.prisma.crawlSchedule.create({
      data: {
        name: '清洗后重判发布',
        kind: 'ingest-clean',
        cronExpr: '20 1 * * *',
        enabled: true,
        payload: {},
        nextHint: '每天 01:20 处理未解析草稿，并按发布规则重判',
      },
    });
  }

  list() {
    return this.prisma.crawlSchedule.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async reloadAll() {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
    const rows = await this.prisma.crawlSchedule.findMany({ where: { enabled: true } });
    for (const row of rows) {
      if (!cron.validate(row.cronExpr)) {
        console.warn('[schedule] 非法 cron', row.name, row.cronExpr);
        continue;
      }
      const task = cron.schedule(row.cronExpr, () => {
        this.runOne(row.id).catch((e) => console.error('[schedule]', row.name, e));
      });
      this.tasks.set(row.id, task);
    }
    console.log(`[schedule] 已挂载 ${this.tasks.size} 个定时任务`);
  }

  async upsert(data: {
    id?: string;
    name: string;
    kind: string;
    cronExpr: string;
    enabled?: boolean;
    payload?: any;
    nextHint?: string;
  }) {
    const row = data.id
      ? await this.prisma.crawlSchedule.update({
          where: { id: data.id },
          data: {
            name: data.name,
            kind: data.kind,
            cronExpr: data.cronExpr,
            enabled: data.enabled ?? true,
            payload: data.payload || {},
            nextHint: data.nextHint,
          },
        })
      : await this.prisma.crawlSchedule.create({
          data: {
            name: data.name,
            kind: data.kind,
            cronExpr: data.cronExpr,
            enabled: data.enabled ?? true,
            payload: data.payload || {},
            nextHint: data.nextHint,
          },
        });
    await this.reloadAll();
    return row;
  }

  async runOne(id: string) {
    const row = await this.prisma.crawlSchedule.findUnique({ where: { id } });
    if (!row) throw new Error('调度不存在');
    try {
      if (row.kind === 'openalex') {
        await this.jobs.enqueueCrawl('openalex', { ...(row.payload as any), batch: true });
      } else if (row.kind === 'csv') {
        await this.jobs.enqueueCrawl('csv', row.payload as any);
      } else if (row.kind === 'match') {
        await this.jobs.enqueueMatch(row.payload as any);
      } else if (row.kind === 'ingest-clean') {
        await this.ingest.runPending();
      } else {
        throw new Error('未知 kind');
      }
      return this.prisma.crawlSchedule.update({
        where: { id },
        data: { lastRunAt: new Date(), lastStatus: 'queued', lastMessage: '已入队' },
      });
    } catch (e: any) {
      await this.prisma.crawlSchedule.update({
        where: { id },
        data: { lastRunAt: new Date(), lastStatus: 'failed', lastMessage: e?.message || String(e) },
      });
      throw e;
    }
  }
}
