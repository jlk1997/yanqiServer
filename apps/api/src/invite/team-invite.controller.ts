import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { TeamInviteService } from './team-invite.service';

@Controller()
export class TeamInviteController {
  constructor(private team: TeamInviteService) {}

  @Post('team/invites')
  create(@Req() req: any, @Body() body: any) {
    const u = req.user;
    if (!u?.uid) return { ok: false, message: '请先登录' };
    return this.team.create(
      { uid: u.uid, role: u.role, email: u.email, orgId: u.orgId, tenantId: u.tenantId },
      body || {},
    );
  }

  @Get('team/invites')
  async list(@Req() req: any, @Query('orgId') orgId?: string) {
    const u = req.user;
    if (!u?.uid) return { ok: false, message: '请先登录' };
    const oid = orgId || u.orgId;
    if (!oid) return { ok: false, message: '请先绑定组织' };
    if ((u.role === 'TENANT_ADMIN' || u.role === 'ORG_USER') && oid !== u.orgId) {
      return { ok: false, message: '只能看本组织邀请' };
    }
    const items = await this.team.listForOrg(oid);
    return { ok: true, items };
  }

  @Post('team/invites/:id/revoke')
  revoke(@Req() req: any, @Param('id') id: string) {
    const u = req.user;
    if (!u?.uid) return { ok: false, message: '请先登录' };
    return this.team.revoke(u.email, id, u.role === 'ADMIN' || u.role === 'OPERATOR' ? undefined : u.orgId);
  }

  @Get('public/team-invite/:token')
  peek(@Param('token') token: string) {
    return this.team.peek(token);
  }

  @Post('public/team-invite/:token/accept')
  accept(@Param('token') token: string, @Body() body: { password?: string; name?: string }) {
    return this.team.accept(token, { password: body?.password || '', name: body?.name });
  }
}
