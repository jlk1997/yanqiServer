import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword, signToken, verifyToken, TokenPayload, passwordHashMeta, newJti } from './token';
import { UserRole } from '@prisma/client';
import { resolveShell } from './shell';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async ensureSeedUsers() {
    // 默认租户 + 白标
    await this.prisma.tenant.upsert({
      where: { id: 'default' },
      update: { name: '研企通默认租户', active: true, planCode: 'free' },
      create: {
        id: 'default',
        code: 'default',
        name: '研企通默认租户',
        planCode: 'free',
        active: true,
        quotas: {},
        features: { portal: true, matching: true, outreach: true, branding: true },
        note: '平台默认租户',
      },
    });
    await this.prisma.tenantBranding.upsert({
      where: { tenantId: 'default' },
      update: {
        productName: '研企通',
        primaryColor: '#3d8bfd',
        tagline: '把实验室能力、科研成果和企业要解决的问题对上号',
      },
      create: {
        tenantId: 'default',
        productName: '研企通',
        primaryColor: '#3d8bfd',
        tagline: '把实验室能力、科研成果和企业要解决的问题对上号',
        domainStatus: 'stub',
      },
    });

    const free = await this.prisma.plan.upsert({
      where: { code: 'free' },
      update: {
        quotas: { match_runs: 50, crawl_jobs: 20, reports: 30, seats: 3, cards: 40 },
        features: { matching: true, reports: true, crawl: true, outreach: true, portal: true },
      },
      create: {
        code: 'free',
        name: '免费版',
        priceMonthly: 0,
        description: '前期全站可用；有配额上限，方便以后升级。',
        quotas: { match_runs: 50, crawl_jobs: 20, reports: 30, seats: 3, cards: 40 },
        features: { matching: true, reports: true, crawl: true, outreach: true, portal: true },
      },
    });
    await this.prisma.plan.upsert({
      where: { code: 'org_pro' },
      update: {
        priceMonthly: 199900,
        quotas: { match_runs: 500, crawl_jobs: 200, reports: 300, seats: 20, cards: 500 },
        features: {
          matching: true,
          reports: true,
          crawl: true,
          outreach: true,
          portal: true,
          export_pack: true,
        },
      },
      create: {
        code: 'org_pro',
        name: '机构版',
        priceMonthly: 199900,
        description: '机构席位更多、报告与匹配配额更高（支付暂为演示桩，单位分）。',
        quotas: { match_runs: 500, crawl_jobs: 200, reports: 300, seats: 20, cards: 500 },
        features: {
          matching: true,
          reports: true,
          crawl: true,
          outreach: true,
          portal: true,
          export_pack: true,
        },
      },
    });
    await this.prisma.plan.upsert({
      where: { code: 'ops' },
      update: {
        quotas: { match_runs: 9999, crawl_jobs: 9999, reports: 9999, seats: 100, cards: 9999 },
        features: {
          matching: true,
          reports: true,
          crawl: true,
          outreach: true,
          portal: true,
          export_pack: true,
          admin: true,
        },
      },
      create: {
        code: 'ops',
        name: '运营版',
        priceMonthly: 0,
        description: '平台运营内部档，配额宽松。',
        quotas: { match_runs: 9999, crawl_jobs: 9999, reports: 9999, seats: 100, cards: 9999 },
        features: {
          matching: true,
          reports: true,
          crawl: true,
          outreach: true,
          portal: true,
          export_pack: true,
          admin: true,
        },
      },
    });

    const flags: Array<[string, boolean, string]> = [
      ['portal_public', true, '公开门户'],
      ['ai_reports', true, 'AI 分析报告'],
      ['scheduled_crawl', true, '定时采集'],
      ['billing_stub', true, '支付桩'],
      ['match_feedback', true, '匹配反馈学习'],
      ['data_quality', true, '数据质检'],
      ['integrations_stub', true, 'Chatwoot/AiToEarn 对接桩'],
      ['multi_tenant_prep', true, '多租户预留字段'],
    ];
    for (const [key, enabled, note] of flags) {
      await this.prisma.featureFlag.upsert({
        where: { key },
        update: { enabled, note },
        create: { key, enabled, note },
      });
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@yanqi.local';
    const adminPass = process.env.ADMIN_PASS || 'yanqi123';
    let admin = await this.prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await this.prisma.user.create({
        data: {
          email: adminEmail,
          name: '平台超管',
          passwordHash: hashPassword(adminPass),
          role: UserRole.ADMIN,
          planCode: 'ops',
          tenantId: 'default',
        },
      });
      await this.prisma.subscription.create({
        data: { userId: admin.id, planId: free.id, status: 'active', billing: 'free', meta: { note: 'admin' } },
      });
    }

    const opEmail = 'operator@yanqi.local';
    if (!(await this.prisma.user.findUnique({ where: { email: opEmail } }))) {
      const op = await this.prisma.user.create({
        data: {
          email: opEmail,
          name: '运营小研',
          passwordHash: hashPassword('yanqi123'),
          role: UserRole.OPERATOR,
          planCode: 'ops',
          tenantId: 'default',
        },
      });
      await this.prisma.subscription.create({
        data: { userId: op.id, planId: free.id, status: 'active', billing: 'free' },
      });
    }

    const brokerEmail = 'broker@yanqi.local';
    if (!(await this.prisma.user.findUnique({ where: { email: brokerEmail } }))) {
      const br = await this.prisma.user.create({
        data: {
          email: brokerEmail,
          name: '技术经理人小周',
          passwordHash: hashPassword('yanqi123'),
          role: UserRole.BROKER,
          planCode: 'ops',
          tenantId: 'default',
        },
      });
      await this.prisma.subscription.create({
        data: { userId: br.id, planId: free.id, status: 'active', billing: 'free' },
      });
    }

    await this.prisma.featureFlag.upsert({
      where: { key: 'broker_desk' },
      update: { enabled: true, note: '技术经理人/经纪人分派台' },
      create: { key: 'broker_desk', enabled: true, note: '技术经理人/经纪人分派台' },
    });
    await this.prisma.featureFlag.upsert({
      where: { key: 'tenant_isolation' },
      update: { enabled: true, note: '机构用户 orgId/tenant 强制隔离' },
      create: { key: 'tenant_isolation', enabled: true, note: '机构用户 orgId/tenant 强制隔离' },
    });
    await this.prisma.featureFlag.upsert({
      where: { key: 'white_label' },
      update: { enabled: true, note: '租户白标（logo/主色/域名桩）' },
      create: { key: 'white_label', enabled: true, note: '租户白标（logo/主色/域名桩）' },
    });
    await this.prisma.featureFlag.upsert({
      where: { key: 'broker_followup_fsm' },
      update: { enabled: true, note: '经纪人跟进状态机' },
      create: { key: 'broker_followup_fsm', enabled: true, note: '经纪人跟进状态机' },
    });
    await this.prisma.featureFlag.upsert({
      where: { key: 'billing_checkout_stub' },
      update: { enabled: true, note: '结账会话+webhook 支付桩' },
      create: { key: 'billing_checkout_stub', enabled: true, note: '结账会话+webhook 支付桩' },
    });

    // M27 多角色演示账号（企业 / 高校 / 园区观察）
    const ensurePersona = async (opts: {
      email: string;
      name: string;
      role: UserRole;
      orgName?: string;
      orgType?: string;
      planCode?: string;
    }) => {
      let orgId: string | undefined;
      if (opts.orgName) {
        let org = await this.prisma.organization.findFirst({ where: { name: opts.orgName } });
        if (!org) {
          org = await this.prisma.organization.create({
            data: {
              name: opts.orgName,
              type: (opts.orgType as any) || 'ENTERPRISE',
              region: '上海',
              summary: 'M27 演示组织',
              tenantId: 'default',
            },
          });
        }
        orgId = org.id;
      }
      let u = await this.prisma.user.findUnique({ where: { email: opts.email } });
      if (!u) {
        u = await this.prisma.user.create({
          data: {
            email: opts.email,
            name: opts.name,
            passwordHash: hashPassword('yanqi123'),
            role: opts.role,
            orgId,
            planCode: opts.planCode || 'org_pro',
            tenantId: 'default',
          },
        });
        await this.prisma.subscription.create({
          data: { userId: u.id, planId: free.id, status: 'active', billing: 'free' },
        });
      } else if (orgId && !u.orgId) {
        u = await this.prisma.user.update({ where: { id: u.id }, data: { orgId, role: opts.role } });
      }
      if (orgId && u) {
        await this.prisma.orgMembership.upsert({
          where: { userId_orgId: { userId: u.id, orgId } },
          update: { roleInOrg: opts.role === UserRole.TENANT_ADMIN ? 'admin' : 'member' },
          create: {
            userId: u.id,
            orgId,
            roleInOrg: opts.role === UserRole.TENANT_ADMIN ? 'admin' : 'member',
          },
        });
      }
      return u;
    };

    await ensurePersona({
      email: 'enterprise@yanqi.local',
      name: '企业对接人·陈强',
      role: UserRole.TENANT_ADMIN,
      orgName: '沪江精密装备有限公司',
      orgType: 'ENTERPRISE',
    });
    await ensurePersona({
      email: 'uni@yanqi.local',
      name: '科研秘书·王明',
      role: UserRole.TENANT_ADMIN,
      orgName: '上海理工大学',
      orgType: 'UNIVERSITY',
    });
    await ensurePersona({
      email: 'park@yanqi.local',
      name: '园区观察员',
      role: UserRole.OPS_VIEWER,
      planCode: 'ops',
    });

        // 回填租户（容错：字段尚未迁移时忽略）
    try {
      await this.prisma.organization.updateMany({ where: { tenantId: null }, data: { tenantId: 'default' } });
    } catch (_) {}
    try {
      await this.prisma.$executeRawUnsafe(`UPDATE "User" SET "tenantId" = 'default' WHERE "tenantId" IS NULL`);
    } catch (_) {}

    return { freePlanId: free.id, adminId: admin.id };
  }

  async login(emailOrUser: string, password: string, meta?: { userAgent?: string; ip?: string }) {
    const aliases: Record<string, string> = {
      admin: process.env.ADMIN_EMAIL || 'admin@yanqi.local',
      broker: 'broker@yanqi.local',
      enterprise: 'enterprise@yanqi.local',
      uni: 'uni@yanqi.local',
      university: 'uni@yanqi.local',
      research: 'uni@yanqi.local',
      park: 'park@yanqi.local',
      operator: 'operator@yanqi.local',
    };
    const key = (emailOrUser || '').trim().toLowerCase();
    const email = aliases[key] || emailOrUser;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      const legacyUser = process.env.ADMIN_USER || 'admin';
      const legacyPass = process.env.ADMIN_PASS || 'yanqi123';
      if (emailOrUser === legacyUser && password === legacyPass) {
        await this.ensureSeedUsers();
        const again = await this.prisma.user.findUnique({
          where: { email: process.env.ADMIN_EMAIL || 'admin@yanqi.local' },
        });
        if (again) return this.issue(again, meta);
      }
      throw new UnauthorizedException('账号或密码错误');
    }
    return this.issue(user, meta);
  }

  async register(body: {
    email: string;
    password: string;
    name: string;
    orgName?: string;
    orgType?: string;
  }, meta?: { userAgent?: string; ip?: string }) {
    const exists = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new ForbiddenException('该邮箱已注册');
    await this.ensureSeedUsers();
    const free = await this.prisma.plan.findUnique({ where: { code: 'free' } });
    let orgId: string | undefined;
    if (body.orgName) {
      const org = await this.prisma.organization.create({
        data: {
          name: body.orgName,
          type: (body.orgType as any) || 'ENTERPRISE',
          summary: 'registered via portal',
          tenantId: 'default',
        },
      });
      orgId = org.id;
    }
    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        name: body.name || body.email.split('@')[0],
        passwordHash: hashPassword(body.password),
        role: UserRole.ORG_USER,
        orgId,
        planCode: 'free',
        tenantId: 'default',
      },
    });
    if (orgId) {
      await this.prisma.orgMembership.create({
        data: { userId: user.id, orgId, roleInOrg: 'owner' },
      });
    }
    if (free) {
      await this.prisma.subscription.create({
        data: { userId: user.id, planId: free.id, status: 'active', billing: 'free' },
      });
    }
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        title: '欢迎加入研企通',
        body: '你现在是免费版机构用户。可以完善组织档案、发布需求或成果，并查看匹配推荐。',
        level: 'success',
        link: '/portal.html#workspace',
      },
    });
    return this.issue(user, meta);
  }

  async issue(
    user: {
      id: string;
      role: string;
      email: string;
      orgId?: string | null;
      tenantId?: string | null;
      name?: string;
      planCode?: string;
      passwordHash?: string;
    },
    meta?: { userAgent?: string; ip?: string },
  ) {
    const tenantId = user.tenantId || 'default';
    const signed = signToken({
      uid: user.id,
      role: user.role,
      email: user.email,
      orgId: user.orgId,
      tenantId,
      jti: newJti(),
    });
    await this.prisma.authSession.create({
      data: {
        jti: signed.jti,
        userId: user.id,
        userAgent: meta?.userAgent?.slice(0, 240) || null,
        ip: meta?.ip || null,
        expiresAt: new Date(signed.exp * 1000),
      },
    });
    const isOpsUser = user.role === 'ADMIN' || user.role === 'OPERATOR';
    let orgType: string | null = null;
    if (user.orgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { type: true },
      });
      orgType = org?.type || null;
    }
    const shell = resolveShell({ role: user.role, orgId: user.orgId, orgType });
    return {
      ok: true,
      token: signed.token,
      jti: signed.jti,
      apiKey: isOpsUser ? process.env.ADMIN_API_KEY || undefined : undefined,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgType,
        tenantId,
        planCode: user.planCode || 'free',
        ...shell,
      },
      shell: shell.shell,
      homePath: shell.homePath,
      persona: shell.persona,
      personaLabel: shell.personaLabel,
      passwordHashing: user.passwordHash ? passwordHashMeta(user.passwordHash) : undefined,
      message: '登录成功',
    };
  }

  parseAuthHeader(req: { headers: Record<string, any> }): TokenPayload | null {
    const h = req.headers['authorization'] || '';
    if (typeof h === 'string' && h.startsWith('Bearer ')) {
      return verifyToken(h.slice(7));
    }
    const cookie = req.headers.cookie || '';
    const m = /yanqi_token=([^;]+)/.exec(cookie);
    if (m) return verifyToken(decodeURIComponent(m[1]));
    return null;
  }

  async assertSessionActive(payload: TokenPayload | null) {
    if (!payload) return null;
    if (!payload.jti) return payload; // 旧 token 无 jti：仍可用，但建议重新登录
    const row = await this.prisma.authSession.findUnique({ where: { jti: payload.jti } });
    if (!row) return payload; // 库未建会话时兼容
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    await this.prisma.authSession.update({
      where: { jti: payload.jti },
      data: { lastSeenAt: new Date() },
    }).catch(() => null);
    return payload;
  }

  listSessions(userId: string) {
    return this.prisma.authSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        jti: true,
        userAgent: true,
        ip: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
  }

  async revokeSession(userId: string, jti: string, actor?: string) {
    const row = await this.prisma.authSession.findUnique({ where: { jti } });
    if (!row || row.userId !== userId) return { ok: false, message: '会话不存在或不属于你' };
    await this.prisma.authSession.update({
      where: { jti },
      data: { revokedAt: new Date() },
    });
    return { ok: true, jti, message: '该会话已吊销，对应令牌立即失效' };
  }

  async revokeAllSessions(userId: string, exceptJti?: string) {
    const r = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptJti ? { NOT: { jti: exceptJti } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return { ok: true, count: r.count, message: `已吊销 ${r.count} 个会话` };
  }

  async logout(payload: TokenPayload | null) {
    if (payload?.jti) {
      await this.prisma.authSession.updateMany({
        where: { jti: payload.jti },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true, message: '已退出并吊销当前会话' };
  }
}
