import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { randomBytes } from 'crypto';
import { hashPassword } from '../auth/token';
import { can } from '../auth/permissions';
import { FlagsService } from '../flags/flags.service';
import { QuotaService } from '../plans/quota.service';

@Injectable()
export class TeamInviteService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private flags: FlagsService,
    private quota: QuotaService,
  ) {}

  private token() {
    return randomBytes(24).toString('hex');
  }

  async create(
    actor: { uid: string; role: string; email: string; orgId?: string | null; tenantId?: string | null },
    body: { email: string; name?: string; role?: string; note?: string; orgId?: string },
  ) {
    if (!can(actor.role, 'org.invite') && actor.role !== 'ADMIN' && actor.role !== 'OPERATOR') {
      throw new ForbiddenException('无权发起协作邀请');
    }
    await this.flags.assertEnabled('team_invite', actor.tenantId || 'default', '协作邀请已关闭（team_invite）。');

    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new BadRequestException('请填写有效邮箱');
    const orgId = body.orgId || actor.orgId;
    if (!orgId) throw new BadRequestException('请先绑定组织');
    if (actor.role === 'TENANT_ADMIN' || actor.role === 'ORG_USER') {
      if (actor.orgId !== orgId) throw new ForbiddenException('只能邀请加入本组织');
    }
    const role = body.role === 'TENANT_ADMIN' ? 'TENANT_ADMIN' : 'ORG_USER';
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const row = await this.prisma.teamInvite.create({
      data: {
        token: this.token(),
        email,
        name: body.name || null,
        role: role as any,
        orgId,
        tenantId: actor.tenantId || 'default',
        invitedById: actor.uid,
        note: body.note || null,
        expiresAt,
        status: 'pending',
      },
    });
    await this.audit.log({
      action: 'team.invite.create',
      actor: actor.email,
      targetType: 'TeamInvite',
      targetId: row.id,
      meta: { email, role, orgId },
    });
    try {
      await this.quota.incr(`tenant:${actor.tenantId || 'default'}`, 'invites', 1);
    } catch (_) {}
    const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 3100}`;
    const acceptUrl = `${base}/invite.html?team=${row.token}`;
    return {
      ok: true,
      invite: { id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt, status: row.status },
      acceptUrl,
      copyText: `请打开链接加入协作（7 天内有效）：\n${acceptUrl}\n接受后角色：${role === 'TENANT_ADMIN' ? '机构管理员' : '机构成员'}`,
      mailStubZh: '邮件真发仍受 SMTP 出网限制；可先复制链接发给同事。',
      message: '邀请已创建，复制链接发给对方即可',
    };
  }

  listForOrg(orgId: string) {
    return this.prisma.teamInvite.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async peek(token: string) {
    const row = await this.prisma.teamInvite.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('邀请不存在或已失效');
    const org = await this.prisma.organization.findUnique({ where: { id: row.orgId } });
    return {
      ok: true,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      expiresAt: row.expiresAt,
      expired: row.expiresAt.getTime() < Date.now() || row.status !== 'pending',
      orgName: org?.name,
      productHint: '接受后即可进门户看「我的对接」',
    };
  }

  async accept(
    token: string,
    body: { password: string; name?: string },
  ) {
    const row = await this.prisma.teamInvite.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('邀请不存在');
    if (row.status !== 'pending') throw new BadRequestException('邀请已使用或已撤销');
    if (row.expiresAt.getTime() < Date.now()) {
      await this.prisma.teamInvite.update({ where: { id: row.id }, data: { status: 'expired' } });
      throw new BadRequestException('邀请已过期，请让管理员重发');
    }
    const password = body.password || '';
    if (password.length < 6) throw new BadRequestException('密码至少 6 位');
    const existing = await this.prisma.user.findUnique({ where: { email: row.email } });
    let user = existing;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: row.email,
          name: body.name || row.name || row.email.split('@')[0],
          passwordHash: hashPassword(password),
          role: row.role as any,
          orgId: row.orgId,
          tenantId: row.tenantId,
          active: true,
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          orgId: row.orgId,
          role: row.role as any,
          tenantId: row.tenantId,
          passwordHash: hashPassword(password),
          name: body.name || user.name,
          active: true,
        },
      });
    }
    await this.prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: row.orgId } },
      update: { roleInOrg: row.role === 'TENANT_ADMIN' ? 'admin' : 'member' },
      create: {
        userId: user.id,
        orgId: row.orgId,
        roleInOrg: row.role === 'TENANT_ADMIN' ? 'admin' : 'member',
      },
    });
    await this.prisma.teamInvite.update({
      where: { id: row.id },
      data: { status: 'accepted', acceptedAt: new Date(), acceptedUserId: user.id },
    });
    await this.audit.log({
      action: 'team.invite.accept',
      actor: row.email,
      targetType: 'TeamInvite',
      targetId: row.id,
      meta: { userId: user.id, role: row.role, orgId: row.orgId },
    });
    return {
      ok: true,
      message: '已加入团队，请用该邮箱登录门户',
      user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
    };
  }

  async revoke(actorEmail: string, id: string, orgId?: string) {
    const row = await this.prisma.teamInvite.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('邀请不存在');
    if (orgId && row.orgId !== orgId) throw new ForbiddenException('无权撤销');
    await this.prisma.teamInvite.update({ where: { id }, data: { status: 'revoked' } });
    await this.audit.log({
      action: 'team.invite.revoke',
      actor: actorEmail,
      targetType: 'TeamInvite',
      targetId: id,
      meta: { email: row.email },
    });
    return { ok: true, message: '已撤销邀请' };
  }
}
