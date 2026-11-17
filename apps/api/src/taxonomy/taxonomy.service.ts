import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { TAXONOMY_SEED } from './taxonomy.seed';

@Injectable()
export class TaxonomyService implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async onModuleInit() {
    try {
      await this.ensureSeed();
    } catch (e) {
      // boot 不因种子失败而挂
      console.warn('[taxonomy] seed skipped', (e as Error)?.message);
    }
  }

  async ensureSeed() {
    const n = await this.prisma.taxonomyTag.count();
    if (n >= 20) return { ok: true, seeded: false, count: n };
    for (const t of TAXONOMY_SEED) {
      await this.prisma.taxonomyTag.upsert({
        where: { code: t.code },
        create: {
          code: t.code,
          labelZh: t.labelZh,
          parentCode: t.parentCode || null,
          synonyms: t.synonyms || [],
          sortOrder: t.sortOrder,
          active: true,
        },
        update: {
          labelZh: t.labelZh,
          parentCode: t.parentCode || null,
          synonyms: t.synonyms || [],
          sortOrder: t.sortOrder,
          active: true,
        },
      });
    }
    const count = await this.prisma.taxonomyTag.count();
    return { ok: true, seeded: true, count };
  }

  async list(q: { parent?: string; q?: string; tree?: boolean } = {}) {
    await this.ensureSeed();
    const where: any = { active: true };
    if (q.parent === 'root') where.parentCode = null;
    else if (q.parent) where.parentCode = q.parent;
    let items = await this.prisma.taxonomyTag.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    if (q.q) {
      const s = q.q.toLowerCase();
      items = items.filter(
        (t) =>
          t.code.includes(s) ||
          t.labelZh.includes(q.q!) ||
          (t.synonyms || []).some((x) => String(x).toLowerCase().includes(s)),
      );
    }
    if (q.tree) {
      const all = await this.prisma.taxonomyTag.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      const roots = all.filter((t) => !t.parentCode);
      const childrenOf = (code: string) => all.filter((t) => t.parentCode === code);
      return {
        ok: true,
        count: all.length,
        tree: roots.map((r) => ({
          ...r,
          children: childrenOf(r.code),
        })),
      };
    }
    return { ok: true, count: items.length, items };
  }

  async tagCard(kind: string, id: string, codes: string[], actor = 'ops') {
    const clean = [...new Set((codes || []).map((c) => String(c).trim()).filter(Boolean))];
    if (clean.length) {
      const found = await this.prisma.taxonomyTag.findMany({ where: { code: { in: clean }, active: true } });
      const ok = new Set(found.map((f) => f.code));
      const bad = clean.filter((c) => !ok.has(c));
      if (bad.length) throw new BadRequestException('未知标签：' + bad.join(','));
    }
    const k = kind.toLowerCase();
    let row: any;
    if (k === 'capability') {
      row = await this.prisma.capability.update({ where: { id }, data: { taxonomyCodes: clean } });
    } else if (k === 'outcome') {
      row = await this.prisma.outcome.update({ where: { id }, data: { taxonomyCodes: clean } });
    } else if (k === 'demand') {
      row = await this.prisma.demand.update({ where: { id }, data: { taxonomyCodes: clean } });
    } else {
      throw new BadRequestException('kind 仅支持 capability|outcome|demand');
    }
    await this.audit.log({
      action: 'taxonomy.tag',
      actor,
      targetType: k,
      targetId: id,
      meta: { codes: clean },
    });
    return { ok: true, kind: k, id, taxonomyCodes: clean, row };
  }

  async searchByTag(code: string, take = 30) {
    const tag = await this.prisma.taxonomyTag.findUnique({ where: { code } });
    if (!tag) throw new NotFoundException('标签不存在');
    // 含子级
    const kids = await this.prisma.taxonomyTag.findMany({ where: { parentCode: code, active: true } });
    const codes = [code, ...kids.map((k) => k.code)];
    const [capabilities, outcomes, demands] = await Promise.all([
      this.prisma.capability.findMany({
        where: { taxonomyCodes: { hasSome: codes } },
        take,
        include: { org: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.outcome.findMany({
        where: { taxonomyCodes: { hasSome: codes } },
        take,
        include: { org: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.demand.findMany({
        where: { taxonomyCodes: { hasSome: codes } },
        take,
        include: { org: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return {
      ok: true,
      code,
      labelZh: tag.labelZh,
      expandedCodes: codes,
      capabilities: capabilities.map((c) => ({
        id: c.id,
        title: c.title,
        org: c.org?.name,
        taxonomyCodes: c.taxonomyCodes,
      })),
      outcomes: outcomes.map((c) => ({
        id: c.id,
        title: c.title,
        org: c.org?.name,
        taxonomyCodes: c.taxonomyCodes,
      })),
      demands: demands.map((c) => ({
        id: c.id,
        title: c.title,
        org: c.org?.name,
        taxonomyCodes: c.taxonomyCodes,
      })),
    };
  }
}
