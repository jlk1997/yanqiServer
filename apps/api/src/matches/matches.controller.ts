import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import type { Response } from 'express';
import { MatchesService } from './matches.service';
import { scopedOrgId } from '../auth/scope';
import { FindPeopleService } from '../outreach/find-people.service';

@Controller('matches')
export class MatchesController {
  constructor(
    private svc: MatchesService,
    private findPeople: FindPeopleService,
  ) {}

  private viewer(req: any) {
    const role = req?.user?.role;
    if (!req?.authMeta?.hasKey && (role === 'ORG_USER' || role === 'TENANT_ADMIN')) {
      return { kind: 'org' as const, orgId: scopedOrgId(req, undefined) };
    }
    if (!req?.authMeta?.hasKey && role === 'BROKER') {
      return { kind: 'broker' as const, brokerId: req.user?.uid };
    }
    return { kind: 'ops' as const };
  }

  private opsOnly(req: any) {
    if (this.viewer(req).kind !== 'ops') {
      throw new ForbiddenException('请在机构工作台查看对接进展');
    }
  }

  @Get()
  list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('minScore') minScore?: string,
    @Query('brokerId') brokerId?: string,
  ) {
    const ms = minScore !== undefined && minScore !== '' ? Number(minScore) : undefined;
    const viewer = this.viewer(req);
    const orgId = viewer.kind === 'org' ? viewer.orgId : undefined;
    const bid = viewer.kind === 'broker' ? viewer.brokerId : brokerId;
    return this.svc.list({ status, minScore: ms, orgId, brokerId: bid, audience: viewer.kind });
  }

  @Post('run')
  run(
    @Req() req: any,
    @Body()
    body: {
      demandId?: string;
      demandIds?: string[];
      topN?: number;
      minScore?: number;
      bypassFullBatch?: boolean;
    },
  ) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      // 机构可请求为自己需求跑匹配
    }
    const b = body || {};
    // M85：bypassFullBatch / 单 demandId → 仅跑该需求
    if (b.bypassFullBatch && b.demandId && !b.demandIds?.length) {
      return this.svc.runMatch({ ...b, demandIds: [b.demandId] });
    }
    return this.svc.runMatch(b);
  }

  /** M59：续跑一页纸+解释核心预热队列（租户隔离） */
  @Post('prewarm/resume')
  resumePrewarm(
    @Req() req: any,
    @Body() body: { queueId?: string; tenantId?: string },
  ) {
    const queueId = String(body?.queueId || '').trim();
    if (!queueId) return { ok: false, messageZh: '缺少 queueId', wave: 'M59' };
    const tenantId =
      body?.tenantId || req?.resolvedTenantId || req?.user?.tenantId || 'default';
    return this.svc.resumePrewarmQueue(queueId, { tenantId });
  }

  @Post(':id/find-people')
  findPeopleFor(@Req() req: any, @Param('id') id: string) {
    this.opsOnly(req);
    return this.findPeople.findForMatch(id);
  }

  @Post(':id/reject-dossier')
  rejectDossier(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string; comment?: string }) {
    this.opsOnly(req);
    return this.findPeople.reject(id, body?.reason || 'other', body?.comment);
  }

  @Get('contact-gaps')
  contactGaps(@Req() req: any, @Query('status') status?: string) {
    this.opsOnly(req);
    return this.findPeople.gaps(status || 'open');
  }

  @Post('contact-gaps/:id/fill')
  fillGap(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { email?: string; phone?: string; personName?: string },
  ) {
    this.opsOnly(req);
    return this.findPeople.fillGap(id, body || {});
  }

  @Post('bulk-status')
  bulk(@Req() req: any, @Body() body: { ids: string[]; status: string; operatorNote?: string }) {
    this.opsOnly(req);
    return this.svc.bulkUpdateStatus(body?.ids || [], body?.status, body?.operatorNote);
  }

  /** M56：解释页 · fields=core|full · 短缓存/ETag · timingMs */
  @Get(':id/explain')
  async explain(
    @Param('id') id: string,
    @Query('fields') fields?: string,
    @Query('slim') slim?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const f = slim === '1' || slim === 'true' ? 'core' : fields;
    const body = await this.svc.explainMatch(id, { fields: f });
    if (viewer.kind === 'org') {
      body.leads = [];
      if (body.broker) body.broker = { id: body.broker.id, name: body.broker.name };
      body.operatorNote = null;
    }
    if (res) {
      if (body?.etag) res.setHeader('ETag', body.etag);
      res.setHeader('X-Yanqi-Wave', 'M59');
      if (body?.timingMs != null) res.setHeader('X-Yanqi-Timing-Ms', String(body.timingMs));
      const inm = req?.headers?.['if-none-match'];
      if (inm && body?.etag && String(inm) === String(body.etag)) {
        res.status(304);
        return;
      }
    }
    return body;
  }

  /** 分享分级说明（大白话） */
  @Get('one-pager/tiers')
  onePagerTiers() {
    return this.svc.listOnePagerTiers();
  }

  /** 我的分享台账（可含已撤销/过期） */
  @Get('one-pager/shares')
  listShares(
    @Req() req: any,
    @Query('matchId') matchId?: string,
    @Query('includeDead') includeDead?: string,
  ) {
    const role = req?.user?.role;
    const isOps = req?.authMeta?.hasKey || role === 'ADMIN' || role === 'OPERATOR';
    return this.svc.listOnePagerShares({
      actor: req?.user?.email || req?.user?.uid,
      matchId,
      includeDead: includeDead === '1' || includeDead === 'true',
      isOps,
    });
  }

  /** 公开/合作方分享令牌读取（按级脱敏；已撤销/过期拒绝） */
  @Get('one-pager/s/:token')
  sharedOnePager(@Param('token') token: string) {
    return this.svc.getSharedOnePager(token);
  }

  /** 撤销分享 */
  @Post('one-pager/s/:token/revoke')
  revokeShare(@Param('token') token: string, @Req() req: any) {
    const role = req?.user?.role;
    const isOps = req?.authMeta?.hasKey || role === 'ADMIN' || role === 'OPERATOR';
    return this.svc.revokeOnePagerShare(token, req?.user?.email || req?.user?.uid || 'user', isOps);
  }

  /** 改过期时间 */
  @Patch('one-pager/s/:token')
  patchShare(
    @Param('token') token: string,
    @Body() body: { expiresDays?: number; expiresAt?: string },
    @Req() req: any,
  ) {
    const role = req?.user?.role;
    const isOps = req?.authMeta?.hasKey || role === 'ADMIN' || role === 'OPERATOR';
    return this.svc.setOnePagerShareExpiry(
      token,
      req?.user?.email || req?.user?.uid || 'user',
      body || {},
      isOps,
    );
  }

  /** 导出元信息（链接清单） */
  @Get(':id/one-pager/export')
  async onePagerExport(@Req() req: any, @Param('id') id: string) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    return this.svc.onePagerExportMeta(id);
  }

  /** 创建分级分享链接 */
  @Post(':id/one-pager/share')
  async shareOnePager(
    @Param('id') id: string,
    @Body() body: { tier?: string; expiresDays?: number },
    @Req() req: any,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const tier = viewer.kind === 'org' && (!body?.tier || body.tier === 'full') ? 'partner' : body?.tier || 'partner';
    return this.svc.createOnePagerShare(
      id,
      tier,
      req?.user?.email || req?.user?.uid || 'user',
      { expiresDays: body?.expiresDays },
    );
  }

  /** 可打印 HTML（分享/浏览器另存） */
  @Get(':id/one-pager/html')
  async onePagerHtml(
    @Req() req: any,
    @Param('id') id: string,
    @Query('role') role: string,
    @Query('tier') tier: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const useTier = viewer.kind === 'org' && (!tier || tier === 'full') ? 'partner' : tier || 'full';
    const { html } = await this.svc.onePagerHtml(id, role || '', useTier);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="yanqi-one-pager-${id.slice(0, 10)}.html"`);
    }
    res.send(html);
  }

  /** Chrome 打印 PDF */
  @Get(':id/one-pager/pdf')
  async onePagerPdf(
    @Req() req: any,
    @Param('id') id: string,
    @Query('role') role: string,
    @Query('tier') tier: string,
    @Res() res: Response,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const useTier = viewer.kind === 'org' && (!tier || tier === 'full') ? 'partner' : tier || 'full';
    try {
      const out = await this.svc.onePagerPdf(id, role || '', useTier);
      if (!existsSync(out.pdfPath)) throw new Error('pdf missing');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="yanqi-one-pager-${id.slice(0, 10)}.pdf"`);
      createReadStream(out.pdfPath).pipe(res);
    } catch (e: any) {
      const { html } = await this.svc.onePagerHtml(id, role || '', useTier);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Yanqi-Pdf-Fallback', 'html');
      res.status(200).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PDF 降级</title></head><body>
        <p style="font-family:sans-serif;padding:16px">服务端 PDF 暂不可用（${String(e?.message || e).slice(0, 120)}）。请使用「打印 / 另存为 PDF」。</p>
        ${html.replace('<!DOCTYPE html>', '').replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '')}
      </body></html>`);
    }
  }

  /** Chrome 截长图 PNG */
  @Get(':id/one-pager/png')
  async onePagerPng(
    @Req() req: any,
    @Param('id') id: string,
    @Query('role') role: string,
    @Query('tier') tier: string,
    @Res() res: Response,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const useTier = viewer.kind === 'org' && (!tier || tier === 'full') ? 'partner' : tier || 'full';
    try {
      const out = await this.svc.onePagerImage(id, role || '', useTier, 'png');
      if (!existsSync(out.imagePath)) throw new Error('png missing');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="yanqi-one-pager-${id.slice(0, 10)}.png"`);
      createReadStream(out.imagePath).pipe(res);
    } catch (e: any) {
      res.status(503).json({
        ok: false,
        message: '长图 PNG 暂不可用：' + String(e?.message || e).slice(0, 160),
        hintZh: '可改用下载 HTML / PDF，或浏览器打印。',
      });
    }
  }

  /** 长图 JPEG（PNG 转码） */
  @Get(':id/one-pager/jpeg')
  async onePagerJpeg(
    @Req() req: any,
    @Param('id') id: string,
    @Query('role') role: string,
    @Query('tier') tier: string,
    @Res() res: Response,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const useTier = viewer.kind === 'org' && (!tier || tier === 'full') ? 'partner' : tier || 'full';
    try {
      const out = await this.svc.onePagerImage(id, role || '', useTier, 'jpeg');
      if (!existsSync(out.imagePath)) throw new Error('jpeg missing');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="yanqi-one-pager-${id.slice(0, 10)}.jpg"`);
      createReadStream(out.imagePath).pipe(res);
    } catch (e: any) {
      res.status(503).json({
        ok: false,
        message: '长图 JPEG 暂不可用：' + String(e?.message || e).slice(0, 160),
        hintZh: '可改用 PNG / HTML / PDF。',
      });
    }
  }

  /** 中文一页纸（工作台 sheet 主入口）· M55/M57：slim + fields 投影 + ETag；收件箱投影复用 */
  @Get(':id/one-pager')
  async onePager(
    @Param('id') id: string,
    @Query('tier') tier: string | undefined,
    @Query('slim') slim: string | undefined,
    @Query('fields') fields: string | undefined,
    @Query('fresh') fresh: string | undefined,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const viewer = this.viewer(req);
    if (viewer.kind !== 'ops') await this.svc.visibleToViewer(id, viewer);
    const useTier = viewer.kind === 'org' && (!tier || tier === 'full') ? 'partner' : tier || 'full';
    const wantSlim =
      slim === '0' || slim === 'false' || fields === 'full' || fields === 'all' ? false : true;
    const body = await this.svc.onePager(id, useTier, {
      slim: wantSlim,
      fields: fields || (wantSlim ? 'sheet' : 'full'),
      bypassCache: fresh === '1' || fresh === 'true',
    });
    const etag = body?.etag;
    if (etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=15');
      res.setHeader('X-Yanqi-OnePager-Cache', body.cache || 'MISS');
      res.setHeader('X-Yanqi-OnePager-Timing', String(body.timingMs ?? ''));
      res.setHeader('X-Yanqi-Wave', 'M57');
      if (req.headers['if-none-match'] === etag) {
        res.status(304);
        return;
      }
    }
    return body;
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const viewer = this.viewer(req);
    const row = await this.svc.visibleToViewer(id, viewer);
    if (viewer.kind === 'ops') return row;
    return this.svc.presentExternal(row);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { status: string; operatorNote?: string }, @Req() req: any) {
    const viewer = this.viewer(req);
    if (viewer.kind === 'org') this.opsOnly(req);
    if (viewer.kind === 'broker') await this.svc.visibleToViewer(id, viewer);
    return this.svc.updateStatus(id, body.status, body.operatorNote, req.user?.uid);
  }

  @Post(':id/regenerate-draft')
  regenerate(@Req() req: any, @Param('id') id: string) {
    this.opsOnly(req);
    return this.svc.regenerateDraft(id);
  }
}
