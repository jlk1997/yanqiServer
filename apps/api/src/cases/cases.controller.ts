import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { CasesService } from './cases.service';

@Controller('cases')
export class CasesController {
  constructor(private svc: CasesService) {}

  /** 运营 / 园区观察员可审案例；机构用户不可 */
  private assertModerator(req: any) {
    const role = req?.user?.role;
    const hasKey = req?.authMeta?.hasKey;
    if (hasKey || role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER') return;
    if (role === 'ORG_USER' || role === 'BROKER' || role === 'TENANT_ADMIN') {
      throw new ForbiddenException('仅运营或园区审核台可审批案例');
    }
    // 无角色但带 ops cookie / key 的情况由中间件处理；此处兜底
    if (!role && !hasKey) throw new ForbiddenException('仅运营或园区审核台可审批案例');
  }

  /** 门户公开：已发布 */
  @Get('public')
  pub(
    @Query('taxonomy') taxonomy?: string,
    @Query('outcome') outcome?: string,
    @Query('take') take?: string,
  ) {
    return this.svc.listPublished({
      taxonomy,
      outcome,
      take: take ? Number(take) : 40,
    });
  }

  @Get('public/:id')
  pubOne(@Param('id') id: string) {
    return this.svc.getPublished(id);
  }

  /** 审核台队列（含中文状态） */
  @Get()
  list(@Query('status') status?: string, @Req() req?: any) {
    this.assertModerator(req);
    return this.svc.listOps(status);
  }

  @Post('from-match/:matchId')
  fromMatch(@Param('matchId') matchId: string, @Body() body: any, @Req() req: any) {
    this.assertModerator(req);
    // 园区可生成草稿，但仍进 pending
    const role = req.user?.role;
    if (role === 'OPS_VIEWER' && !req.authMeta?.hasKey) {
      // 允许
    }
    return this.svc.draftFromMatch(matchId, req.user?.email || 'ops', body || {});
  }

  @Put()
  upsert(@Body() body: any, @Req() req: any) {
    const role = req.user?.role;
    if (role === 'OPS_VIEWER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('园区观察员请用审核动作，勿直接改稿');
    }
    this.assertModerator(req);
    return this.svc.upsertManual(body || {}, req.user?.email || 'ops');
  }

  @Post('batch')
  batch(@Body() body: { ids?: string[]; action?: string; note?: string }, @Req() req: any) {
    this.assertModerator(req);
    const action = (body?.action || '').toLowerCase();
    if (!['publish', 'reject', 'unpublish', 'requeue'].includes(action)) {
      throw new BadRequestException('action 须为 publish|reject|unpublish|requeue');
    }
    return this.svc.batchDecide(
      body?.ids || [],
      action as any,
      req.user?.email || 'ops',
      body?.note,
    );
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Req() req: any) {
    this.assertModerator(req);
    return this.svc.decide(id, 'published', req.user?.email || 'ops');
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertModerator(req);
    return this.svc.decide(id, 'rejected', req.user?.email || 'ops', body?.note);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertModerator(req);
    return this.svc.decide(id, 'unpublished', req.user?.email || 'ops', body?.note);
  }

  @Post(':id/requeue')
  requeue(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertModerator(req);
    return this.svc.decide(id, 'pending', req.user?.email || 'ops', body?.note);
  }
}
