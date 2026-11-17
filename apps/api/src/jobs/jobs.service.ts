import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import { listAnomalyChainResumeCards } from '../workbench/anomaly-chain-job';
import { spawn } from 'child_process';
import { join } from 'path';
import { recordResearchSnapshotAudit } from './research-snapshot-audit';

type QueueBackend = 'bullmq' | 'inline';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private inlineQueue: Array<{ id: string; run: () => Promise<void>; cancel: boolean; kind: string }> = [];
  private inlineRunning = false;
  private backend: QueueBackend = 'inline';
  private matchQueue: any = null;
  private crawlQueue: any = null;
  private matchWorker: any = null;
  private crawlWorker: any = null;
  private connection: any = null;
  /** M42/M43：进行中/排队任务可取消 + 细粒度进度 */
  private liveJobs = new Map<
    string,
    {
      cancel: boolean;
      /** M76：分项取消 */
      cancelEmbed?: boolean;
      cancelScore?: boolean;
      cancelScope?: 'all' | 'embed' | 'score' | null;
      status: string;
      kind: string;
      percent?: number;
      bannerZh?: string;
      hintZh?: string;
      step?: string;
      batchIndex?: number;
      batchTotal?: number;
      phase?: string;
      /** M44 */
      remainingDemandIds?: string[];
      processedDemandIds?: string[];
      resumeAvailable?: boolean;
      phaseZh?: string;
      /** M48：进行中匹配触及的供给机构快照 */
      matchedOrgIds?: string[];
      /** M60：统一打分+预热任务卡 */
      prewarmQueueId?: string | null;
      prewarmResumeAvailable?: boolean;
      scoreResumeAvailable?: boolean;
      unifiedPhase?: string | null;
      onePagerPrewarm?: any;
      /** M76：分项中文进度 */
      itemizedPhases?: any[];
      cancelScopesAvailable?: string[];
      /** M77：细取消后续跑游标切分 */
      resumeCursors?: any;
      itemizedPhasesSse?: boolean;
    }
  >();

  constructor(
    private prisma: PrismaService,
    private matches: MatchesService,
  ) {}

  async onModuleInit() {
    await this.tryInitBullMQ();
  }

  async onModuleDestroy() {
    try {
      await this.matchWorker?.close?.();
      await this.crawlWorker?.close?.();
      await this.matchQueue?.close?.();
      await this.crawlQueue?.close?.();
      await this.connection?.quit?.();
    } catch (_) {}
  }

  private async tryInitBullMQ() {
    const url = process.env.REDIS_URL;
    if (!url) {
      console.log('[jobs] 未配置 REDIS_URL，使用进程内队列');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IORedis = require('ioredis');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Queue, Worker } = require('bullmq');
      const connection = new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 1500,
        retryStrategy: () => null,
      });
      await connection.connect();
      await connection.ping();
      this.connection = connection;
      const prefix = process.env.BULLMQ_PREFIX || 'yanqi';
      this.matchQueue = new Queue('yanqi-match', { connection, prefix });
      this.crawlQueue = new Queue('yanqi-crawl', { connection, prefix });
      this.matchWorker = new Worker(
        'yanqi-match',
        async (job: any) => {
          const data = job.data || {};
          const jobLogId = data._jobLogId || String(job.id || '');
          if (jobLogId && !this.liveJobs.has(jobLogId)) {
            this.liveJobs.set(jobLogId, {
              cancel: false,
              status: 'running',
              kind: 'match',
              percent: 10,
              bannerZh: '匹配执行中…',
            });
          }
          const result = await this.matches.runMatch({
            ...data,
            jobLogId,
            cancelCheck: () => Boolean(this.liveJobs.get(jobLogId)?.cancel),
            cancelScopes: () => {
              const L = this.liveJobs.get(jobLogId);
              return {
                all: Boolean(L?.cancel),
                embed: Boolean(L?.cancelEmbed || L?.cancel),
                score: Boolean(L?.cancelScore || L?.cancel),
              };
            },
            onProgress: async (p: any) => {
              const L = this.liveJobs.get(jobLogId);
              if (!L) return;
              if (typeof p.percent === 'number') L.percent = p.percent;
              if (p.bannerZh) L.bannerZh = p.bannerZh;
              if (p.hintZh) L.hintZh = p.hintZh;
              if (p.step) L.step = p.step;
              if (Array.isArray((p as any).itemizedPhases)) L.itemizedPhases = (p as any).itemizedPhases;
              if (Array.isArray((p as any).cancelScopesAvailable))
                L.cancelScopesAvailable = (p as any).cancelScopesAvailable;
              if (p.phase) {
                L.phase = p.phase;
                const zh: Record<string, string> = {
                  prepare: '准备中',
                  demand: '匹配需求',
                  write: '写入结果',
                  cancelled: '已取消',
                  done: '已完成',
                };
                L.phaseZh = zh[p.phase] || p.phase;
              }
              if (typeof p.demandIndex === 'number') L.batchIndex = p.demandIndex;
              if (typeof p.demandTotal === 'number') L.batchTotal = p.demandTotal;
              if (Array.isArray((p as any).matchedOrgIds)) {
                L.matchedOrgIds = Array.from(new Set<string>((p as any).matchedOrgIds.map((x: any) => String(x))));
              }
              if (p.cancelled) {
                L.status = 'cancelled';
                L.cancel = true;
              } else if (L.status !== 'cancelling' && L.status !== 'cancelled') {
                L.status = 'running';
              }
            },
          });
          if ((result as any)?.cancelled || (result as any)?.prewarmResumeAvailable || (result as any)?.onePagerPrewarm?.resumeAvailable) {
            const L = this.liveJobs.get(jobLogId);
            const remaining = Array.isArray((result as any)?.remainingDemandIds)
              ? (result as any).remainingDemandIds
              : [];
            const processed = Array.isArray((result as any)?.processedDemandIds)
              ? (result as any).processedDemandIds
              : [];
            const matchedOrgs = Array.isArray((result as any)?.matchedOrgIds)
              ? (result as any).matchedOrgIds.map(String)
              : L?.matchedOrgIds || [];
            const pw = (result as any)?.onePagerPrewarm || null;
            const scoreResume = Boolean((result as any)?.scoreResumeAvailable) || remaining.length > 0;
            const prewarmResume =
              Boolean((result as any)?.prewarmResumeAvailable) || Boolean(pw?.resumeAvailable);
            const unifiedResume = scoreResume || prewarmResume;
            const cancelled = Boolean((result as any)?.cancelled);
            if (L) {
              L.cancel = cancelled;
              L.status = cancelled || prewarmResume ? 'cancelled' : 'done';
              L.remainingDemandIds = remaining;
              L.processedDemandIds = processed;
              L.resumeAvailable = unifiedResume;
              L.scoreResumeAvailable = scoreResume;
              L.prewarmResumeAvailable = prewarmResume;
              L.prewarmQueueId = pw?.queueId || null;
              L.unifiedPhase = (result as any)?.unifiedPhase || null;
              L.onePagerPrewarm = pw;
              L.matchedOrgIds = matchedOrgs;
              L.resumeCursors = (result as any)?.resumeCursors || null;
              L.itemizedPhasesSse = true;
              L.bannerZh = L.bannerZh || (result as any)?.summaryZh || (cancelled ? '匹配已取消' : '匹配完成');
              L.phase = cancelled ? 'cancelled' : prewarmResume ? 'prewarm' : 'done';
              L.phaseZh = cancelled ? '已取消' : prewarmResume ? '预热可续' : '已完成';
            }
            if (jobLogId) {
              await this.prisma.jobLog
                .update({
                  where: { id: jobLogId },
                  data: {
                    status: cancelled || prewarmResume ? 'cancelled' : 'done',
                    message: (result as any)?.summaryZh || `已取消 · 剩余需求 ${remaining.length}`,
                    payload: {
                      ...(data || {}),
                      cancelled,
                      remainingDemandIds: remaining,
                      processedDemandIds: processed,
                      resumeAvailable: unifiedResume,
                      scoreResumeAvailable: scoreResume,
                      prewarmResumeAvailable: prewarmResume,
                      resumeCursors: (result as any)?.resumeCursors || null,
                      itemizedPhasesSse: true,
                      prewarmQueueId: pw?.queueId || null,
                      onePagerPrewarm: pw,
                      unifiedJobCard: true,
                      matchedOrgIds: matchedOrgs,
                      wave: 'M77',
                    } as any,
                  },
                })
                .catch(() => null);
            }
          }
        },
        { connection, prefix, concurrency: 1 },
      );
      this.crawlWorker = new Worker(
        'yanqi-crawl',
        async (job: any) => {
          await this.runCrawlScript(job.data?.kind || 'openalex', job.data || {});
        },
        { connection, prefix, concurrency: 1 },
      );
      this.matchWorker.on('failed', (job: any, err: Error) =>
        console.error('[bullmq match failed]', job?.id, err?.message),
      );
      this.crawlWorker.on('failed', (job: any, err: Error) =>
        console.error('[bullmq crawl failed]', job?.id, err?.message),
      );
      this.backend = 'bullmq';
      console.log('[jobs] BullMQ 已启用（REDIS_URL 可用）');
    } catch (e: any) {
      console.warn('[jobs] Redis/BullMQ 不可用，回退进程内队列：', e?.message || e);
      try {
        await this.connection?.quit?.();
      } catch (_) {}
      this.connection = null;
      this.backend = 'inline';
    }
  }

  status() {
    return {
      backend: this.backend,
      redisUrlConfigured: Boolean(process.env.REDIS_URL),
      inlineQueued: this.inlineQueue.length,
    };
  }

  list(tenantId?: string) {
    return this.prisma.jobLog.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async pumpInline() {
    if (this.inlineRunning) return;
    this.inlineRunning = true;
    while (this.inlineQueue.length) {
      const job = this.inlineQueue.shift()!;
      const live = this.liveJobs.get(job.id);
      if (job.cancel || live?.cancel) {
        await this.prisma.jobLog
          .update({
            where: { id: job.id },
            data: { status: 'cancelled', message: '已取消：排队中被停下，未执行' },
          })
          .catch(() => null);
        if (live) {
          live.status = 'cancelled';
          live.bannerZh = '已取消（未执行）';
          live.percent = 100;
        }
        continue;
      }
      if (live) {
        live.status = 'running';
        live.percent = 40;
        live.bannerZh = `正在执行「${job.kind}」…`;
      }
      await this.prisma.jobLog
        .update({ where: { id: job.id }, data: { status: 'running', message: '执行中' } })
        .catch(() => null);
      try {
        await job.run();
        const after = this.liveJobs.get(job.id);
        const wasCancelled = Boolean(after?.cancel) || after?.status === 'cancelled' || after?.status === 'cancelling';
        if (wasCancelled && after?.status !== 'done') {
          await this.prisma.jobLog
            .update({
              where: { id: job.id },
              data: { status: 'cancelled', message: after?.bannerZh || '已取消' },
            })
            .catch(() => null);
          if (after) {
            after.status = 'cancelled';
            after.percent = after.percent != null ? after.percent : 100;
            after.bannerZh = after.bannerZh || `「${job.kind}」已取消`;
          }
        } else {
          await this.prisma.jobLog
            .update({ where: { id: job.id }, data: { status: 'done', message: '完成' } })
            .catch(() => null);
          if (live) {
            live.status = 'done';
            live.percent = 100;
            live.bannerZh = `「${job.kind}」已完成`;
          }
        }
      } catch (e: any) {
        console.error('[jobs]', e);
        await this.prisma.jobLog
          .update({
            where: { id: job.id },
            data: { status: 'failed', message: String(e?.message || e).slice(0, 400) },
          })
          .catch(() => null);
        if (live) {
          live.status = 'failed';
          live.percent = 100;
          live.bannerZh = `「${job.kind}」失败`;
        }
      }
    }
    this.inlineRunning = false;
  }

  private repoRoot() {
    return join(__dirname, '..', '..', '..', '..');
  }

  private async runCrawlScript(kind: 'openalex' | 'csv', extra: any = {}) {
    const repoRoot = this.repoRoot();
    const script =
      kind === 'openalex'
        ? join(repoRoot, 'workers', 'crawl', 'src', 'openalex.ts')
        : join(repoRoot, 'workers', 'crawl', 'src', 'import-csv.ts');
    const env = { ...process.env };
    if (kind === 'openalex' && extra.search) env.OPENALEX_SEARCH = String(extra.search);
    if (kind === 'openalex' && extra.batch) env.OPENALEX_BATCH = '1';
    if (kind === 'openalex' && extra.limit) env.OPENALEX_LIMIT = String(extra.limit);
    if (kind === 'openalex' && extra.perPage) env.OPENALEX_PER_PAGE = String(extra.perPage);
    if (kind === 'openalex' && (extra.fillEmpty || extra.envHint?.OPENALEX_FILL_EMPTY)) env.OPENALEX_FILL_EMPTY = '1';
    if (kind === 'openalex' && (extra.fillEmptyPreview || extra.envHint?.OPENALEX_FILL_EMPTY_PREVIEW)) {
      env.OPENALEX_FILL_EMPTY = '1';
      env.OPENALEX_FILL_EMPTY_PREVIEW = '1';
    }
    if (kind === 'openalex' && extra.previewOut) env.OPENALEX_PREVIEW_OUT = String(extra.previewOut);
    if (kind === 'csv' && extra.csvPath) env.CSV_PATH = String(extra.csvPath);
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: kind,
        payload: extra,
        status: 'running',
        message: this.backend === 'bullmq' ? 'BullMQ 采集中' : '进程内采集中',
        tenantId: extra.tenantId || 'default',
      },
    });
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npx', ['tsx', script], {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('crawl exit ' + code))));
    });
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: kind,
        payload: extra,
        status: 'done',
        message: '采集完成',
        tenantId: extra.tenantId || 'default',
      },
    });
  }

  async enqueueMatch(opts: any = {}) {
    const log = await this.prisma.jobLog.create({
      data: {
        queue: 'match',
        jobName: 'enqueue',
        payload: opts,
        status: 'queued',
        message: this.backend === 'bullmq' ? '匹配已入 BullMQ' : '匹配已入进程队列',
        tenantId: opts.tenantId || 'default',
      },
    });
    this.liveJobs.set(log.id, {
      cancel: false,
      status: 'queued',
      kind: 'match',
      percent: 10,
      bannerZh: '匹配已入队…',
    });
    if (this.backend === 'bullmq' && this.matchQueue) {
      await this.matchQueue.add('run', { ...opts, _jobLogId: log.id }, { removeOnComplete: 100, removeOnFail: 50, jobId: log.id });
      return {
        ...log,
        backend: this.backend,
        cancelPath: `/api/jobs/${log.id}/cancel`,
        progressPath: `/api/jobs/progress?id=${log.id}`,
        streamPath: `/api/jobs/progress/stream?id=${log.id}`,
      };
    }
    this.inlineQueue.push({
      id: log.id,
      kind: 'match',
      cancel: false,
      run: async () => {
        const live0 = this.liveJobs.get(log.id);
        if (live0?.cancel) return;
        const result = await this.matches.runMatch({
          ...opts,
          jobLogId: log.id,
          cancelCheck: () => Boolean(this.liveJobs.get(log.id)?.cancel),
          cancelScopes: () => {
            const L = this.liveJobs.get(log.id);
            return {
              all: Boolean(L?.cancel),
              embed: Boolean(L?.cancelEmbed || L?.cancel),
              score: Boolean(L?.cancelScore || L?.cancel),
            };
          },
          onProgress: async (p: any) => {
            const L = this.liveJobs.get(log.id);
            if (!L) return;
            if (typeof p.percent === 'number') L.percent = p.percent;
            if (p.bannerZh) L.bannerZh = p.bannerZh;
            if (p.hintZh) L.hintZh = p.hintZh;
            if (p.step) L.step = p.step;
            if (Array.isArray((p as any).itemizedPhases)) L.itemizedPhases = (p as any).itemizedPhases;
            if (Array.isArray((p as any).cancelScopesAvailable))
              L.cancelScopesAvailable = (p as any).cancelScopesAvailable;
            if (p.phase) {
              L.phase = p.phase;
              const zh: Record<string, string> = {
                prepare: '准备中',
                demand: '匹配需求',
                write: '写入结果',
                prewarm: '预热中',
                cancelled: '已取消',
                done: '已完成',
              };
              L.phaseZh = zh[p.phase] || p.phase;
            }
            if (typeof p.demandIndex === 'number') L.batchIndex = p.demandIndex;
            if (typeof p.demandTotal === 'number') L.batchTotal = p.demandTotal;
            if (Array.isArray((p as any).matchedOrgIds)) {
              L.matchedOrgIds = Array.from(new Set<string>((p as any).matchedOrgIds.map((x: any) => String(x))));
            }
            if (p.cancelled) {
              L.status = 'cancelled';
              L.cancel = true;
            } else if (L.status !== 'cancelling' && L.status !== 'cancelled') {
              L.status = 'running';
            }
            await this.prisma.jobLog
              .update({
                where: { id: log.id },
                data: {
                  message: p.bannerZh || L.bannerZh || '执行中',
                  status: p.cancelled ? 'cancelled' : L.status === 'cancelling' ? 'cancelling' : 'running',
                  payload: {
                    demandId: opts?.demandId,
                    demandIds: opts?.demandIds,
                    topN: opts?.topN,
                    minScore: opts?.minScore,
                    tenantId: opts?.tenantId,
                    matchedOrgIds: L.matchedOrgIds || [],
                    progress: {
                      percent: L.percent,
                      step: L.step,
                      phase: L.phase,
                      batchIndex: L.batchIndex,
                      batchTotal: L.batchTotal,
                      bannerZh: L.bannerZh,
                      hintZh: L.hintZh,
                      matchedOrgIds: L.matchedOrgIds || [],
                      itemizedPhases: L.itemizedPhases || null,
                      cancelScopesAvailable: L.cancelScopesAvailable || ['embed', 'score', 'all'],
                      itemizedPhasesSse: true,
                      wave: 'M77',
                    },
                    itemizedPhases: L.itemizedPhases || null,
                    itemizedPhasesSse: true,
                  } as any,
                },
              })
              .catch(() => null);
          },
        });
        if ((result as any)?.cancelled) {
          const L = this.liveJobs.get(log.id);
          const remaining = Array.isArray((result as any)?.remainingDemandIds)
            ? (result as any).remainingDemandIds
            : [];
          const processed = Array.isArray((result as any)?.processedDemandIds)
            ? (result as any).processedDemandIds
            : [];
          const matchedOrgs = Array.isArray((result as any)?.matchedOrgIds)
            ? (result as any).matchedOrgIds.map(String)
            : L?.matchedOrgIds || [];
          const pw = (result as any)?.onePagerPrewarm || null;
          const scoreResume = Boolean((result as any)?.scoreResumeAvailable) || remaining.length > 0;
          const prewarmResume =
            Boolean((result as any)?.prewarmResumeAvailable) || Boolean(pw?.resumeAvailable);
          const unifiedResume = scoreResume || prewarmResume;
          if (L) {
            L.cancel = true;
            L.status = 'cancelled';
            L.bannerZh =
              L.bannerZh ||
              ((result as any)?.summaryZh as string) ||
              '匹配已取消';
            L.remainingDemandIds = remaining;
            L.processedDemandIds = processed;
            L.resumeAvailable = unifiedResume;
            L.scoreResumeAvailable = scoreResume;
            L.prewarmResumeAvailable = prewarmResume;
            L.prewarmQueueId = pw?.queueId || (result as any)?.prewarmQueueId || null;
            L.unifiedPhase = (result as any)?.unifiedPhase || (scoreResume ? 'score' : prewarmResume ? 'prewarm' : 'cancelled');
            L.onePagerPrewarm = pw;
            L.matchedOrgIds = matchedOrgs;
            L.resumeCursors = (result as any)?.resumeCursors || null;
            L.itemizedPhasesSse = true;
            if (Array.isArray((result as any)?.itemizedPhases)) L.itemizedPhases = (result as any).itemizedPhases;
            L.hintZh = unifiedResume
              ? scoreResume
                ? `剩 ${remaining.length} 条需求可续跑（统一任务卡，含后续预热；游标已切分）`
                : `预热可续队列 ${L.prewarmQueueId}（游标已切分）`
              : L.hintZh;
            L.phase = 'cancelled';
            L.phaseZh = '已取消';
          }
          await this.prisma.jobLog
            .update({
              where: { id: log.id },
              data: {
                status: 'cancelled',
                message:
                  (result as any)?.summaryZh ||
                  `已取消 · 剩余需求 ${remaining.length}` +
                    (prewarmResume ? ` · 预热可续` : ''),
                payload: {
                  ...(opts || {}),
                  cancelled: true,
                  remainingDemandIds: remaining,
                  processedDemandIds: processed,
                  resumeAvailable: unifiedResume,
                  scoreResumeAvailable: scoreResume,
                  prewarmResumeAvailable: prewarmResume,
                  unifiedPhase: (result as any)?.unifiedPhase || null,
                  resumeCursors: (result as any)?.resumeCursors || null,
                  itemizedPhases: L?.itemizedPhases || (result as any)?.itemizedPhases || null,
                  itemizedPhasesSse: true,
                  prewarmQueueId: pw?.queueId || null,
                  onePagerPrewarm: pw,
                  unifiedJobCard: true,
                  matchedOrgIds: matchedOrgs,
                  topN: opts?.topN,
                  minScore: opts?.minScore,
                  tenantId: opts?.tenantId,
                  wave: 'M77',
                } as any,
              },
            })
            .catch(() => null);
        } else if (result) {
          const L = this.liveJobs.get(log.id);
          const pw = (result as any)?.onePagerPrewarm || null;
          const remaining = Array.isArray((result as any)?.remainingDemandIds)
            ? (result as any).remainingDemandIds
            : [];
          const scoreResume = Boolean((result as any)?.scoreResumeAvailable) || remaining.length > 0;
          const prewarmResume =
            Boolean((result as any)?.prewarmResumeAvailable) || Boolean(pw?.resumeAvailable);
          const unifiedResume = scoreResume || prewarmResume;
          if (L) {
            L.resumeAvailable = unifiedResume;
            L.remainingDemandIds = remaining;
            L.scoreResumeAvailable = scoreResume;
            L.prewarmResumeAvailable = prewarmResume;
            L.prewarmQueueId = pw?.queueId || (result as any)?.prewarmQueueId || null;
            L.unifiedPhase = (result as any)?.unifiedPhase || (prewarmResume ? 'prewarm' : 'done');
            L.onePagerPrewarm = pw;
            L.resumeCursors = (result as any)?.resumeCursors || null;
            L.itemizedPhasesSse = true;
            L.phase = prewarmResume ? 'prewarm' : 'done';
            L.phaseZh = prewarmResume ? '预热可续' : '已完成';
            if (prewarmResume) {
              L.bannerZh = `打分完成 · 预热可续 ${pw?.remainingIds?.length || 0}`;
              L.hintZh = `统一任务卡可续跑预热队列 ${L.prewarmQueueId}`;
            }
          }
          await this.prisma.jobLog
            .update({
              where: { id: log.id },
              data: {
                status: prewarmResume ? 'cancelled' : 'done',
                message:
                  (result as any)?.summaryZh ||
                  (prewarmResume
                    ? `打分完成 · 预热可续队列 ${pw?.queueId}`
                    : '匹配完成'),
                payload: {
                  ...(opts || {}),
                  cancelled: false,
                  remainingDemandIds: remaining,
                  processedDemandIds: (result as any)?.processedDemandIds || [],
                  resumeAvailable: unifiedResume,
                  scoreResumeAvailable: scoreResume,
                  prewarmResumeAvailable: prewarmResume,
                  unifiedPhase: (result as any)?.unifiedPhase || (prewarmResume ? 'prewarm' : 'done'),
                  resumeCursors: (result as any)?.resumeCursors || null,
                  itemizedPhases: L?.itemizedPhases || null,
                  itemizedPhasesSse: true,
                  prewarmQueueId: pw?.queueId || null,
                  onePagerPrewarm: pw,
                  unifiedJobCard: true,
                  matchedOrgIds: Array.isArray((result as any)?.matchedOrgIds)
                    ? (result as any).matchedOrgIds
                    : L?.matchedOrgIds || [],
                  topN: opts?.topN,
                  minScore: opts?.minScore,
                  tenantId: opts?.tenantId,
                  wave: 'M77',
                } as any,
              },
            })
            .catch(() => null);
        }
      },
    });
    this.pumpInline();
    return {
      ...log,
      backend: this.backend,
      cancelPath: `/api/jobs/${log.id}/cancel`,
      progressPath: `/api/jobs/progress?id=${log.id}`,
      streamPath: `/api/jobs/progress/stream?id=${log.id}`,
      summaryZh: '匹配已入队。可看进度（SSE/轮询），排队中可取消；取消后可按剩余需求续跑。',
    };
  }

  async enqueueCrawl(kind: 'openalex' | 'csv', extra: any = {}) {
    const log = await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: kind,
        payload: extra,
        status: 'queued',
        message: this.backend === 'bullmq' ? '采集已入 BullMQ' : '采集已入进程队列',
        tenantId: extra.tenantId || 'default',
      },
    });
    this.liveJobs.set(log.id, {
      cancel: false,
      status: 'queued',
      kind: 'crawl-' + kind,
      percent: 10,
      bannerZh: '采集已入队…',
    });
    if (this.backend === 'bullmq' && this.crawlQueue) {
      await this.crawlQueue.add(kind, { kind, ...extra }, { removeOnComplete: 100, removeOnFail: 50 });
      return {
        ...log,
        backend: this.backend,
        cancelPath: `/api/jobs/${log.id}/cancel`,
        progressPath: `/api/jobs/progress?id=${log.id}`,
      };
    }
    this.inlineQueue.push({
      id: log.id,
      kind: 'crawl-' + kind,
      cancel: false,
      run: async () => {
        const live = this.liveJobs.get(log.id);
        if (live?.cancel) return;
        await this.runCrawlScript(kind, extra);
      },
    });
    this.pumpInline();
    return {
      ...log,
      backend: this.backend,
      cancelPath: `/api/jobs/${log.id}/cancel`,
      progressPath: `/api/jobs/progress?id=${log.id}`,
    };
  }

  cancel(id: string, body: { scope?: 'all' | 'embed' | 'score'; reasonZh?: string } = {}) {
    const scope = (body?.scope === 'embed' || body?.scope === 'score' || body?.scope === 'all'
      ? body.scope
      : 'all') as 'all' | 'embed' | 'score';
    const live = this.liveJobs.get(id);
    const queued = this.inlineQueue.find((j) => j.id === id);
    const applyScope = (L: NonNullable<typeof live>) => {
      L.cancelScope = scope;
      if (scope === 'all') {
        L.cancel = true;
        L.cancelEmbed = true;
        L.cancelScore = true;
      } else if (scope === 'embed') {
        L.cancelEmbed = true;
      } else if (scope === 'score') {
        L.cancelScore = true;
      }
    };
    const scopeZh =
      scope === 'embed' ? '仅停供给嵌入/ANN' : scope === 'score' ? '仅停打分写库' : '全停';
    if (queued) {
      if (scope === 'all') queued.cancel = true;
      if (live) applyScope(live);
      if (scope === 'all' && live) live.cancel = true;
      return {
        ok: true,
        jobId: id,
        status: 'cancelling',
        scope,
        scopeZh,
        finerCancel: true,
        wave: 'M77',
        tipZh: `已请求取消（${scopeZh}）：排队中全停则不执行；分项取消在跑时按边界生效；结束后游标按阶段切分。`,
        summaryZh: `已请求取消（${scopeZh}）：若还在排队则不会执行；若已在跑则等本轮边界。`,
        toastZh: `取消请求 · ${scopeZh}`,
      };
    }
    if (live && (live.status === 'queued' || live.status === 'running' || live.status === 'cancelling')) {
      applyScope(live);
      if (scope === 'all') {
        live.cancel = true;
        live.status = 'cancelling';
        live.bannerZh = '取消请求已收到（全停）…';
      } else {
        live.bannerZh =
          scope === 'embed'
            ? '已请求仅停供给嵌入/ANN 预热…'
            : '已请求仅停打分写库…';
        live.hintZh =
          scope === 'embed'
            ? '供给嵌入与 ANN 预热将停；已有向量的打分可继续。软取消全停仍可用。'
            : '打分与写库将在块边界停下；供给补齐可继续。软取消全停仍可用。';
      }
      return {
        ok: true,
        jobId: id,
        status: live.status,
        scope,
        scopeZh,
        finerCancel: true,
        wave: 'M77',
        resumeCursorSplit: true,
        tipZh:
          scope === 'all'
            ? '已请求全停。匹配会在当前需求/批次边界停下；排队中的会跳过；结束后游标按阶段切分。'
            : `已请求分项取消（${scopeZh}）。结束后续跑游标自动切分，不重做已完成阶段；软取消全停仍两边同停。`,
        summaryZh:
          scope === 'all'
            ? '已请求取消。匹配会在当前需求/批次边界停下；排队中的会跳过。'
            : `已请求分项取消（${scopeZh}）；结束后游标按阶段切分。`,
        toastZh: `取消请求 · ${scopeZh}`,
        cancelScopesAvailable: ['embed', 'score', 'all'],
      };
    }
    if (!live) {
      return { ok: false, messageZh: '任务不在本进程或已结束', jobId: id, wave: 'M77' };
    }
    return {
      ok: true,
      jobId: id,
      status: live.status,
      scope,
      wave: 'M77',
      summaryZh: '已经不在跑了，不用取消',
      toastZh: '任务已结束',
    };
  }

  /** M41/M42：长任务进度（匹配/采集/导入桥接）— 给等待反馈用 */
  async progress(id?: string, kind?: string): Promise<any> {
    // 导入任务桥接
    if (kind === 'import' && id) {
      const imp = await this.prisma.enterpriseImportJob.findUnique({ where: { id } });
      if (imp) {
        const prog = ((imp.report as any) || {}).progress || {};
        const running = imp.status === 'importing' || imp.status === 'validating';
        return {
          ok: true,
          kind: 'import',
          job: {
            id: imp.id,
            queue: 'import',
            jobName: 'enterprise',
            status: imp.status,
            statusZh:
              ({ importing: '写入中', validating: '校验中', done: '已完成', failed: '失败', cancelled: '已取消' } as any)[
                imp.status
              ] || imp.status,
            message: prog.bannerZh || imp.status,
            createdAt: imp.createdAt,
          },
          percent: typeof prog.percent === 'number' ? prog.percent : running ? 30 : 100,
          waiting: running,
          bannerZh: prog.bannerZh || `导入 ${imp.status}`,
          hintZh: prog.hintZh || '',
          cancelPath: `/api/imports/enterprise/jobs/${imp.id}/cancel`,
          backend: this.backend,
          inlineQueued: this.inlineQueue.length,
          inlineRunning: this.inlineRunning,
        };
      }
    }

    const live = id ? this.liveJobs.get(id) : null;
    const latest = id
      ? await this.prisma.jobLog.findUnique({ where: { id } })
      : await this.prisma.jobLog.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!latest) {
      const imp = await this.prisma.enterpriseImportJob.findFirst({ orderBy: { createdAt: 'desc' } });
      if (imp) {
        const prog = ((imp.report as any) || {}).progress || {};
        const running = imp.status === 'importing' || imp.status === 'validating';
        return {
          ok: true,
          kind: 'import',
          job: {
            id: imp.id,
            queue: 'import',
            jobName: 'enterprise',
            status: imp.status,
            statusZh: imp.status,
            message: prog.bannerZh || imp.status,
            createdAt: imp.createdAt,
          },
          percent: typeof prog.percent === 'number' ? prog.percent : running ? 30 : 100,
          waiting: running,
          bannerZh: prog.bannerZh || `导入 ${imp.status}`,
          hintZh: prog.hintZh || '',
          cancelPath: `/api/imports/enterprise/jobs/${imp.id}/cancel`,
          backend: this.backend,
          inlineQueued: this.inlineQueue.length,
          inlineRunning: this.inlineRunning,
        };
      }
      return {
        ok: true,
        empty: true,
        bannerZh: '还没有任务记录',
        hintZh: '点「跑匹配」或「导入」后，这里会显示进度。',
        backend: this.backend,
        inlineQueued: this.inlineQueue.length,
        inlineRunning: this.inlineRunning,
      };
    }
    const status = live?.status || latest.status;
    const running = status === 'running' || status === 'queued' || status === 'cancelling';
    const pct =
      live?.percent != null
        ? live.percent
        : status === 'done' || status === 'ok' || status === 'cancelled'
          ? 100
          : status === 'failed'
            ? 100
            : status === 'running'
              ? 55
              : status === 'queued'
                ? 15
                : 30;
    const statusZh: Record<string, string> = {
      queued: '排队中',
      running: '执行中',
      cancelling: '取消中',
      cancelled: '已取消',
      done: '已完成',
      ok: '已完成',
      failed: '失败',
    };
    const payload = (latest.payload as any) || {};
    const remainingDemandIds =
      live?.remainingDemandIds ||
      (Array.isArray(payload.remainingDemandIds) ? payload.remainingDemandIds : []);
    const prewarmQueueId =
      live?.prewarmQueueId ||
      payload.prewarmQueueId ||
      payload?.onePagerPrewarm?.queueId ||
      null;
    const prewarmResumeAvailable =
      Boolean(live?.prewarmResumeAvailable) ||
      Boolean(payload.prewarmResumeAvailable) ||
      Boolean(payload?.onePagerPrewarm?.resumeAvailable);
    const scoreResumeAvailable =
      Boolean(live?.scoreResumeAvailable) ||
      Boolean(payload.scoreResumeAvailable) ||
      (status === 'cancelled' && remainingDemandIds.length > 0);
    const resumeAvailable =
      Boolean(live?.resumeAvailable) ||
      Boolean(payload.resumeAvailable) ||
      scoreResumeAvailable ||
      prewarmResumeAvailable;
    const phase = live?.phase || payload?.progress?.phase || null;
    const phaseZhMap: Record<string, string> = {
      prepare: '准备中',
      demand: '匹配需求',
      write: '写入结果',
      importing: '写入中',
      validating: '校验中',
      cancelled: '已取消',
      done: '已完成',
      failed: '失败',
      queued: '排队中',
      running: '执行中',
      cancelling: '取消中',
      resume: '续跑中',
      prewarm: '预热中',
    };
    const phaseZh =
      live?.phaseZh ||
      (phase ? phaseZhMap[phase] || phase : statusZh[status] || status);
    const matchedOrgIdsProg: string[] = [
      ...new Set(
        [
          ...(Array.isArray(live?.matchedOrgIds) ? live!.matchedOrgIds! : []),
          ...(Array.isArray(payload.matchedOrgIds) ? payload.matchedOrgIds : []),
          ...(Array.isArray(payload?.progress?.matchedOrgIds) ? payload.progress.matchedOrgIds : []),
        ]
          .map(String)
          .filter(Boolean),
      ),
    ];
    const batchIndex = live?.batchIndex ?? payload?.progress?.batchIndex ?? null;
    const batchTotal = live?.batchTotal ?? payload?.progress?.batchTotal ?? null;
    const step = live?.step || payload?.progress?.step || null;
    let phaseText = phaseZh;
    if (batchIndex != null && batchTotal != null) {
      phaseText = `${phaseZh} · ${batchIndex}/${batchTotal}`;
    } else if (step) {
      phaseText = `${phaseZh} · ${step}`;
    }

    return {
      ok: true,
      kind: latest.queue,
      job: {
        id: latest.id,
        queue: latest.queue,
        jobName: latest.jobName,
        status,
        statusZh: statusZh[status] || status,
        message: latest.message,
        createdAt: latest.createdAt,
        tenantId: latest.tenantId,
      },
      percent: pct,
      waiting: running,
      cancelRequested: Boolean(live?.cancel),
      cancelPath: `/api/jobs/${latest.id}/cancel`,
      resumePath: resumeAvailable ? `/api/jobs/${latest.id}/resume` : null,
      resumeAvailable,
      scoreResumeAvailable,
      prewarmResumeAvailable,
      prewarmQueueId,
      unifiedPhase:
        live?.unifiedPhase ||
        payload.unifiedPhase ||
        (scoreResumeAvailable ? 'score' : prewarmResumeAvailable ? 'prewarm' : null),
      unifiedJobCard: true,
      remainingDemandIds,
      remainingCount: remainingDemandIds.length,
      matchedOrgIds: matchedOrgIdsProg,
      matchedOrgCount: matchedOrgIdsProg.length,
      streamPath: `/api/jobs/progress/stream?id=${latest.id}`,
      step,
      phase,
      phaseZh,
      phaseText,
      batchIndex,
      batchTotal,
      itemizedPhases:
        live?.itemizedPhases ||
        (payload as any)?.itemizedPhases ||
        (payload as any)?.progress?.itemizedPhases ||
        null,
      itemizedProgressLabelZh: '匹配分项进度',
      itemizedPhasesSse: true,
      itemizedPhasesSseTipZh: '分项进度经现有 job SSE/progress 通道推送（中文标签）',
      cancelScopesAvailable:
        live?.cancelScopesAvailable || ['embed', 'score', 'all'],
      cancelScope: live?.cancelScope || null,
      finerCancel: true,
      finerCancelTipZh: '可仅停供给嵌入/ANN，或仅停打分；软取消仍全停；取消后游标按阶段切分',
      resumeCursors:
        live?.resumeCursors ||
        (payload as any)?.resumeCursors ||
        null,
      resumeCursorSplitLabelZh: '细取消后续跑游标切分',
      wave: 'M77',
      bannerZh:
        live?.bannerZh ||
        (running
          ? `任务「${latest.jobName}」${statusZh[status] || status}…`
          : `最近任务「${latest.jobName}」${statusZh[status] || status}`),
      hintZh:
        live?.hintZh ||
        (running
          ? status === 'cancelling'
            ? '正在取消：当前批次跑完就停…'
            : '请稍候。可点取消；取消在批次边界生效，不要连点。'
          : status === 'failed'
            ? '失败了：可看任务详情后重试，或联系运营。'
            : status === 'cancelled'
              ? resumeAvailable
                ? scoreResumeAvailable
                  ? `已取消。剩 ${remainingDemandIds.length} 条需求可点「续跑」（统一任务卡）。`
                  : `打分已落库。预热可续队列 ${prewarmQueueId}，点「续跑」即可。`
                : '已取消。可以继续下一项。'
              : '可以继续下一项工作。'),
      backend: this.backend,
      inlineQueued: this.inlineQueue.length,
      inlineRunning: this.inlineRunning,
    };
  }


  /** M45/M46：统一续跑任务卡（匹配 JobLog + 导入 EnterpriseImportJob）；业务壳按 shell/org 收窄 */
  async listResumeCards(
    opts: {
      tenantId?: string;
      limit?: number;
      shell?: string;
      orgId?: string | null;
      kinds?: string;
      actorEmail?: string | null;
      actorUid?: string | null;
    } = {},
  ) {
    const tenantId = opts.tenantId || 'default';
    const limit = Math.min(Math.max(opts.limit || 12, 1), 40);
    const shell = String(opts.shell || 'ops');
    const isBizShell = shell === 'enterprise' || shell === 'research' || shell === 'onboarding';
    const kindsDefault = isBizShell ? 'match' : 'match,import,anomaly-chain';
    const kindsSet = new Set(
      String(opts.kinds || kindsDefault)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const cards: any[] = [];

    let myDemandIds: Set<string> | null = null;
    /** M47：科研壳 — MatchResult 反查（能力/成果 → 命中过的 demandId） */
    let myMatchedDemandIds: Set<string> | null = null;
    let researchReverseCount = 0;
    if (isBizShell && opts.orgId) {
      const rows = await this.prisma.demand.findMany({
        where: {
          orgId: opts.orgId,
          org: { tenantId },
        },
        select: { id: true },
        take: 800,
      });
      myDemandIds = new Set(rows.map((r) => r.id));
    }
    if (shell === 'research' && opts.orgId) {
      try {
        const [caps, outs] = await Promise.all([
          this.prisma.capability.findMany({
            where: { orgId: opts.orgId },
            select: { id: true },
            take: 600,
          }),
          this.prisma.outcome.findMany({
            where: { orgId: opts.orgId },
            select: { id: true },
            take: 600,
          }),
        ]);
        const capIds = caps.map((x) => x.id);
        const outIds = outs.map((x) => x.id);
        const orClause: any[] = [];
        if (capIds.length) orClause.push({ capabilityId: { in: capIds } });
        if (outIds.length) orClause.push({ outcomeId: { in: outIds } });
        if (orClause.length) {
          const hits = await this.prisma.matchResult.findMany({
            where: {
              tenantId,
              OR: orClause,
            },
            select: { demandId: true },
            take: 2500,
          });
          myMatchedDemandIds = new Set(hits.map((h) => h.demandId).filter(Boolean));
          researchReverseCount = myMatchedDemandIds.size;
        } else {
          myMatchedDemandIds = new Set();
        }
      } catch (_) {
        myMatchedDemandIds = new Set();
      }
    }

    if (kindsSet.has('match')) {
      const matchLogs = await this.prisma.jobLog.findMany({
        where: { tenantId, queue: 'match' },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });
      for (const log of matchLogs) {
        const live = this.liveJobs.get(log.id);
        const payload = (log.payload as any) || {};
        const status = live?.status || log.status || 'unknown';
        const remaining: string[] =
          (Array.isArray(live?.remainingDemandIds) && live!.remainingDemandIds!.length
            ? live!.remainingDemandIds!
            : null) ||
          (Array.isArray(payload.remainingDemandIds) ? payload.remainingDemandIds : []);
        const demandIds: string[] = [];
        if (payload.demandId) demandIds.push(String(payload.demandId));
        if (Array.isArray(payload.demandIds)) demandIds.push(...payload.demandIds.map(String));
        demandIds.push(...remaining.map(String));
        const uniqDemandIds = [...new Set(demandIds.filter(Boolean))];
        const prewarmQueueId =
          live?.prewarmQueueId ||
          payload.prewarmQueueId ||
          payload?.onePagerPrewarm?.queueId ||
          null;
        const prewarmResumeAvailable =
          Boolean(live?.prewarmResumeAvailable) ||
          Boolean(payload.prewarmResumeAvailable) ||
          Boolean(payload?.onePagerPrewarm?.resumeAvailable);
        const scoreResumeAvailable =
          Boolean(live?.scoreResumeAvailable) ||
          Boolean(payload.scoreResumeAvailable) ||
          (status === 'cancelled' && remaining.length > 0);
        const resumeAvailable =
          Boolean(live?.resumeAvailable) ||
          Boolean(payload.resumeAvailable) ||
          scoreResumeAvailable ||
          prewarmResumeAvailable;
        const running = status === 'queued' || status === 'running' || status === 'cancelling';
        if (!(resumeAvailable || running || status === 'cancelled')) continue;

        const matchedOrgIds: string[] = [
          ...new Set(
            [
              ...(Array.isArray(live?.matchedOrgIds) ? live!.matchedOrgIds! : []),
              ...(Array.isArray(payload.matchedOrgIds) ? payload.matchedOrgIds : []),
              ...(Array.isArray(payload?.progress?.matchedOrgIds) ? payload.progress.matchedOrgIds : []),
            ].map(String).filter(Boolean),
          ),
        ];

        if (isBizShell) {
          // 整库匹配（无 demandIds）仅运营可见；科研进行中可用 matchedOrgIds 快照看见
          if (!uniqDemandIds.length && !(shell === 'research' && running && matchedOrgIds.length)) {
            continue;
          }
          if (shell === 'research') {
            // M47/M48：本单位需求 / Match 反查 / 进行中 matchedOrgIds 快照
            const hitOwnDemand = myDemandIds && uniqDemandIds.length
              ? uniqDemandIds.some((id) => myDemandIds!.has(id))
              : false;
            const hitReverse = myMatchedDemandIds && uniqDemandIds.length
              ? uniqDemandIds.some((id) => myMatchedDemandIds!.has(id))
              : false;
            const hitSnapshot = Boolean(opts.orgId && matchedOrgIds.includes(String(opts.orgId)));
            if (!hitOwnDemand && !hitReverse && !hitSnapshot) continue;
          } else if (myDemandIds) {
            if (!uniqDemandIds.length || !uniqDemandIds.some((id) => myDemandIds!.has(id))) continue;
          } else if (!opts.orgId) {
            continue;
          }
        }

        const pct =
          live?.percent != null
            ? live.percent
            : status === 'cancelled'
              ? Math.max(5, Math.min(99, 100 - remaining.length))
              : running
                ? live?.percent ?? 40
                : 100;
        const unifiedPhase =
          live?.unifiedPhase ||
          payload.unifiedPhase ||
          (scoreResumeAvailable ? 'score' : prewarmResumeAvailable ? 'prewarm' : running ? 'running' : null);
        cards.push({
          id: log.id,
          kind: 'match',
          kindZh: '批量匹配·预热',
          status,
          statusZh:
            ({ queued: '排队中', running: '执行中', cancelling: '取消中', cancelled: '已取消', done: '已完成', failed: '失败' } as any)[
              status
            ] || status,
          percent: pct,
          waiting: running,
          resumeAvailable,
          scoreResumeAvailable,
          prewarmResumeAvailable,
          prewarmQueueId,
          unifiedPhase,
          resumeCursors: live?.resumeCursors || payload.resumeCursors || null,
          resumeCursorSplitLabelZh: '细取消后续跑游标切分',
          itemizedPhasesSse: true,
          itemizedProgressLabelZh: '匹配分项进度',
          finerCancelTipZh: '可仅停供给嵌入/ANN，或仅停打分；取消后游标按阶段切分',
          unifiedJobCard: true,
          cancelPath: running ? `/api/jobs/${log.id}/cancel` : null,
          resumePath: resumeAvailable ? `/api/jobs/${log.id}/resume` : null,
          resumeScoreOnlyPath: scoreResumeAvailable ? `/api/jobs/${log.id}/resume` : null,
          resumePrewarmOnlyPath: prewarmResumeAvailable ? `/api/jobs/${log.id}/resume` : null,
          prewarmResumePath: prewarmResumeAvailable ? '/api/matches/prewarm/resume' : null,
          streamPath: `/api/jobs/progress/stream?id=${log.id}`,
          progressPath: `/api/jobs/${log.id}/progress`,
          remainingCount: remaining.length,
          demandIds: uniqDemandIds,
          matchedOrgIds,
          matchedOrgCount: matchedOrgIds.length,
          inProgressSnapshot: Boolean(running && matchedOrgIds.length),
          mergeStrategy: null,
          mergeStrategies: null,
          titleZh: `匹配·预热 · ${log.jobName || log.id.slice(0, 8)}`,
          summaryZh: resumeAvailable
            ? scoreResumeAvailable && prewarmResumeAvailable
              ? `游标已切分：打分剩 ${remaining.length} · 预热可续 ${prewarmQueueId}`
              : scoreResumeAvailable
              ? `未跑完：剩 ${remaining.length} 条需求可续跑（仅打分游标）`
              : `预热可续：队列 ${prewarmQueueId}（仅预热游标）`
            : running
              ? `进行中 ${pct}% · 可取消` +
                (matchedOrgIds.length ? ` · 已触及 ${matchedOrgIds.length} 家供给机构` : '')
              : `状态：${status}`,
          hintZh: resumeAvailable
            ? scoreResumeAvailable
              ? '点续跑只处理剩下的需求，并继续预热；不必整库重跑。'
              : '打分已落库。点续跑只补一页纸/解释核心预热。'
            : running
              ? '取消在批次边界生效。打分与预热同一张任务卡。'
              : '',
          createdAt: log.createdAt,
          calmTone: resumeAvailable ? 'resume' : running ? 'progress' : 'idle',
          scopedToOrg: Boolean(isBizShell && opts.orgId),
          researchReverse: shell === 'research',
          wave: 'M60',
        });
        if (shell === 'research' && running && matchedOrgIds.length && opts.orgId) {
          recordResearchSnapshotAudit({
            actor: opts.actorEmail || opts.actorUid || 'research-user',
            actorUid: opts.actorUid || null,
            tenantId: opts.tenantId || null,
            orgId: opts.orgId || null,
            jobId: log.id,
            matchedOrgCount: matchedOrgIds.length,
            matchedOrgIds,
            shell: 'research',
          });
        }
        if (cards.filter((c) => c.kind === 'match').length >= limit) break;
      }
    }

    if (kindsSet.has('import') && !isBizShell) {
      const imports = await this.prisma.enterpriseImportJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });
      for (const job of imports) {
        const report = (job.report as any) || {};
        const remainingRows = Array.isArray(report.remainingRows) ? report.remainingRows : [];
        const resumeAvailable = Boolean(report.resumeAvailable) && remainingRows.length > 0;
        const running = job.status === 'importing' || job.status === 'validating';
        if (!(resumeAvailable || running || job.status === 'cancelled')) continue;
        const mergeStrategy = report.mergeStrategy || 'fill-empty';
        const pct =
          typeof report?.progress?.percent === 'number'
            ? report.progress.percent
            : job.status === 'cancelled'
              ? Math.round(((job.importedRows || 0) / Math.max(job.validRows || job.totalRows || 1, 1)) * 100)
              : running
                ? 45
                : 100;
        const rowDecisions =
          report.rowDecisions && typeof report.rowDecisions === 'object' ? report.rowDecisions : {};
        let confirmN = 0;
        let skipN = 0;
        for (const v of Object.values(rowDecisions)) {
          if (v === 'confirm') confirmN += 1;
          else if (v === 'skip') skipN += 1;
        }
        const undecidedN = Math.max(0, remainingRows.length - confirmN - skipN);
        const undecidedBuckets =
          report.undecidedBuckets ||
          (resumeAvailable
            ? {
                tipZh: `未决分桶（任务卡）：未决 ${undecidedN}/${remainingRows.length}（打开冲突预览可按机构/需求/联系人分桶）`,
                labelsZh: { org: '机构冲突', demand: '需求冲突', person: '联系人冲突', all: '全部分桶' },
                wave: 'M73',
              }
            : null);
        const resumeCursor =
          report.resumeCursor ||
          (resumeAvailable
            ? {
                slimOffset: null,
                slimLimit: null,
                pageCursor: null,
                conflictTypes: [],
                bucket: null,
                tipZh: '续跑游标尚未持久化；冲突预览/未决向导后会写入任务卡。',
                wave: 'M72',
              }
            : null);
        const crossPageDecisionSummary = resumeAvailable
          ? {
              confirm: confirmN,
              skip: skipN,
              undecided: undecidedN,
              totalRemaining: remainingRows.length,
              willWrite: confirmN,
              confirmOnly: true,
              tipZh: `跨页决策摘要（仅确认续跑）：确认 ${confirmN} · 跳过 ${skipN} · 未决 ${undecidedN} · 将写 ${confirmN}/${remainingRows.length}`,
              beforeApplyZh: `应用前确认：仅写入已确认的 ${confirmN} 行；跳过 ${skipN} · 未决 ${undecidedN} 不写。`,
              wave: 'M74',
            }
          : null;
        cards.push({
          id: job.id,
          kind: 'import',
          kindZh: '企业导入',
          status: job.status,
          statusZh:
            ({ validating: '校验中', importing: '写入中', done: '已完成', failed: '失败', cancelled: '已取消' } as any)[
              job.status
            ] || job.status,
          percent: pct,
          waiting: running,
          resumeAvailable,
          cancelPath: running ? `/api/imports/enterprise/jobs/${job.id}/cancel` : null,
          resumePath: resumeAvailable ? `/api/imports/enterprise/jobs/${job.id}/resume` : null,
          confirmOnlyResumePath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/resume`
            : null,
          undecidedConfirmLabelZh: '未决全确认',
          undecidedSkipLabelZh: '未决全跳过',
          undecidedBucketOrgLabelZh: '机构未决',
          undecidedBucketDemandLabelZh: '需求未决',
          undecidedBucketPersonLabelZh: '联系人未决',
          skipBucketOnlyOrgLabelZh: '仅跳过机构桶',
          skipBucketOnlyDemandLabelZh: '仅跳过需求桶',
          skipBucketOnlyPersonLabelZh: '仅跳过联系人桶',
          undoSkipBucketLabelZh: '撤销上次分桶跳过',
          confirmBucketAndResumeLabelZh: '确认本桶+续跑',
          skipBucketDiffReplayLabelZh: '回放分桶跳过差分',
          confirmBucketWritePreviewLabelZh: '确认本桶写库预演',
          jumpToSeqRestoreLabelZh: '跳到 seq 还原',
          seqRestoreScrubberLabelZh: 'seq 还原时间线 scrubber',
          scrubberDiffPlaybackLabelZh: '播放分桶跳过差分序列',
          scrubberPauseSeekRestoreLabelZh: '差分播放暂停/定点还原',
          batchFieldDecisionsLabelZh: '跨行批量字段确认/跳过',
          rowFieldDiffLabelZh: '写库预演行级字段 diff',
          fieldConfirmSkipLabelZh: '按字段确认/跳过',
          fieldConfirmLiveRewriteLabelZh: '字段确认后即时改写预演',
          demandIdCheckpointResumeLabelZh: '按 demandId 召回/打分检查点续跑',
          itemizedProgressLabelZh: '匹配分项进度',
          finerCancelTipZh: '可仅停供给嵌入/ANN，或仅停打分；软取消仍全停',
          undoSkipBucketPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview/undo-skip-bucket`
            : null,
          confirmBucketAndResumePath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview/confirm-bucket-resume`
            : null,
          skipBucketDiffReplayPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview/skip-bucket-diff`
            : null,
          jumpToSeqRestorePath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview/skip-bucket-diff/restore`
            : null,
          confirmBucketWritePreviewPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview/confirm-bucket-write-preview`
            : null,
          confirmOnlyResumeLabelZh: '仅确认行续跑（带桶/游标）',
          confirmOnlyResumeCursorAlign: true,
          confirmOnlyResumeCursorPersisted: Boolean(report.resumeCursor),
          jobCardResumeCarriesBucketCursor: true,
          undoSkipBucketAvailable: Boolean(report.lastSkipBucketUndo),
          lastSkipBucketUndo: report.lastSkipBucketUndo || null,
          crossPageDecisionSummary,
          undecidedBuckets,
          resumeCursor,
          confirmOnlyResumeCounts: resumeAvailable
            ? {
                confirm: confirmN,
                skip: skipN,
                decided: confirmN + skipN,
                tipZh: `仅确认行续跑计数：确认 ${confirmN} · 跳过 ${skipN}`,
              }
            : null,
          conflictPreviewPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview`
            : null,
          conflictPreviewCsvPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-preview.csv`
            : null,
          conflictExportCsvPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-export.csv`
            : null,
          conflictExportZipPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-export.zip`
            : null,
          conflictExportAsyncPath: resumeAvailable
            ? `/api/imports/enterprise/jobs/${job.id}/conflict-export/async`
            : null,
          streamPath: `/api/imports/enterprise/jobs/${job.id}/progress/stream`,
          progressPath: `/api/imports/enterprise/jobs/${job.id}/progress`,
          remainingCount: remainingRows.length,
          mergeStrategy,
          mergeStrategies: ['fill-empty', 'skip', 'overwrite'],
          titleZh: `导入 · ${job.filename || job.id.slice(0, 8)}`,
          summaryZh: resumeAvailable
            ? `已取消/部分写入：剩 ${remainingRows.length} 行可差分续跑（确认 ${confirmN} · 跳过 ${skipN} · 未决 ${undecidedN}；策略：${mergeStrategy}）`
            : running
              ? `写入中 ${pct}% · 可取消`
              : `状态：${job.status}`,
          hintZh: resumeAvailable
            ? '续跑前可先看冲突预览与未决分桶；游标持久化在任务卡；可用「仅确认行续跑」；全量冲突可导出 CSV/ZIP。'
            : running
              ? '取消后已写入行保留。'
              : '',
          createdAt: job.createdAt,
          calmTone: resumeAvailable ? 'resume' : running ? 'progress' : 'idle',
          unifiedJobCard: true,
          wave: 'M73',
        });
        if (cards.filter((c) => c.kind === 'import').length >= limit) break;
      }
    }

    if (kindsSet.has('anomaly-chain') && !isBizShell) {
      const acards = listAnomalyChainResumeCards(tenantId, Math.min(4, limit));
      for (const c of acards) cards.push(c);
    }

    cards.sort((a, b) => {
      const rank = (c: any) => (c.resumeAvailable ? 0 : c.waiting ? 1 : 2);
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const emptyZh =
      shell === 'research'
        ? '暂无与本单位能力/成果相关的进行中/可续跑匹配（Match 反查 + 进行中 matchedOrgIds 快照；整库匹配与导入由运营台处理）'
        : isBizShell
          ? '暂无与本单位相关的进行中/可续跑匹配任务（整库匹配与导入由运营台处理）'
          : '暂无进行中或可续跑的匹配/导入/异常串联任务';
    const tipZh =
      shell === 'research'
        ? '科研壳：Match→需求 反查 + 进行中 matchedOrgIds 快照（结果未全落库也能看见相关任务）。导入仍走运营台。'
        : isBizShell
          ? '这里只显示与你单位需求相关的匹配任务：进度 / 取消 / 续跑。授权批量导入请走运营台。'
          : '取消或部分完成后，这里会出现一张冷静的续跑卡：进度 / 取消 / 续跑 /（导入）合并策略；异常串联 bust→复探针也可挂任务卡。';

    return {
      ok: true,
      wave: 'M82',
      shell,
      kinds: [...kindsSet],
      scoped: isBizShell,
      orgId: opts.orgId || null,
      researchReverseLookup: shell === 'research',
      researchMatchedDemandCount: shell === 'research' ? researchReverseCount : undefined,
      researchInProgressSnapshot: shell === 'research',
      researchSnapshotAuditM49: shell === 'research',
      count: cards.length,
      cards: cards.slice(0, limit),
      emptyZh,
      tipZh,
    };
  }

  /** M44/M60：统一任务卡续跑 — 优先剩余 demand 打分，否则续预热队列 */
  async resumeMatch(id: string, body: { phase?: 'score' | 'prewarm' | 'auto' } = {}) {
    const log = await this.prisma.jobLog.findUnique({ where: { id } });
    if (!log) return { ok: false, messageZh: '找不到任务', jobId: id };
    const live = this.liveJobs.get(id);
    if (live && (live.status === 'queued' || live.status === 'running' || live.status === 'cancelling')) {
      return { ok: false, messageZh: '任务仍在进行或取消中，请先等停下再续跑', jobId: id };
    }
    const payload = (log.payload as any) || {};
    const cursors = live?.resumeCursors || payload.resumeCursors || null;
    const prefer =
      body?.phase === 'score' || body?.phase === 'prewarm' || body?.phase === 'auto'
        ? body.phase
        : 'auto';
    const remaining: string[] =
      prefer === 'prewarm'
        ? []
        : (Array.isArray(cursors?.scoreOnly?.demandIds) && cursors.scoreOnly.demandIds.length
            ? cursors.scoreOnly.demandIds
            : null) ||
          (Array.isArray(live?.remainingDemandIds) && live!.remainingDemandIds!.length
            ? live!.remainingDemandIds!
            : null) ||
          (Array.isArray(payload.remainingDemandIds) ? payload.remainingDemandIds : []);
    if (remaining.length && prefer !== 'prewarm') {
      const opts = {
        demandIds: remaining,
        topN: payload.topN,
        minScore: payload.minScore,
        tenantId: payload.tenantId || log.tenantId || 'default',
        resumeOf: id,
      };
      const enq = await this.enqueueMatch(opts);
      return {
        ...enq,
        ok: true,
        resumed: true,
        resumeOf: id,
        unifiedPhase: 'score',
        remainingDemandIds: remaining,
        remainingCount: remaining.length,
        summaryZh: `已按剩余 ${remaining.length} 条需求续跑入队（统一任务卡·仅打分游标·demandId 检查点）。可看进度，也可再取消。`,
        resumeCursorSplit: true,
        resumePhase: 'score',
        demandIdCheckpointResume: true,
        demandCheckpoints: cursors?.demandCheckpoints || payload.demandCheckpoints || null,
        lastUnfinishedDemandId:
          cursors?.demandCheckpoints?.lastUnfinishedDemandId ||
          cursors?.scoreOnly?.lastUnfinishedDemandId ||
          null,
        tipZh:
          cursors?.scoreOnly?.tipZh ||
          cursors?.demandCheckpoints?.tipZh ||
          `仅打分续跑 ${remaining.length} 条（按 demandId×phase 检查点跨进程落盘跳过已完成阶段）`,
        toastZh: `续跑入队 · 剩 ${remaining.length} 条需求`,
        wave: 'M80',
        checkpointPersistAcrossProcess: true,
        annPoolWarmResumeByDemandId: true,
        phaseResumeByDemandPhase: true,
        annPoolCapacityAdapt: true,
      };
    }

    const queueId =
      prefer === 'score'
        ? null
        : cursors?.prewarmOnly?.queueId ||
          live?.prewarmQueueId ||
          payload.prewarmQueueId ||
          payload?.onePagerPrewarm?.queueId ||
          null;
    const prewarmResume =
      Boolean(live?.prewarmResumeAvailable) ||
      Boolean(payload.prewarmResumeAvailable) ||
      Boolean(payload?.onePagerPrewarm?.resumeAvailable);
    if (queueId && prewarmResume) {
      const tenantId = payload.tenantId || log.tenantId || 'default';
      const r = await this.matches.resumePrewarmQueue(String(queueId), { tenantId });
      const still = Boolean(r?.onePagerPrewarm?.resumeAvailable);
      if (live) {
        live.prewarmResumeAvailable = still;
        live.resumeAvailable = still;
        live.onePagerPrewarm = r?.onePagerPrewarm || live.onePagerPrewarm;
        live.unifiedPhase = still ? 'prewarm' : 'done';
        live.phase = still ? 'prewarm' : 'done';
        live.phaseZh = still ? '预热可续' : '已完成';
        live.status = still ? 'cancelled' : 'done';
      }
      await this.prisma.jobLog
        .update({
          where: { id },
          data: {
            status: still ? 'cancelled' : 'done',
            message: r?.tipZh || '预热续跑结束',
            payload: {
              ...payload,
              resumeAvailable: still,
              prewarmResumeAvailable: still,
              scoreResumeAvailable: false,
              unifiedPhase: still ? 'prewarm' : 'done',
              prewarmQueueId: queueId,
              onePagerPrewarm: r?.onePagerPrewarm || payload.onePagerPrewarm,
              unifiedJobCard: true,
              wave: 'M60',
            } as any,
          },
        })
        .catch(() => null);
      return {
        ok: true,
        resumed: true,
        resumeOf: id,
        unifiedPhase: 'prewarm',
        prewarmQueueId: queueId,
        onePagerPrewarm: r?.onePagerPrewarm,
        tipZh: (cursors?.prewarmOnly?.tipZh || r?.tipZh || '') + '（仅预热游标，不重跑打分）',
        summaryZh: still
          ? `预热续跑仍有剩余（队列 ${queueId}），可再点续跑。`
          : `预热续跑完成（队列 ${queueId}）。`,
        busyClearZh: r?.busyClearZh || '预热续跑结束。',
        resumeCursorSplit: true,
        resumePhase: 'prewarm',
        wave: 'M77',
      };
    }

    return {
      ok: false,
      messageZh: '没有可续跑的剩余需求或预热队列',
      hintZh: '该任务已跑完，或取消时未留下 remainingDemandIds / prewarmQueueId。',
      jobId: id,
      resumeAvailable: false,
      wave: 'M60',
    };
  }

}
