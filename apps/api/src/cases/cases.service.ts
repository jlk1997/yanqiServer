import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

function cardFace(card: any) {
  if (!card) return null;
  const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  return { publishStatus: card.publishStatus, quarantine: Boolean(ext.quarantine), source: ext.source };
}

function matchShareBlock(match: any) {
  const breakdown = match?.scoreBreakdown && typeof match.scoreBreakdown === 'object' ? match.scoreBreakdown : {};
  return shared.externalShareBlock({
    action: breakdown.action,
    cards: [cardFace(match?.demand), cardFace(match?.capability), cardFace(match?.outcome)].filter(Boolean),
  });
}

const REGION_ALIAS: Record<string, string> = {
  上海: '华东',
  江苏: '华东',
  浙江: '华东',
  安徽: '华东',
  北京: '华北',
  天津: '华北',
  河北: '华北',
  广东: '华南',
  深圳: '华南',
  福建: '东南',
  四川: '西南',
  重庆: '西南',
  湖北: '华中',
  湖南: '华中',
};

function regionBucket(r?: string | null) {
  if (!r) return '某地';
  for (const [k, v] of Object.entries(REGION_ALIAS)) {
    if (r.includes(k)) return v;
  }
  return '某地';
}

function orgAlias(org: { name?: string | null; type?: string | null; region?: string | null } | null | undefined, side: 'demand' | 'supply') {
  if (!org) return side === 'demand' ? '某企业需求方' : '某供给方';
  const bucket = regionBucket(org.region);
  const t = String(org.type || '');
  if (t === 'UNIVERSITY' || t === 'LAB_INSTITUTE') return `${bucket}某高校/实验室`;
  if (t === 'ENTERPRISE') return `${bucket}某企业`;
  if (t === 'GOVERNMENT') return `${bucket}某机构`;
  return `${bucket}某组织`;
}


const STATUS_ZH: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已公示',
  rejected: '已驳回',
  unpublished: '已下架',
};

const OUTCOME_ZH: Record<string, string> = {
  success: '成功',
  failure: '未成交',
  mixed: '混合',
  lesson: '复盘',
};

@Injectable()
export class CasesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  enrich(item: any) {
    return {
      ...item,
      statusZh: STATUS_ZH[item.status] || item.status,
      outcomeZh: OUTCOME_ZH[item.outcome] || item.outcome,
      canApprove: ['draft', 'pending', 'rejected', 'unpublished'].includes(item.status),
      canReject: ['draft', 'pending', 'published', 'unpublished'].includes(item.status),
      canUnpublish: item.status === 'published',
    };
  }

  async listOps(status?: string, take = 50) {
    const where: any = {};
    if (status) where.status = status;
    const items = await this.prisma.caseStudy.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
    });
    const counts = await this.prisma.caseStudy.groupBy({ by: ['status'], _count: { _all: true } });
    const by: Record<string, number> = {};
    for (const c of counts) by[c.status] = c._count._all;
    return {
      ok: true,
      wave: 'M33-pay-skeleton-longimg-batch',
      noteZh: '案例审核台：待审核 / 已公示 / 已驳回 / 已下架。支持批量通过/驳回/下架。通过后进公开案例池。',
      statusZh: STATUS_ZH,
      counts: by,
      queue: {
        pending: by.pending || 0,
        published: by.published || 0,
        rejected: by.rejected || 0,
        unpublished: by.unpublished || 0,
        draft: by.draft || 0,
      },
      items: items.map((i) => this.enrich(i)),
    };
  }

  async listPublished(q?: { taxonomy?: string; outcome?: string; take?: number }) {
    const where: any = { status: 'published' };
    if (q?.outcome) where.outcome = q.outcome;
    if (q?.taxonomy) where.taxonomyCodes = { has: q.taxonomy };
    const items = await this.prisma.caseStudy.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: Math.min(q?.take || 40, 100),
    });
    return { ok: true, items: items.map((item) => this.presentPublic(item)) };
  }

  presentPublic(item: any) {
    return {
      id: item.id,
      title: shared.publicCaseText(item.title),
      outcome: item.outcome,
      outcomeZh: OUTCOME_ZH[item.outcome] || item.outcome,
      summaryZh: shared.publicCaseText(item.summaryZh),
      detailZh: shared.publicCaseText(item.detailZh),
      taxonomyCodes: item.taxonomyCodes || [],
      demandAlias: item.demandAlias || null,
      supplyAlias: item.supplyAlias || null,
      industryHint: item.industryHint || null,
      trlBand: item.trlBand || null,
      publishedAt: item.publishedAt || null,
    };
  }

  async getPublished(id: string) {
    const item = await this.prisma.caseStudy.findFirst({
      where: { id, status: 'published' },
    });
    if (!item) throw new NotFoundException('案例不存在或未发布');
    return { ok: true, item: this.presentPublic(item) };
  }

  /** 从已关闭对接生成脱敏草稿 */
  async draftFromMatch(matchId: string, actor = 'ops', body?: { title?: string; outcome?: string; summaryZh?: string }) {
    const m = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true } },
        outcome: { include: { org: true } },
      },
    });
    if (!m) throw new NotFoundException('匹配不存在');
    const block = matchShareBlock(m);
    if (block) {
      throw new BadRequestException(block.message.replace('不能对外展示', '不能写成公开案例'));
    }
    const closed =
      m.status === 'CLOSED' ||
      m.followUpStatus === 'closed_won' ||
      m.followUpStatus === 'closed_lost';
    if (!closed) {
      throw new BadRequestException('仅建议从已关闭/成交/流失对接生成案例（可先改状态）');
    }
    const supply = m.capability || m.outcome;
    const supplyOrg = m.capability?.org || m.outcome?.org;
    const demandAlias = orgAlias(m.demand?.org, 'demand');
    const supplyAlias = orgAlias(supplyOrg, 'supply');
    const won = m.followUpStatus === 'closed_won';
    const lost = m.followUpStatus === 'closed_lost' || m.status === 'REJECTED';
    const outcome = body?.outcome || (won ? 'success' : lost ? 'failure' : 'mixed');
    const taxonomyCodes = [
      ...new Set([
        ...((m.demand as any)?.taxonomyCodes || []),
        ...((supply as any)?.taxonomyCodes || []),
      ]),
    ];
    const trl = supply && 'trl' in supply ? supply.trl : null;
    const title =
      body?.title ||
      `${demandAlias} × ${supplyAlias} · ${outcome === 'success' ? '对接成功' : outcome === 'failure' ? '未继续' : '过程复盘'}`;
    const hiddenNames = [m.demand?.org?.name, supplyOrg?.name].filter(Boolean);
    const band = (m.totalScore || 0) >= 0.7 ? '较高' : (m.totalScore || 0) >= 0.45 ? '中等' : '一般';
    const summaryZh = shared.publicCaseText(
      body?.summaryZh ||
        `在「${(m.demand?.industry || []).slice(0, 3).join('、') || '相关'}」方向，${demandAlias}与${supplyAlias}完成对接闭环（匹配程度${band}）。组织真名、老师姓名和联系方式不写入案例。`,
      hiddenNames,
    );
    const detailZh = shared.publicCaseText(
      [
        `方向：${(m.demand?.industry || []).slice(0, 3).join('、') || '相关技术'}`,
        `跟进结果：${won ? '已成交' : lost ? '未继续' : '已关闭'}`,
        '教训：合同前清单与权利、成熟度越早对齐，后续越稳。',
      ].join('\n'),
      hiddenNames,
    );

    const item = await this.prisma.caseStudy.create({
      data: {
        sourceMatchId: matchId,
        title: shared.publicCaseText(title, hiddenNames),
        outcome,
        summaryZh,
        detailZh,
        taxonomyCodes,
        demandAlias,
        supplyAlias,
        industryHint: (m.demand?.industry || []).slice(0, 4).join('、') || null,
        trlBand: trl != null ? (trl >= 7 ? 'TRL7+' : trl >= 5 ? 'TRL5-6' : 'TRL1-4') : null,
        status: 'pending',
        createdBy: actor,
        meta: { followUpStatus: m.followUpStatus, publicSafe: true },
      },
    });
    await this.audit.log({
      action: 'case.draft_from_match',
      actor,
      targetType: 'CaseStudy',
      targetId: item.id,
      meta: { matchId },
    });
    return { ok: true, item, noteZh: '已生成脱敏草稿（pending），运营审批后门户可见' };
  }

  async upsertManual(body: any, actor = 'ops') {
    if (!body?.title || !body?.summaryZh) throw new BadRequestException('需要 title 与 summaryZh');
    if (body.status === 'published') {
      throw new BadRequestException('公示请走审核通过，不能在改稿时直接公开');
    }
    const title = shared.publicCaseText(body.title);
    const summaryZh = shared.publicCaseText(body.summaryZh);
    const detailZh = body.detailZh ? shared.publicCaseText(body.detailZh) : body.detailZh;
    if (body.id) {
      const item = await this.prisma.caseStudy.update({
        where: { id: body.id },
        data: {
          title,
          summaryZh,
          detailZh,
          outcome: body.outcome || 'lesson',
          taxonomyCodes: body.taxonomyCodes || [],
          demandAlias: body.demandAlias,
          supplyAlias: body.supplyAlias,
          industryHint: body.industryHint,
          trlBand: body.trlBand,
          status: body.status && body.status !== 'published' ? body.status : undefined,
        },
      });
      return { ok: true, item };
    }
    const item = await this.prisma.caseStudy.create({
      data: {
        title,
        summaryZh,
        detailZh: detailZh || null,
        outcome: body.outcome || 'lesson',
        taxonomyCodes: body.taxonomyCodes || [],
        demandAlias: body.demandAlias || '某需求方',
        supplyAlias: body.supplyAlias || '某供给方',
        industryHint: body.industryHint || null,
        trlBand: body.trlBand || null,
        status: 'pending',
        createdBy: actor,
      },
    });
    await this.audit.log({
      action: 'case.create',
      actor,
      targetType: 'CaseStudy',
      targetId: item.id,
      meta: {},
    });
    return { ok: true, item };
  }

  async scrubForPublish(row: any) {
    const names: string[] = [];
    if (row.sourceMatchId) {
      const match = await this.prisma.matchResult.findUnique({
        where: { id: row.sourceMatchId },
        include: {
          demand: { include: { org: true } },
          capability: { include: { org: true } },
          outcome: { include: { org: true } },
        },
      });
      if (match) {
        const block = matchShareBlock(match);
        if (block) throw new BadRequestException(block.message.replace('不能对外展示', '不能公示成案例'));
        for (const name of [match.demand?.org?.name, match.capability?.org?.name, match.outcome?.org?.name]) {
          if (name) names.push(name);
        }
      }
    }
    return {
      title: shared.publicCaseText(row.title, names),
      summaryZh: shared.publicCaseText(row.summaryZh, names),
      detailZh: shared.publicCaseText(row.detailZh, names),
    };
  }

  async decide(
    id: string,
    decision: 'published' | 'rejected' | 'unpublished' | 'pending',
    actor = 'ops',
    note?: string,
  ) {
    const row = await this.prisma.caseStudy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('案例不存在');

    if (decision === 'published') {
      if (!['draft', 'pending', 'rejected', 'unpublished'].includes(row.status)) {
        throw new BadRequestException(`当前状态「${STATUS_ZH[row.status] || row.status}」不能公示`);
      }
      const scrubbed = await this.scrubForPublish(row);
      const item = await this.prisma.caseStudy.update({
        where: { id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          approvedBy: actor,
          rejectNote: null,
          title: scrubbed.title,
          summaryZh: scrubbed.summaryZh,
          detailZh: scrubbed.detailZh,
        },
      });
      await this.audit.log({
        action: 'case.publish',
        actor,
        targetType: 'CaseStudy',
        targetId: id,
        meta: {},
      });
      return { ok: true, item: this.enrich(item), noteZh: '已通过审核并公示，公开案例池可见。' };
    }

    if (decision === 'unpublished') {
      if (row.status !== 'published') {
        throw new BadRequestException('只有已公示的案例可以下架');
      }
      const item = await this.prisma.caseStudy.update({
        where: { id },
        data: {
          status: 'unpublished',
          approvedBy: actor,
          rejectNote: note || '运营下架',
          meta: {
            ...((row.meta as object) || {}),
            unpublishedAt: new Date().toISOString(),
            unpublishedBy: actor,
          },
        },
      });
      await this.audit.log({
        action: 'case.unpublish',
        actor,
        targetType: 'CaseStudy',
        targetId: id,
        meta: { note },
      });
      return { ok: true, item: this.enrich(item), noteZh: '已从公开案例池下架，门户不再展示。' };
    }

    if (decision === 'pending') {
      const item = await this.prisma.caseStudy.update({
        where: { id },
        data: { status: 'pending', approvedBy: actor, rejectNote: note || null },
      });
      await this.audit.log({
        action: 'case.requeue',
        actor,
        targetType: 'CaseStudy',
        targetId: id,
        meta: { note },
      });
      return { ok: true, item: this.enrich(item), noteZh: '已退回待审核队列。' };
    }

    const item = await this.prisma.caseStudy.update({
      where: { id },
      data: { status: 'rejected', rejectNote: note || '未通过脱敏审核', approvedBy: actor },
    });
    await this.audit.log({
      action: 'case.reject',
      actor,
      targetType: 'CaseStudy',
      targetId: id,
      meta: { note },
    });
    return { ok: true, item: this.enrich(item), noteZh: '已驳回，不会进入公开案例池。' };
  }
  async batchDecide(
    ids: string[],
    action: 'publish' | 'reject' | 'unpublish' | 'requeue',
    actor = 'ops',
    note?: string,
  ) {
    const uniq = Array.from(new Set((ids || []).filter(Boolean)));
    if (!uniq.length) {
      return { ok: false, wave: 'M33-pay-skeleton-longimg-batch', count: 0, noteZh: '请先勾选案例。' };
    }
    const map: Record<string, 'published' | 'rejected' | 'unpublished' | 'pending'> = {
      publish: 'published',
      reject: 'rejected',
      unpublish: 'unpublished',
      requeue: 'pending',
    };
    const decision = map[action];
    if (!decision) {
      return { ok: false, wave: 'M33-pay-skeleton-longimg-batch', count: 0, noteZh: '动作不合法：publish/reject/unpublish/requeue' };
    }
    const results: any[] = [];
    const errors: { id: string; message: string }[] = [];
    for (const id of uniq) {
      try {
        const r = await this.decide(id, decision, actor, note);
        results.push({ id, ok: true, status: r.item?.status, statusZh: r.item?.statusZh });
      } catch (e: any) {
        errors.push({ id, message: String(e?.message || e).slice(0, 160) });
      }
    }
    await this.audit.log({
      action: 'case.batch_' + action,
      actor,
      targetType: 'CaseStudy',
      meta: { count: results.length, errors: errors.length, ids: uniq.slice(0, 40) },
    });
    return {
      ok: errors.length === 0,
      wave: 'M33-pay-skeleton-longimg-batch',
      action,
      actionZh: ({ publish: '批量通过公示', reject: '批量驳回', unpublish: '批量下架', requeue: '批量回待审' } as any)[action],
      count: results.length,
      failed: errors.length,
      results,
      errors,
      noteZh: `已处理 ${results.length} 条` + (errors.length ? `，失败 ${errors.length} 条` : '。'),
    };
  }

}
