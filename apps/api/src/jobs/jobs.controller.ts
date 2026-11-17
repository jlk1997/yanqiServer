import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JobsService } from './jobs.service';
import { tenantFilter } from '../auth/scope';
import { resolveShell } from '../auth/shell';
import { checkSseTicketTenantQuota, mintSseTicket, resetSseTicketTenantQuota, peekSseTicketQuotaStats } from '../auth/sse-ticket';
import { listResearchSnapshotAudits, searchResearchSnapshotAudits, pruneResearchSnapshotAudits, exportResearchSnapshotAuditsCsv } from './research-snapshot-audit';
import {
  startResearchSnapshotAuditExportAsync,
  auditExportJobProgress,
  cancelAuditExportJob,
  resolveAuditExportDownload,
  listAuditExportJobs,
  peekAuditExportAsyncStats,
  researchSnapshotAuditAsyncThreshold,
  cleanupResearchSnapshotAuditExportArtifacts,
  researchSnapshotAuditExportTtlMs,
  researchSnapshotAuditExportDiskQuotaBytes,
  researchSnapshotAuditExportTenantDiskQuotaBytes,
} from './research-snapshot-audit-async';

/** M45/M46：SSE 开流前再拦一层匿名（中间件已拦；这里给中文码） */
function assertSseAuth(req: any, res: Response): boolean {
  const meta = req?.authMeta || {};
  if (req?.user || meta.hasKey || meta.hasOpsCookie) return true;
  res.status(401).json({
    ok: false,
    code: 'SSE_AUTH_REQUIRED',
    messageZh:
      '进度推送需要登录：请带登录 cookie、Authorization: Bearer，或先 POST /api/jobs/sse-ticket 再用 ?sse_ticket=…（优先于长寿命 access_token）。匿名流已拒绝。',
  });
  return false;
}

function sseAuthHeader(req: any): string {
  if (req?.authViaSseTicket) return 'sse-ticket';
  if (req?.authViaQueryToken) return 'query-token';
  return 'session';
}

@Controller('jobs')
export class JobsController {
  constructor(private svc: JobsService) {}

  @Get()
  list(@Req() req: any) {
    const tf = tenantFilter(req);
    return this.svc.list(tf.tenantId);
  }

  @Get('status')
  status() {
    return this.svc.status();
  }

  @Get('progress')
  progress(@Query('id') id?: string, @Query('kind') kind?: string) {
    return this.svc.progress(id, kind);
  }

  /** M46–M50：一次性短 TTL SSE 票（含租户+角色配额）；可绑 streamPath + 可选 jobId */
  @Post('sse-ticket')
  mintTicket(
    @Req() req: any,
    @Body()
    body: {
      ttlMs?: number;
      purpose?: string;
      streamPath?: string;
      path?: string;
      jobId?: string;
      id?: string;
      /** 仅 ADMIN/API-Key：临时压低/抬高本请求配额上限（冒烟测 429 用） */
      limitOverride?: number;
    } = {},
  ) {
    const u = req?.user;
    if (!u && !req?.authMeta?.hasKey && !req?.authMeta?.hasOpsCookie) {
      throw new UnauthorizedException('请先登录再领取 SSE 短票');
    }
    const payload = u
      ? {
          uid: u.uid,
          role: u.role,
          orgId: u.orgId || null,
          tenantId: u.tenantId || 'default',
          email: u.email,
          jti: u.jti,
          orgType: u.orgType,
        }
      : {
          uid: 'api-key-admin',
          role: 'ADMIN',
          orgId: null,
          tenantId: req?.resolvedTenantId || 'default',
          via: 'api-key',
        };
    const tenantId = String(payload.tenantId || 'default');
    const isAdmin = payload.role === 'ADMIN' || payload.role === 'OPS' || Boolean(req?.authMeta?.hasKey);
    const headerOverride = Number(req?.headers?.['x-yanqi-sse-quota-limit']);
    const bodyOverride = Number(body?.limitOverride);
    let limitOverride: number | null = null;
    if (isAdmin) {
      if (Number.isFinite(bodyOverride) && bodyOverride >= 1) limitOverride = Math.floor(bodyOverride);
      else if (Number.isFinite(headerOverride) && headerOverride >= 1) limitOverride = Math.floor(headerOverride);
    }
    const quota = checkSseTicketTenantQuota(tenantId, { role: payload.role, limitOverride });
    if (!quota.ok) {
      throw new HttpException(
        {
          ok: false,
          code: quota.code,
          messageZh: quota.messageZh,
          retryAfterSec: quota.retryAfterSec,
          limit: quota.limit,
          remaining: 0,
          tenantId: quota.tenantId,
          roleBucket: quota.roleBucket,
          tipZh: '短票是给 EventSource 用的一次性凭证；会话 cookie 已登录时不必狂刷 mint。',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const minted = mintSseTicket(payload, {
      ttlMs: body?.ttlMs,
      purpose: body?.purpose || 'sse-progress',
      uid: payload.uid,
      streamPath: body?.streamPath || body?.path || null,
      jobId: body?.jobId || body?.id || null,
    });
    return {
      ...minted,
      quota: {
        remaining: quota.remaining,
        limit: quota.limit,
        resetAt: new Date(quota.resetAt).toISOString(),
        tenantId: quota.tenantId,
        roleBucket: quota.roleBucket,
      },
      wave: 'M50',
    };
  }

  /** M50：重置短票租户配额窗口（运营/API-Key；冒烟在 M47 前调用，避免前序 burst 互踩） */
  @Post('sse-ticket/quota-reset')
  resetSseQuota(
    @Req() req: any,
    @Body() body: { tenantId?: string | null } = {},
  ) {
    const u = req?.user;
    const isAdmin =
      Boolean(req?.authMeta?.hasKey) ||
      u?.role === 'ADMIN' ||
      u?.role === 'OPS' ||
      Boolean(req?.authMeta?.hasOpsCookie);
    if (!isAdmin) {
      throw new HttpException(
        { ok: false, code: 'FORBIDDEN', messageZh: '仅运营可重置 SSE 短票配额窗口' },
        HttpStatus.FORBIDDEN,
      );
    }
    const result = resetSseTicketTenantQuota(body?.tenantId ?? null);
    return {
      ...result,
      policy: peekSseTicketQuotaStats(),
      tipZh: '已清空短票领取计数窗口；生产请谨慎使用，主要用于演练/冒烟防互踩。',
    };
  }

  /** M49/M50：科研快照审计列表 / 检索（运营抽查） */
  @Get('research-snapshot-audits')
  researchSnapshotAudits(
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('jobId') jobId?: string,
    @Query('actor') actor?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Req() req?: any,
  ) {
    const role = req?.user?.role;
    if (role && role !== 'ADMIN' && role !== 'OPS' && !req?.authMeta?.hasKey) {
      return { ok: false, messageZh: '仅运营可查看科研快照审计' };
    }
    const hasSearch = Boolean(q || jobId || actor || since || until);
    if (hasSearch) {
      return searchResearchSnapshotAudits({
        q,
        jobId,
        actor,
        since,
        until,
        limit: Number(limit) || 40,
      });
    }
    return listResearchSnapshotAudits(Number(limit) || 40);
  }

  /** M50：按保留策略修剪科研快照审计 */
  @Post('research-snapshot-audits/prune')
  pruneSnapshotAudits(@Req() req: any, @Body() body: { retentionDays?: number } = {}) {
    const role = req?.user?.role;
    if (role && role !== 'ADMIN' && role !== 'OPS' && !req?.authMeta?.hasKey) {
      throw new HttpException(
        { ok: false, messageZh: '仅运营可修剪审计' },
        HttpStatus.FORBIDDEN,
      );
    }
    return pruneResearchSnapshotAudits(body?.retentionDays);
  }

  /** M51/M52：科研快照审计 CSV 下载（检索 + 脱敏档；大表请走 async） */
  @Get('research-snapshot-audits.csv')
  researchSnapshotAuditsCsv(
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('jobId') jobId?: string,
    @Query('actor') actor?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('redaction') redaction?: string,
    @Req() req?: any,
    @Res() res?: Response,
  ) {
    const role = req?.user?.role;
    if (role && role !== 'ADMIN' && role !== 'OPS' && !req?.authMeta?.hasKey) {
      throw new HttpException(
        { ok: false, messageZh: '仅运营可导出科研快照审计' },
        HttpStatus.FORBIDDEN,
      );
    }
    const pack = exportResearchSnapshotAuditsCsv({
      q,
      jobId,
      actor,
      since,
      until,
      limit: Number(limit) || 500,
      redaction,
    });
    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', `attachment; filename="${pack.fileName}"`);
    res!.setHeader('X-Yanqi-Wave', 'M54');
    res!.setHeader('X-Yanqi-Audit-Count', String(pack.count));
    res!.setHeader('X-Yanqi-Audit-Redaction', pack.redaction);
    res!.send(pack.csv);
  }

  /** M52–M54：异步审计导出元信息（含 TTL/全局+租户配额） */
  @Get('research-snapshot-audits/export/async/meta')
  auditExportAsyncMeta(@Req() req: any) {
    this.assertOpsAudit(req);
    const stats = peekAuditExportAsyncStats();
    return {
      ok: true,
      wave: 'M54',
      threshold: researchSnapshotAuditAsyncThreshold(),
      redactionTiers: ['full', 'partner', 'public'],
      ttlMs: researchSnapshotAuditExportTtlMs(),
      quotaBytes: researchSnapshotAuditExportDiskQuotaBytes(),
      tenantQuotaBytes: researchSnapshotAuditExportTenantDiskQuotaBytes(),
      tenantIsolation: true,
      tenantsPathHint: 'exports/research-snapshot-audits/async/tenants/<tenantId>/',
      stats,
      tipZh: '大表审计导出请走 async：脱敏档 full|partner|public；可进度/取消/下载；M54 按租户隔离目录 + 租户/全局配额 + TTL，可 cleanup。',
      cleanupPath: '/api/jobs/research-snapshot-audits/export/async/cleanup',
    };
  }

  /** M53/M54：清理审计异步导出产物（TTL + 租户/全局磁盘配额） */
  @Post('research-snapshot-audits/export/async/cleanup')
  cleanupAuditExportArtifacts(@Req() req: any, @Body() body: { force?: boolean; tenantId?: string } = {}) {
    this.assertOpsAudit(req);
    const tf = tenantFilter(req);
    return cleanupResearchSnapshotAuditExportArtifacts({
      force: !!body?.force,
      tenantId: body?.tenantId ?? tf.tenantId ?? null,
    });
  }

  /** M52：启动异步审计大 CSV 导出 */
  @Post('research-snapshot-audits/export/async')
  startAuditExportAsync(
    @Req() req: any,
    @Body()
    body: {
      redaction?: string;
      q?: string;
      jobId?: string;
      actor?: string;
      since?: string;
      until?: string;
      limit?: number;
      tenantId?: string;
    } = {},
  ) {
    this.assertOpsAudit(req);
    const tf = tenantFilter(req);
    return startResearchSnapshotAuditExportAsync({
      redaction: body?.redaction,
      q: body?.q,
      jobId: body?.jobId,
      actor: body?.actor,
      since: body?.since,
      until: body?.until,
      limit: body?.limit,
      actorName: req?.user?.email || req?.user?.uid || 'ops',
      tenantId: body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || tf.tenantId || 'default',
    });
  }

  @Get('research-snapshot-audits/export/jobs')
  listAuditExports(@Req() req: any, @Query('limit') limit?: string) {
    this.assertOpsAudit(req);
    return {
      ok: true,
      wave: 'M54',
      items: listAuditExportJobs(Number(limit) || 20),
      stats: peekAuditExportAsyncStats(),
    };
  }

  @Get('research-snapshot-audits/export/jobs/:exportId')
  auditExportProgress(@Req() req: any, @Param('exportId') exportId: string) {
    this.assertOpsAudit(req);
    return auditExportJobProgress(exportId);
  }

  @Post('research-snapshot-audits/export/jobs/:exportId/cancel')
  cancelAuditExport(@Req() req: any, @Param('exportId') exportId: string) {
    this.assertOpsAudit(req);
    return cancelAuditExportJob(exportId);
  }

  @Get('research-snapshot-audits/export/jobs/:exportId/download')
  downloadAuditExport(@Req() req: any, @Param('exportId') exportId: string, @Res() res: Response) {
    this.assertOpsAudit(req);
    const pack = resolveAuditExportDownload(exportId);
    if (!pack.ok || !pack.filePath) {
      res.status(pack.job?.status === 'running' || pack.job?.status === 'queued' ? 409 : 404).json(pack);
      return;
    }
    const fs = require('fs');
    const name = pack.fileName || 'research-snapshot-audit-async.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.setHeader('X-Yanqi-Wave', 'M54');
    res.setHeader('X-Yanqi-Audit-Redaction', pack.job?.redaction || 'full');
    res.send(fs.readFileSync(pack.filePath));
  }

  private assertOpsAudit(req: any) {
    const role = req?.user?.role;
    if (role && role !== 'ADMIN' && role !== 'OPS' && !req?.authMeta?.hasKey) {
      throw new HttpException(
        { ok: false, messageZh: '仅运营可操作科研快照审计导出' },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** M45/M46：统一续跑任务卡；业务壳按 shell/kinds/org 收窄 */
  @Get('resume-cards')
  async resumeCards(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('shell') shellQ?: string,
    @Query('kinds') kinds?: string,
    @Query('scope') scope?: string,
  ) {
    const tf = tenantFilter(req);
    const n = Math.min(Math.max(Number(limit) || 12, 1), 40);
    let shell = shellQ || scope || '';
    if (!shell) {
      try {
        shell = resolveShell({
          role: req?.user?.role,
          orgId: req?.user?.orgId,
          orgType: req?.user?.orgType || req?.user?.org?.type,
        }).shell;
      } catch (_) {
        shell = req?.authMeta?.hasKey ? 'ops' : 'ops';
      }
    }
    if (req?.authMeta?.hasKey && !shellQ && !scope) shell = 'ops';
    return this.svc.listResumeCards({
      tenantId: tf.tenantId,
      limit: n,
      shell,
      orgId: req?.user?.orgId || null,
      actorEmail: req?.user?.email || null,
      actorUid: req?.user?.uid || null,
      kinds,
    });
  }

  /** M44/M46：SSE 进度流；匿名拒绝；优先 cookie / 短票 / Bearer / access_token */
  @Get('progress/stream')
  async progressStream(
    @Query('id') id: string | undefined,
    @Query('kind') kind: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!assertSseAuth(req, res)) return;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Yanqi-Sse-Auth', sseAuthHeader(req));
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

    let closed = false;
    const onClose = () => {
      closed = true;
    };
    req.on('close', onClose);

    const send = async () => {
      if (closed) return true;
      const p = await this.svc.progress(id, kind);
      res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`);
      return !p?.waiting;
    };

    try {
      let done = await send();
      while (!done && !closed) {
        await new Promise((r) => setTimeout(r, 900));
        done = await send();
      }
      if (!closed) {
        res.write(`event: end\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      }
    } catch (e: any) {
      if (!closed) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ ok: false, message: String(e?.message || e).slice(0, 200) })}\n\n`,
        );
      }
    } finally {
      req.off('close', onClose);
      if (!closed) res.end();
    }
  }

  @Post('match')
  match(@Body() body: any) {
    return this.svc.enqueueMatch(body || {});
  }

  @Post('crawl/openalex')
  crawlOpenAlex(@Body() body: any) {
    return this.svc.enqueueCrawl('openalex', body || {});
  }

  @Post('crawl/csv')
  crawlCsv(@Body() body: any) {
    return this.svc.enqueueCrawl('csv', body || {});
  }

  @Get(':id/progress')
  progressById(@Param('id') id: string, @Query('kind') kind?: string) {
    return this.svc.progress(id, kind);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() body: { scope?: 'all' | 'embed' | 'score'; reasonZh?: string } = {},
  ) {
    return this.svc.cancel(id, body || {});
  }

  /** M44/M77：匹配取消后按剩余 demandIds 续跑；可指定 phase=score|prewarm */
  @Post(':id/resume')
  resume(
    @Param('id') id: string,
    @Body() body: { phase?: 'score' | 'prewarm' | 'auto' } = {},
  ) {
    return this.svc.resumeMatch(id, body || {});
  }
}
