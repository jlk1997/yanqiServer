import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { createReadStream, existsSync, writeFileSync } from 'fs';
import type { Response } from 'express';
import { CommissionsService } from './commissions.service';

@Controller('commissions')
export class CommissionsController {
  constructor(private commissions: CommissionsService) {}

  private brokerScope(req?: any, brokerId?: string, tenantId?: string) {
    if (req?.user?.role === 'BROKER') {
      return { brokerId: req.user.uid, tenantId: req.user.tenantId || tenantId };
    }
    return { brokerId, tenantId };
  }

  @Get('ledger')
  ledger(
    @Query('brokerId') brokerId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: any,
  ) {
    return this.commissions.ledger({ ...this.brokerScope(req, brokerId, tenantId), status, from, to });
  }

  /** M38：佣金账 CSV（Excel 可开） */
  @Get('ledger/export.csv')
  async exportCsv(
    @Query('brokerId') brokerId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const out = await this.commissions.exportLedgerCsv({ ...this.brokerScope(req, brokerId, tenantId), status, from, to });
    res!.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.fileName}"`,
      'X-Yanqi-Banner': 'demo-never-charges',
    });
    return out.csv;
  }

  /** M38：佣金账 Excel 友好导出 */
  @Get('ledger/export.xlsx')
  async exportXlsx(
    @Query('brokerId') brokerId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const out = await this.commissions.exportLedgerExcel({ ...this.brokerScope(req, brokerId, tenantId), status, from, to });
    res!.set({
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.fileName}"`,
      'X-Yanqi-Banner': 'demo-never-charges',
    });
    return new StreamableFile(createReadStream(out.filePath));
  }

  /** M38：佣金账 PDF */
  @Get('ledger/export.pdf')
  async exportPdf(
    @Query('brokerId') brokerId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    try {
      const out = await this.commissions.exportLedgerPdf({ ...this.brokerScope(req, brokerId, tenantId), status, from, to });
      if (!existsSync(out.filePath)) throw new Error('pdf missing');
      res!.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${out.fileName}"`,
        'X-Yanqi-Banner': 'demo-never-charges',
      });
      return new StreamableFile(createReadStream(out.filePath));
    } catch (e: any) {
      throw new BadRequestException('佣金账 PDF 失败：' + (e?.message || String(e)).slice(0, 200));
    }
  }

  /** 导出能力探测 */
  @Get('ledger/export')
  exportMeta() {
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: '佣金账可按状态/日期筛选后导出 CSV / Excel / PDF；演示不打款。',
      neverCharges: true,
      filters: ['status', 'from', 'to'],
      statusEnums: ['stub', 'pending', 'approved', 'paid'],
      links: {
        csv: '/api/commissions/ledger/export.csv',
        xlsx: '/api/commissions/ledger/export.xlsx',
        pdf: '/api/commissions/ledger/export.pdf',
      },
      noteZh: '查询参数 status、from、to（YYYY-MM-DD）对 ledger 与三种导出同时生效。',
    };
  }

  @Get()
  list(
    @Query('brokerId') brokerId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Req() req?: any,
  ) {
    const scope = this.brokerScope(req, brokerId, tenantId);
    return this.commissions.list({ ...scope, status });
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户不能创建分成' };
    }
    return this.commissions.createStub(body || {}, req?.user?.email || 'ops');
  }

  @Post('ensure-demo')
  ensureDemo(@Req() req: any, @Body() body?: { brokerId?: string }) {
    const brokerId =
      req.user?.role === 'BROKER' ? req.user.uid : body?.brokerId || req.user?.uid;
    return this.commissions.ensureDemoLedger(brokerId);
  }

  @Patch(':id/status')
  status(@Param('id') id: string, @Body() body: { status: string }, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' || req.user?.role === 'BROKER') {
      if (!req.authMeta?.hasKey && req.user?.role !== 'ADMIN' && req.user?.role !== 'OPERATOR') {
        if (req.user?.role === 'BROKER') return { ok: false, message: '经纪人不能改分成状态' };
      }
    }
    return this.commissions.setStatus(id, body.status, req?.user?.email || 'ops');
  }
}
