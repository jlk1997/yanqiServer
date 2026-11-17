import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { QualityBadgesService } from '../quality-badges/quality-badges.service';

const STATUSES = ['submitted', 'assigned', 'approved', 'rejected', 'withdrawn'] as const;

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private badges: QualityBadgesService,
  ) {}

  async list(q: { status?: string; take?: number } = {}) {
    const where: any = {};
    if (q.status) where.status = q.status;
    const items = await this.prisma.expertReview.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(q.take || 80, 200),
    });
    const counts = await this.prisma.expertReview.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c._count._all;
    return {
      ok: true,
      counts: byStatus,
      strip: STATUSES.map((s) => ({
        status: s,
        labelZh:
          ({
            submitted: '待分派',
            assigned: '复核中',
            approved: '已通过',
            rejected: '未通过',
            withdrawn: '已撤回',
          } as any)[s] || s,
        count: byStatus[s] || 0,
      })),
      items,
    };
  }

  async submit(body: {
    targetType: string;
    targetId: string;
    submitter?: string;
    note?: string;
  }) {
    const tt = String(body.targetType || '').toLowerCase();
    if (tt !== 'capability' && tt !== 'outcome') {
      throw new BadRequestException('targetType 仅支持 capability|outcome');
    }
    const id = body.targetId;
    let title = '';
    let orgName: string | undefined;
    if (tt === 'capability') {
      const row = await this.prisma.capability.findUnique({ where: { id }, include: { org: true } });
      if (!row) throw new NotFoundException('能力卡不存在');
      title = row.title;
      orgName = row.org?.name;
    } else {
      const row = await this.prisma.outcome.findUnique({ where: { id }, include: { org: true } });
      if (!row) throw new NotFoundException('成果卡不存在');
      title = row.title;
      orgName = row.org?.name;
    }
    const open = await this.prisma.expertReview.findFirst({
      where: {
        targetType: tt,
        targetId: id,
        status: { in: ['submitted', 'assigned'] },
      },
    });
    if (open) {
      return { ok: true, reused: true, item: open, noteZh: '已有进行中的复核单，未重复提交' };
    }
    const item = await this.prisma.expertReview.create({
      data: {
        targetType: tt,
        targetId: id,
        titleSnapshot: title,
        orgName: orgName || null,
        status: 'submitted',
        submitter: body.submitter || 'ops',
        meta: { note: body.note || null },
      },
    });
    await this.audit.log({
      action: 'expert_review.submit',
      actor: body.submitter || 'ops',
      targetType: tt,
      targetId: id,
      meta: { reviewId: item.id },
    });
    return { ok: true, item };
  }

  async assign(id: string, reviewerEmail: string, actor = 'ops', note?: string) {
    const row = await this.prisma.expertReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('复核单不存在');
    if (!['submitted', 'assigned'].includes(row.status)) {
      throw new BadRequestException('当前状态不可分派');
    }
    const email = String(reviewerEmail || '').trim();
    if (!email) throw new BadRequestException('请填写复核人邮箱');
    const item = await this.prisma.expertReview.update({
      where: { id },
      data: {
        status: 'assigned',
        reviewerEmail: email,
        reviewerNote: note || row.reviewerNote,
        assignedAt: new Date(),
      },
    });
    await this.audit.log({
      action: 'expert_review.assign',
      actor,
      targetType: 'ExpertReview',
      targetId: id,
      meta: { reviewerEmail: email },
    });
    return { ok: true, item };
  }

  async decide(
    id: string,
    decision: 'approved' | 'rejected',
    actor = 'ops',
    decisionNote?: string,
  ) {
    const row = await this.prisma.expertReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('复核单不存在');
    if (!['submitted', 'assigned'].includes(row.status)) {
      throw new BadRequestException('当前状态不可裁决');
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new BadRequestException('decision 仅支持 approved|rejected');
    }
    const item = await this.prisma.expertReview.update({
      where: { id },
      data: {
        status: decision,
        decisionNote: decisionNote || (decision === 'approved' ? '通过同行复核' : '未通过'),
        decidedAt: new Date(),
        reviewerEmail: row.reviewerEmail || actor,
      },
    });
    if (decision === 'approved') {
      // 挂上 peer_reviewed，保留既有金标
      const kind = row.targetType;
      const target = await this.badges.forTarget(kind, row.targetId);
      const next = [...new Set([...(target.trustBadges || []), 'peer_reviewed'])];
      await this.badges.setBadges(kind, row.targetId, next, actor);
    }
    await this.audit.log({
      action: `expert_review.${decision}`,
      actor,
      targetType: row.targetType,
      targetId: row.targetId,
      meta: { reviewId: id, decisionNote: decisionNote || null },
    });
    return { ok: true, item, badgeApplied: decision === 'approved' };
  }

  async withdraw(id: string, actor = 'ops', note?: string) {
    const row = await this.prisma.expertReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('复核单不存在');
    if (!['submitted', 'assigned'].includes(row.status)) {
      throw new BadRequestException('仅进行中可撤回');
    }
    const item = await this.prisma.expertReview.update({
      where: { id },
      data: { status: 'withdrawn', decisionNote: note || '已撤回' },
    });
    await this.audit.log({
      action: 'expert_review.withdraw',
      actor,
      targetType: 'ExpertReview',
      targetId: id,
      meta: {},
    });
    return { ok: true, item };
  }
}
