import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { scopedOrgId } from '../auth/scope';
import { AuditService } from '../common/audit.service';
import { clientIp, rateLimit } from '../common/rate-limit';
import { Response } from 'express';
import { BadRequestException } from '@nestjs/common';

@Controller('leads')
export class LeadsController {
  constructor(
    private svc: LeadsService,
    private audit: AuditService,
  ) {}

  @Get()
  list(@Req() req: any, @Query('status') status?: string) {
    return this.svc.list(status, this.scope(req));
  }

  @Get('export.csv')
  async exportCsv(@Req() req: any, @Res() res: Response, @Query('status') status?: string) {
    const csv = await this.svc.exportCsv(status, this.scope(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="yanqi-leads.csv"');
    res.send('\uFEFF' + csv);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.svc.get(id, this.scope(req));
  }

  private scope(req: any) {
    const role = req.user?.role;
    if (req.authMeta?.hasKey) return {};
    if (role === 'ORG_USER' || role === 'TENANT_ADMIN') return { orgId: scopedOrgId(req) };
    if (role === 'BROKER') return { brokerId: req.user?.uid };
    return {};
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Post(':id/approve-send')
  async approveSend(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const ip = clientIp(req);
    const rl = rateLimit(`lead-send:${ip}`, 30, 60_000);
    if (!rl.ok) throw new BadRequestException(`发送过快，请 ${rl.retryAfterSec}s 后再试`);
    const actor = body?.actor || req?.user?.email || 'ops';
    const confirmLive = body?.confirmLive === true;
    const result = await this.svc.approveAndSend(id, actor, confirmLive);
    await this.audit.log({
      action: 'api.lead.approve_send',
      actor,
      targetType: 'Lead',
      targetId: id,
      ip,
      meta: { mode: result.mode, ok: result.ok, confirmLive },
    });
    return result;
  }
}
