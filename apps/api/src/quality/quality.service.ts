import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QualityService {
  constructor(private prisma: PrismaService) {}

  async scanAll() {
    const issues: Array<{
      entityType: string;
      entityId: string;
      code: string;
      severity: string;
      message: string;
      meta?: any;
    }> = [];

    const orgs = await this.prisma.organization.findMany();
    for (const o of orgs) {
      if (!o.summary || o.summary.trim().length < 8) {
        issues.push({
          entityType: 'Organization',
          entityId: o.id,
          code: 'thin_summary',
          severity: 'warn',
          message: `组织「${o.name}」简介过短或缺失，影响匹配解释。`,
        });
      }
      if (!o.region) {
        issues.push({
          entityType: 'Organization',
          entityId: o.id,
          code: 'missing_field',
          severity: 'info',
          message: `组织「${o.name}」未填地域。`,
          meta: { field: 'region' },
        });
      }
    }

    const caps = await this.prisma.capability.findMany({ include: { org: true } });
    const capTitles = new Map<string, string[]>();
    for (const c of caps) {
      const ck = c.title.trim().toLowerCase();
      if (!capTitles.has(ck)) capTitles.set(ck, []);
      capTitles.get(ck)!.push(c.id);
      if (!c.summary) {
        issues.push({
          entityType: 'Capability',
          entityId: c.id,
          code: 'missing_field',
          severity: 'warn',
          message: `能力卡「${c.title}」缺摘要。`,
          meta: { field: 'summary', org: c.org?.name },
        });
      }
      if (!(c.keywords || []).length) {
        issues.push({
          entityType: 'Capability',
          entityId: c.id,
          code: 'missing_field',
          severity: 'warn',
          message: `能力卡「${c.title}」缺关键词。`,
          meta: { field: 'keywords' },
        });
      }
    }

    for (const [title, ids] of capTitles) {
      if (ids.length > 1) {
        for (const id of ids) {
          issues.push({
            entityType: 'Capability',
            entityId: id,
            code: 'duplicate_title',
            severity: 'warn',
            message: `能力卡标题疑似重复：「${title}」（共 ${ids.length} 条）。`,
            meta: { siblings: ids },
          });
        }
      }
    }

    const outs = await this.prisma.outcome.findMany({ include: { org: true } });
    const titleMap = new Map<string, string[]>();
    for (const o of outs) {
      const key = o.title.trim().toLowerCase();
      if (!titleMap.has(key)) titleMap.set(key, []);
      titleMap.get(key)!.push(o.id);
      if (!o.abstract || o.abstract.length < 20) {
        issues.push({
          entityType: 'Outcome',
          entityId: o.id,
          code: 'thin_summary',
          severity: 'info',
          message: `成果「${o.title}」摘要过短。`,
          meta: { org: o.org?.name },
        });
      }
    }
    for (const [title, ids] of titleMap) {
      if (ids.length > 1) {
        for (const id of ids) {
          issues.push({
            entityType: 'Outcome',
            entityId: id,
            code: 'duplicate_title',
            severity: 'warn',
            message: `成果标题重复：「${title}」（共 ${ids.length} 条）。`,
            meta: { siblings: ids },
          });
        }
      }
    }

    const demands = await this.prisma.demand.findMany({ include: { org: true } });
    const demTitles = new Map<string, string[]>();
    for (const d of demands) {
      const key = d.title.trim().toLowerCase();
      if (!demTitles.has(key)) demTitles.set(key, []);
      demTitles.get(key)!.push(d.id);
      if (!d.problem || d.problem.length < 10) {
        issues.push({
          entityType: 'Demand',
          entityId: d.id,
          code: 'missing_field',
          severity: 'warn',
          message: `需求「${d.title}」问题描述过短。`,
          meta: { field: 'problem' },
        });
      }
      if (!(d.industry || []).length) {
        issues.push({
          entityType: 'Demand',
          entityId: d.id,
          code: 'missing_field',
          severity: 'warn',
          message: `需求「${d.title}」未填行业标签。`,
          meta: { field: 'industry' },
        });
      }
    }
    for (const [title, ids] of demTitles) {
      if (ids.length > 1) {
        for (const id of ids) {
          issues.push({
            entityType: 'Demand',
            entityId: id,
            code: 'duplicate_title',
            severity: 'warn',
            message: `需求标题重复：「${title}」（共 ${ids.length} 条）。`,
            meta: { siblings: ids },
          });
        }
      }
    }

    const blockedOutcomes = await this.prisma.outcome.findMany({
      where: { publishStatus: { not: 'published' } },
      take: 80,
      select: { id: true, title: true, publishBlockers: true },
    });
    for (const o of blockedOutcomes) {
      for (const code of o.publishBlockers || []) {
        issues.push({
          entityType: 'Outcome',
          entityId: o.id,
          code,
          severity: 'warn',
          message: `成果「${o.title}」未发布：${code}`,
        });
      }
    }
    const blockedDemands = await this.prisma.demand.findMany({
      where: { publishStatus: { not: 'published' } },
      take: 80,
      select: { id: true, title: true, publishBlockers: true },
    });
    for (const d of blockedDemands) {
      for (const code of d.publishBlockers || []) {
        issues.push({
          entityType: 'Demand',
          entityId: d.id,
          code,
          severity: 'warn',
          message: `需求「${d.title}」未发布：${code}`,
        });
      }
    }
    const ambiguousPeople = await this.prisma.person.findMany({
      where: { publishBlockers: { has: 'ambiguous_person' } },
      take: 40,
      select: { id: true, name: true },
    });
    for (const p of ambiguousPeople) {
      issues.push({
        entityType: 'Person',
        entityId: p.id,
        code: 'ambiguous_person',
        severity: 'warn',
        message: `老师「${p.name}」同名未合并，需要人工确认`,
      });
    }

    // 垃圾标题
    for (const o of outs) {
      const tl = (o.title || '').trim();
      if (tl.length < 4 || /^untitled$/i.test(tl) || /^test$/i.test(tl)) {
        issues.push({
          entityType: 'Outcome',
          entityId: o.id,
          code: 'junk_title',
          severity: 'warn',
          message: `成果标题像测试/垃圾数据：「${tl || '(空)'}」`,
        });
      }
    }

    // 刷新：删未解决旧记录，再写入本轮
    await this.prisma.dataQualityIssue.deleteMany({ where: { resolvedAt: null } });
    if (issues.length) {
      await this.prisma.dataQualityIssue.createMany({
        data: issues.map((i) => ({
          entityType: i.entityType,
          entityId: i.entityId,
          code: i.code,
          severity: i.severity,
          message: i.message,
          meta: i.meta || {},
        })),
      });
    }

    const byCode: Record<string, number> = {};
    for (const i of issues) byCode[i.code] = (byCode[i.code] || 0) + 1;
    const score = Math.max(0, Math.min(100, 100 - issues.filter((x) => x.severity !== 'info').length * 2 - issues.filter((x) => x.severity === 'info').length));
    return {
      ok: true,
      total: issues.length,
      byCode,
      qualityScore: score,
      sample: issues.slice(0, 30),
    };
  }

  list(opts: { unresolvedOnly?: boolean } = {}) {
    return this.prisma.dataQualityIssue.findMany({
      where: opts.unresolvedOnly ? { resolvedAt: null } : undefined,
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async resolve(id: string) {
    return this.prisma.dataQualityIssue.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  async summary() {
    const open = await this.prisma.dataQualityIssue.count({ where: { resolvedAt: null } });
    const byCode = await this.prisma.dataQualityIssue.groupBy({
      by: ['code'],
      where: { resolvedAt: null },
      _count: true,
    });
    return { open, byCode };
  }
}
