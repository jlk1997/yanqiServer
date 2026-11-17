import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private svc: ReviewsService) {}

  private assertOps(req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可操作专家复核队列');
    }
  }

  @Get()
  list(@Query('status') status?: string, @Query('take') take?: string) {
    return this.svc.list({ status, take: take ? Number(take) : 80 });
  }

  @Post('submit')
  submit(@Body() body: any, @Req() req: any) {
    this.assertOps(req);
    const actor = req.user?.email || 'ops';
    return this.svc.submit({ ...(body || {}), submitter: body?.submitter || actor });
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertOps(req);
    const actor = req.user?.email || 'ops';
    return this.svc.assign(id, body?.reviewerEmail, actor, body?.note);
  }

  @Post(':id/decide')
  decide(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertOps(req);
    const actor = req.user?.email || 'ops';
    return this.svc.decide(id, body?.decision, actor, body?.decisionNote);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertOps(req);
    const actor = req.user?.email || 'ops';
    return this.svc.withdraw(id, actor, body?.note);
  }
}
