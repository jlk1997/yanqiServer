import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private plans: PlansService) {}

  @Get()
  list() {
    return this.plans.list();
  }

  @Get('flags')
  flags() {
    return this.plans.flags();
  }

  @Get('me/quota')
  meQuota(@Req() req: any) {
    const uid = req.user?.uid;
    if (!uid) return { plan: null, usage: [], message: '未登录用户，按运营密钥访问' };
    return this.plans.myQuota(uid);
  }

  /** 租户/用户用量对照看板 */
  @Get('usage')
  usage(@Req() req: any, @Query('tenantId') tenantId?: string) {
    const uid = req.user?.uid;
    const tid = tenantId || req.user?.tenantId || 'default';
    return this.plans.metering({ userId: uid, tenantId: tid });
  }

  @Post('flags')
  setFlag(@Body() body: { key: string; enabled: boolean; note?: string }, @Req() req: any) {
    if (req.user?.role && req.user.role !== 'ADMIN' && !req.authMeta?.hasKey) {
      return { ok: false, message: '仅超管可改功能开关' };
    }
    return this.plans.setFlag(body.key, body.enabled, body.note);
  }
}
