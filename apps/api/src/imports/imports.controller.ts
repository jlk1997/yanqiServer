import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { ImportsService } from './imports.service';
import * as fs from 'fs';
import { createAlertWebhookDraft, getAlertWebhookDraft, confirmAlertWebhookDraft, cancelAlertWebhookDraft } from '../common/alert-webhook-dual-confirm';

function assertSseAuth(req: any, res: Response): boolean {
  const meta = req?.authMeta || {};
  if (req?.user || meta.hasKey || meta.hasOpsCookie) return true;
  res.status(401).json({
    ok: false,
    code: 'SSE_AUTH_REQUIRED',
    messageZh:
      '导入进度推送需要登录：cookie / Bearer / ?sse_ticket=…（优先）或 ?access_token=…。匿名流已拒绝。',
  });
  return false;
}

@Controller('imports')
export class ImportsController {
  constructor(private imports: ImportsService) {}

  @Get('enterprise/template')
  templateInfo() {
    return this.imports.templateInfo();
  }

  @Get('enterprise/merge-strategies')
  mergeStrategies() {
    return {
      ok: true,
      default: 'fill-empty',
      items: [
        this.imports.mergeStrategyMeta('fill-empty'),
        this.imports.mergeStrategyMeta('skip'),
        this.imports.mergeStrategyMeta('overwrite'),
      ],
      tipZh: '取消或部分导入后再跑时，选冲突策略决定「库里已有同名/同码」怎么处理。',
    };
  }

  @Get('enterprise/template.csv')
  templateFile(@Res() res: Response) {
    const info = this.imports.templateInfo();
    const header = info.headers.join(',') + '\n';
    const sample =
      '示例科技有限公司,ENTERPRISE,上海,https://example.com,91310000MA1XXXX000,做工业视觉检测设备,产线缺陷检测提速,相机帧率不够导致漏检,工业视觉|缺陷检测,张工,zhang@example.com,技术总监,batch-2026-11\n';
    const p = this.imports.templatePath();
    try {
      fs.mkdirSync(require('path').dirname(p), { recursive: true });
      if (!fs.existsSync(p)) fs.writeFileSync(p, '\uFEFF' + header + sample, 'utf8');
    } catch (_) {}
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="enterprise-authorized-import.csv"');
    if (fs.existsSync(p)) return res.send(fs.readFileSync(p));
    return res.send('\uFEFF' + header + sample);
  }

  @Get('enterprise/jobs')
  list(@Query('tenantId') tenantId?: string) {
    return this.imports.list(tenantId || 'default');
  }

  @Get('enterprise/jobs/:id/progress')
  progress(@Param('id') id: string) {
    return this.imports.progress(id);
  }

  /** M44/M45：导入进度 SSE（匿名拒绝） */
  @Get('enterprise/jobs/:id/progress/stream')
  async progressStream(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    if (!assertSseAuth(req, res)) return;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader(
      'X-Yanqi-Sse-Auth',
      (req as any).authViaSseTicket ? 'sse-ticket' : (req as any).authViaQueryToken ? 'query-token' : 'session',
    );
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    let closed = false;
    const onClose = () => {
      closed = true;
    };
    req.on('close', onClose);
    const send = async () => {
      if (closed) return true;
      const p = await this.imports.progress(id);
      res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`);
      return !p?.waiting;
    };
    try {
      let done = await send();
      while (!done && !closed) {
        await new Promise((r) => setTimeout(r, 900));
        done = await send();
      }
      if (!closed) res.write(`event: end\ndata: ${JSON.stringify({ ok: true })}\n\n`);
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

  @Post('enterprise/jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.imports.cancelJob(id);
  }

  /** M45/M55/M65：续跑前冲突预览 · slim↔demand/person 游标对齐；?fields=summary|slim|rows · offset/limit · ETag · 批查 */
  @Get('enterprise/jobs/:id/conflict-preview')
  async conflictPreview(
    @Param('id') id: string,
    @Query('mergeStrategy') mergeStrategy: 'skip' | 'overwrite' | 'fill-empty' | undefined,
    @Query('full') full: string | undefined,
    @Query('fields') fields: string | undefined,
    @Query('fresh') fresh: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('skipRowIndexes') skipRowIndexes: string | undefined,
    @Query('confirmRowIndexes') confirmRowIndexes: string | undefined,
    @Query('respectRowDecisions') respectRowDecisions: string | undefined,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parseIdx = (raw?: string) =>
      String(raw || '')
        .split(/[,\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
    const body = await this.imports.conflictPreview(id, mergeStrategy, {
      full: full === '1' || full === 'true',
      fields: fields || 'rows',
      bypassCache: fresh === '1' || fresh === 'true',
      offset: offset != null && offset !== '' ? Number(offset) : undefined,
      limit: limit != null && limit !== '' ? Number(limit) : undefined,
      skipRowIndexes: parseIdx(skipRowIndexes),
      confirmRowIndexes: parseIdx(confirmRowIndexes),
      respectRowDecisions: respectRowDecisions !== '0' && respectRowDecisions !== 'false',
    });
    const etag = (body as any)?.etag;
    if (etag && (body as any)?.ok) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=4, stale-while-revalidate=12');
      res.setHeader('X-Yanqi-Conflict-Cache', (body as any).cache || 'MISS');
      res.setHeader('X-Yanqi-Conflict-Timing', String((body as any).timingMs ?? ''));
      res.setHeader('X-Yanqi-Wave', 'M67');
      if ((body as any)?.paging) {
        res.setHeader('X-Yanqi-Conflict-Offset', String((body as any).paging.offset ?? ''));
        res.setHeader('X-Yanqi-Conflict-Has-More', (body as any).paging.hasMore ? '1' : '0');
      }
      if (req.headers['if-none-match'] === etag) {
        res.status(304);
        return;
      }
    }
    return body;
  }

  /** M46/M48：冲突预览 CSV（默认抽样；?full=1 全量） */
  @Get('enterprise/jobs/:id/conflict-preview.csv')
  async conflictPreviewCsv(
    @Param('id') id: string,
    @Query('mergeStrategy') mergeStrategy: 'skip' | 'overwrite' | 'fill-empty' | undefined,
    @Query('full') full: string | undefined,
    @Res() res: Response,
  ) {
    const data = await this.imports.conflictPreview(id, mergeStrategy, {
      full: full === '1' || full === 'true',
    });
    if (!data?.ok) {
      res.status(404).json(data);
      return;
    }
    const body = this.imports.conflictRowsToCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="conflict-' +
        (data.full ? 'full-' : 'preview-') +
        id.slice(0, 8) +
        '.csv"',
    );
    res.setHeader('X-Yanqi-Conflict-Full', data.full ? '1' : '0');
    res.setHeader('X-Yanqi-Conflict-Rows', String((data.rows || []).length));
    res.send(body);
  }

  /** M48：全量冲突导出 CSV（始终 full） */
  @Get('enterprise/jobs/:id/conflict-export.csv')
  async conflictExportCsv(
    @Param('id') id: string,
    @Query('mergeStrategy') mergeStrategy: 'skip' | 'overwrite' | 'fill-empty' | undefined,
    @Res() res: Response,
  ) {
    const data = await this.imports.conflictPreview(id, mergeStrategy, { full: true });
    if (!data?.ok) {
      res.status(404).json(data);
      return;
    }
    const body = this.imports.conflictRowsToCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="conflict-full-' + id.slice(0, 8) + '.csv"',
    );
    res.setHeader('X-Yanqi-Conflict-Full', '1');
    res.setHeader('X-Yanqi-Conflict-Rows', String((data.rows || []).length));
    res.send(body);
  }

  /** M48：全量冲突导出 ZIP（CSV + summary.json） */
  @Get('enterprise/jobs/:id/conflict-export.zip')
  async conflictExportZip(
    @Param('id') id: string,
    @Query('mergeStrategy') mergeStrategy: 'skip' | 'overwrite' | 'fill-empty' | undefined,
    @Res() res: Response,
  ) {
    const pack = await this.imports.conflictExportZip(id, mergeStrategy);
    if (!pack?.ok) {
      res.status(404).json(pack);
      return;
    }
    const fs = require('fs');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + (pack.fileName || 'conflict-full.zip') + '"',
    );
    res.setHeader('X-Yanqi-Conflict-Full', '1');
    res.setHeader('X-Yanqi-Conflict-Rows', String(pack.exportedRows || 0));
    res.send(fs.readFileSync(pack.filePath));
  }

  /** M49/M50：异步冲突大文件导出元信息 */
  @Get('enterprise/conflict-export/async/meta')
  conflictExportAsyncMeta() {
    return this.imports.conflictExportAsyncMeta();
  }

  /** M50/M51：清理异步导出产物（TTL + 租户/全局磁盘配额） */
  @Post('enterprise/conflict-export/async/cleanup')
  cleanupConflictExportArtifacts(@Body() body: { tenantId?: string } = {}) {
    return this.imports.cleanupConflictExportArtifacts({ tenantId: body?.tenantId });
  }

  /** M52/M53：导出租户配额告警徽章数据（含双通道摘要） */
  @Get('enterprise/conflict-export/async/quota-warnings')
  conflictExportQuotaWarnings(@Query('tenantId') tenantId?: string) {
    return this.imports.tenantExportQuotaWarnings({ tenantId });
  }

  /** M53：配额告警双通道派发（草稿/干跑，不真发） */
  @Post('enterprise/conflict-export/async/quota-warnings/notify')
  conflictExportQuotaWarningsNotify(@Body() body: { tenantId?: string; force?: boolean } = {}) {
    return this.imports.dispatchExportQuotaAlertDualChannel({
      tenantId: body?.tenantId,
      force: body?.force !== false,
    });
  }

  /** M54：配额告警 Webhook 双确认 · 创建草稿（强制 dry-run 流） */
  @Post('enterprise/conflict-export/async/quota-warnings/webhook-draft')
  createQuotaWebhookDraft(@Req() req: any, @Body() body: { tenantId?: string } = {}) {
    return createAlertWebhookDraft({
      kind: 'export_quota',
      tenantId: body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default',
      actor: req?.user?.email || req?.user?.uid || 'ops',
    });
  }

  /** M54：配额 Webhook 确认卡 */
  @Get('enterprise/conflict-export/async/quota-warnings/webhook-draft/:draftId')
  getQuotaWebhookDraft(@Param('draftId') draftId: string) {
    return getAlertWebhookDraft(draftId);
  }

  /** M54：配额 Webhook 确认干跑 */
  @Post('enterprise/conflict-export/async/quota-warnings/webhook-draft/:draftId/confirm')
  confirmQuotaWebhookDraft(
    @Req() req: any,
    @Param('draftId') draftId: string,
    @Body() body: { live?: boolean } = {},
  ) {
    return confirmAlertWebhookDraft(draftId, {
      live: !!body?.live,
      actor: req?.user?.email || req?.user?.uid || 'ops',
    });
  }

  /** M54：取消配额 Webhook 草稿 */
  @Post('enterprise/conflict-export/async/quota-warnings/webhook-draft/:draftId/cancel')
  cancelQuotaWebhookDraft(@Param('draftId') draftId: string) {
    return cancelAlertWebhookDraft(draftId);
  }

  /** M49/M50：启动异步冲突导出（导入任务不存在 → 404，不入队） */
  @Post('enterprise/jobs/:id/conflict-export/async')
  async startConflictExportAsync(
    @Param('id') id: string,
    @Body()
    body: {
      format?: 'csv' | 'zip';
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
    } = {},
    @Req() req: any,
  ) {
    const result = await this.imports.startConflictExportAsyncJob(id, {
      format: body?.format === 'zip' ? 'zip' : 'csv',
      mergeStrategy: body?.mergeStrategy,
      actor: req?.user?.email || req?.user?.uid || 'ops',
      tenantId: req?.user?.tenantId || req?.resolvedTenantId || 'default',
    });
    if (result && (result as any).ok === false && (result as any).code === 'IMPORT_JOB_NOT_FOUND') {
      throw new HttpException(result, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  /** M49：列出某导入任务的异步导出 */
  @Get('enterprise/jobs/:id/conflict-export/jobs')
  listConflictExportJobs(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.imports.listConflictExportAsync(id, Number(limit) || 20);
  }

  /** M49：异步导出进度 */
  @Get('enterprise/jobs/:id/conflict-export/jobs/:exportId')
  conflictExportAsyncProgress(@Param('exportId') exportId: string) {
    return this.imports.conflictExportAsyncProgress(exportId);
  }

  /** M49：取消异步导出 */
  @Post('enterprise/jobs/:id/conflict-export/jobs/:exportId/cancel')
  cancelConflictExportAsync(@Param('exportId') exportId: string) {
    return this.imports.cancelConflictExportAsync(exportId);
  }

  /** M49：异步导出进度 SSE */
  @Get('enterprise/jobs/:id/conflict-export/jobs/:exportId/stream')
  async conflictExportAsyncStream(
    @Param('exportId') exportId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!assertSseAuth(req, res)) return;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    let closed = false;
    const onClose = () => {
      closed = true;
    };
    req.on('close', onClose);
    try {
      let done = false;
      while (!done && !closed) {
        const p = this.imports.conflictExportAsyncProgress(exportId);
        res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`);
        done = !p?.waiting;
        if (!done) await new Promise((r) => setTimeout(r, 700));
      }
      if (!closed) res.write(`event: end\ndata: ${JSON.stringify({ ok: true })}\n\n`);
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

  /** M49：下载已完成的异步冲突文件 */
  @Get('enterprise/jobs/:id/conflict-export/jobs/:exportId/download')
  downloadConflictExportAsync(@Param('exportId') exportId: string, @Res() res: Response) {
    const pack = this.imports.resolveConflictExportAsyncFile(exportId);
    if (!pack.ok || !pack.filePath) {
      res.status(pack.job?.status === 'running' || pack.job?.status === 'queued' ? 409 : 404).json(pack);
      return;
    }
    const fs = require('fs');
    const name = pack.fileName || 'conflict-async.bin';
    const isZip = name.endsWith('.zip');
    res.setHeader('Content-Type', isZip ? 'application/zip' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.setHeader('X-Yanqi-Conflict-Async', '1');
    res.setHeader('X-Yanqi-Conflict-Rows', String(pack.job?.exportedRows || 0));
    res.send(fs.readFileSync(pack.filePath));
  }

  /** M67：冲突按行确认/跳过决策（写入 job.report，预览/续跑尊重） */
  @Post('enterprise/jobs/:id/conflict-preview/row-decisions')
  setConflictRowDecisions(
    @Param('id') id: string,
    @Body()
    body: {
      decisions?: Record<string, 'confirm' | 'skip'> | Array<{ rowIndex: number; decision: 'confirm' | 'skip' }>;
      skipRowIndexes?: number[];
      confirmRowIndexes?: number[];
      allConfirmRowIndexes?: number[];
      allSkipRowIndexes?: number[];
      clear?: boolean;
      /** M70/M71 未决向导 */
      undecidedAction?: 'confirm' | 'skip';
      undecidedRowIndexes?: number[];
      slimOffset?: number;
      slimLimit?: number;
      conflictType?: string;
      bucket?: string;
      conflictTypes?: string[];
      pageCursor?: string;
      persistCursor?: boolean;
    } = {},
  ) {
    return this.imports.setConflictRowDecisions(id, body || {});
  }

  /** M70/M71/M72：未决行批量决策向导（可按冲突类型分桶 + 仅本桶跳过 + 持久化游标） */
  @Post('enterprise/jobs/:id/conflict-preview/undecided-wizard')
  undecidedWizard(
    @Param('id') id: string,
    @Body()
    body: {
      action?: 'confirm' | 'skip';
      rowIndexes?: number[];
      slimOffset?: number;
      slimLimit?: number;
      conflictType?: string;
      bucket?: string;
      conflictTypes?: string[];
      pageCursor?: string;
      persistCursor?: boolean;
      skipBucketOnly?: boolean;
    } = {},
  ) {
    return this.imports.undecidedBatchDecideWizard(id, body || {});
  }

  /** M72/M73：仅跳过指定冲突桶（org|demand|person） */
  @Post('enterprise/jobs/:id/conflict-preview/skip-bucket')
  skipBucketOnly(
    @Param('id') id: string,
    @Body()
    body: {
      bucket?: string;
      conflictType?: string;
      slimOffset?: number;
      slimLimit?: number;
      pageCursor?: string;
      persistCursor?: boolean;
    } = {},
  ) {
    return this.imports.skipConflictBucketOnly(id, body || {});
  }

  /** M73：撤销最近一次分桶跳过 */
  @Post('enterprise/jobs/:id/conflict-preview/undo-skip-bucket')
  undoSkipBucketOnly(@Param('id') id: string) {
    return this.imports.undoSkipConflictBucketOnly(id);
  }

  /** M73/M74：确认本桶未决 + 仅确认行续跑（可附写库预演） */
  @Post('enterprise/jobs/:id/conflict-preview/confirm-bucket-resume')
  confirmBucketAndResume(
    @Param('id') id: string,
    @Body()
    body: {
      bucket?: string;
      conflictType?: string;
      slimOffset?: number;
      slimLimit?: number;
      pageCursor?: string;
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
      persistCursor?: boolean;
      dryRunDecideOnly?: boolean;
      previewWritePlan?: boolean;
      previewOnly?: boolean;
    } = {},
  ) {
    return this.imports.confirmBucketAndResume(id, body || {});
  }

  /** M74/M75：回放分桶跳过决策差分时间线 */
  @Get('enterprise/jobs/:id/conflict-preview/skip-bucket-diff')
  skipBucketDiffReplay(@Param('id') id: string, @Req() req: any) {
    const limit = Number(req?.query?.limit) || undefined;
    const role = req?.query?.role || req?.user?.role || null;
    const orgType = req?.query?.orgType || req?.user?.orgType || null;
    return this.imports.replaySkipBucketDiff(id, { limit, role, orgType });
  }

  /** M75：跳到指定分桶跳过差分 seq 还原 */
  @Post('enterprise/jobs/:id/conflict-preview/skip-bucket-diff/restore')
  skipBucketDiffRestore(
    @Param('id') id: string,
    @Body() body: { seq?: number; dryRun?: boolean } = {},
  ) {
    return this.imports.restoreSkipBucketDiffAtSeq(id, body || {});
  }

  /** M76/M80：写库预演按字段确认/跳过（可落租户策略偏好） */
  @Post('enterprise/jobs/:id/conflict-preview/field-decisions')
  writePreviewFieldDecisions(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      decisions?: Array<{ rowIndex: number; field: string; decision: 'confirm' | 'skip' | null }>;
      fieldDecisions?: Record<string, 'confirm' | 'skip' | null>;
      clear?: boolean;
      bucket?: string;
      batch?: {
        rowIndexes?: number[];
        field?: string;
        fields?: string[];
        decision?: 'confirm' | 'skip' | null;
      } | null;
      rowIndexes?: number[];
      field?: string;
      fields?: string[];
      decision?: 'confirm' | 'skip' | null;
      /** M79/M81 */
      strategyTemplate?: 'overwrite' | 'fill-empty' | 'skip' | null;
      strategyByFieldType?: Record<string, 'overwrite' | 'fill-empty' | 'skip'> | null;
      applyStrategyTemplates?: boolean;
      persistTenantPrefs?: boolean;
      lastScrubberSpeed?: number | null;
      role?: string | null;
      orgType?: string | null;
      asRoleOverlay?: boolean | null;
    } = {},
  ) {
    const role = body?.role || req?.user?.role || null;
    const orgType = body?.orgType || req?.user?.orgType || null;
    return this.imports.setWritePreviewFieldDecisions(id, {
      ...(body || {}),
      role,
      orgType,
    });
  }

    /** M80/M81：冲突预览租户偏好（字段策略默认 + scrubber 倍速 + 角色覆盖） */
  @Get('enterprise/conflict-ui-prefs')
  getConflictUiPrefs(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('role') role?: string,
    @Query('orgType') orgType?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.readConflictUiPrefs(tid, {
      role: role || req?.user?.role || null,
      orgType: orgType || req?.user?.orgType || null,
      applyRoleOverlay: true,
    });
  }

  @Put('enterprise/conflict-ui-prefs')
  putConflictUiPrefs(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      strategyByFieldType?: Record<string, 'overwrite' | 'fill-empty' | 'skip'> | null;
      lastScrubberSpeed?: number | null;
      strategyTemplate?: 'overwrite' | 'fill-empty' | 'skip' | null;
      role?: string | null;
      orgType?: string | null;
      asRoleOverlay?: boolean | null;
      roleOverlay?: {
        strategyByFieldType?: Record<string, 'overwrite' | 'fill-empty' | 'skip'> | null;
        lastScrubberSpeed?: number | null;
        strategyTemplate?: 'overwrite' | 'fill-empty' | 'skip' | null;
      } | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.writeConflictUiPrefs(tid, {
      ...(body || {}),
      role: body?.role || req?.user?.role || null,
      orgType: body?.orgType || req?.user?.orgType || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs')
  postConflictUiPrefs(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      strategyByFieldType?: Record<string, 'overwrite' | 'fill-empty' | 'skip'> | null;
      lastScrubberSpeed?: number | null;
      strategyTemplate?: 'overwrite' | 'fill-empty' | 'skip' | null;
      role?: string | null;
      orgType?: string | null;
      asRoleOverlay?: boolean | null;
      roleOverlay?: {
        strategyByFieldType?: Record<string, 'overwrite' | 'fill-empty' | 'skip'> | null;
        lastScrubberSpeed?: number | null;
        strategyTemplate?: 'overwrite' | 'fill-empty' | 'skip' | null;
      } | null;
    } = {},
  ) {
    return this.putConflictUiPrefs(req, body);
  }



  /** M82：角色覆盖 A/B 预演（租户默认 vs 角色覆盖并排；可带草稿；不落盘） */
  @Get('enterprise/conflict-ui-prefs/ab-preview')
  getConflictUiAbPreview(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('role') role?: string,
    @Query('orgType') orgType?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.previewConflictUiRoleOverlayAb(tid, {
      role: role || req?.user?.role || null,
      orgType: orgType || req?.user?.orgType || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-preview')
  postConflictUiAbPreview(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      role?: string | null;
      orgType?: string | null;
      roleOverlay?: any;
      bucketFieldDefaults?: any;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.previewConflictUiRoleOverlayAb(tid, {
      role: body?.role || req?.user?.role || null,
      orgType: body?.orgType || req?.user?.orgType || null,
      roleOverlay: body?.roleOverlay || null,
      bucketFieldDefaults: body?.bucketFieldDefaults || null,
    });
  }

  /** M83/M84：A/B 预演一键应用角色覆盖（落盘；可撤销） */
  @Post('enterprise/conflict-ui-prefs/ab-apply')
  postConflictUiAbApply(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      role?: string | null;
      orgType?: string | null;
      roleOverlay?: any;
      bucketFieldDefaults?: any;
      lastScrubberSpeed?: number | null;
      strategyByFieldType?: Record<string, 'overwrite' | 'fill-empty' | 'skip'> | null;
      strategyTemplate?: 'overwrite' | 'fill-empty' | 'skip' | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.applyConflictUiRoleOverlayAb(tid, {
      role: body?.role || req?.user?.role || null,
      orgType: body?.orgType || req?.user?.orgType || null,
      roleOverlay: body?.roleOverlay || null,
      bucketFieldDefaults: body?.bucketFieldDefaults || null,
      lastScrubberSpeed: body?.lastScrubberSpeed,
      strategyByFieldType: body?.strategyByFieldType || null,
      strategyTemplate: body?.strategyTemplate || null,
    });
  }

  /** M84：撤销上次 A/B 一键应用 */
  @Post('enterprise/conflict-ui-prefs/ab-apply/undo')
  postConflictUiAbApplyUndo(
    @Req() req: any,
    @Body() body: { tenantId?: string } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.undoConflictUiRoleOverlayAbApply(tid);
  }

  /** M85/M86：A/B 应用/撤销差分时间线（含 scrubber） */
  @Get('enterprise/conflict-ui-prefs/ab-apply/timeline')
  getConflictUiAbTimeline(@Req() req: any, @Query('tenantId') tenantId?: string) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.getConflictUiAbDiffTimeline(tid);
  }

  /** M86/M88：A/B 时间线 scrubber seek/暂停；M88 套用前 diff 确认卡，ack 后真套用 */
  @Post('enterprise/conflict-ui-prefs/ab-apply/timeline/seek')
  postConflictUiAbTimelineSeek(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      seq?: number;
      pause?: boolean;
      applyPreview?: boolean;
      confirmApply?: boolean;
      confirm?: boolean;
      applyReal?: boolean;
      previewConfirm?: boolean;
      showConfirmCard?: boolean;
      confirmCardAck?: boolean;
      ackConfirmCard?: boolean;
      applyOnlyRole?: string | null;
      onlyRole?: string | null;
      applyOnlyBucket?: string | null;
      onlyBucket?: string | null;
      applyFoldedRole?: string | null;
      applyFoldedBucket?: string | null;
      applyOnlyRoles?: string[] | null;
      applyOnlyBuckets?: string[] | null;
      onlyRoles?: string[] | null;
      onlyBuckets?: string[] | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.seekConflictUiAbDiffTimeline(tid, body || {});
  }

  /** M94：按角色列出/保存/套用排除字段模板 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates')
  listExceptFieldsTemplates(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('role') role?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.listExceptFieldsTemplatesByRole(tid, role || req?.user?.role || null);
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates')
  saveExceptFieldsTemplate(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      role?: string | null;
      nameZh?: string | null;
      templateId?: string | null;
      exceptFieldsByBucket?: Record<string, string[]>;
      selectAllExceptByBucket?: Record<string, string[]>;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.saveExceptFieldsTemplateByRole(tid, {
      ...body,
      role: body?.role || req?.user?.role || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/apply')
  applyExceptFieldsTemplate(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      role?: string | null;
      templateId?: string | null;
      nameZh?: string | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.applyExceptFieldsTemplateByRole(tid, {
      ...body,
      role: body?.role || req?.user?.role || null,
    });
  }

  /** M94：可撤销摘要帧 → 站内一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager')
  undoableSummaryOnePagerGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.renderUndoableSummaryAsInAppOnePager(tid, {
      seq: seq != null ? Number(seq) : null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager')
  undoableSummaryOnePagerPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      seq?: number | null;
      summary?: any;
      titleZh?: string | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.renderUndoableSummaryAsInAppOnePager(tid, body || {});
  }


  /** M95：排除字段模板跨角色只读共享预览 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview')
  exceptFieldsTemplateSharedPreviewGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('templateId') templateId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.previewExceptFieldsTemplateSharedReadOnly(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      templateId: templateId || null,
      readOnly: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview')
  exceptFieldsTemplateSharedPreviewPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      fromRole?: string | null;
      toRole?: string | null;
      templateId?: string | null;
      nameZh?: string | null;
      readOnly?: boolean;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.previewExceptFieldsTemplateSharedReadOnly(tid, body || {});
  }

  /** M95：可撤销摘要一页纸并入匹配解释侧栏 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar')
  undoSummaryOnePagerMatchExplainSidebarGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.foldUndoableSummaryOnePagerIntoMatchExplainSidebar(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar')
  undoSummaryOnePagerMatchExplainSidebarPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      seq?: number | null;
      summary?: any;
      titleZh?: string | null;
      matchId?: string | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.foldUndoableSummaryOnePagerIntoMatchExplainSidebar(tid, body || {});
  }


  /** M96：只读共享预览复制为本角色草稿 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft')
  exceptSharedPreviewCopyAsMyRoleDraftGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('templateId') templateId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.copyExceptFieldsTemplateSharedPreviewAsMyRoleDraft(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      templateId: templateId || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft')
  exceptSharedPreviewCopyAsMyRoleDraftPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      fromRole?: string | null;
      toRole?: string | null;
      myRole?: string | null;
      role?: string | null;
      templateId?: string | null;
      nameZh?: string | null;
      draftNameZh?: string | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.copyExceptFieldsTemplateSharedPreviewAsMyRoleDraft(tid, body || {});
  }

  /** M96：侧栏摘要联动真实 matchId 一页纸高亮 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight')
  undoSidebarMatchHighlightGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('sidebarItemId') sidebarItemId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.highlightMatchExplainSidebarToMatchOnePager(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      sidebarItemId: sidebarItemId || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight')
  undoSidebarMatchHighlightPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      seq?: number | null;
      summary?: any;
      titleZh?: string | null;
      matchId?: string | null;
      sidebarItemId?: string | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.highlightMatchExplainSidebarToMatchOnePager(tid, body || {});
  }


  /** M97：本角色草稿 ↔ 共享源差分 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source')
  exceptDraftDiffSharedSourceGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('templateId') templateId?: string,
    @Query('draftId') draftId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.diffMyRoleDraftAgainstSharedSourceExceptTemplate(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      templateId: templateId || null,
      draftId: draftId || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source')
  exceptDraftDiffSharedSourcePost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      fromRole?: string | null;
      toRole?: string | null;
      myRole?: string | null;
      role?: string | null;
      templateId?: string | null;
      draftId?: string | null;
      nameZh?: string | null;
      draftNameZh?: string | null;
      ensureCopy?: boolean;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.diffMyRoleDraftAgainstSharedSourceExceptTemplate(tid, body || {});
  }

  /** M97：侧栏高亮 ↔ 一页纸章节双向 seek */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek')
  undoSidebarMatchHighlightBidirSeekGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('sidebarItemId') sidebarItemId?: string,
    @Query('direction') direction?: string,
    @Query('sectionId') sectionId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.bidirectionalSeekSidebarHighlightAndOnePagerSections(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      sidebarItemId: sidebarItemId || null,
      direction: direction || 'both',
      sectionId: sectionId || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek')
  undoSidebarMatchHighlightBidirSeekPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      seq?: number | null;
      summary?: any;
      titleZh?: string | null;
      matchId?: string | null;
      sidebarItemId?: string | null;
      direction?: string | null;
      sectionId?: string | null;
      sectionKey?: string | null;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.bidirectionalSeekSidebarHighlightAndOnePagerSections(tid, body || {});
  }

  /** M98：草稿差分一键回同步共享源 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync')
  exceptDraftDiffSharedSourceResyncGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('templateId') templateId?: string,
    @Query('draftId') draftId?: string,
    @Query('previewConfirm') previewConfirm?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncMyRoleDraftToSharedSourceExceptTemplate(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      templateId: templateId || null,
      draftId: draftId || null,
      previewConfirm: previewConfirm !== '0' && previewConfirm !== 'false',
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync')
  exceptDraftDiffSharedSourceResyncPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      fromRole?: string | null;
      toRole?: string | null;
      myRole?: string | null;
      role?: string | null;
      templateId?: string | null;
      draftId?: string | null;
      nameZh?: string | null;
      draftNameZh?: string | null;
      ensureCopy?: boolean;
      confirmResync?: boolean;
      confirmCardAck?: boolean;
      previewConfirm?: boolean;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncMyRoleDraftToSharedSourceExceptTemplate(tid, body || {});
  }

  /** M98：双向 seek 记住上次一页纸章节锚点 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor')
  undoSidebarMatchHighlightBidirSeekRememberAnchorGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('sidebarItemId') sidebarItemId?: string,
    @Query('direction') direction?: string,
    @Query('sectionId') sectionId?: string,
    @Query('useRemembered') useRemembered?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.bidirectionalSeekRememberLastSectionAnchor(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      sidebarItemId: sidebarItemId || null,
      direction: direction || 'both',
      sectionId: sectionId || null,
      useRemembered: useRemembered === '1' || useRemembered === 'true' || !sectionId,
      remember: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor')
  undoSidebarMatchHighlightBidirSeekRememberAnchorPost(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      seq?: number | null;
      summary?: any;
      titleZh?: string | null;
      matchId?: string | null;
      sidebarItemId?: string | null;
      direction?: string | null;
      sectionId?: string | null;
      sectionKey?: string | null;
      remember?: boolean;
      useRemembered?: boolean;
      clearRemembered?: boolean;
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.bidirectionalSeekRememberLastSectionAnchor(tid, body || {});
  }



  /** M99：草稿按分桶选择性回同步共享源 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets')
  exceptDraftResyncSelectiveBucketsGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('buckets') buckets?: string,
    @Query('previewConfirm') previewConfirm?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const bucketList = buckets
      ? String(buckets).split(',').map((s) => s.trim()).filter(Boolean)
      : ['org', 'demand'];
    return this.imports.resyncMyRoleDraftToSharedSourceSelectiveByBuckets(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      buckets: bucketList,
      previewConfirm: previewConfirm !== '0' && previewConfirm !== 'false',
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets')
  exceptDraftResyncSelectiveBucketsPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncMyRoleDraftToSharedSourceSelectiveByBuckets(tid, body || {});
  }

  /** M99：双向 seek 记住锚点按 matchId 分桶 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id')
  undoSidebarBidirSeekRememberAnchorByMatchIdGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('sidebarItemId') sidebarItemId?: string,
    @Query('direction') direction?: string,
    @Query('sectionId') sectionId?: string,
    @Query('useRemembered') useRemembered?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.bidirectionalSeekRememberLastSectionAnchorByMatchId(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      sidebarItemId: sidebarItemId || null,
      direction: direction || 'both',
      sectionId: sectionId || null,
      useRemembered: useRemembered === '1' || useRemembered === 'true' || !sectionId,
      remember: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id')
  undoSidebarBidirSeekRememberAnchorByMatchIdPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.bidirectionalSeekRememberLastSectionAnchorByMatchId(tid, body || {});
  }




  /** M100：分桶回同步 before/after 对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast')
  exceptDraftResyncSelectiveBucketsContrastGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('buckets') buckets?: string,
    @Query('previewConfirm') previewConfirm?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const bucketList = buckets
      ? String(buckets).split(',').map((s) => s.trim()).filter(Boolean)
      : ['org', 'demand'];
    return this.imports.resyncSelectiveBucketsWithBeforeAfterContrast(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      buckets: bucketList,
      previewConfirm: previewConfirm !== '0' && previewConfirm !== 'false',
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast')
  exceptDraftResyncSelectiveBucketsContrastPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncSelectiveBucketsWithBeforeAfterContrast(tid, body || {});
  }

  /** M100：matchId 锚点跨会话模板 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template')
  undoSidebarBidirSeekRememberAnchorCrossSessionGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('loadTemplate') loadTemplate?: string,
    @Query('listTemplates') listTemplates?: string,
    @Query('saveAsTemplate') saveAsTemplate?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCrossSessionTemplateByMatchId(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      sectionId: sectionId || null,
      loadTemplate: loadTemplate === '1' || loadTemplate === 'true',
      listTemplates: listTemplates === '1' || listTemplates === 'true',
      saveAsTemplate: saveAsTemplate !== '0' && saveAsTemplate !== 'false',
      remember: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template')
  undoSidebarBidirSeekRememberAnchorCrossSessionPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCrossSessionTemplateByMatchId(tid, body || {});
  }

  /** M101：分桶回同步 · 只同步变更桶 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only')
  exceptDraftResyncSyncChangedBucketsOnlyGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('buckets') buckets?: string,
    @Query('previewConfirm') previewConfirm?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const bucketList = buckets
      ? String(buckets).split(',').map((s) => s.trim()).filter(Boolean)
      : ['org', 'demand', 'person'];
    return this.imports.resyncSelectiveBucketsSyncChangedOnly(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      buckets: bucketList,
      previewConfirm: previewConfirm !== '0' && previewConfirm !== 'false',
      syncChangedBucketsOnly: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only')
  exceptDraftResyncSyncChangedBucketsOnlyPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncSelectiveBucketsSyncChangedOnly(tid, {
      ...(body || {}),
      syncChangedBucketsOnly: body?.syncChangedBucketsOnly !== false,
    });
  }

  /** M101：matchId 锚点跨会话模板 · 按角色分套 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role')
  undoSidebarBidirSeekRememberAnchorCrossSessionByRoleGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('loadTemplate') loadTemplate?: string,
    @Query('listTemplates') listTemplates?: string,
    @Query('saveAsTemplate') saveAsTemplate?: string,
    @Query('role') role?: string,
    @Query('myRole') myRole?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCrossSessionTemplateByRole(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      sectionId: sectionId || null,
      loadTemplate: loadTemplate === '1' || loadTemplate === 'true',
      listTemplates: listTemplates === '1' || listTemplates === 'true',
      saveAsTemplate: saveAsTemplate !== '0' && saveAsTemplate !== 'false',
      remember: true,
      role: role || myRole || 'broker',
      myRole: myRole || role || 'broker',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role')
  undoSidebarBidirSeekRememberAnchorCrossSessionByRolePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCrossSessionTemplateByRole(tid, body || {});
  }

  /** M102：只同步变更桶 · 跳过清单预览 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview')
  exceptDraftResyncSkipListPreviewGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('buckets') buckets?: string,
    @Query('previewConfirm') previewConfirm?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const bucketList = buckets
      ? String(buckets).split(',').map((s) => s.trim()).filter(Boolean)
      : ['org', 'demand', 'person'];
    return this.imports.resyncChangedBucketsSkipListPreview(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      buckets: bucketList,
      previewConfirm: previewConfirm !== '0' && previewConfirm !== 'false',
      previewSkipList: true,
      syncChangedBucketsOnly: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview')
  exceptDraftResyncSkipListPreviewPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncChangedBucketsSkipListPreview(tid, {
      ...(body || {}),
      syncChangedBucketsOnly: body?.syncChangedBucketsOnly !== false,
      previewSkipList: body?.previewSkipList !== false,
    });
  }

  /** M102：按角色跨会话模板 · 跨租户只读克隆 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone')
  undoSidebarByRoleTemplateCrossTenantCloneGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('cloneFromTenant') cloneFromTenant?: string,
    @Query('listTemplates') listTemplates?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorByRoleTemplateCrossTenantReadOnlyClone(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      role: role || 'broker',
      myRole: role || 'broker',
      cloneFromTenant: cloneFromTenant || 'demo-peer',
      crossTenantClone: true,
      readOnlyClone: true,
      listTemplates: listTemplates === '1' || listTemplates === 'true',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone')
  undoSidebarByRoleTemplateCrossTenantClonePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorByRoleTemplateCrossTenantReadOnlyClone(tid, body || {});
  }

  /** M103：跳过清单 · 勾选强制纳入 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks')
  exceptDraftResyncSkipListForceIncludeGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('buckets') buckets?: string,
    @Query('forceInclude') forceInclude?: string,
    @Query('previewConfirm') previewConfirm?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const bucketList = buckets
      ? String(buckets).split(',').map((s) => s.trim()).filter(Boolean)
      : ['org', 'demand', 'person'];
    const forceList = forceInclude
      ? String(forceInclude).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.imports.resyncSkipListForceIncludePicks(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || null,
      buckets: bucketList,
      forceIncludeBuckets: forceList,
      forceIncludePicks: true,
      previewConfirm: previewConfirm !== '0' && previewConfirm !== 'false',
      previewSkipList: true,
      syncChangedBucketsOnly: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks')
  exceptDraftResyncSkipListForceIncludePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncSkipListForceIncludePicks(tid, {
      ...(body || {}),
      forceIncludePicks: body?.forceIncludePicks !== false,
      previewSkipList: body?.previewSkipList !== false,
    });
  }

  /** M103：跨租户只读克隆 · 差分预览再采纳 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt')
  undoSidebarCloneDiffPreviewAdoptGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('cloneFromTenant') cloneFromTenant?: string,
    @Query('diffPreview') diffPreview?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorByRoleTemplateCrossTenantCloneDiffPreviewThenAdopt(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      role: role || 'broker',
      myRole: role || 'broker',
      cloneFromTenant: cloneFromTenant || 'demo-peer',
      crossTenantClone: true,
      readOnlyClone: true,
      diffPreview: diffPreview !== '0' && diffPreview !== 'false',
      showDiffPreview: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt')
  undoSidebarCloneDiffPreviewAdoptPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorByRoleTemplateCrossTenantCloneDiffPreviewThenAdopt(tid, body || {});
  }


  /** M104：强制纳入 · 存为角色默认 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults')
  exceptDraftForceIncludeRoleDefaultsGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('fromRole') fromRole?: string,
    @Query('toRole') toRole?: string,
    @Query('myRole') myRole?: string,
    @Query('forceInclude') forceInclude?: string,
    @Query('useRoleDefaults') useRoleDefaults?: string,
    @Query('saveAsRoleDefaults') saveAsRoleDefaults?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const forceList = forceInclude
      ? String(forceInclude).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.imports.resyncForceIncludeSaveAsRoleDefaults(tid, {
      fromRole: fromRole || null,
      toRole: toRole || null,
      myRole: myRole || toRole || 'broker',
      forceIncludeBuckets: forceList,
      forceIncludePicks: true,
      useRoleDefaults: useRoleDefaults === '1' || useRoleDefaults === 'true',
      saveAsRoleDefaults: saveAsRoleDefaults === '1' || saveAsRoleDefaults === 'true',
      previewSkipList: true,
      previewConfirm: true,
      syncChangedBucketsOnly: true,
      buckets: ['org', 'demand', 'person'],
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults')
  exceptDraftForceIncludeRoleDefaultsPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeSaveAsRoleDefaults(tid, {
      ...(body || {}),
      forceIncludePicks: body?.forceIncludePicks !== false,
      previewSkipList: body?.previewSkipList !== false,
    });
  }

  /** M104：跨租户克隆差分 · 字段子集采纳 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset')
  undoSidebarCloneDiffFieldSubsetGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('seq') seq?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('cloneFromTenant') cloneFromTenant?: string,
    @Query('adoptFields') adoptFields?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const fields = adoptFields
      ? String(adoptFields).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.imports.rememberAnchorCloneDiffFieldSubsetAdopt(tid, {
      seq: seq != null ? Number(seq) : null,
      matchId: matchId || null,
      role: role || 'broker',
      myRole: role || 'broker',
      cloneFromTenant: cloneFromTenant || 'demo-peer',
      crossTenantClone: true,
      readOnlyClone: true,
      diffPreview: true,
      showDiffPreview: true,
      fieldSubsetAdopt: true,
      adoptFields: fields,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset')
  undoSidebarCloneDiffFieldSubsetPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetAdopt(tid, {
      ...(body || {}),
      fieldSubsetAdopt: body?.fieldSubsetAdopt !== false,
    });
  }

  /** M105：强制纳入角色默认 A/B 对照套用 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply')
  exceptDraftForceIncludeRoleDefaultsAbGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('roleA') roleA?: string,
    @Query('roleB') roleB?: string,
    @Query('targetRole') targetRole?: string,
    @Query('applyWinner') applyWinner?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbCompareApply(tid, {
      roleA: roleA || 'broker',
      roleB: roleB || 'admin',
      targetRole: targetRole || roleA || 'broker',
      applyWinner: applyWinner === '1' || applyWinner === 'true',
      abCompare: true,
      ensureSaveA: true,
      ensureSaveB: true,
      previewSkipList: true,
      syncChangedBucketsOnly: true,
      buckets: ['org', 'demand', 'person'],
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply')
  exceptDraftForceIncludeRoleDefaultsAbPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbCompareApply(tid, {
      ...(body || {}),
      abCompare: body?.abCompare !== false,
      ensureSaveA: body?.ensureSaveA !== false,
      ensureSaveB: body?.ensureSaveB !== false,
    });
  }

  /** M105：克隆差分字段子集采纳软撤销 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo')
  undoSidebarCloneDiffFieldSubsetSoftUndoGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetAdoptSoftUndo(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo')
  undoSidebarCloneDiffFieldSubsetSoftUndoPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetAdoptSoftUndo(tid, body || {});
  }


  /** M106：角色默认 A/B 胜出侧软撤销 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo')
  exceptDraftForceIncludeRoleDefaultsAbSoftUndoGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('roleA') roleA?: string,
    @Query('roleB') roleB?: string,
    @Query('targetRole') targetRole?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbCompareApplySoftUndo(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      roleA: roleA || 'broker',
      roleB: roleB || 'admin',
      targetRole: targetRole || roleA || 'broker',
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo')
  exceptDraftForceIncludeRoleDefaultsAbSoftUndoPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbCompareApplySoftUndo(tid, body || {});
  }

  /** M106：字段子集软撤销前后对照卡 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast')
  undoSidebarCloneDiffFieldSubsetSoftUndoBeforeAfterGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('showBeforeAfterCard') showBeforeAfterCard?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetAdoptSoftUndoBeforeAfterContrast(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: showBeforeAfterCard !== '0' && showBeforeAfterCard !== 'false',
      beforeAfterContrast: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast')
  undoSidebarCloneDiffFieldSubsetSoftUndoBeforeAfterPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetAdoptSoftUndoBeforeAfterContrast(tid, body || {});
  }

  /** M107：A/B 胜出侧软撤销前后对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast')
  exceptDraftForceIncludeRoleDefaultsAbSoftUndoBeforeAfterGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('roleA') roleA?: string,
    @Query('roleB') roleB?: string,
    @Query('targetRole') targetRole?: string,
    @Query('showBeforeAfterCard') showBeforeAfterCard?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbCompareApplySoftUndoBeforeAfterContrast(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      roleA: roleA || 'broker',
      roleB: roleB || 'admin',
      targetRole: targetRole || roleA || 'broker',
      showBeforeAfterCard: showBeforeAfterCard !== '0' && showBeforeAfterCard !== 'false',
      beforeAfterContrast: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast')
  exceptDraftForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbCompareApplySoftUndoBeforeAfterContrast(tid, body || {});
  }

  /** M107：字段子集软撤销前后卡定点/只采纳一侧 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt')
  undoSidebarCloneDiffFieldSubsetSoftUndoBaPinpointOnesideGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('pinpointAnnotate') pinpointAnnotate?: string,
    @Query('annotateFields') annotateFields?: string,
    @Query('adoptOneSideOnly') adoptOneSideOnly?: string,
    @Query('adoptSide') adoptSide?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const fields = annotateFields
      ? String(annotateFields).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.imports.rememberAnchorCloneDiffFieldSubsetSoftUndoBeforeAfterPinpointOnesideAdopt(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: pinpointAnnotate === '1' || pinpointAnnotate === 'true' || fields.length > 0,
      annotateFields: fields,
      adoptOneSideOnly: adoptOneSideOnly === '1' || adoptOneSideOnly === 'true' || !!adoptSide,
      adoptSide: adoptSide || null,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt')
  undoSidebarCloneDiffFieldSubsetSoftUndoBaPinpointOnesidePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetSoftUndoBeforeAfterPinpointOnesideAdopt(tid, body || {});
  }

  /** M108：A/B 胜出侧软撤销前后卡定点标注 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint')
  exceptDraftAbSoftUndoBeforeAfterPinpointGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('targetRole') targetRole?: string,
    @Query('pinpointAnnotate') pinpointAnnotate?: string,
    @Query('annotateFields') annotateFields?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const fields = annotateFields
      ? String(annotateFields).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.imports.resyncForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPinpoint(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      targetRole: targetRole || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: pinpointAnnotate !== '0' && pinpointAnnotate !== 'false',
      annotateFields: fields.length ? fields : ['org', 'person'],
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint')
  exceptDraftAbSoftUndoBeforeAfterPinpointPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPinpoint(tid, body || {});
  }

  /** M108：只采纳一侧可软撤销中文摘要 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary')
  undoSidebarOnesideAdoptSoftUndoSummaryGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetPinpointOnesideAdoptSoftUndoSummary(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary')
  undoSidebarOnesideAdoptSoftUndoSummaryPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorCloneDiffFieldSubsetPinpointOnesideAdoptSoftUndoSummary(tid, body || {});
  }


  /** M109：胜出侧前后卡定点触发供给再旁路 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass')
  exceptDraftAbSoftUndoBeforeAfterPinpointReBypassGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('targetRole') targetRole?: string,
    @Query('pinpointAnnotate') pinpointAnnotate?: string,
    @Query('annotateFields') annotateFields?: string,
    @Query('oneClickReBypass') oneClickReBypass?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const fields = annotateFields
      ? String(annotateFields).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.imports.resyncForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPinpointReBypass(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      targetRole: targetRole || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: pinpointAnnotate !== '0' && pinpointAnnotate !== 'false',
      annotateFields: fields.length ? fields : ['org', 'person'],
      pinpointToSupplyReBypass: true,
      oneClickReBypass: oneClickReBypass !== '0' && oneClickReBypass !== 'false',
      reBypass: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass')
  exceptDraftAbSoftUndoBeforeAfterPinpointReBypassPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPinpointReBypass(tid, body || {});
  }

  /** M109：一侧可软撤销摘要 scrubber 进 A/B 时间线 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline')
  undoSidebarOnesideAdoptSoftUndoSummaryScrubAbTimelineGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('scrubIntoAbTimeline') scrubIntoAbTimeline?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorOnesideAdoptSoftUndoSummaryScrubAbTimeline(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: scrubIntoAbTimeline !== '0' && scrubIntoAbTimeline !== 'false',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline')
  undoSidebarOnesideAdoptSoftUndoSummaryScrubAbTimelinePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorOnesideAdoptSoftUndoSummaryScrubAbTimeline(tid, body || {});
  }


  /** M110：定点再旁路失败并入归因 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr')
  exceptDraftPinpointRebypassFailFoldAttrGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('targetRole') targetRole?: string,
    @Query('simulateFailure') simulateFailure?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPinpointReBypassFailFoldAttr(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      targetRole: targetRole || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateFields: ['org', 'person'],
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: simulateFailure === '1' || simulateFailure === 'true' || true,
      forceFailure: true,
      failureCode: failureCode || 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr')
  exceptDraftPinpointRebypassFailFoldAttrPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludeRoleDefaultsAbSoftUndoBeforeAfterPinpointReBypassFailFoldAttr(tid, body || {});
  }

  /** M110：A/B 时间线摘要帧定点标注 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint')
  undoSidebarSummaryFramePinpointGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorOnesideAdoptSoftUndoSummaryScrubAbTimelineSummaryFramePinpoint(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint')
  undoSidebarSummaryFramePinpointPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorOnesideAdoptSoftUndoSummaryScrubAbTimelineSummaryFramePinpoint(tid, body || {});
  }



  /** M111：失败归因一键重试折进任务卡 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card')
  exceptDraftFailFoldRetryFoldTaskCardGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('targetRole') targetRole?: string,
    @Query('simulateFailure') simulateFailure?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      targetRole: targetRole || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateFields: ['org', 'person'],
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: simulateFailure === '1' || simulateFailure === 'true' || true,
      forceFailure: true,
      failureCode: failureCode || 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card')
  exceptDraftFailFoldRetryFoldTaskCardPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, body || {});
  }

  /** M111：A/B 摘要帧定点触发供给再旁路 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass')
  undoSidebarSummaryPinpointSupplyRebypassGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypass(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass')
  undoSidebarSummaryPinpointSupplyRebypassPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypass(tid, body || {});
  }

  /** M112：失败归因一键重试折进任务卡 · 单阶段暂停宽限 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace')
  exceptDraftFailFoldRetryFoldTaskCardPhasePauseGraceGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('targetRole') targetRole?: string,
    @Query('graceMs') graceMs?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      targetRole: targetRole || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateFields: ['org', 'person'],
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace')
  exceptDraftFailFoldRetryFoldTaskCardPhasePauseGracePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, body || {});
  }

  /** M112：摘要帧定点再旁路前后对照（失败并入归因） */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after')
  undoSidebarSummaryPinpointSupplyRebypassBeforeAfterGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfter(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: simulateFailure === '1' || simulateFailure === 'true',
      forceFailure: simulateFailure === '1' || simulateFailure === 'true',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after')
  undoSidebarSummaryPinpointSupplyRebypassBeforeAfterPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfter(tid, body || {});
  }




  /** M113：任务卡重试阶段暂停宽限 · 软取消进台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger')
  exceptDraftFailFoldRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger')
  exceptDraftFailFoldRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, body || {});
  }

  /** M113：摘要前后对照卡定点 → 供给再旁路 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass')
  undoSidebarSummaryBaPinpointRebypassGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypass(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure === '1' || simulateFailure === 'true',
      forceFailure: simulateFailure === '1' || simulateFailure === 'true',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass')
  undoSidebarSummaryBaPinpointRebypassPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypass(tid, body || {});
  }




  /** M114：软取消中文台账 → 角色过滤审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager')
  exceptDraftFailFoldRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      roleFilteredAudit: true,
      roleAuditOnePager: true,
      renderAuditOnePager: true,
      inAppOnePager: true,
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager')
  exceptDraftFailFoldRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, body || {});
  }

  /** M114：摘要前后卡定点再旁路失败并入归因 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr')
  undoSidebarSummaryBaPinpointRebypassFailFoldAttrGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttr(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      forceFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr')
  undoSidebarSummaryBaPinpointRebypassFailFoldAttrPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttr(tid, body || {});
  }


  /** M115：软取消角色审计一页纸 seek 回台账行 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger')
  exceptDraftFailFoldSoftCancelLedgerRoleAuditOnepagerSeekLedgerGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      roleFilteredAudit: true,
      roleAuditOnePager: true,
      renderAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger')
  exceptDraftFailFoldSoftCancelLedgerRoleAuditOnepagerSeekLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, body || {});
  }

  /** M115：摘要失败归因字段过滤回放 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay')
  undoSidebarSummaryFailFoldAttrFieldFilterReplayGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplay(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      forceFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      fieldFilterReplay: true,
      fieldFilter: ['titleZh', 'sectionId'],
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay')
  undoSidebarSummaryFailFoldAttrFieldFilterReplayPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplay(tid, body || {});
  }



  /** M116：软取消审计 seek 回台账多选中文对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  exceptDraftFailFoldSoftCancelSeekLedgerMultiSelectContrastGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      roleFilteredAudit: true,
      roleAuditOnePager: true,
      renderAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  exceptDraftFailFoldSoftCancelSeekLedgerMultiSelectContrastPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, body || {});
  }

  /** M116：摘要失败归因字段过滤回放 scrubber 书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks')
  undoSidebarSummaryFailFoldAttrFfReplayScrubberBmGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarks(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      forceFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      fieldFilterReplay: true,
      fieldFilter: ['titleZh', 'sectionId'],
      scrubberBookmarks: true,
      fieldFilterReplayScrubberBookmarks: true,
      bookmarkNameZh: '演示·M116摘要失败归因回放书签',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks')
  undoSidebarSummaryFailFoldAttrFfReplayScrubberBmPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarks(tid, body || {});
  }



  /** M117：软取消 seek 台账多选对照短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  exceptDraftFailFoldSoftCancelSeekMultiselectClipScrubberGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      roleFilteredAudit: true,
      roleAuditOnePager: true,
      renderAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  exceptDraftFailFoldSoftCancelSeekMultiselectClipScrubberPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, body || {});
  }

  /** M117：摘要失败归因过滤回放 scrubber 书签跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share')
  undoSidebarSummaryFfReplayBmXSessionRoShareGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShare(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      forceFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      fieldFilterReplay: true,
      fieldFilter: ['titleZh', 'sectionId'],
      scrubberBookmarks: true,
      fieldFilterReplayScrubberBookmarks: true,
      bookmarkNameZh: '演示·M117摘要失败归因回放书签跨会话',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m117-summary',
      targetSessionId: targetSessionId || 'session-peer-m117-summary',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share')
  undoSidebarSummaryFfReplayBmXSessionRoSharePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShare(tid, body || {});
  }


  /** M118：多选对照短片 scrubber 关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  exceptDraftMultiselectClipScrubberKeyframeBookmarksGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      roleFilteredAudit: true,
      roleAuditOnePager: true,
      renderAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberKeyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M118多选对照短片关帧书签',
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  exceptDraftMultiselectClipScrubberKeyframeBookmarksPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, body || {});
  }

  /** M118：摘要失败归因回放书签跨会话 · 中文差分预览再采纳 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt')
  undoSidebarSummaryFfReplayBmDiffPreviewAdoptGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdopt(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      forceFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      fieldFilterReplay: true,
      fieldFilter: ['titleZh', 'sectionId'],
      scrubberBookmarks: true,
      fieldFilterReplayScrubberBookmarks: true,
      bookmarkNameZh: '演示·M118摘要回放书签差分预览再采纳',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m118-summary',
      targetSessionId: targetSessionId || 'session-peer-m118-summary',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt')
  undoSidebarSummaryFfReplayBmDiffPreviewAdoptPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdopt(tid, body || {});
  }


  /** M119：多选对照短片 scrubber 关帧书签跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  exceptDraftMultiselectClipScrubberKfBmXSessionRoShareGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('phase') phase?: string,
    @Query('graceMs') graceMs?: string,
    @Query('softCancel') softCancel?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
      softCancel: softCancel !== '0' && softCancel !== 'false',
      softCancelWinsOverGrace: softCancel !== '0' && softCancel !== 'false',
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      roleFilteredAudit: true,
      roleAuditOnePager: true,
      renderAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberKeyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M119多选对照短片关帧书签跨会话',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m119-clip',
      targetSessionId: targetSessionId || 'session-peer-m119-clip',
      oneClickRetry: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  exceptDraftMultiselectClipScrubberKfBmXSessionRoSharePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, body || {});
  }

  /** M119：摘要回放书签差分预览再采纳 · 一侧软撤销前后卡 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo')
  undoSidebarSummaryFfReplayBmDiffPreviewOnesideSoftUndoGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('undoToken') undoToken?: string,
    @Query('softUndo') softUndo?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
    @Query('simulateFailure') simulateFailure?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndo(tid, {
      undoToken: undoToken || null,
      softUndo: softUndo === '1' || softUndo === 'true' || !!undoToken || true,
      matchId: matchId || null,
      role: role || 'broker',
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      pinpointAnnotate: true,
      annotateSummaryFrames: true,
      summaryFramePinpoint: true,
      annotateFields: ['titleZh', 'sectionId'],
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: adoptSide || 'before',
      confirmOneside: true,
      confirmCardAck: true,
      showUndoableSummary: true,
      onesideSoftUndoSummary: true,
      scrubIntoAbTimeline: true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      baPinpointAnnotate: true,
      pinpointFromBeforeAfter: true,
      simulateFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      forceFailure: simulateFailure !== '0' && simulateFailure !== 'false',
      failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      fieldFilterReplay: true,
      fieldFilter: ['titleZh', 'sectionId'],
      scrubberBookmarks: true,
      fieldFilterReplayScrubberBookmarks: true,
      bookmarkNameZh: '演示·M119摘要回放书签差分预览一侧软撤销',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m119-summary',
      targetSessionId: targetSessionId || 'session-peer-m119-summary',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      softUndoAdopt: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo')
  undoSidebarSummaryFfReplayBmDiffPreviewOnesideSoftUndoPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndo(tid, body || {});
  }

    /** M88：字段粒撤销栈可视化时间线 */
  @Get('enterprise/conflict-preview/field-grain-undo-stack/timeline')
  getFieldGrainUndoStackTimeline(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('jobId') jobId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.getFieldGrainUndoStackTimeline(tid, jobId || null);
  }

  @Get('enterprise/jobs/:id/conflict-preview/field-grain-into-write-preview/undo-timeline')
  getFieldGrainUndoStackTimelineForJob(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.getFieldGrainUndoStackTimeline(tid, id);
  }

  /** M89：字段粒撤销栈定点 seek-undo（租户维） */
  @Post('enterprise/conflict-preview/field-grain-undo-stack/timeline/seek')
  postFieldGrainUndoStackSeek(
    @Req() req: any,
    @Body()
    body: {
      tenantId?: string;
      jobId?: string;
      seq?: number;
      keepSeq?: boolean;
      bucket?: string;
      previewConfirm?: boolean;
      showConfirmCard?: boolean;
      confirmCardAck?: boolean;
      ackConfirmCard?: boolean;
      confirmUndo?: boolean;
      keepFields?: string[];
      fieldsToKeep?: string[];
      bulkKeepBuckets?: string[];
      keepBuckets?: string[];
      keepFieldsByBucket?: Record<string, boolean | string[]>;
      exceptFieldsByBucket?: Record<string, string[]>;
      selectAllExceptByBucket?: Record<string, string[]>;
      exceptFields?: string[];
    } = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    const jobId = body?.jobId || '';
    if (!jobId) {
      return {
        ok: false,
        wave: 'M93',
        tipZh: '定点撤销需要 jobId',
        toastZh: '缺 jobId',
        busyZh: '字段粒定点撤销…',
        dryRun: true,
        noEgress: true,
        midPageCancelIntact: true,
      };
    }
    return this.imports.seekUndoFieldGrainStack(jobId, {
      tenantId: tid,
      seq: body?.seq,
      keepSeq: body?.keepSeq,
      bucket: body?.bucket,
      previewConfirm: body?.previewConfirm,
      showConfirmCard: body?.showConfirmCard,
      confirmCardAck: body?.confirmCardAck,
      ackConfirmCard: body?.ackConfirmCard,
      confirmUndo: body?.confirmUndo,
      keepFields: body?.keepFields,
      fieldsToKeep: body?.fieldsToKeep,
      bulkKeepBuckets: body?.bulkKeepBuckets,
      keepBuckets: body?.keepBuckets,
      keepFieldsByBucket: body?.keepFieldsByBucket,
      exceptFieldsByBucket: body?.exceptFieldsByBucket,
      selectAllExceptByBucket: body?.selectAllExceptByBucket,
      exceptFields: body?.exceptFields,
    });
  }

  
  /** M89/M93：字段粒撤销栈定点 seek-undo（job 维；按桶全选可排除字段） */
  @Post('enterprise/jobs/:id/conflict-preview/field-grain-into-write-preview/undo-timeline/seek')
  postFieldGrainUndoStackSeekForJob(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      seq?: number;
      keepSeq?: boolean;
      bucket?: string;
      previewConfirm?: boolean;
      showConfirmCard?: boolean;
      confirmCardAck?: boolean;
      ackConfirmCard?: boolean;
      confirmUndo?: boolean;
      keepFields?: string[];
      fieldsToKeep?: string[];
      bulkKeepBuckets?: string[];
      keepBuckets?: string[];
      keepFieldsByBucket?: Record<string, boolean | string[]>;
      exceptFieldsByBucket?: Record<string, string[]>;
      selectAllExceptByBucket?: Record<string, string[]>;
      exceptFields?: string[];
    } = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.seekUndoFieldGrainStack(id, {
      tenantId: tid,
      seq: body?.seq,
      keepSeq: body?.keepSeq,
      bucket: body?.bucket,
      previewConfirm: body?.previewConfirm,
      showConfirmCard: body?.showConfirmCard,
      confirmCardAck: body?.confirmCardAck,
      ackConfirmCard: body?.ackConfirmCard,
      confirmUndo: body?.confirmUndo,
      keepFields: body?.keepFields,
      fieldsToKeep: body?.fieldsToKeep,
      bulkKeepBuckets: body?.bulkKeepBuckets,
      keepBuckets: body?.keepBuckets,
      keepFieldsByBucket: body?.keepFieldsByBucket,
      exceptFieldsByBucket: body?.exceptFieldsByBucket,
      selectAllExceptByBucket: body?.selectAllExceptByBucket,
      exceptFields: body?.exceptFields,
    });
  }

  /** M85/M86：字段粒决策一键灌入确认本桶写库预演 */
  @Post('enterprise/jobs/:id/conflict-preview/field-grain-into-write-preview')
  fieldGrainIntoWritePreview(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      bucket?: string;
      conflictType?: string;
      role?: string | null;
      slimOffset?: number;
      slimLimit?: number;
      pageCursor?: string;
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
      persistCursor?: boolean;
    } = {},
  ) {
    return this.imports.applyFieldGrainIntoWritePreview(id, {
      ...body,
      role: body?.role || req?.user?.role || null,
      tenantId: req?.user?.tenantId || req?.resolvedTenantId || 'default',
    });
  }

  /** M86/M87：撤销字段粒灌入（多步栈） */
  @Post('enterprise/jobs/:id/conflict-preview/field-grain-into-write-preview/undo')
  fieldGrainIntoWritePreviewUndo(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { bucket?: string; steps?: number } = {},
  ) {
    return this.imports.undoFieldGrainIntoWritePreview(id, {
      ...body,
      tenantId: req?.user?.tenantId || req?.resolvedTenantId || 'default',
    });
  }

  /** M74/M75：确认本桶写库预演（不真正 resume 写库；含行级字段 diff） */
  @Post('enterprise/jobs/:id/conflict-preview/confirm-bucket-write-preview')
  confirmBucketWritePreview(
    @Param('id') id: string,
    @Body()
    body: {
      bucket?: string;
      conflictType?: string;
      slimOffset?: number;
      slimLimit?: number;
      pageCursor?: string;
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
      persistCursor?: boolean;
      decideFirst?: boolean;
    } = {},
  ) {
    return this.imports.confirmBucketWritePlanPreview(id, body || {});
  }

  /** M67：按行确认预演写库计划（尊重跳过，不写库） */
  @Post('enterprise/jobs/:id/conflict-preview/apply-preview')
  conflictApplyPreview(
    @Param('id') id: string,
    @Body()
    body: {
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
      skipRowIndexes?: number[];
      confirmRowIndexes?: number[];
      persistDecisions?: boolean;
    } = {},
  ) {
    return this.imports.conflictApplyPreview(id, body || {});
  }

  /** M43/M44：取消后差分续跑（可带冲突合并策略） */
  @Post('enterprise/jobs/:id/resume')
  resume(
    @Param('id') id: string,
    @Body()
    body: {
      asyncWrite?: boolean;
      async?: boolean;
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
      skipRowIndexes?: number[];
      confirmRowIndexes?: number[];
      respectRowDecisions?: boolean;
      /** M69：仅确认行续跑 */
      confirmOnly?: boolean;
      /** M70：slim/page 游标对齐 */
      slimOffset?: number;
      slimLimit?: number;
      pageCursor?: string;
      alignConfirmOnlyCursor?: boolean;
      /** M71：冲突类型分桶 */
      conflictType?: string;
      bucket?: string;
      conflictTypes?: string[];
      persistCursor?: boolean;
    } = {},
    @Req() req: any,
  ) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户不能跑授权批量导入，请联系运营' };
    }
    const asyncWrite = body?.asyncWrite === false || body?.async === false ? false : true;
    return this.imports.resumeDifferential(id, {
      asyncWrite,
      actorEmail: req.user?.email || 'ops',
      mergeStrategy: body?.mergeStrategy,
      skipRowIndexes: body?.skipRowIndexes,
      confirmRowIndexes: body?.confirmRowIndexes,
      respectRowDecisions: body?.respectRowDecisions !== false,
      confirmOnly: body?.confirmOnly === true,
      slimOffset: body?.slimOffset,
      slimLimit: body?.slimLimit,
      pageCursor: body?.pageCursor,
      alignConfirmOnlyCursor: body?.alignConfirmOnlyCursor !== false,
      conflictType: body?.conflictType,
      bucket: body?.bucket,
      conflictTypes: body?.conflictTypes,
      persistCursor: body?.persistCursor !== false,
    });
  }

  @Get('enterprise/jobs/:id')
  get(@Param('id') id: string) {
    return this.imports.get(id);
  }

  @Post('enterprise')
  async upload(
    @Body()
    body: {
      csvText?: string;
      source?: string;
      filename?: string;
      tenantId?: string;
      dryValidateOnly?: boolean;
      asyncWrite?: boolean;
      async?: boolean;
      mergeStrategy?: 'skip' | 'overwrite' | 'fill-empty';
    },
    @Req() req: any,
  ) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户不能跑授权批量导入，请联系运营' };
    }
    if (!body?.csvText || !String(body.csvText).trim()) {
      return { ok: false, message: '请提供 csvText' };
    }
    return this.imports.importCsvText(body.csvText, {
      source: body.source || 'csv_manual',
      filename: body.filename || 'upload.csv',
      tenantId: body.tenantId || req.user?.tenantId || 'default',
      actorEmail: req.user?.email || 'ops',
      dryValidateOnly: Boolean(body.dryValidateOnly),
      asyncWrite: Boolean(body.asyncWrite || body.async),
      mergeStrategy: body.mergeStrategy,
    });
  }

  /** M120：关帧书签跨会话只读分享 · 差分预览再采纳 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt')
  exceptDraftKfXsessionShareDiffPreviewAdoptGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdopt(tid, {
      softCancel: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M120关帧跨会话差分预览再采纳',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m120-clip',
      targetSessionId: targetSessionId || 'session-peer-m120-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt')
  exceptDraftKfXsessionShareDiffPreviewAdoptPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdopt(tid, body || {});
  }

  /** M120：一侧软撤销摘要 scrubber 进 A/B 时间线 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline')
  undoSidebarOnesideSoftUndoScrubAbTimelineGet(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('matchId') matchId?: string,
    @Query('role') role?: string,
    @Query('adoptSide') adoptSide?: string,
  ) {
    const tid = tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimeline(tid, {
      matchId: matchId || null,
      role: role || 'broker',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: adoptSide || 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M120一侧软撤销scrub进A/B时间线',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: 'session-demo-m120-summary',
      targetSessionId: 'session-peer-m120-summary',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline')
  undoSidebarOnesideSoftUndoScrubAbTimelinePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = body?.tenantId || req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimeline(tid, body || {});
  }



  /** M121：差分预览采纳软撤销前后卡 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after')
  exceptDraftDiffPreviewAdoptSoftUndoBeforeAfterGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfter(tid, {
      softCancel: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M121差分预览采纳软撤销前后卡',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m121-clip',
      targetSessionId: targetSessionId || 'session-peer-m121-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after')
  exceptDraftDiffPreviewAdoptSoftUndoBeforeAfterPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfter(tid, body || {});
  }

  /** M121：A/B 时间线帧定点标注 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate')
  undoSidebarAbTimelineFramePinpointAnnotateGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotate(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m121',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M121 A/B时间线帧定点标注',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M121 A/B时间线帧定点标注',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m121-summary',
      targetSessionId: targetSessionId || 'session-peer-m121-summary',
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate')
  undoSidebarAbTimelineFramePinpointAnnotatePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotate(tid, body || {});
  }



  /** M122：软撤销前后卡定点再旁路 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass')
  exceptDraftSoftUndoBaPinpointRebypassGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypass(tid, {
      softCancel: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M122软撤销前后卡定点再旁路',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m122-clip',
      targetSessionId: targetSessionId || 'session-peer-m122-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M122软撤销前后卡定点再旁路',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass')
  exceptDraftSoftUndoBaPinpointRebypassPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypass(tid, body || {});
  }

  /** M122：A/B 时间线帧定点触发供给再旁路 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass')
  undoSidebarAbFramePinpointSupplyRebypassGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypass(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m122',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M122 A/B帧定点触发供给再旁路',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M122 A/B帧定点再旁路',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m122-summary',
      targetSessionId: targetSessionId || 'session-peer-m122-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass')
  undoSidebarAbFramePinpointSupplyRebypassPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypass(tid, body || {});
  }

  /** M123：定点再旁路失败并入归因中文卡 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr')
  exceptDraftSoftUndoBaPinpointRebypassFailFoldAttrGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttr(tid, {
      softCancel: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M123定点再旁路失败归因',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m123-clip',
      targetSessionId: targetSessionId || 'session-peer-m123-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M123定点再旁路失败并入归因',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr')
  exceptDraftSoftUndoBaPinpointRebypassFailFoldAttrPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttr(tid, body || {});
  }

  /** M123：A/B 帧定点供给再旁路后中文前后对照卡 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after')
  undoSidebarAbFrameRebypassBeforeAfterGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfter(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m123',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M123 A/B帧再旁路前后对照',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M123 A/B帧再旁路前后对照',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m123-summary',
      targetSessionId: targetSessionId || 'session-peer-m123-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after')
  undoSidebarAbFrameRebypassBeforeAfterPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfter(tid, body || {});
  }



  /** M124：定点失败归因一键重试折进中文任务卡 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card')
  exceptDraftPinpointFailAttrOneClickRetryFoldTaskCardGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, {
      softCancel: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M124定点失败归因重试',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m124-clip',
      targetSessionId: targetSessionId || 'session-peer-m124-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M124定点失败归因一键重试折进任务卡',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card')
  exceptDraftPinpointFailAttrOneClickRetryFoldTaskCardPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, body || {});
  }

  /** M124：A/B 帧再旁路前后卡定点再旁路 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass')
  undoSidebarAbFrameRebypassBaPinpointRebypassGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypass(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m124',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M124 A/B帧再旁路前后卡定点再旁路',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M124 A/B帧再旁路前后卡定点再旁路',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m124-summary',
      targetSessionId: targetSessionId || 'session-peer-m124-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass')
  undoSidebarAbFrameRebypassBaPinpointRebypassPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypass(tid, body || {});
  }




  /** M125：定点失败归因重试任务卡单阶段暂停宽限 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace')
  exceptDraftFailAttrRetryTaskcardPhasePauseGraceGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, {
      softCancel: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M125定点失败归因重试暂停宽限',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m125-clip',
      targetSessionId: targetSessionId || 'session-peer-m125-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M125定点失败归因重试任务卡阶段暂停宽限',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace')
  exceptDraftFailAttrRetryTaskcardPhasePauseGracePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, body || {});
  }

  /** M125：A/B 帧再旁路定点失败并入中文归因 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr')
  undoSidebarAbFrameRebypassPinpointFailFoldAttrGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttr(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m125',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M125 A/B帧再旁路定点失败并入归因',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M125 A/B帧再旁路定点失败并入归因',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m125-summary',
      targetSessionId: targetSessionId || 'session-peer-m125-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr')
  undoSidebarAbFrameRebypassPinpointFailFoldAttrPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttr(tid, body || {});
  }



  /** M126：失败归因重试暂停宽限软取消进中文台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger')
  exceptDraftFailAttrRetryPauseGraceSoftCancelLedgerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M126失败归因重试暂停宽限软取消',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m126-clip',
      targetSessionId: targetSessionId || 'session-peer-m126-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M126失败归因重试暂停宽限软取消进台账',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger')
  exceptDraftFailAttrRetryPauseGraceSoftCancelLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      ...(body || {}),
    });
  }

  /** M126：A/B 帧定点失败归因一键重试 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry')
  undoSidebarAbPinpointFailAttrOneClickRetryGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetry(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m126',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M126 A/B帧定点失败归因一键重试',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M126 A/B帧定点失败归因一键重试',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m126-summary',
      targetSessionId: targetSessionId || 'session-peer-m126-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry')
  undoSidebarAbPinpointFailAttrOneClickRetryPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetry(tid, body || {});
  }




  /** M127：失败归因软取消台账角色过滤审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager')
  exceptDraftFailAttrSoftCancelLedgerRoleAuditOnepagerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M127失败归因软取消台账角色审计',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m127-clip',
      targetSessionId: targetSessionId || 'session-peer-m127-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M127失败归因软取消台账角色审计一页纸',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager')
  exceptDraftFailAttrSoftCancelLedgerRoleAuditOnepagerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      roleFilteredAudit: body?.roleFilteredAudit !== false,
      roleAuditOnePager: body?.roleAuditOnePager !== false,
      renderAuditOnePager: body?.renderAuditOnePager !== false,
      ...(body || {}),
    });
  }

  /** M127：A/B 帧定点失败归因一键重试折进任务卡 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card')
  undoSidebarAbFailAttrOneClickRetryFoldTaskCardGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m127',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M127 A/B帧定点失败归因一键重试折进任务卡',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M127 A/B帧定点失败归因一键重试折进任务卡',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m127-summary',
      targetSessionId: targetSessionId || 'session-peer-m127-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card')
  undoSidebarAbFailAttrOneClickRetryFoldTaskCardPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCard(tid, body || {});
  }


  /** M128：失败归因软取消审计一页纸回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger')
  exceptDraftFailAttrSoftCancelAuditSeekLedgerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M128失败归因软取消审计回跳',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m128-clip',
      targetSessionId: targetSessionId || 'session-peer-m128-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M128失败归因软取消审计回跳台账',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger')
  exceptDraftFailAttrSoftCancelAuditSeekLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      roleFilteredAudit: body?.roleFilteredAudit !== false,
      roleAuditOnePager: body?.roleAuditOnePager !== false,
      renderAuditOnePager: body?.renderAuditOnePager !== false,
      seekLedgerRow: body?.seekLedgerRow !== false,
      seekBackToLedger: body?.seekBackToLedger !== false,
      ...(body || {}),
    });
  }

  /** M128：A/B 失败归因重试任务卡单阶段暂停宽限 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace')
  undoSidebarAbFailAttrRetryTaskcardPhasePauseGraceGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m128',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M128 A/B失败归因重试任务卡暂停宽限',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M128 A/B失败归因重试任务卡暂停宽限',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m128-summary',
      targetSessionId: targetSessionId || 'session-peer-m128-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace')
  undoSidebarAbFailAttrRetryTaskcardPhasePauseGracePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGrace(tid, body || {});
  }



  /** M129：失败归因软取消审计回跳多选中文对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  exceptDraftFailAttrSoftCancelSeekMultiselectContrastGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M129失败归因软取消回跳多选',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m129-clip',
      targetSessionId: targetSessionId || 'session-peer-m129-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M129失败归因软取消回跳多选对照',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  exceptDraftFailAttrSoftCancelSeekMultiselectContrastPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      roleFilteredAudit: body?.roleFilteredAudit !== false,
      roleAuditOnePager: body?.roleAuditOnePager !== false,
      renderAuditOnePager: body?.renderAuditOnePager !== false,
      seekLedgerRow: body?.seekLedgerRow !== false,
      seekBackToLedger: body?.seekBackToLedger !== false,
      multiSelectLedgerRows: body?.multiSelectLedgerRows !== false,
      multiSelectContrast: body?.multiSelectContrast !== false,
      ...(body || {}),
    });
  }

  /** M129：A/B 失败归因重试暂停宽限软取消进台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger')
  undoSidebarAbFailAttrRetryPauseGraceSoftCancelLedgerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, {
      role: role || 'broker',
      matchId: matchId || 'demo-match-m129',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M129 A/B失败归因重试暂停宽限软取消进台账',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M129 A/B失败归因重试暂停宽限软取消进台账',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m129-summary',
      targetSessionId: targetSessionId || 'session-peer-m129-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger')
  undoSidebarAbFailAttrRetryPauseGraceSoftCancelLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedger(tid, body || {});
  }




  /** M130：失败归因软取消多选对照短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  exceptDraftFailAttrSoftCancelMultiselectClipScrubberGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      bookmarkNameZh: '演示·M130失败归因软取消多选短片scrubber',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m130-clip',
      targetSessionId: targetSessionId || 'session-peer-m130-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M130失败归因软取消多选对照短片scrubber',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  exceptDraftFailAttrSoftCancelMultiselectClipScrubberPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      roleFilteredAudit: body?.roleFilteredAudit !== false,
      roleAuditOnePager: body?.roleAuditOnePager !== false,
      renderAuditOnePager: body?.renderAuditOnePager !== false,
      seekLedgerRow: body?.seekLedgerRow !== false,
      seekBackToLedger: body?.seekBackToLedger !== false,
      multiSelectLedgerRows: body?.multiSelectLedgerRows !== false,
      multiSelectContrast: body?.multiSelectContrast !== false,
      clipFrameScrubber: body?.clipFrameScrubber !== false,
      scrubber: body?.scrubber !== false,
      ...(body || {}),
    });
  }

  /** M130：A/B 失败归因软取消台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager')
  undoSidebarAbFailAttrSoftCancelLedgerRoleAuditOnepagerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, {
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: matchId || 'demo-match-m130',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M130 A/B失败归因软取消台账角色审计一页纸',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M130 A/B失败归因软取消台账角色审计一页纸',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m130-summary',
      targetSessionId: targetSessionId || 'session-peer-m130-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager')
  undoSidebarAbFailAttrSoftCancelLedgerRoleAuditOnepagerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepager(tid, body || {});
  }


  /** M131：失败归因软取消多选对照短片 scrubber 关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  exceptDraftFailAttrSoftCancelMultiselectClipKfBmGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M131失败归因软取消多选短片关帧书签',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m131-clip',
      targetSessionId: targetSessionId || 'session-peer-m131-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M131失败归因软取消多选对照短片关帧书签',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  exceptDraftFailAttrSoftCancelMultiselectClipKfBmPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      keyframeBookmarks: body?.keyframeBookmarks !== false,
      scrubberBookmarks: body?.scrubberBookmarks !== false,
      clipFrameScrubber: body?.clipFrameScrubber !== false,
      ...(body || {}),
    });
  }

  /** M131：A/B 失败归因软取消角色审计一页纸回跳台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger')
  undoSidebarAbFailAttrSoftCancelRoleAuditSeekLedgerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, {
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: matchId || 'demo-match-m131',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M131 A/B失败归因软取消角色审计回跳台账',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M131 A/B失败归因软取消角色审计回跳台账',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m131-summary',
      targetSessionId: targetSessionId || 'session-peer-m131-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger')
  undoSidebarAbFailAttrSoftCancelRoleAuditSeekLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedger(tid, body || {});
  }



  /** M132：失败归因软取消多选短片关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  exceptDraftFailAttrSoftCancelClipKfBmXsessionGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M132失败归因软取消多选短片关帧跨会话只读分享',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m132-clip',
      targetSessionId: targetSessionId || 'session-peer-m132-clip',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M132失败归因软取消多选短片关帧跨会话只读分享',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  exceptDraftFailAttrSoftCancelClipKfBmXsessionPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      crossSessionShare: body?.crossSessionShare !== false,
      readOnlyShare: body?.readOnlyShare !== false,
      keyframeBookmarks: body?.keyframeBookmarks !== false,
      ...(body || {}),
    });
  }

  /** M132：A/B 失败归因软取消角色审计回跳多选中文对照 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  undoSidebarAbFailAttrSoftCancelRoleAuditSeekMultiselectGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, {
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: matchId || 'demo-match-m132',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M132 A/B失败归因软取消角色审计回跳多选对照',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M132 A/B失败归因软取消角色审计回跳多选对照',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m132-summary',
      targetSessionId: targetSessionId || 'session-peer-m132-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  undoSidebarAbFailAttrSoftCancelRoleAuditSeekMultiselectPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tid, body || {});
  }



  /** M133：失败归因软取消关帧跨会话过期吊销进台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  exceptDraftFailAttrSoftCancelKfBmXsessionExpiryGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M133失败归因软取消关帧跨会话过期吊销',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m133-clip',
      targetSessionId: targetSessionId || 'session-peer-m133-clip',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M133失败归因软取消关帧跨会话过期吊销',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  exceptDraftFailAttrSoftCancelKfBmXsessionExpiryPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      shareLinkExpiry: body?.shareLinkExpiry !== false,
      expiryRevokeLedger: body?.expiryRevokeLedger !== false,
      revokeShare: body?.revokeShare !== false,
      ...(body || {}),
    });
  }

  /** M133：A/B 失败归因软取消回跳多选短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  undoSidebarAbFailAttrSoftCancelSeekMultiselectClipScrubberGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, {
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: matchId || 'demo-match-m133',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M133 A/B失败归因软取消回跳多选短片scrubber',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M133 A/B失败归因软取消回跳多选短片scrubber',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m133-summary',
      targetSessionId: targetSessionId || 'session-peer-m133-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  undoSidebarAbFailAttrSoftCancelSeekMultiselectClipScrubberPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tid, body || {});
  }



  /** M134：失败归因软取消过期吊销台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  exceptDraftFailAttrSoftCancelExpiryLedgerRoleAuditGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M134失败归因软取消过期吊销台账角色审计',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m134-clip',
      targetSessionId: targetSessionId || 'session-peer-m134-clip',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M134失败归因软取消过期吊销台账角色审计',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  exceptDraftFailAttrSoftCancelExpiryLedgerRoleAuditPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      roleAuditOnePager: body?.roleAuditOnePager !== false,
      roleFilteredAudit: body?.roleFilteredAudit !== false,
      ...(body || {}),
    });
  }

  /** M134：A/B 失败归因软取消多选短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  undoSidebarAbFailAttrSoftCancelSeekMultiselectClipKfBmGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, {
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: matchId || 'demo-match-m134',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M134 A/B失败归因软取消多选短片关帧书签',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M134 A/B失败归因软取消多选短片关帧书签',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m134-summary',
      targetSessionId: targetSessionId || 'session-peer-m134-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  undoSidebarAbFailAttrSoftCancelSeekMultiselectClipKfBmPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tid, body || {});
  }




  /** M135：失败归因软取消过期吊销台账角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  exceptDraftFailAttrSoftCancelExpiryLedgerRoleAuditSeekGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tid, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M135失败归因软取消过期吊销台账角色审计回跳',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m135-clip',
      targetSessionId: targetSessionId || 'session-peer-m135-clip',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M135失败归因软取消过期吊销台账角色审计回跳',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  exceptDraftFailAttrSoftCancelExpiryLedgerRoleAuditSeekPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tid, {
      softCancel: body?.softCancel !== false,
      softCancelWinsOverGrace: body?.softCancelWinsOverGrace !== false,
      writeSoftCancelLedger: body?.writeSoftCancelLedger !== false,
      chineseLedger: body?.chineseLedger !== false,
      seekLedgerRow: body?.seekLedgerRow !== false,
      seekBackToLedger: body?.seekBackToLedger !== false,
      ...(body || {}),
    });
  }

  /** M135：A/B 失败归因软取消多选短片关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  undoSidebarAbFailAttrSoftCancelSeekMultiselectClipKfBmXsessionGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('matchId') matchId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('failureCode') failureCode?: string,
    @Query('graceMs') graceMs?: string,
    @Query('phase') phase?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, {
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: matchId || 'demo-match-m135',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M135 A/B失败归因软取消多选短片关帧跨会话只读分享',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M135 A/B失败归因软取消多选短片关帧跨会话',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m135-summary',
      targetSessionId: targetSessionId || 'session-peer-m135-summary',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: failureCode || 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: phase || 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: graceMs != null ? Number(graceMs) : 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  undoSidebarAbFailAttrSoftCancelSeekMultiselectClipKfBmXsessionPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tid = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tid, body || {});
  }



  /** M136：失败归因软取消过期台账角色审计回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  failAttrExpiryRoleAuditSeekMultiselectGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tenantId, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M136失败归因软取消过期台账角色审计回跳多选',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m136-clip',
      targetSessionId: targetSessionId || 'session-peer-m136-clip',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M136失败归因软取消过期台账角色审计回跳多选',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  failAttrExpiryRoleAuditSeekMultiselectPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tenantId, body || {});
  }

  /** M136：A/B 失败归因软取消关帧跨会话分享过期吊销进台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  abFailAttrClipKfBmXsessionExpiryRevokeGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m136',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M136 A/B失败归因软取消关帧跨会话分享过期吊销',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M136 A/B失败归因软取消关帧跨会话过期吊销',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m136-summary',
      targetSessionId: targetSessionId || 'session-peer-m136-summary',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  abFailAttrClipKfBmXsessionExpiryRevokePost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tenantId, body || {});
  }



  /** M137：失败归因过期回跳多选短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  failAttrExpirySeekMultiselectClipScrubberGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tenantId, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M137失败归因过期回跳多选短片 scrubber',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m137-clip',
      targetSessionId: targetSessionId || 'session-peer-m137-clip',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M137失败归因过期回跳多选短片 scrubber',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  failAttrExpirySeekMultiselectClipScrubberPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tenantId, body || {});
  }

  /** M137：A/B 失败归因过期吊销台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  abFailAttrExpiryRevokeRoleAuditOnepagerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m137',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M137 A/B失败归因过期吊销台账角色审计一页纸',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M137 A/B失败归因过期吊销角色审计',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m137-summary',
      targetSessionId: targetSessionId || 'session-peer-m137-summary',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  abFailAttrExpiryRevokeRoleAuditOnepagerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tenantId, body || {});
  }



  /** M138：失败归因过期多选短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  failAttrExpiryMultiselectClipKfBmGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tenantId, {
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M138失败归因过期多选短片关帧书签',
      shareFfReplayBookmarks: true,
      crossSessionShareBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m138-clip',
      targetSessionId: targetSessionId || 'session-peer-m138-clip',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      softUndoBeforeAfter: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'org'],
      noteZh: '演示·M138失败归因过期多选短片关帧书签',
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: 15000,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  failAttrExpiryMultiselectClipKfBmPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tenantId, body || {});
  }

  /** M138：A/B 失败归因过期角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  abFailAttrExpiryRoleAuditSeekLedgerGet(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('revoke') revoke?: string,
    @Query('expiresInMs') expiresInMs?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker',
      filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m138',
      adoptOneSideOnly: true,
      onesideSoftUndo: true,
      adoptSide: 'before',
      softUndoAdopt: true,
      softUndo: true,
      showBeforeAfterCard: true,
      beforeAfterContrast: true,
      scrubIntoAbTimeline: true,
      pinpointAnnotate: true,
      annotateFields: ['titleZh', 'score'],
      noteZh: '演示·M138 A/B失败归因过期角色审计回跳台账',
      chineseDiffPreview: true,
      diffPreviewConfirm: true,
      diffPreviewThenAdopt: true,
      adoptSharedBookmarks: true,
      confirmAdopt: true,
      confirmCardAck: true,
      bookmarkNameZh: '演示·M138 A/B失败归因过期角色审计回跳',
      shareFfReplayBookmarks: true,
      crossSessionShare: true,
      readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m138-summary',
      targetSessionId: targetSessionId || 'session-peer-m138-summary',
      shareLinkExpiry: true,
      expiryRevokeLedger: true,
      expiresInMs: expiresInMs != null ? Number(expiresInMs) : 3600000,
      revokeShare: revoke === '1' || revoke === 'true' || true,
      pinpointToSupplyReBypass: true,
      oneClickReBypass: true,
      reBypass: true,
      simulateFailure: true,
      forceFailure: true,
      failureCode: 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
      foldFailureIntoAttribution: true,
      showFailureAttribution: true,
      oneClickRetry: true,
      retryFromAttribution: true,
      foldIntoChainTaskCard: true,
      foldRetryIntoChainTaskCard: true,
      pausePhase: true,
      phasePause: true,
      phase: 'one-click-retry',
      graceAlarm: true,
      showGraceAlarm: true,
      autoResumeAfterGrace: true,
      graceMs: 15000,
      softCancel: true,
      softCancelWinsOverGrace: true,
      writeSoftCancelLedger: true,
      chineseLedger: true,
      roleFilteredAudit: true,
      renderAuditOnePager: true,
      roleAuditOnePager: true,
      inAppOnePager: true,
      seekLedgerRow: true,
      seekBackToLedger: true,
      highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true,
      multiSelectContrast: true,
      seekEntryIndexes: [0, 1],
      clipFrameScrubber: true,
      scrubber: true,
      scrubIndex: 0,
      exportClipFrames: true,
      clipFrames: true,
      keyframeBookmarks: true,
      scrubberBookmarks: true,
      scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  abFailAttrExpiryRoleAuditSeekLedgerPost(
    @Req() req: any,
    @Body() body: Record<string, any> = {},
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedger(tenantId, body || {});
  }



  /** M139：失败归因过期关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  failAttrExpiryKfBmXsessionRoShareM139Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M139失败归因过期关帧跨会话',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m139-clip', targetSessionId: targetSessionId || 'session-peer-m139-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  failAttrExpiryKfBmXsessionRoShareM139Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShare(tenantId, body || {});
  }

  /** M139：A/B 失败归因过期回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  abFailAttrExpirySeekMultiselectM139Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m139', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M139 A/B失败归因过期回跳多选对照',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M139 A/B失败归因过期回跳多选', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m139-summary', targetSessionId: targetSessionId || 'session-peer-m139-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  abFailAttrExpirySeekMultiselectM139Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrast(tenantId, body || {});
  }


  /** M140：失败归因过期关帧过期吊销进台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  FailAttrExpiryKfBmExpiryRevokeM140Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M140失败归因过期关帧过期吊销',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m140-clip', targetSessionId: targetSessionId || 'session-peer-m140-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  FailAttrExpiryKfBmExpiryRevokeM140Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedger(tenantId, body || {});
  }

  /** M140：A/B 失败归因过期多选短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrExpiryMultiselectClipScrubberM140Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m140', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M140 A/B失败归因过期多选短片scrubber',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M140 A/B失败归因过期多选短片', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m140-summary', targetSessionId: targetSessionId || 'session-peer-m140-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrExpiryMultiselectClipScrubberM140Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubber(tenantId, body || {});
  }

  /** M141：失败归因过期吊销台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  FailAttrExpiryRevokeRoleAuditOnepagerM141Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M141失败归因过期吊销角色审计',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m141-clip', targetSessionId: targetSessionId || 'session-peer-m141-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  FailAttrExpiryRevokeRoleAuditOnepagerM141Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepager(tenantId, body || {});
  }

  /** M141：A/B 失败归因过期多选短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrExpiryMultiselectClipKfBmM141Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m141', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M141 A/B失败归因过期多选短片关帧书签',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M141 A/B失败归因过期多选短片关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m141-summary', targetSessionId: targetSessionId || 'session-peer-m141-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrExpiryMultiselectClipKfBmM141Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarks(tenantId, body || {});
  }




  /** M142：失败归因过期角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  FailAttrExpiryRoleAuditSeekLedgerM142Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M142失败归因过期角色审计回跳',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m142-clip', targetSessionId: targetSessionId || 'session-peer-m142-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true,
      seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  FailAttrExpiryRoleAuditSeekLedgerM142Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142(tenantId, body || {});
  }

  /** M142：A/B 失败归因过期关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  AbFailAttrExpiryClipKfBmXsessionRoShareM142Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m142', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M142 A/B失败归因过期关帧跨会话只读分享',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M142 A/B失败归因过期关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m142-summary', targetSessionId: targetSessionId || 'session-peer-m142-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  AbFailAttrExpiryClipKfBmXsessionRoShareM142Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142(tenantId, body || {});
  }


  /** M143：失败归因过期回跳多选短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  FailAttrExpirySeekMultiselectClipScrubberM143Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M143失败归因过期回跳多选短片scrubber',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m143-clip', targetSessionId: targetSessionId || 'session-peer-m143-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  FailAttrExpirySeekMultiselectClipScrubberM143Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143(tenantId, body || {});
  }

  /** M143：A/B 失败归因过期关帧跨会话分享过期吊销进台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  AbFailAttrExpiryClipKfBmXsessionExpiryRevokeM143Get(
    @Req() req: any,
    @Query('seq') seq?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m143', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M143 A/B失败归因过期关帧跨会话过期吊销',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M143 A/B失败归因过期关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m143-summary', targetSessionId: targetSessionId || 'session-peer-m143-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  AbFailAttrExpiryClipKfBmXsessionExpiryRevokeM143Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143(tenantId, body || {});
  }



  /** M144：失败归因过期多选短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  FailAttrExpiryMultiselectClipKfBmM144Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M144失败归因过期多选短片关帧书签',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m144-clip', targetSessionId: targetSessionId || 'session-peer-m144-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  FailAttrExpiryMultiselectClipKfBmM144Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144(tenantId, body || {});
  }

  /** M144：A/B 失败归因过期吊销角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM144Get(
    @Req() req: any,
    @Query('seq') seq?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m144', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M144 A/B失败归因过期吊销角色审计',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M144 A/B失败归因过期关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m144-summary', targetSessionId: targetSessionId || 'session-peer-m144-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM144Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144(tenantId, body || {});
  }


  /** M145：失败归因过期关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  FailAttrExpiryKfBmXsessionRoShareM145Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M145失败归因过期关帧跨会话只读分享',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m145-clip', targetSessionId: targetSessionId || 'session-peer-m145-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  FailAttrExpiryKfBmXsessionRoShareM145Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145(tenantId, body || {});
  }

  /** M145：A/B 失败归因过期角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  AbFailAttrExpiryRoleAuditSeekLedgerM145Get(
    @Req() req: any,
    @Query('seq') seq?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m145', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M145 A/B失败归因过期角色审计回跳',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M145 A/B失败归因过期关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m145-summary', targetSessionId: targetSessionId || 'session-peer-m145-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  AbFailAttrExpiryRoleAuditSeekLedgerM145Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145(tenantId, body || {});
  }



  /** M146：失败归因过期关帧过期吊销进台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  FailAttrExpiryXsessionExpiryRevokeLedgerM146Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M146失败归因过期关帧过期吊销',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m146-clip', targetSessionId: targetSessionId || 'session-peer-m146-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  FailAttrExpiryXsessionExpiryRevokeLedgerM146Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146(tenantId, body || {});
  }

  /** M146：A/B 失败归因过期回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  AbFailAttrExpirySeekMultiselectContrastM146Get(
    @Req() req: any,
    @Query('seq') seq?: string,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146(tenantId, {
      seq: seq != null ? Number(seq) : 1,
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      matchId: 'demo-match-m146', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M146 A/B失败归因过期回跳多选对照',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M146 A/B失败归因过期关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m146-summary', targetSessionId: targetSessionId || 'session-peer-m146-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  AbFailAttrExpirySeekMultiselectContrastM146Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146(tenantId, body || {});
  }



  /** M147：失败归因过期吊销角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  FailAttrExpiryRevokeRoleAuditOnepagerM147Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M147失败归因过期吊销角色审计',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m147-clip', targetSessionId: targetSessionId || 'session-peer-m147-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  FailAttrExpiryRevokeRoleAuditOnepagerM147Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147(tenantId, body || {});
  }

  /** M147：A/B 失败归因过期多选短片scrubber */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrExpirySeekMultiselectClipScrubberM147Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seq') seq?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m147',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M147 A/B失败归因过期多选短片scrubber',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M147 A/B失败归因过期关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m147-summary', targetSessionId: targetSessionId || 'session-peer-m147-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrExpirySeekMultiselectClipScrubberM147Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147(tenantId, body || {});
  }


  /** M148：失败归因角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  FailAttrRoleAuditSeekLedgerM148Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M148失败归因角色审计回跳',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m148-clip', targetSessionId: targetSessionId || 'session-peer-m148-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  FailAttrRoleAuditSeekLedgerM148Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148(tenantId, body || {});
  }

  /** M148：A/B 失败归因短片scrubber关帧书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrClipScrubberKeyframeBookmarksM148Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seq') seq?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m148',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M148 A/B失败归因短片scrubber关帧书签',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M148 A/B失败归因短片关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m148-summary', targetSessionId: targetSessionId || 'session-peer-m148-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrClipScrubberKeyframeBookmarksM148Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148(tenantId, body || {});
  }


  /** M149：失败归因回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  FailAttrSeekMultiselectContrastM149Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M149失败归因回跳多选对照',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m149-clip', targetSessionId: targetSessionId || 'session-peer-m149-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  FailAttrSeekMultiselectContrastM149Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149(tenantId, body || {});
  }

  /** M149：A/B 失败归因关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  AbFailAttrKfBmXsessionRoShareM149Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m149',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M149 A/B失败归因关帧跨会话只读分享',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M149 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m149-summary', targetSessionId: targetSessionId || 'session-peer-m149-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  AbFailAttrKfBmXsessionRoShareM149Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149(tenantId, body || {});
  }



  /** M150：失败归因多选短片 scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  FailAttrMultiselectClipScrubberM150Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M150失败归因多选短片scrubber',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m150-clip', targetSessionId: targetSessionId || 'session-peer-m150-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  FailAttrMultiselectClipScrubberM150Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150(tenantId, body || {});
  }

  /** M150：A/B 失败归因关帧跨会话过期吊销 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  AbFailAttrKfBmXsessionExpiryRevokeM150Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m150',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M150 A/B失败归因关帧跨会话过期吊销',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M150 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m150-summary', targetSessionId: targetSessionId || 'session-peer-m150-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  AbFailAttrKfBmXsessionExpiryRevokeM150Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150(tenantId, body || {});
  }



  /** M151：失败归因短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  FailAttrClipKfBmM151Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M151失败归因短片关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m151-clip', targetSessionId: targetSessionId || 'session-peer-m151-clip',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  FailAttrClipKfBmM151Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151(tenantId, body || {});
  }

  /** M151：A/B 失败归因过期吊销角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM151Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m151',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M151 A/B失败归因过期吊销角色审计',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M151 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m151-summary', targetSessionId: targetSessionId || 'session-peer-m151-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM151Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151(tenantId, body || {});
  }



  /** M152：失败归因关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  FailAttrKfBmXsessionRoShareM152Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M152失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m152-fail-attr', targetSessionId: targetSessionId || 'session-peer-m152-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  FailAttrKfBmXsessionRoShareM152Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152(tenantId, body || {});
  }

  /** M152：A/B 失败归因角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  AbFailAttrRoleAuditSeekLedgerM152Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m152',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M152 A/B失败归因角色审计回跳',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M152 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m152-summary', targetSessionId: targetSessionId || 'session-peer-m152-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  AbFailAttrRoleAuditSeekLedgerM152Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152(tenantId, body || {});
  }



  /** M153：失败归因关帧跨会话过期吊销 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  FailAttrKfBmXsessionExpiryRevokeM153Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M153失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m153-fail-attr', targetSessionId: targetSessionId || 'session-peer-m153-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  FailAttrKfBmXsessionExpiryRevokeM153Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153(tenantId, body || {});
  }

  /** M153：A/B 失败归因角色审计回跳台账多选对照 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  AbFailAttrRoleAuditSeekMultiselectContrastM153Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m153',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M153 A/B失败归因角色审计回跳多选',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M153 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m153-summary', targetSessionId: targetSessionId || 'session-peer-m153-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  AbFailAttrRoleAuditSeekMultiselectContrastM153Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153(tenantId, body || {});
  }



  /** M154：失败归因过期台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  FailAttrExpiryLedgerRoleAuditM154Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M154失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m154-fail-attr', targetSessionId: targetSessionId || 'session-peer-m154-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  FailAttrExpiryLedgerRoleAuditM154Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154(tenantId, body || {});
  }

  /** M154：A/B 失败归因角色审计回跳多选短片scrubber */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrRoleAuditSeekMultiselectClipScrubberM154Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m154',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M154 A/B失败归因角色审计回跳多选短片',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M154 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m154-summary', targetSessionId: targetSessionId || 'session-peer-m154-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrRoleAuditSeekMultiselectClipScrubberM154Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154(tenantId, body || {});
  }



  /** M155：失败归因过期角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  FailAttrExpiryRoleAuditSeekLedgerM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M155失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m155-fail-attr', targetSessionId: targetSessionId || 'session-peer-m155-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  FailAttrExpiryRoleAuditSeekLedgerM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155(tenantId, body || {});
  }

  /** M155：A/B 失败归因角色审计回跳多选关帧书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrRoleAuditSeekMultiselectKeyframeBookmarksM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m155',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M155 A/B失败归因角色审计回跳多选关帧',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M155 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m155-summary', targetSessionId: targetSessionId || 'session-peer-m155-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrRoleAuditSeekMultiselectKeyframeBookmarksM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155(tenantId, body || {});
  }



  /** M156：失败归因过期角色审计回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  FailAttrExpiryRoleAuditSeekMultiselectM156Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M156失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m156-fail-attr', targetSessionId: targetSessionId || 'session-peer-m156-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  FailAttrExpiryRoleAuditSeekMultiselectM156Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156(tenantId, body || {});
  }

  /** M156：A/B 失败归因多选关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  AbFailAttrMultiselectKfBmXsessionRoShareM156Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m156',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M156 A/B失败归因多选关帧',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M156 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m156-summary', targetSessionId: targetSessionId || 'session-peer-m156-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  AbFailAttrMultiselectKfBmXsessionRoShareM156Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156(tenantId, body || {});
  }



  /** M157：失败归因回跳多选短片scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  FailAttrSeekMultiselectClipScrubberM157Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M157失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m157-fail-attr', targetSessionId: targetSessionId || 'session-peer-m157-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  FailAttrSeekMultiselectClipScrubberM157Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157(tenantId, body || {});
  }

  /** M157：A/B 失败归因多选关帧跨会话过期吊销 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  AbFailAttrMultiselectKfBmXsessionExpiryRevokeM157Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m157',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M157 A/B失败归因多选关帧',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M157 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m157-summary', targetSessionId: targetSessionId || 'session-peer-m157-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger')
  AbFailAttrMultiselectKfBmXsessionExpiryRevokeM157Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157(tenantId, body || {});
  }



  /** M158：失败归因短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  FailAttrClipKeyframeBookmarksM158Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158失败归因短片关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m158-fail-attr', targetSessionId: targetSessionId || 'session-peer-m158-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  FailAttrClipKeyframeBookmarksM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158(tenantId, body || {});
  }

  /** M158：A/B 失败归因过期吊销角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM158Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m158',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M158 A/B失败归因过期吊销',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M158 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m158-summary', targetSessionId: targetSessionId || 'session-peer-m158-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158(tenantId, body || {});
  }



  /** M159：失败归因关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  FailAttrKfBmXsessionRoShareM159Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M159失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m159-fail-attr', targetSessionId: targetSessionId || 'session-peer-m159-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share')
  FailAttrKfBmXsessionRoShareM159Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159(tenantId, body || {});
  }

  /** M159：A/B 失败归因角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  AbFailAttrRoleAuditSeekLedgerM159Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m159',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M159 A/B失败归因角色审计回跳',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M159 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m159-summary', targetSessionId: targetSessionId || 'session-peer-m159-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger')
  AbFailAttrRoleAuditSeekLedgerM159Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159(tenantId, body || {});
  }



  /** M160：失败归因关帧跨会话过期吊销 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m160')
  FailAttrKfBmXsessionExpiryRevokeM160Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M160失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m160-fail-attr', targetSessionId: targetSessionId || 'session-peer-m160-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m160')
  FailAttrKfBmXsessionExpiryRevokeM160Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160(tenantId, body || {});
  }

  /** M160：A/B 失败归因角色审计回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  AbFailAttrRoleAuditSeekMultiselectContrastM160Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m160',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M160 A/B失败归因角色审计回跳多选',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M160 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m160-summary', targetSessionId: targetSessionId || 'session-peer-m160-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast')
  AbFailAttrRoleAuditSeekMultiselectContrastM160Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160(tenantId, body || {});
  }



  /** M161：失败归因过期台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161')
  FailAttrExpiryLedgerRoleAuditOnepagerM161Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M161失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m161-fail-attr', targetSessionId: targetSessionId || 'session-peer-m161-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161')
  FailAttrExpiryLedgerRoleAuditOnepagerM161Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161(tenantId, body || {});
  }

  /** M161：A/B 失败归因角色审计回跳多选短片scrubber */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrRoleAuditSeekMultiselectClipScrubberM161Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m161',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M161 A/B失败归因角色审计回跳多选短片',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M161 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m161-summary', targetSessionId: targetSessionId || 'session-peer-m161-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber')
  AbFailAttrRoleAuditSeekMultiselectClipScrubberM161Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161(tenantId, body || {});
  }



  /** M162：失败归因过期角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162')
  FailAttrExpiryRoleAuditSeekLedgerM162Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M162失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m162-fail-attr', targetSessionId: targetSessionId || 'session-peer-m162-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162')
  FailAttrExpiryRoleAuditSeekLedgerM162Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162(tenantId, body || {});
  }

  /** M162：A/B 失败归因角色审计回跳多选关帧书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrRoleAuditSeekMultiselectKfBmM162Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m162',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M162 A/B失败归因角色审计回跳多选关帧',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M162 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m162-summary', targetSessionId: targetSessionId || 'session-peer-m162-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks')
  AbFailAttrRoleAuditSeekMultiselectKfBmM162Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162(tenantId, body || {});
  }



  /** M163：失败归因回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163')
  FailAttrSeekMultiselectContrastM163Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M163失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m163-fail-attr', targetSessionId: targetSessionId || 'session-peer-m163-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163')
  FailAttrSeekMultiselectContrastM163Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163(tenantId, body || {});
  }

  /** M163：A/B 失败归因多选关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163')
  AbFailAttrMultiselectKfBmXsessionRoShareM163Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m163',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M163 A/B失败归因多选关帧跨会话',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M163 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m163-summary', targetSessionId: targetSessionId || 'session-peer-m163-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163')
  AbFailAttrMultiselectKfBmXsessionRoShareM163Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163(tenantId, body || {});
  }



  /** M164：失败归因多选短片scrubber */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164')
  FailAttrMultiselectClipScrubberM164Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M164失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m164-fail-attr', targetSessionId: targetSessionId || 'session-peer-m164-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164')
  FailAttrMultiselectClipScrubberM164Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164(tenantId, body || {});
  }

  /** M164：A/B 失败归因多选关帧跨会话过期吊销 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164')
  AbFailAttrMsKfBmXsessionExpiryRevokeM164Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m164',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M164 A/B失败归因多选关帧过期吊销',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M164 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m164-summary', targetSessionId: targetSessionId || 'session-peer-m164-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164')
  AbFailAttrMsKfBmXsessionExpiryRevokeM164Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164(tenantId, body || {});
  }



  /** M165：失败归因短片关帧书签 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165')
  FailAttrClipKeyframeBookmarksM165Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M165失败归因短片关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m165-fail-attr', targetSessionId: targetSessionId || 'session-peer-m165-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165')
  FailAttrClipKeyframeBookmarksM165Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165(tenantId, body || {});
  }

  /** M165：A/B 失败归因过期吊销角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM165Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m165',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M165 A/B失败归因过期吊销角色审计',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M165 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m165-summary', targetSessionId: targetSessionId || 'session-peer-m165-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM165Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165(tenantId, body || {});
  }



  /** M166：失败归因关帧跨会话只读分享 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166')
  FailAttrKfBmXsessionRoShareM166Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M166失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m166-fail-attr', targetSessionId: targetSessionId || 'session-peer-m166-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166')
  FailAttrKfBmXsessionRoShareM166Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166(tenantId, body || {});
  }

  /** M166：A/B 失败归因角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166')
  AbFailAttrRoleAuditSeekLedgerM166Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m166',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M166 A/B失败归因角色审计回跳',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M166 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m166-summary', targetSessionId: targetSessionId || 'session-peer-m166-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166')
  AbFailAttrRoleAuditSeekLedgerM166Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166(tenantId, body || {});
  }



  /** M167：失败归因关帧跨会话过期吊销 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167')
  FailAttrKfBmXsessionExpiryRevokeM167Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M167失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m167-fail-attr', targetSessionId: targetSessionId || 'session-peer-m167-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167')
  FailAttrKfBmXsessionExpiryRevokeM167Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167(tenantId, body || {});
  }

  /** M167：A/B 失败归因角色审计回跳多选对照 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167')
  AbFailAttrRoleAuditSeekMultiselectContrastM167Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m167',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M167 A/B失败归因角色审计回跳多选',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M167 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m167-summary', targetSessionId: targetSessionId || 'session-peer-m167-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167')
  AbFailAttrRoleAuditSeekMultiselectContrastM167Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167(tenantId, body || {});
  }



  /** M168：失败归因过期台账角色审计一页纸 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168')
  FailAttrExpiryLedgerRoleAuditOnepagerM168Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M168失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m168-fail-attr', targetSessionId: targetSessionId || 'session-peer-m168-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168')
  FailAttrExpiryLedgerRoleAuditOnepagerM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168(tenantId, body || {});
  }

  /** M168：A/B 失败归因回跳多选短片scrubber */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168')
  AbFailAttrSeekMultiselectClipScrubberM168Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m168',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M168 A/B失败归因回跳多选短片',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M168 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m168-summary', targetSessionId: targetSessionId || 'session-peer-m168-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168')
  AbFailAttrSeekMultiselectClipScrubberM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168(tenantId, body || {});
  }



  /** M169：失败归因过期角色审计回跳台账 */
  @Get('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168/seek-ledger/m169')
  FailAttrRoleAuditSeekLedgerM169Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168SeekLedgerM169(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M169失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m169-fail-attr', targetSessionId: targetSessionId || 'session-peer-m169-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168/seek-ledger/m169')
  FailAttrRoleAuditSeekLedgerM169Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168SeekLedgerM169(tenantId, body || {});
  }

  /** M169：A/B 失败归因回跳多选关帧书签 */
  @Get('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169')
  AbFailAttrMultiselectClipKeyframeBookmarksM169Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m169',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M169 A/B失败归因回跳多选关帧',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M169 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m169-summary', targetSessionId: targetSessionId || 'session-peer-m169-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169')
  AbFailAttrMultiselectClipKeyframeBookmarksM169Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169(tenantId, body || {});
  }



  /** M170：失败归因回跳多选对照 */
  @Get('imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168/seek-ledger/m169/multi-select-contrast/m170')
  FailAttrSeekMultiselectContrastM170Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168SeekLedgerM169MultiselectContrastM170(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M170失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m170-fail-attr', targetSessionId: targetSessionId || 'session-peer-m170-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168/seek-ledger/m169/multi-select-contrast/m170')
  FailAttrSeekMultiselectContrastM170Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168SeekLedgerM169MultiselectContrastM170(tenantId, body || {});
  }

  /** M170：A/B 失败归因多选关帧跨会话只读分享 */
  @Get('imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169/xsession-ro-share/m170')
  AbFailAttrMultiselectKfBmXsessionRoShareM170Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169XsessionRoShareM170(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m170',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M170 A/B失败归因多选关帧跨会话',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M170 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m170-summary', targetSessionId: targetSessionId || 'session-peer-m170-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169/xsession-ro-share/m170')
  AbFailAttrMultiselectKfBmXsessionRoShareM170Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169XsessionRoShareM170(tenantId, body || {});
  }


}
