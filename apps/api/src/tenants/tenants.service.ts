import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

export const DEFAULT_TENANT_ID = 'default';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async ensureDefaultTenant() {
    const tenant = await this.prisma.tenant.upsert({
      where: { id: DEFAULT_TENANT_ID },
      update: {
        name: '研企通默认租户',
        active: true,
        planCode: 'free',
      },
      create: {
        id: DEFAULT_TENANT_ID,
        code: 'default',
        name: '研企通默认租户',
        planCode: 'free',
        active: true,
        quotas: {},
        features: { portal: true, matching: true, outreach: true },
        note: '平台默认租户；演示与内部运营数据都落在这里',
      },
    });
    await this.prisma.tenantBranding.upsert({
      where: { tenantId: DEFAULT_TENANT_ID },
      update: {
        productName: '研企通',
        primaryColor: '#3d8bfd',
        tagline: '把实验室能力、科研成果和企业要解决的问题对上号',
      },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        productName: '研企通',
        primaryColor: '#3d8bfd',
        tagline: '把实验室能力、科研成果和企业要解决的问题对上号',
        customDomain: null,
        domainStatus: 'stub',
      },
    });

    // 回填旧数据的 tenantId
    await this.prisma.$executeRawUnsafe(
      `UPDATE "Organization" SET "tenantId" = 'default' WHERE "tenantId" IS NULL OR "tenantId" = ''`,
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE "User" SET "tenantId" = 'default' WHERE "tenantId" IS NULL OR "tenantId" = ''`,
    );
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "JobLog" SET "tenantId" = 'default' WHERE "tenantId" IS NULL OR "tenantId" = ''`,
      );
    } catch (_) {}
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "MatchResult" SET "tenantId" = 'default' WHERE "tenantId" IS NULL OR "tenantId" = ''`,
      );
    } catch (_) {}
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "CrawlSchedule" SET "tenantId" = 'default' WHERE "tenantId" IS NULL OR "tenantId" = ''`,
      );
    } catch (_) {}

    return tenant;
  }

  list() {
    return this.prisma.tenant.findMany({
      include: { branding: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(idOrCode: string) {
    const row =
      (await this.prisma.tenant.findUnique({
        where: { id: idOrCode },
        include: { branding: true },
      })) ||
      (await this.prisma.tenant.findUnique({
        where: { code: idOrCode },
        include: { branding: true },
      }));
    if (!row) throw new NotFoundException('租户不存在');
    return row;
  }

  async branding(tenantId = DEFAULT_TENANT_ID) {
    await this.ensureDefaultTenant();
    const b = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!b) {
      return {
        tenantId,
        productName: '研企通',
        primaryColor: '#3d8bfd',
        tagline: '把实验室能力、科研成果和企业要解决的问题对上号',
        logoUrl: null,
        customDomain: null,
        domainStatus: 'stub',
      };
    }
    return b;
  }

  async updateBranding(
    tenantId: string,
    body: {
      logoUrl?: string | null;
      primaryColor?: string;
      productName?: string;
      tagline?: string | null;
      customDomain?: string | null;
      faviconUrl?: string | null;
    },
    actor = 'ops',
  ) {
    await this.get(tenantId);
    const row = await this.prisma.tenantBranding.upsert({
      where: { tenantId },
      update: {
        logoUrl: body.logoUrl === undefined ? undefined : body.logoUrl,
        primaryColor: body.primaryColor,
        productName: body.productName,
        tagline: body.tagline === undefined ? undefined : body.tagline,
        customDomain: body.customDomain === undefined ? undefined : body.customDomain,
        faviconUrl: body.faviconUrl === undefined ? undefined : body.faviconUrl,
        domainStatus: body.customDomain ? 'stub' : undefined,
      },
      create: {
        tenantId,
        logoUrl: body.logoUrl || null,
        primaryColor: body.primaryColor || '#3d8bfd',
        productName: body.productName || '研企通',
        tagline: body.tagline || null,
        customDomain: body.customDomain || null,
        faviconUrl: body.faviconUrl || null,
        domainStatus: 'stub',
      },
    });
    await this.audit.log({
      action: 'tenant.branding.update',
      actor,
      targetType: 'TenantBranding',
      targetId: row.id,
      meta: { tenantId, productName: row.productName },
    });
    return row;
  }

  async updateTenant(
    id: string,
    body: { name?: string; planCode?: string; active?: boolean; quotas?: any; features?: any; note?: string },
    actor = 'ops',
  ) {
    const plan = body.planCode
      ? await this.prisma.plan.findUnique({ where: { code: body.planCode } })
      : null;
    if (body.planCode && !plan) throw new BadRequestException('套餐不存在');
    const row = await this.prisma.tenant.update({
      where: { id },
      data: {
        name: body.name,
        planCode: body.planCode,
        active: body.active,
        quotas: body.quotas,
        features: body.features,
        note: body.note,
      },
      include: { branding: true },
    });
    await this.audit.log({
      action: 'tenant.update',
      actor,
      targetType: 'Tenant',
      targetId: id,
      meta: { planCode: row.planCode, active: row.active },
    });
    return row;
  }

  async createTenant(
    body: { code: string; name: string; planCode?: string },
    actor = 'ops',
  ) {
    const code = (body.code || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(code)) {
      throw new BadRequestException('租户 code 需 2-32 位小写字母数字_-');
    }
    const exists = await this.prisma.tenant.findUnique({ where: { code } });
    if (exists) throw new BadRequestException('租户 code 已存在');
    const planCode = body.planCode || 'free';
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new BadRequestException('套餐不存在');
    const row = await this.prisma.tenant.create({
      data: {
        code,
        name: body.name,
        planCode,
        branding: {
          create: {
            productName: body.name,
            primaryColor: '#3d8bfd',
            tagline: '科研成果与企业需求对接',
            domainStatus: 'stub',
          },
        },
      },
      include: { branding: true },
    });
    await this.audit.log({
      action: 'tenant.create',
      actor,
      targetType: 'Tenant',
      targetId: row.id,
      meta: { code },
    });
    return row;
  }

  /** 租户有效配额：租户覆盖 ∪ 套餐 */
  async effectiveQuotas(tenantId: string) {
    const t = await this.get(tenantId);
    const plan = await this.prisma.plan.findUnique({ where: { code: t.planCode || 'free' } });
    const base = (plan?.quotas as any) || {};
    const override = (t.quotas as any) || {};
    return { ...base, ...override, planCode: t.planCode, tenantId: t.id };
  }
}
