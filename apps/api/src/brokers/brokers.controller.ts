import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { BrokersService } from './brokers.service';

@Controller('brokers')
export class BrokersController {
  constructor(private brokers: BrokersService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.brokers.listBrokers(tenantId);
  }

  @Get('statuses')
  statuses() {
    return this.brokers.statusLabels();
  }

  @Get('assignments')
  assignments(@Query('brokerId') brokerId?: string, @Query('tenantId') tenantId?: string, @Req() req?: any) {
    const role = req?.user?.role;
    if (role === 'BROKER') return this.brokers.listAssigned(req.user.uid, req.user.tenantId || tenantId);
    return this.brokers.listAssigned(brokerId, tenantId);
  }

  @Get('sla')
  sla(@Query('brokerId') brokerId?: string, @Query('tenantId') tenantId?: string, @Req() req?: any) {
    const role = req?.user?.role;
    const bid = role === 'BROKER' ? req.user.uid : brokerId;
    return this.brokers.slaBoard({ brokerId: bid, tenantId });
  }

  @Get('capacity')
  capacity(@Query('overdueWarnAt') overdueWarnAt?: string, @Query('tenantId') tenantId?: string) {
    return this.brokers.capacityBoard({
      overdueWarnAt: overdueWarnAt ? Number(overdueWarnAt) : 3,
      tenantId,
    });
  }

  @Post('sla/remind')
  remind(@Req() req: any) {
    return this.brokers.remindOverdue(req?.user?.email || 'ops');
  }

  @Get('timeline/:matchId')
  timeline(@Param('matchId') matchId: string) {
    return this.brokers.timeline(matchId);
  }

  @Post('assign')
  assign(@Body() body: { matchId: string; brokerId: string }, @Req() req: any) {
    return this.brokers.assign(body.matchId, body.brokerId, req?.user?.email || 'ops');
  }

  @Post('unassign/:matchId')
  unassign(@Param('matchId') matchId: string, @Req() req: any) {
    return this.brokers.unassign(matchId, req?.user?.email || 'ops');
  }

  @Post('follow-up/:matchId')
  followUp(
    @Param('matchId') matchId: string,
    @Body() body: { status: string; note?: string },
    @Req() req: any,
  ) {
    return this.brokers.advance(matchId, body.status, body.note, {
      uid: req?.user?.uid,
      email: req?.user?.email,
      role: req?.user?.role,
    });
  }

  @Post('note/:matchId')
  note(@Param('matchId') matchId: string, @Body() body: { note: string }, @Req() req: any) {
    return this.brokers.addNote(matchId, body.note, {
      uid: req?.user?.uid,
      email: req?.user?.email,
      role: req?.user?.role,
    });
  }

  @Post('schedule/:matchId')
  schedule(
    @Param('matchId') matchId: string,
    @Body() body: { nextFollowUp: string },
    @Req() req: any,
  ) {
    return this.brokers.setNextFollowUp(matchId, body.nextFollowUp, {
      uid: req?.user?.uid,
      email: req?.user?.email,
      role: req?.user?.role,
    });
  }

  @Get('attachments/:matchId')
  listAtt(@Param('matchId') matchId: string) {
    return this.brokers.listAttachments(matchId);
  }

  @Post('attachments/:matchId')
  addAtt(
    @Param('matchId') matchId: string,
    @Body()
    body: {
      fileName: string;
      contentBase64?: string;
      textContent?: string;
      mimeType?: string;
      kind?: string;
      note?: string;
    },
    @Req() req: any,
  ) {
    return this.brokers.addAttachment(matchId, body || ({} as any), req?.user?.email || 'ops');
  }

  @Get('attachments/file/:id')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { row, buffer } = await this.brokers.readAttachmentFile(id);
    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    res.send(buffer);
  }
}
