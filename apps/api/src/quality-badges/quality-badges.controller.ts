import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { QualityBadgesService } from './quality-badges.service';

@Controller('trust')
export class QualityBadgesController {
  constructor(private svc: QualityBadgesService) {}

  @Get('badges')
  labels() {
    return this.svc.labels();
  }

  @Get(':kind/:id')
  get(@Param('kind') kind: string, @Param('id') id: string) {
    return this.svc.forTarget(kind, id);
  }

  @Post(':kind/:id/badges')
  set(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { badges?: string[]; qualityScore?: number },
    @Req() req: any,
  ) {
    const role = req.user?.role;
    if (!req.authMeta?.hasKey && role !== 'ADMIN' && role !== 'OPERATOR') {
      throw new ForbiddenException('仅运营可设金标');
    }
    const actor = req.user?.email || req.user?.uid || 'ops';
    return this.svc.setBadges(kind, id, body?.badges || [], actor, body?.qualityScore);
  }

  @Post(':kind/:id/badges/clear')
  clear(@Param('kind') kind: string, @Param('id') id: string, @Req() req: any) {
    const role = req.user?.role;
    if (!req.authMeta?.hasKey && role !== 'ADMIN' && role !== 'OPERATOR') {
      throw new ForbiddenException('仅运营可清除金标');
    }
    return this.svc.clearBadges(kind, id, req.user?.email || 'ops');
  }
}
