import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FLAG_DEFAULTS, FLAG_KEYS } from './flags.defaults';

@Injectable()
export class FlagsService implements OnModuleInit {
  private seeded = false;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults().catch((e) => {
      console.warn('[flags] ensureDefaults', e?.message || e);
    });
  }

  /** 只写库，不回调 list（避免递归） */
  async ensureDefaults() {
    if (this.seeded) return;
    for (const key of FLAG_KEYS) {
      const d = FLAG_DEFAULTS[key];
      await this.prisma.featureFlag.upsert({
        where: { key },
        update: {},
        create: {
          key,
          enabled: d.enabled,
          note: d.noteZh,
          meta: { module: d.module, source: 'm16_defaults' },
        },
      });
    }
    this.seeded = true;
  }

  async listGlobal() {
    await this.ensureDefaults();
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  /** 解析：租户 features 覆盖 > 全局 FeatureFlag > FLAG_DEFAULTS */
  async resolve(tenantId = 'default'): Promise<
    Record<string, { enabled: boolean; source: string; noteZh: string }>
  > {
    const globals = await this.listGlobal();
    const gmap = new Map(globals.map((g) => [g.key, g]));
    let tenantFeatures: Record<string, any> = {};
    try {
      const t = await this.prisma.tenant.findFirst({
        where: { OR: [{ id: tenantId }, { code: tenantId }] },
      });
      if (t?.features && typeof t.features === 'object') tenantFeatures = t.features as any;
    } catch (_) {}

    const out: Record<string, { enabled: boolean; source: string; noteZh: string }> = {};
    for (const key of FLAG_KEYS) {
      const def = FLAG_DEFAULTS[key];
      const g = gmap.get(key);
      let enabled = g ? g.enabled : def.enabled;
      let source = g ? 'global' : 'default';
      if (Object.prototype.hasOwnProperty.call(tenantFeatures, key)) {
        const v = tenantFeatures[key];
        enabled = typeof v === 'boolean' ? v : Boolean(v?.enabled);
        source = 'tenant';
      }
      out[key] = { enabled, source, noteZh: g?.note || def.noteZh };
    }
    for (const g of globals) {
      if (!out[g.key]) {
        out[g.key] = {
          enabled: g.enabled,
          source: 'global',
          noteZh: g.note || '',
        };
      }
    }
    return out;
  }

  async listResolved(tenantId = 'default') {
    const resolved = await this.resolve(tenantId);
    return {
      tenantId,
      flags: Object.entries(resolved).map(([key, v]) => ({
        key,
        enabled: v.enabled,
        source: v.source,
        note: v.noteZh,
        module: FLAG_DEFAULTS[key]?.module || 'other',
      })),
      defaults: FLAG_DEFAULTS,
      noteZh:
        '优先级：租户 features 覆盖 > 全局 FeatureFlag 表 > 代码默认。关开关会拦对应 API，运维台仍可见说明。',
    };
  }

  async isEnabled(key: string, tenantId = 'default') {
    const all = await this.resolve(tenantId);
    if (all[key]) return all[key].enabled;
    const g = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (g) return g.enabled;
    return FLAG_DEFAULTS[key]?.enabled ?? true;
  }

  async assertEnabled(key: string, tenantId = 'default', messageZh?: string) {
    const ok = await this.isEnabled(key, tenantId);
    if (!ok) {
      throw new ForbiddenException(
        messageZh || `功能「${key}」已关闭（功能开关）。请到运维台「套餐与开关」打开，或改租户 features。`,
      );
    }
  }

  async setGlobal(key: string, enabled: boolean, note?: string) {
    const d = FLAG_DEFAULTS[key];
    this.seeded = true;
    return this.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled, note: note ?? undefined },
      create: {
        key,
        enabled,
        note: note || d?.noteZh || '',
        meta: { module: d?.module || 'other' },
      },
    });
  }

  async setTenant(tenantCodeOrId: string, key: string, enabled: boolean) {
    const t = await this.prisma.tenant.findFirst({
      where: { OR: [{ id: tenantCodeOrId }, { code: tenantCodeOrId }] },
    });
    if (!t) throw new ForbiddenException('租户不存在');
    const features = { ...((t.features as any) || {}), [key]: enabled };
    return this.prisma.tenant.update({
      where: { id: t.id },
      data: { features },
    });
  }

  async clearTenantOverride(tenantCodeOrId: string, key: string) {
    const t = await this.prisma.tenant.findFirst({
      where: { OR: [{ id: tenantCodeOrId }, { code: tenantCodeOrId }] },
    });
    if (!t) throw new ForbiddenException('租户不存在');
    const features = { ...((t.features as any) || {}) };
    delete features[key];
    return this.prisma.tenant.update({ where: { id: t.id }, data: { features } });
  }
}
