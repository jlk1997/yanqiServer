import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { PlaybooksService } from './playbooks.service';

@Controller('playbooks')
export class PlaybooksController {
  constructor(private svc: PlaybooksService) {}

  private tenantOf(req: any, qTenant?: string) {
    return qTenant || req?.user?.tenantId || req?.resolvedTenantId || 'default';
  }

  @Get()
  list(@Query('scenario') scenario?: string, @Query('all') all?: string, @Query('tenantId') tenantId?: string, @Req() req?: any) {
    return this.svc.list({ scenario, activeOnly: all !== '1', tenantId: this.tenantOf(req, tenantId) });
  }

  @Get('funnel/summary')
  funnel(@Query('days') days?: string) {
    return this.svc.funnelSummary(days ? Number(days) : 30);
  }

  /** 经纪人移动端剧本包（须在 :id 之前）· M39 按租户 + etag */
  @Get('mobile-pack')
  mobilePack(
    @Query('tenantId') tenantId?: string,
    @Query('sinceVersion') sinceVersion?: string,
    @Query('clientEtag') clientEtag?: string,
    @Query('clientDirty') clientDirty?: string,
    @Req() req?: any,
  ) {
    return this.svc.mobilePack({
      tenantId: this.tenantOf(req, tenantId),
      sinceVersion,
      clientEtag,
      clientDirty: clientDirty === '1' || clientDirty === 'true',
    });
  }

  /** M39：显式同步（冲突 / 无变更 / 更新） */
  @Post('mobile-pack/sync')
  syncPack(@Body() body: any, @Req() req?: any) {
    return this.svc.syncMobilePack({
      ...(body || {}),
      tenantId: this.tenantOf(req, body?.tenantId),
    });
  }

  @Post('funnel/mark')
  mark(@Body() body: any, @Req() req: any) {
    const actor = req.user?.email || req.user?.uid || 'ops';
    return this.svc.markOutcome({ ...(body || {}), actor });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Put()
  upsert(@Body() body: any, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可维护剧本库');
    }
    return this.svc.upsert(body || {});
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    if (req.user?.role && req.user.role !== 'ADMIN' && req.user.role !== 'OPERATOR' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可删剧本');
    }
    return this.svc.remove(id);
  }

  @Post(':id/apply')
  apply(@Param('id') id: string, @Body() body: Record<string, string>) {
    return this.svc.apply(id, body || {});
  }

  @Post(':id/apply-lead/:leadId')
  applyLead(@Param('id') id: string, @Param('leadId') leadId: string, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('机构用户不能改线索草稿');
    }
    return this.svc.applyToLead(id, leadId);
  }
}
