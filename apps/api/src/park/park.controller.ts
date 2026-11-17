import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import type { Response } from 'express';
import { ParkService, ApprovalStatus, WindowStatus, DocStatus, DocDirection } from './park.service';

@Controller('park')
export class ParkController {
  constructor(private svc: ParkService) {}

  @Get('board')
  board() {
    return this.svc.board();
  }

  @Post('windows')
  createWindow(@Body() body: any, @Req() req: any) {
    this.svc.assertCanMutate(req, 'window');
    return this.svc.createWindow(body || {}, req?.user?.email || req?.user?.uid || 'ops');
  }

  @Patch('windows/:id/status')
  windowStatus(@Param('id') id: string, @Body() body: { status: WindowStatus; noteZh?: string }, @Req() req: any) {
    this.svc.assertCanMutate(req, 'window');
    return this.svc.transitionWindow(id, body.status, req?.user?.email || 'ops', body.noteZh);
  }

  @Post('approvals')
  createApproval(@Body() body: any, @Req() req: any) {
    this.svc.assertCanMutate(req, 'approval');
    return this.svc.createApproval(body || {}, req?.user?.email || req?.user?.uid || 'ops');
  }

  @Patch('approvals/:id/transition')
  approvalTransition(
    @Param('id') id: string,
    @Body() body: { status: ApprovalStatus; noteZh?: string },
    @Req() req: any,
  ) {
    const role = req?.user?.role;
    const hasKey = req?.authMeta?.hasKey;
    const isOps = hasKey || role === 'ADMIN' || role === 'OPERATOR';
    if (!isOps) {
      // 园区观察账号可审阅推进
      if (!this.svc.parkMayReview(body.status)) {
        this.svc.assertCanMutate(req, 'window');
      }
    }
    return this.svc.transitionApproval(id, body.status, req?.user?.email || req?.user?.uid || 'park', body.noteZh);
  }

  @Post('seed-from-demands')
  seed(@Req() req: any) {
    this.svc.assertCanMutate(req, 'window');
    return this.svc.seedFromDemands(req?.user?.email || 'ops');
  }

  /** 已通过/已公示 → 一键进案例审核台（默认 pending；body.publishNow 直接公示） */
  @Post('approvals/:id/publish-case')
  publishCase(@Param('id') id: string, @Body() body: { publishNow?: boolean }, @Req() req: any) {
    const role = req?.user?.role;
    const hasKey = req?.authMeta?.hasKey;
    const isOps = hasKey || role === 'ADMIN' || role === 'OPERATOR';
    if (!isOps) {
      if (role === 'BROKER') {
        this.svc.assertCanMutate(req, 'window');
      }
    }
    return this.svc.publishDesensitizedCase(
      id,
      req?.user?.email || req?.user?.uid || 'park',
      { publishNow: Boolean(body?.publishNow) },
    );
  }

  /** 公文交换骨架：列表 */
  @Get('docs')
  listDocs(
    @Query('direction') direction?: DocDirection,
    @Query('status') status?: DocStatus,
  ) {
    return this.svc.listDocs({ direction, status });
  }

  /** M37：批量签发文号 / 批量标记发出 */
  @Post('docs/batch')
  batchDocs(
    @Body() body: { ids?: string[]; action?: 'assign_docno' | 'mark_sent'; templateId?: string; noteZh?: string },
    @Req() req: any,
  ) {
    this.svc.assertCanMutate(req, 'docs');
    return this.svc.batchDocs(body || {}, req?.user?.email || req?.user?.uid || 'park');
  }

  /** M39：红头批量套版 ZIP */
  @Post('docs/redhead/zip')
  async redheadZip(
    @Body() body: { ids?: string[] },
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.svc.assertCanMutate(req, 'docs');
    try {
      const out = await this.svc.renderRedheadZip(body?.ids || [], req?.user?.email || req?.user?.uid || 'park');
      if (!existsSync(out.filePath)) throw new Error('zip missing');
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${out.fileName}"`,
        'X-Yanqi-Banner': 'not-official-gov-doc',
        'X-Yanqi-Count': String(out.count),
      });
      return new StreamableFile(createReadStream(out.filePath));
    } catch (e: any) {
      throw new BadRequestException('红头批量 ZIP 失败：' + (e?.message || String(e)).slice(0, 200));
    }
  }

  /** M39：红头批量 ZIP 元信息（门禁探测，不生成文件） */
  @Post('docs/redhead/zip-meta')
  redheadZipMeta(@Body() body: { ids?: string[] }, @Req() req: any) {
    this.svc.assertCanMutate(req, 'docs');
    const ids = Array.from(new Set((body?.ids || []).map((x) => String(x || '').trim()).filter(Boolean)));
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: '红头批量套版 ZIP（非法定公文 · 不接专网）',
      liveGovNetwork: false,
      count: ids.length,
      ids,
      link: '/api/park/docs/redhead/zip',
      noteZh: 'POST ids[] 生成 ZIP；单次最多 30 份。',
    };
  }

  /** M39：登记投递回执骨架 */
  @Post('docs/:id/delivery-ack')
  deliveryAck(
    @Param('id') id: string,
    @Body() body: { channel?: string; status?: 'recorded' | 'simulated_sent' | 'simulated_acked'; noteZh?: string },
    @Req() req: any,
  ) {
    this.svc.assertCanMutate(req, 'docs');
    return this.svc.recordDeliveryAck(id, body || {}, req?.user?.email || req?.user?.uid || 'park');
  }

  /** M39：投递回执列表 */
  @Get('docs/:id/delivery-acks')
  deliveryAcks(@Param('id') id: string) {
    return this.svc.listDeliveryAcks(id);
  }

  /** 新建公文草稿（可带模板文号 / 征集窗） */
  @Post('docs')
  createDoc(
    @Body()
    body: {
      direction?: DocDirection;
      titleZh?: string;
      bodyZh?: string;
      counterpartyZh?: string;
      templateId?: string;
      windowId?: string;
      docNo?: string;
    },
    @Req() req: any,
  ) {
    this.svc.assertCanMutate(req, 'docs');
    return this.svc.createDocDraft(body || ({} as any), req?.user?.email || req?.user?.uid || 'park');
  }

  /** 公文状态：draft → sent → acked */
  @Patch('docs/:id/status')
  docStatus(
    @Param('id') id: string,
    @Body() body: { status: DocStatus; noteZh?: string },
    @Req() req: any,
  ) {
    this.svc.assertCanMutate(req, 'docs');
    return this.svc.transitionDoc(id, body.status, req?.user?.email || req?.user?.uid || 'park', body.noteZh);
  }

  /** 公文模板列表（文号规则） */
  @Get('doc-templates')
  listTemplates() {
    return this.svc.listDocTemplates();
  }

  /** 新建/更新公文模板（运营） */
  @Post('doc-templates')
  upsertTemplate(@Body() body: any, @Req() req: any) {
    this.svc.assertCanMutate(req, 'window');
    return this.svc.upsertDocTemplate(body || {}, req?.user?.email || req?.user?.uid || 'ops');
  }

  /** 文号预览（不消耗序号） */
  @Get('doc-templates/preview-docno')
  previewDocNo(@Query('rule') rule?: string, @Query('seq') seq?: string) {
    return this.svc.previewDocNo(rule, seq ? Number(seq) : undefined);
  }

  /** 公文关联征集窗 */
  @Patch('docs/:id/window')
  linkWindow(
    @Param('id') id: string,
    @Body() body: { windowId?: string | null },
    @Req() req: any,
  ) {
    this.svc.assertCanMutate(req, 'docs');
    return this.svc.linkDocWindow(
      id,
      body?.windowId === undefined ? null : body.windowId,
      req?.user?.email || req?.user?.uid || 'park',
    );
  }


  /** M38：红头套版 HTML 预览 */
  @Get('docs/:id/redhead/html')
  redheadHtml(@Param('id') id: string, @Res() res: Response) {
    const out = this.svc.docRedHeaderHtml(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Yanqi-Banner', 'not-official-gov-doc');
    return res.send(out.html);
  }

  /** M38：红头套版 PDF 下载 */
  @Get('docs/:id/redhead/pdf')
  async redheadPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    try {
      const out = await this.svc.renderDocRedHeaderPdf(id);
      if (!existsSync(out.pdfPath)) throw new Error('pdf missing');
      const safe = String(out.docNo || id)
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 60) || id.slice(0, 12);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="yanqi-park-doc-${safe}.pdf"`,
        'X-Yanqi-Banner': 'not-official-gov-doc',
        'X-Yanqi-Note': 'demo-not-official-gov-doc',
      });
      return new StreamableFile(createReadStream(out.pdfPath));
    } catch (e: any) {
      throw new BadRequestException('红头 PDF 生成失败：' + (e?.message || String(e)).slice(0, 200));
    }
  }


  /** 元信息：便于门禁探测 */
  @Get('docs/:id/redhead')
  async redheadMeta(@Param('id') id: string) {
    const html = this.svc.docRedHeaderHtml(id);
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: html.bannerZh,
      liveGovNetwork: false,
      doc: html.doc,
      links: {
        html: `/api/park/docs/${id}/redhead/html`,
        pdf: `/api/park/docs/${id}/redhead/pdf`,
      },
      noteZh: '红头套版仅演示；横幅标明非法定公文。',
    };
  }

}
