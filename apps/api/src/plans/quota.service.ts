import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const METRIC_LABELS: Record<string, string> = {
  cards: '卡片（能力/成果/需求）',
  matches: '匹配运行/条数',
  match_runs: '匹配运行次数',
  invites: '协作邀请',
  exports: '数据导出',
  reports: '分析报告',
  mail_dry: '邮件干跑',
  mail_live: '邮件真发',
  seats: '席位',
  crawl_jobs: '采集任务',
};

@Injectable()
export class QuotaService {
  constructor(private prisma: PrismaService) {}

  period() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  metricLabel(metric: string) {
    return METRIC_LABELS[metric] || metric;
  }

  async planForUser(userId?: string | null) {
    if (!userId) {
      return this.prisma.plan.findUnique({ where: { code: 'ops' } });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (tenant?.planCode) {
        const tPlan = await this.prisma.plan.findUnique({ where: { code: tenant.planCode } });
        if (tPlan) {
          const override = (tenant.quotas as any) || {};
          return {
            ...tPlan,
            quotas: { ...(tPlan.quotas as any), ...override },
          } as any;
        }
      }
    }
    const code = user?.planCode || 'free';
    return this.prisma.plan.findUnique({ where: { code } });
  }

  async planForTenant(tenantIdOrCode = 'default') {
    const tenant = await this.prisma.tenant.findFirst({
      where: { OR: [{ id: tenantIdOrCode }, { code: tenantIdOrCode }] },
    });
    const code = tenant?.planCode || 'free';
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) return null;
    const override = (tenant?.quotas as any) || {};
    return { ...plan, quotas: { ...(plan.quotas as any), ...override }, tenant } as any;
  }

  async checkAndIncr(subject: string, metric: string, limit: number, by = 1) {
    const period = this.period();
    const row = await this.prisma.quotaUsage.upsert({
      where: { subject_period_metric: { subject, period, metric } },
      update: {},
      create: { subject, period, metric, used: 0 },
    });
    if (row.used + by > limit) {
      throw new ForbiddenException(
        `本月「${this.metricLabel(metric)}」快到顶了：已用 ${row.used}/${limit}。升到机构版可加配额（支付目前还是演示桩，不会真扣款）。`,
      );
    }
    return this.prisma.quotaUsage.update({
      where: { id: row.id },
      data: { used: { increment: by } },
    });
  }

  /** 只记账不限额（邮件干跑/真发统计） */
  async incr(subject: string, metric: string, by = 1) {
    const period = this.period();
    return this.prisma.quotaUsage.upsert({
      where: { subject_period_metric: { subject, period, metric } },
      update: { used: { increment: by } },
      create: { subject, period, metric, used: by },
    });
  }

  async usage(subject: string) {
    const period = this.period();
    return this.prisma.quotaUsage.findMany({ where: { subject, period } });
  }

  tenantSubject(tenantId: string) {
    return `tenant:${tenantId}`;
  }

  nearLimit(used: number, limit: number) {
    if (!limit || limit <= 0) return { level: 'ok' as const, pct: 0 };
    const pct = Math.round((used / limit) * 100);
    if (used >= limit) return { level: 'exhausted' as const, pct: 100 };
    if (pct >= 90) return { level: 'critical' as const, pct };
    if (pct >= 70) return { level: 'warn' as const, pct };
    return { level: 'ok' as const, pct };
  }

  /**
   * 用量快照：配额计数 + 库内库存（卡片/匹配等）对照，给门户/运维看板。
   */
  async meteringSnapshot(opts: { userId?: string; tenantId?: string } = {}) {
    const period = this.period();
    const tenantId = opts.tenantId || 'default';
    const plan = opts.userId
      ? await this.planForUser(opts.userId)
      : await this.planForTenant(tenantId);
    const quotas = (plan?.quotas as any) || {};

    const tenant =
      (await this.prisma.tenant.findFirst({
        where: { OR: [{ id: tenantId }, { code: tenantId }] },
      })) || null;
    const tid = tenant?.id || tenantId;

    const subjects = [
      this.tenantSubject(tid),
      this.tenantSubject('default'),
      ...(opts.userId ? [`user:${opts.userId}`] : []),
    ];
    const usageRows = await this.prisma.quotaUsage.findMany({
      where: { period, subject: { in: subjects } },
    });
    const usedMap: Record<string, number> = {};
    for (const r of usageRows) {
      usedMap[r.metric] = (usedMap[r.metric] || 0) + r.used;
    }

    // 库存侧（租户范围尽量按 organization.tenantId）
    const [caps, outs, demands, matches, exports, mailDryAudit, mailLiveAudit] =
      await Promise.all([
        this.prisma.capability.count(),
        this.prisma.outcome.count(),
        this.prisma.demand.count(),
        this.prisma.matchResult.count({
          where: tid && tid !== 'default' ? { tenantId: tid } : undefined,
        }),
        this.prisma.tenantExportJob.count({
          where: { tenantId: tid },
        }).catch(() => 0),
        this.prisma.auditLog.count({
          where: {
            action: { in: ['lead.send.dry_run'] },
            createdAt: { gte: new Date(`${period}-01T00:00:00`) },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            action: { in: ['lead.send.smtp'] },
            createdAt: { gte: new Date(`${period}-01T00:00:00`) },
          },
        }),
      ]);

    let inviteCount = usedMap.invites || 0;
    try {
      inviteCount = await this.prisma.teamInvite.count();
    } catch {
      /* keep usedMap */
    }

    const cardStock = caps + outs + demands;
    const metricsSpec: { key: string; used: number; limit: number; stock?: number }[] = [
      {
        key: 'cards',
        used: usedMap.cards || 0,
        limit: Number(quotas.cards ?? quotas.seats ?? 50),
        stock: cardStock,
      },
      {
        key: 'matches',
        used: usedMap.matches || usedMap.match_runs || 0,
        limit: Number(quotas.matches ?? quotas.match_runs ?? 200),
        stock: matches,
      },
      {
        key: 'invites',
        used: usedMap.invites || inviteCount,
        limit: Number(quotas.invites ?? 50),
        stock: inviteCount,
      },
      {
        key: 'exports',
        used: usedMap.exports || exports,
        limit: Number(quotas.exports ?? 10),
        stock: exports,
      },
      {
        key: 'reports',
        used: usedMap.reports || 0,
        limit: Number(quotas.reports ?? 30),
      },
      {
        key: 'mail_dry',
        used: usedMap.mail_dry || mailDryAudit,
        limit: Number(quotas.mail_dry ?? 500),
      },
      {
        key: 'mail_live',
        used: usedMap.mail_live || mailLiveAudit,
        limit: Number(quotas.mail_live ?? 50),
      },
    ];

    const items = metricsSpec.map((m) => {
      const near = this.nearLimit(m.used, m.limit);
      let hintZh = '';
      if (near.level === 'exhausted') {
        hintZh = `「${this.metricLabel(m.key)}」本月额度用完了（${m.used}/${m.limit}）。先别继续堆，升级套餐或下月再来（支付仍是演示）。`;
      } else if (near.level === 'critical') {
        hintZh = `「${this.metricLabel(m.key)}」快到顶了，已经用了 ${near.pct}%（${m.used}/${m.limit}）。`;
      } else if (near.level === 'warn') {
        hintZh = `「${this.metricLabel(m.key)}」用了七成以上（${m.used}/${m.limit}），留意一下。`;
      }
      return {
        metric: m.key,
        labelZh: this.metricLabel(m.key),
        used: m.used,
        limit: m.limit,
        stock: m.stock ?? null,
        pct: near.pct,
        level: near.level,
        hintZh,
      };
    });

    const warnings = items.filter((i) => i.level !== 'ok');
    return {
      ok: true,
      period,
      planCode: plan?.code || 'free',
      planName: plan?.name || '免费档',
      tenantId: tid,
      items,
      warnings,
      summaryZh: warnings.length
        ? `本月有 ${warnings.length} 项接近或达到配额上限，请看下方提示。`
        : '本月用量都还宽裕。',
      noteZh:
        'used 来自配额计数器（及邮件审计）；stock 是库里现存条数，方便对照。支付升级仍是桩，不会真扣款。',
    };
  }
}
