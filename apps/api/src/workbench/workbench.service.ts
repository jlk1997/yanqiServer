import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveShell } from '../auth/shell';
import { BrokersService } from '../brokers/brokers.service';
import { ObserveService } from '../observe/observe.service';
import { ParkService } from '../park/park.service';
import { CommissionsService } from '../commissions/commissions.service';

const { visibleToOrg } = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

function orgFace(m: any) {
  const bd = m?.scoreBreakdown || {};
  return {
    visible: visibleToOrg(bd.action),
    teacherName: m?.primaryPerson?.name || null,
    collabModeLabel: bd.collabModeLabel || null,
  };
}

const STATUS_ZH: Record<string, string> = {
  PENDING_REVIEW: '待复核',
  APPROVED: '已通过',
  CONTACTED: '已联系',
  REJECTED: '已驳回',
  CLOSED: '已关闭',
  assigned: '已分派',
  contacting: '联系中',
  interested: '有意向',
  closed_won: '已成交',
  closed_lost: '已流失',
  OPEN: '进行中',
  DRAFT: '草稿',
  PUBLISHED: '已发布',
};

function zhStatus(s?: string | null) {
  if (!s) return '未开始';
  return STATUS_ZH[s] || s;
}

function buildSheetPreview(m: {
  id: string;
  totalScore?: number | null;
  reason?: string | null;
  demandTitle?: string | null;
  supplyTitle?: string | null;
}) {
  const supplyTitle = m.supplyTitle || '供给';
  const demandTitle = m.demandTitle || '';
  const scorePct = Math.round((Number(m.totalScore) || 0) * 100);
  const reasonSnippet = String(m.reason || '').replace(/\s+/g, ' ').trim().slice(0, 96);
  return {
    headlineZh: `${supplyTitle} · 匹配度约 ${scorePct}%`,
    pairLineZh: demandTitle ? `对应需求：${demandTitle}` : '对应需求未标注',
    reasonSnippet: reasonSnippet || '打开一页纸查看为什么对得上',
    scoreLabelZh: `匹配度约 ${scorePct}%`,
    onePagerPath: `/api/matches/${m.id}/one-pager?tier=partner&fields=sheet&slim=1`,
    fields: 'sheet',
    slim: true,
    wave: 'M59',
  };
}


function brokerNext(status?: string | null): { label: string; status: string; why: string } {
  const st = status || 'assigned';
  if (st === 'assigned' || st === 'PENDING_REVIEW' || st === 'APPROVED') {
    return { label: '开始联系', status: 'contacting', why: '先打个招呼，确认双方时间' };
  }
  if (st === 'contacting') {
    return { label: '标记有意向', status: 'interested', why: '对方点头就往前推' };
  }
  if (st === 'interested') {
    return { label: '推进成交', status: 'closed_won', why: '材料齐了就收口' };
  }
  return { label: '查看详情', status: st, why: '已收口，需要时再打开' };
}

@Injectable()
export class WorkbenchService {
  constructor(
    private prisma: PrismaService,
    private brokers: BrokersService,
    private observe: ObserveService,
    private park: ParkService,
    private commissions: CommissionsService,
  ) {}

  async home(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { org: true },
    });
    if (!user) return { ok: false, message: '请先登录' };
    const shell = resolveShell({ role: user.role, orgId: user.orgId, orgType: user.org?.type });
    const trust = {
      cues: ['人审后才发信', '不爬未授权库', '对接全程可追溯'],
      noteZh: '试点阶段：重要动作会记审计日志。',
    };

    if (shell.shell === 'guest') {
      return this.parkHome(user, shell, trust);
    }

    if (shell.shell === 'ops') {
      const [pendingReview, draftLeads, qualityOpen, unreadNotes, recentMatches, demandN, capN] =
        await Promise.all([
          this.prisma.matchResult.count({ where: { status: 'PENDING_REVIEW' } }),
          this.prisma.lead.count({ where: { status: 'draft' } }),
          this.prisma.dataQualityIssue.count({ where: { resolvedAt: null } }).catch(() => 0),
          this.prisma.notification.count({ where: { userId, readAt: null } }),
          this.prisma.matchResult.findMany({
            orderBy: { totalScore: 'desc' },
            take: 5,
            include: { demand: true, capability: true, outcome: true },
          }),
          this.prisma.demand.count(),
          this.prisma.capability.count(),
        ]);
      return {
        ok: true,
        shell,
        trust,
        wave: 'M47-sse-path-ticket-research-resume-home-alert',
        user: { id: user.id, name: user.name, role: user.role, email: user.email },
        kpis: [
          { key: 'pendingReview', label: '待复核匹配', value: pendingReview, tone: pendingReview ? 'warn' : 'ok' },
          { key: 'draftLeads', label: '待发线索', value: draftLeads, tone: draftLeads ? 'warn' : 'ok' },
          { key: 'qualityOpen', label: '质检待处理', value: qualityOpen },
          { key: 'unread', label: '未读消息', value: unreadNotes },
        ],
        pipeline: [
          { key: 'supply', label: '供给侧', value: capN, hint: '能力卡' },
          { key: 'demand', label: '需求侧', value: demandN, hint: '企业需求' },
          { key: 'review', label: '待复核', value: pendingReview, hint: '人审' },
          { key: 'leads', label: '待发信', value: draftLeads, hint: '草稿' },
        ],
        tasks: [
          {
            title: '先看待复核匹配',
            href: '/ops.html#match',
            why: pendingReview ? `${pendingReview} 条等你点头` : '暂无积压，去采洗配联补库存',
            primary: Boolean(pendingReview),
          },
          {
            title: '采洗配联补库存',
            href: '/ops.html#flywheel',
            why: '高校公开源 + 企业授权表',
            primary: !pendingReview,
          },
          {
            title: '线索草稿过一眼再发',
            href: '/ops.html#leads',
            why: draftLeads ? `${draftLeads} 封草稿` : '没有积压最好',
          },
        ],
        recent: recentMatches.map((m) => ({
          id: m.id,
          title: m.demand?.title || '匹配',
          score: m.totalScore,
          status: m.status,
          statusZh: zhStatus(m.status),
          supply: m.capability?.title || m.outcome?.title || '-',
        })),
        empty: pendingReview || draftLeads ? null : {
          title: '今天很干净',
          body: '没有积压复核。可以去采洗配联补库存，或看报告复盘。',
          icon: '净',
          hintZh: '下一步只做这一件就够了',
          cta: { label: '打开采洗配联', href: '/ops.html#flywheel', ariaLabel: '打开采洗配联飞轮' },
        },
      };
    }

    if (shell.shell === 'broker') {
      const assigned = await this.brokers.listAssigned(user.id, user.tenantId || 'default');
      const sla: any = await this.brokers.slaBoard({ brokerId: user.id, tenantId: user.tenantId || 'default' });
      const items: any[] = Array.isArray(assigned) ? assigned : [];
      const overdueList: any[] = Array.isArray(sla?.overdue) ? sla.overdue : [];
      const overdueIds = new Set<string>(
        overdueList.map((x: any) => x.id || x.matchId).filter(Boolean),
      );
      const open = items.filter((x: any) => {
        const st = x.followUpStatus || x.followStatus || x.status || '';
        return !['closed_won', 'closed_lost', 'CLOSED', 'WON', 'LOST'].includes(st);
      });
      const overdueN = Number(sla?.counts?.overdue ?? overdueIds.size ?? 0);

      const ledger = await this.commissions.ledger({ brokerId: user.id, tenantId: user.tenantId || 'default' });
      const ranked = [...items].sort((a: any, b: any) => {
        const aId = a.id;
        const bId = b.id;
        const aOver = overdueIds.has(aId) ? 0 : 1;
        const bOver = overdueIds.has(bId) ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        const aClosed = ['closed_won', 'closed_lost'].includes(a.followUpStatus || '') ? 1 : 0;
        const bClosed = ['closed_won', 'closed_lost'].includes(b.followUpStatus || '') ? 1 : 0;
        if (aClosed !== bClosed) return aClosed - bClosed;
        return (b.totalScore || 0) - (a.totalScore || 0);
      });

      return {
        ok: true,
        shell,
        trust,
        wave: 'M47-sse-path-ticket-research-resume-home-alert',
        user: { id: user.id, name: user.name, role: user.role, email: user.email },
        ledger,
        hallSteps: [
          { n: 1, titleZh: '待跟进', href: '#queue', hintZh: '超时优先，先保时效' },
          { n: 2, titleZh: '看一页纸', href: '#queue', hintZh: '弄清为什么对得上' },
          { n: 3, titleZh: '推进成交', href: '#queue', hintZh: '按主按钮收口' },
          { n: 4, titleZh: '佣金对账', href: '#ledger', hintZh: '演示账本，不打款' },
        ],
        kpis: [
          { key: 'mine', label: '我的对接单', value: items.length },
          { key: 'open', label: '进行中', value: open.length },
          { key: 'overdue', label: 'SLA 告警', value: overdueN, tone: overdueN ? 'danger' : 'ok' },
          { key: 'comm', label: '待核佣金(元)', value: ledger?.summary?.pendingYuan ?? 0 },
        ],
        pipeline: [
          { key: 'overdue', label: '超时', value: overdueN, hint: '先处理' },
          { key: 'open', label: '进行中', value: open.length, hint: '跟进' },
          { key: 'won', label: '已成交', value: items.filter((x) => (x.followUpStatus || '') === 'closed_won').length, hint: '收口' },
          { key: 'ledger', label: '待核账', value: ledger?.summary?.pendingYuan ?? 0, hint: '元' },
        ],
        tasks: [
          {
            title: overdueN ? `处理 ${overdueN} 条超时单` : '巡视即将到期的单',
            href: '#queue',
            why: '先保时效，再谈转化',
            primary: true,
          },
          { title: '先看一页纸再推进', href: '#queue', why: '弄清为什么对得上' },
          { title: '看佣金对账（演示）', href: '#ledger', why: '可读账本，不真打款' },
        ],
        recent: ranked.filter((m: any) => orgFace(m).visible).slice(0, 12).map((m: any) => {
          const st = m.followUpStatus || m.followStatus || m.status;
          const next = brokerNext(st);
          const urgent = overdueIds.has(m.id);
          const face = orgFace(m);
          return {
            id: m.id,
            title: m.demand?.title || m.demandTitle || '对接',
            status: st,
            statusZh: zhStatus(st),
            score: m.totalScore,
            note: m.followUpNote || m.followNote || m.brokerNote || '',
            teacherName: face.teacherName,
            collabModeLabel: face.collabModeLabel,
            urgent,
            nextStep: next,
          };
        }),
        sla: {
          noteZh: overdueN
            ? `有 ${overdueN} 条超过约定跟进时限，请优先处理。`
            : '暂无超时告警，保持节奏即可。',
          counts: sla?.counts || { overdue: overdueN },
          raw: sla,
        },
        empty: items.length
          ? null
          : {
              title: '还没有分派给你的单',
              body: '让运营在匹配复核里把单分给你，或先看公开对接案例熟悉流程。',
              cta: { label: '看公开案例', href: '/portal.html#matches' },
            },
      };
    }

    const orgId = user.orgId;
    if (!orgId) {
      return {
        ok: true,
        shell,
        trust,
        wave: 'M47-sse-path-ticket-research-resume-home-alert',
        user: { id: user.id, name: user.name, role: user.role, email: user.email },
        kpis: [],
        pipeline: [],
        tasks: [
          { title: '先认领或创建单位', href: '/portal.html#workspace', why: '没有单位就没法发需求/成果', primary: true },
        ],
        recent: [],
        org: null,
        empty: {
          title: '还没绑单位',
          body: '去门户认领高校/企业，或让运营帮你挂上组织。',
          cta: { label: '去认领单位', href: '/portal.html#workspace' },
        },
      };
    }

    const [demands, capabilities, outcomes, notifications] = await Promise.all([
      this.prisma.demand.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' }, take: 12 }),
      this.prisma.capability.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' }, take: 12 }),
      this.prisma.outcome.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' }, take: 12 }),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);

    if (shell.shell === 'research') {
      const supplyIds = {
        caps: capabilities.map((c) => c.id),
        outs: outcomes.map((o) => o.id),
      };
      const interest = (await this.prisma.matchResult.findMany({
        where: {
          OR: [
            supplyIds.caps.length ? { capabilityId: { in: supplyIds.caps } } : undefined,
            supplyIds.outs.length ? { outcomeId: { in: supplyIds.outs } } : undefined,
          ].filter(Boolean) as any,
        },
        orderBy: { totalScore: 'desc' },
        take: 16,
        include: { demand: { include: { org: true } }, primaryPerson: { select: { name: true } } },
      })).filter((m) => orgFace(m).visible).slice(0, 8);
      const openInterest = interest.filter(
        (m) => !['CLOSED', 'REJECTED'].includes(m.status) && m.followUpStatus !== 'closed_lost',
      );
      return {
        ok: true,
        shell,
        trust,
        wave: 'M59-core-org-batch-update-inbox-diff-prewarm-queue',
        user: { id: user.id, name: user.name, role: user.role, email: user.email, orgId },
        org: user.org,
        inboxProjection: { fields: 'sheet', slim: true, wave: 'M63', incremental: true, trueDiff: true, cursor: true },
        hallSteps: [
          { n: 1, titleZh: '上架能力', href: '#publish-cap', hintZh: '写清能对外服务的本事' },
          { n: 2, titleZh: '上架成果', href: '#publish-out', hintZh: '专利/论文/样机用人话' },
          { n: 3, titleZh: '看企业意向', href: '#interest', hintZh: '一页纸弄清为什么对得上' },
          { n: 4, titleZh: '确认或请牵线', href: '#interest', hintZh: '有意向就点头，或请运营牵线' },
        ],
        kpis: [
          { key: 'caps', label: '能力卡', value: capabilities.length },
          { key: 'outs', label: '成果卡', value: outcomes.length },
          { key: 'interest', label: '企业意向', value: interest.length },
          { key: 'unread', label: '未读', value: notifications.filter((n) => !n.readAt).length },
        ],
        pipeline: [
          { key: 'caps', label: '能力', value: capabilities.length, hint: '可对外服务' },
          { key: 'outs', label: '成果', value: outcomes.length, hint: '可转化' },
          { key: 'interest', label: '意向', value: openInterest.length, hint: '待回应' },
          {
            key: 'intent',
            label: '已确认',
            value: interest.filter((m) => m.followUpStatus === 'interested').length,
            hint: '有意向',
          },
        ],
        tasks: [
          {
            title: capabilities.length ? '再补一条可对外服务的能力' : '上架第一条能力',
            href: '#publish-cap',
            why: capabilities.length ? '档案越清楚，企业越敢找' : '没有能力卡，企业搜不到你',
            primary: !capabilities.length,
          },
          {
            title: outcomes.length ? '刷新一条成果摘要' : '上架一条成果',
            href: '#publish-out',
            why: '专利 / 论文 / 样机都行，写人话',
          },
          {
            title: openInterest.length ? `回应 ${openInterest.length} 条企业意向` : '看看哪些企业需求对得上',
            href: '#interest',
            why: openInterest.length ? '点「有意向」或「暂不合适」' : '有供给后自动出现',
            primary: Boolean(openInterest.length),
          },
        ],
        recent: interest.map((m) => {
          const demandTitle = m.demand?.title || '需求';
          const supplyTitle = '对企业需求';
          return {
            id: m.id,
            title: demandTitle,
            score: m.totalScore,
            status: m.status,
            statusZh: zhStatus(m.followUpStatus || m.status),
            followUpStatus: m.followUpStatus,
            orgName: m.demand?.org?.name,
            teacherName: orgFace(m).teacherName,
            collabModeLabel: orgFace(m).collabModeLabel,
            updatedAt: m.updatedAt,
            canRespond: !['closed_won', 'closed_lost'].includes(m.followUpStatus || '') && m.status !== 'CLOSED',
            sheetPreview: buildSheetPreview({
              id: m.id,
              totalScore: m.totalScore,
              reason: m.reason,
              demandTitle,
              supplyTitle: `${m.demand?.org?.name || '企业'} · ${demandTitle}`,
            }),
          };
        }),
        cards: {
          capabilities: capabilities.slice(0, 5),
          outcomes: outcomes.slice(0, 5),
        },
        notifications,
        empty:
          !capabilities.length && !outcomes.length
            ? {
                title: '档案还是空的',
                body: '先上架一条能力或成果，系统才会把企业需求推过来。',
                icon: '研',
                hintZh: '下一步只做这一件就够了',
                cta: { label: '上架能力', href: '#publish-cap', ariaLabel: '去上架科研能力' },
              }
            : !interest.length
              ? {
                  title: '暂时还没有企业意向',
                  body: '供给已上架。可以去需求广场看看，或等匹配跑一轮。',
                  icon: '意',
                  hintZh: '下一步只做这一件就够了',
                  cta: { label: '逛企业需求', href: '/portal.html#demands', ariaLabel: '去企业需求广场看看' },
                }
              : null,
      };
    }

    // enterprise default · M57：收件箱瘦投影（list/detail 仅首屏字段，一页纸走 sheet+ETag）
    const demandIds = demands.map((d) => d.id);
    const matches = demandIds.length
      ? (await this.prisma.matchResult.findMany({
          where: { demandId: { in: demandIds } },
          orderBy: { totalScore: 'desc' },
          take: 16,
          select: {
            id: true,
            totalScore: true,
            status: true,
            followUpStatus: true,
            reason: true,
            scoreBreakdown: true,
            updatedAt: true,
            createdAt: true,
            demand: { select: { id: true, title: true } },
            capability: { select: { id: true, title: true } },
            outcome: { select: { id: true, title: true } },
            primaryPerson: { select: { name: true } },
          },
        })).filter((m) => orgFace(m).visible).slice(0, 8)
      : [];
    const openMatches = matches.filter((m) => !['CLOSED', 'REJECTED'].includes(m.status));
    const pendingBills = await this.prisma.checkoutSession.findMany({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const unpaidYuan = pendingBills.reduce((a, b) => a + (b.amount || 0), 0) / 100;
    const billSla = pendingBills.map((b) => {
      const ageHours = Math.max(0, Math.round(((Date.now() - new Date(b.createdAt).getTime()) / 3600000) * 10) / 10);
      const urgency = ageHours >= 72 ? 'overdue' : ageHours >= 24 ? 'soon' : 'ok';
      const urgencyZh = urgency === 'overdue' ? '逾期关注' : urgency === 'soon' ? '临近关注' : '正常';
      return {
        billId: b.id,
        planCode: b.planCode,
        amountYuan: ((b.amount || 0) / 100).toFixed(2),
        href: '#bills',
        ageHours,
        urgency,
        urgencyZh,
        createdAt: b.createdAt,
      };
    });
    const overdueCount = billSla.filter((x) => x.urgency === 'overdue').length;
    const soonCount = billSla.filter((x) => x.urgency === 'soon').length;
    const billTasks =
      pendingBills.length > 0
        ? [
            {
              title:
                overdueCount > 0
                  ? `处理 ${overdueCount} 笔逾期关注演示账单`
                  : soonCount > 0
                    ? `处理 ${soonCount} 笔临近关注演示账单`
                    : `处理 ${pendingBills.length} 笔演示待付账单`,
              href: '#bills',
              why: `合计约 ¥${unpaidYuan.toFixed(2)} · SLA：临近≥24h / 逾期≥72h · 演示不扣款`,
              primary: true,
              tone: overdueCount ? 'danger' : 'warn',
              kind: 'billing_remind',
            },
          ]
        : [];
    return {
      ok: true,
      shell,
      trust,
      wave: 'M59-core-org-batch-update-inbox-diff-prewarm-queue',
      user: { id: user.id, name: user.name, role: user.role, email: user.email, orgId },
      org: user.org,
      inboxProjection: { fields: 'sheet', slim: true, wave: 'M63', incremental: true, trueDiff: true, cursor: true },
      billReminders: {
        unpaidCount: pendingBills.length,
        unpaidYuan: Number(unpaidYuan.toFixed(2)),
        overdueCount,
        soonCount,
        slaPolicyZh: '挂账≥24h 临近关注；≥72h 逾期关注（演示不扣款）。',
        bannerZh: pendingBills.length
          ? `你有 ${pendingBills.length} 笔演示账单待处理（临近 ${soonCount} / 逾期关注 ${overdueCount}）。不会真扣钱。`
          : null,
        items: billSla,
        notifyDraftPath: '/api/billing/reminders/notify-draft',
        archivePath: 'POST /api/billing/receipts/archive',
      },
      kpis: [
        { key: 'demands', label: '我的需求', value: demands.length },
        { key: 'matches', label: '推荐匹配', value: matches.length },
        { key: 'open', label: '跟进中', value: openMatches.length },
        {
          key: 'unpaidBills',
          label: '演示待付',
          value: pendingBills.length,
          tone: pendingBills.length ? 'warn' : 'ok',
        },
      ],
      pipeline: [
        { key: 'published', label: '已发需求', value: demands.length, hint: '说清楚卡点' },
        { key: 'matched', label: '有推荐', value: matches.length, hint: '实验室/成果' },
        {
          key: 'intent',
          label: '有意向',
          value: matches.filter((m) => m.followUpStatus === 'interested' || m.status === 'CONTACTED').length,
          hint: '双方点头',
        },
        {
          key: 'done',
          label: '已收口',
          value: matches.filter((m) => ['closed_won', 'closed_lost'].includes(m.followUpStatus || '') || m.status === 'CLOSED').length,
          hint: '成或弃',
        },
      ],
      tasks: [
        ...billTasks,
        {
          title: demands.length ? '再发一条真实技术需求' : '发第一条技术需求',
          href: '#publish-demand',
          why: demands.length ? '一条需求对一类卡点' : '没有需求就匹配不了',
          primary: !demands.length && !pendingBills.length,
        },
        {
          title: matches.length ? '打开匹配收件箱' : '等系统推实验室/成果',
          href: '#inbox',
          why: matches.length ? `${matches.length} 条可确认意向或请求联系` : '发需求后自动出现',
          primary: Boolean(matches.length) && !pendingBills.length,
        },
        {
          title: '看对接进度',
          href: '#pipeline',
          why: '发需求 → 匹配 → 意向 → 收口',
        },
      ].slice(0, 4),
      recent: matches.map((m) => {
        const supplyTitle = m.capability?.title || m.outcome?.title || '供给';
        const demandTitle = m.demand?.title || '';
        return {
          id: m.id,
          title: supplyTitle,
          demandTitle,
          score: m.totalScore,
          status: m.status,
          statusZh: zhStatus(m.followUpStatus || m.status),
          followUpStatus: m.followUpStatus,
          teacherName: orgFace(m).teacherName,
          collabModeLabel: orgFace(m).collabModeLabel,
          updatedAt: (m as any).updatedAt || (m as any).createdAt || null,
          canAct: !['closed_won', 'closed_lost'].includes(m.followUpStatus || '') && m.status !== 'CLOSED',
          // M57/M58：一页纸首屏投影；匹配后服务端预热 ETag，收件箱可增量刷新
          sheetPreview: buildSheetPreview({
            id: m.id,
            totalScore: m.totalScore,
            reason: m.reason,
            demandTitle,
            supplyTitle,
          }),
        };
      }),
      myDemands: demands.slice(0, 6).map((d) => ({
        id: d.id,
        title: d.title,
        status: (d as any).status || 'OPEN',
        statusZh: zhStatus((d as any).status || 'OPEN'),
        updatedAt: d.updatedAt,
      })),
      cards: { demands, capabilities, outcomes },
      notifications,
      empty: !demands.length
        ? {
            title: '还没有技术需求',
            body: '用大白话写清卡点和期望，系统帮你找实验室。预算可先写大概区间。',
            icon: '需',
            hintZh: '下一步只做这一件就够了',
            cta: { label: '发一条需求', href: '#publish-demand', ariaLabel: '去发一条技术需求' },
          }
        : !matches.length
          ? {
              title: '需求已发出，还在匹配中',
              body: '可以再补一条更具体的需求，或让运营跑一轮匹配。',
              icon: '配',
              hintZh: '下一步只做这一件就够了',
              cta: { label: '再发一条', href: '#publish-demand', ariaLabel: '再发一条技术需求' },
            }
          : null,
    };
  }

  private async parkHome(user: any, shell: any, trust: any) {
    const board = await this.observe.getParkBoard();
    const parkBoard = this.park.board();
    const st = board.stats || { orgs: 0, outcomes: 0, capabilities: 0, demands: 0, matches: 0 };
    const reviewN = (parkBoard.counts?.underReview || 0) + (parkBoard.counts?.submitted || 0);
    return {
      ok: true,
      shell,
      trust: {
        ...trust,
        cues: board.trustCues || ['只读观察', '不改业务数据', '案例已脱敏'],
        noteZh: 'G 端观察壳：汇总、案例、政策、征集审批。不进采洗配联。',
      },
      wave: 'M47-sse-path-ticket-research-resume-home-alert',
      user: { id: user.id, name: user.name, role: user.role, email: user.email },
      kpis: [
        { key: 'orgs', label: '入驻单位', value: st.orgs },
        { key: 'caps', label: '能力供给', value: st.capabilities },
        { key: 'demands', label: '企业需求', value: st.demands },
        { key: 'review', label: '待审征集', value: reviewN, tone: reviewN ? 'warn' : 'ok' },
      ],
      pipeline: [
        { key: 'supply', label: '成果+能力', value: (st.outcomes || 0) + (st.capabilities || 0), hint: '供给池' },
        { key: 'demand', label: '需求', value: st.demands, hint: '企业侧' },
        { key: 'match', label: '匹配', value: st.matches, hint: '撮合量' },
        { key: 'approval', label: '待审', value: reviewN, hint: '征集审批' },
      ],
      tasks: [
        { title: reviewN ? `处理 ${reviewN} 条征集审批` : '查看征集窗状态', href: '#approvals', why: '园区审批流骨架', primary: true },
        { title: '看区域对接热度', href: '#stats', why: '入驻、供需、匹配一眼清' },
        { title: '翻脱敏成功案例', href: '#cases', why: '对外汇报素材' },
      ],
      observe: {
        hero: board.hero,
        stats: st,
        regionHeat: board.regionHeat || [],
        cases: board.cases || [],
        policies: board.policies || [],
        briefTips: board.briefTips || [],
        source: board.source,
        updatedAt: board.updatedAt,
      },
      park: parkBoard,
      recent: [],
      empty: null,
    };
  }


  private opsDashScope = 'ops_dash_cards';
  private opsDashName = '__ops_dash_cards__';



  /** M60/M61：收件箱差分游标 — 不透明单调令牌（updatedAtMs + matchId），防 ISO 时钟漂移 */
  encodeInboxCursor(opts: { updatedAt?: Date | string | null; id?: string | null }): string | null {
    const id = opts.id ? String(opts.id) : '';
    let ms = 0;
    if (opts.updatedAt) {
      const t = opts.updatedAt instanceof Date ? opts.updatedAt.getTime() : Date.parse(String(opts.updatedAt));
      if (!Number.isNaN(t)) ms = t;
    }
    if (!ms && !id) return null;
    const raw = `v1|${ms}|${id}`;
    return 'm60c_' + Buffer.from(raw, 'utf8').toString('base64url');
  }

  decodeInboxCursor(cursor?: string | null): { ms: number; id: string; raw: string } | null {
    const s = String(cursor || '').trim();
    if (!s) return null;
    try {
      let payload = s;
      if (s.startsWith('m60c_')) payload = s.slice(5);
      const raw = Buffer.from(payload, 'base64url').toString('utf8');
      const parts = raw.split('|');
      if (parts[0] !== 'v1' || parts.length < 3) return null;
      const ms = Number(parts[1]) || 0;
      const id = parts.slice(2).join('|');
      return { ms, id, raw };
    } catch {
      return null;
    }
  }

  /** 是否严格新于游标（同 ms 时用 id 字典序作 tie-break） */
  private isAfterInboxCursor(
    updatedAt: Date | string | null | undefined,
    id: string,
    cursor: { ms: number; id: string } | null,
  ): boolean {
    if (!cursor) return false;
    const ms = updatedAt
      ? updatedAt instanceof Date
        ? updatedAt.getTime()
        : Date.parse(String(updatedAt))
      : 0;
    if (!ms) return false;
    if (ms > cursor.ms) return true;
    if (ms < cursor.ms) return false;
    return String(id) > String(cursor.id || '');
  }

  /**
   * M59–M61：收件箱真差分 — cursor 令牌 / since / knownIds 直接查 matchResult，
   * 不回源整包 home（免 observe/账单/卡片等重载荷）。
   */
  async inboxDelta(
    userId: string,
    opts: { since?: string | null; knownIds?: string[] | null; cursor?: string | null } = {},
  ) {
    const t0 = Date.now();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { org: true },
    });
    if (!user) {
      return {
        ok: false,
        wave: 'M63',
        messageZh: '请先登录',
        tipZh: '登录后才能拉收件箱增量。',
        busyClearZh: '未登录，已清理等待态。',
      };
    }
    const shell = resolveShell({ role: user.role, orgId: user.orgId, orgType: user.org?.type });
    const shellName = shell.shell || 'unknown';
    const known = new Set((opts.knownIds || []).filter(Boolean).map(String));
    const decodedCursor = this.decodeInboxCursor(opts.cursor);
    let sinceDate: Date | null = null;
    if (decodedCursor && decodedCursor.ms) {
      sinceDate = new Date(decodedCursor.ms);
    } else if (opts.since) {
      const t = Date.parse(String(opts.since));
      if (!Number.isNaN(t)) sinceDate = new Date(t);
    }

    if (shellName !== 'enterprise' && shellName !== 'research') {
      return {
        ok: true,
        wave: 'M63',
        shell: shellName,
        trueDiff: true,
        cursor: opts.cursor || null,
        nextCursor: opts.cursor || null,
        since: opts.since || null,
        knownCount: known.size,
        recentCount: 0,
        added: [],
        updated: [],
        removedIds: [],
        latestAt: null,
        kpis: null,
        empty: null,
        tipZh: '当前壳不使用匹配收件箱增量。',
        busyClearZh: '已清理等待态。',
        timingMs: Date.now() - t0,
      };
    }

    const orgId = user.orgId;
    if (!orgId) {
      return {
        ok: true,
        wave: 'M63',
        shell: shellName,
        trueDiff: true,
        cursor: opts.cursor || null,
        nextCursor: opts.cursor || null,
        since: opts.since || null,
        knownCount: known.size,
        recentCount: 0,
        added: [],
        updated: [],
        removedIds: [...known],
        latestAt: null,
        kpis: null,
        empty: {
          title: '还没绑单位',
          body: '去门户认领高校/企业，或让运营帮你挂上组织。',
        },
        tipZh: '未绑单位，收件箱为空。',
        busyClearZh: '已清理等待态。',
        timingMs: Date.now() - t0,
      };
    }

    // 轻量：只取本壳收件箱候选 id/投影所需字段（与 home recent 同源 take=8）
    let rows: any[] = [];
    if (shellName === 'research') {
      const [capabilities, outcomes] = await Promise.all([
        this.prisma.capability.findMany({
          where: { orgId },
          select: { id: true },
          orderBy: { updatedAt: 'desc' },
          take: 12,
        }),
        this.prisma.outcome.findMany({
          where: { orgId },
          select: { id: true },
          orderBy: { updatedAt: 'desc' },
          take: 12,
        }),
      ]);
      const capIds = capabilities.map((c) => c.id);
      const outIds = outcomes.map((o) => o.id);
      if (capIds.length || outIds.length) {
        rows = await this.prisma.matchResult.findMany({
          where: {
            OR: [
              capIds.length ? { capabilityId: { in: capIds } } : undefined,
              outIds.length ? { outcomeId: { in: outIds } } : undefined,
            ].filter(Boolean) as any,
          },
          orderBy: { totalScore: 'desc' },
          take: 8,
          select: {
            id: true,
            totalScore: true,
            status: true,
            followUpStatus: true,
            reason: true,
            scoreBreakdown: true,
            updatedAt: true,
            createdAt: true,
            demand: { select: { id: true, title: true, org: { select: { name: true } } } },
            primaryPerson: { select: { name: true } },
          },
        });
      }
    } else {
      const demands = await this.prisma.demand.findMany({
        where: { orgId },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      });
      const demandIds = demands.map((d) => d.id);
      if (demandIds.length) {
        rows = await this.prisma.matchResult.findMany({
          where: { demandId: { in: demandIds } },
          orderBy: { totalScore: 'desc' },
          take: 8,
          select: {
            id: true,
            totalScore: true,
            status: true,
            followUpStatus: true,
            reason: true,
            scoreBreakdown: true,
            updatedAt: true,
            createdAt: true,
            demand: { select: { id: true, title: true } },
            capability: { select: { id: true, title: true } },
            outcome: { select: { id: true, title: true } },
            primaryPerson: { select: { name: true } },
          },
        });
      }
    }
    rows = rows.filter((m) => orgFace(m).visible);

    const project = (m: any) => {
      if (shellName === 'research') {
        const demandTitle = m.demand?.title || '需求';
        const supplyTitle = '对企业需求';
        return {
          id: m.id,
          title: demandTitle,
          score: m.totalScore,
          status: m.status,
          statusZh: zhStatus(m.followUpStatus || m.status),
          followUpStatus: m.followUpStatus,
          orgName: m.demand?.org?.name,
          teacherName: orgFace(m).teacherName,
          collabModeLabel: orgFace(m).collabModeLabel,
          updatedAt: m.updatedAt,
          canRespond:
            !['closed_won', 'closed_lost'].includes(m.followUpStatus || '') && m.status !== 'CLOSED',
          sheetPreview: buildSheetPreview({
            id: m.id,
            totalScore: m.totalScore,
            reason: m.reason,
            demandTitle,
            supplyTitle: `${m.demand?.org?.name || '企业'} · ${demandTitle}`,
          }),
        };
      }
      const supplyTitle = m.capability?.title || m.outcome?.title || '供给';
      const demandTitle = m.demand?.title || '';
      return {
        id: m.id,
        title: supplyTitle,
        demandTitle,
        score: m.totalScore,
        status: m.status,
        statusZh: zhStatus(m.followUpStatus || m.status),
        followUpStatus: m.followUpStatus,
        teacherName: orgFace(m).teacherName,
        collabModeLabel: orgFace(m).collabModeLabel,
        updatedAt: m.updatedAt || m.createdAt || null,
        canAct:
          !['closed_won', 'closed_lost'].includes(m.followUpStatus || '') && m.status !== 'CLOSED',
        sheetPreview: buildSheetPreview({
          id: m.id,
          totalScore: m.totalScore,
          reason: m.reason,
          demandTitle,
          supplyTitle,
        }),
      };
    };

    const recentIds = new Set(rows.map((m) => String(m.id)));
    const sinceMs = sinceDate ? sinceDate.getTime() : 0;
    const cursorRef = decodedCursor;

    // 真差分：仅对「新增」与「cursor/since 后更新」投影；未变 known 不回传整卡
    const added: any[] = [];
    const updated: any[] = [];
    for (const m of rows) {
      const id = String(m.id);
      if (!known.has(id)) {
        added.push(project(m));
      } else if (cursorRef) {
        if (this.isAfterInboxCursor(m.updatedAt, id, cursorRef)) updated.push(project(m));
      } else if (sinceMs) {
        const updatedAtMs = m.updatedAt ? new Date(m.updatedAt).getTime() : 0;
        if (updatedAtMs && updatedAtMs > sinceMs) updated.push(project(m));
      }
    }
    const removedIds = [...known].filter((id) => !recentIds.has(id));

    // cursor/since 存在时：补查 known 内、updatedAt>since 且可能跌出 Top8 的
    if (sinceDate && known.size) {
      const knownStill = [...known].filter((id) => recentIds.has(id));
      const already = new Set([...added, ...updated].map((x) => String(x.id)));
      const extraIds = knownStill.filter((id) => !already.has(id));
      if (extraIds.length) {
        const touched = await this.prisma.matchResult.findMany({
          where: { id: { in: extraIds }, updatedAt: { gt: sinceDate } },
          select: {
            id: true,
            totalScore: true,
            status: true,
            followUpStatus: true,
            reason: true,
            updatedAt: true,
            createdAt: true,
            demand: { select: { id: true, title: true, org: { select: { name: true } } } },
            capability: { select: { id: true, title: true } },
            outcome: { select: { id: true, title: true } },
          },
        });
        for (const m of touched) {
          const id = String(m.id);
          if (already.has(id)) continue;
          if (cursorRef && !this.isAfterInboxCursor(m.updatedAt, id, cursorRef)) continue;
          updated.push(project(m));
        }
      }
    }

    // 单调 nextCursor：取 rows 中 (updatedAt,id) 最大者
    let cursorAnchor: { updatedAt: any; id: string } | null = null;
    for (const m of rows) {
      if (!m?.updatedAt) continue;
      if (!cursorAnchor) {
        cursorAnchor = { updatedAt: m.updatedAt, id: String(m.id) };
        continue;
      }
      const aMs = new Date(m.updatedAt).getTime();
      const bMs = new Date(cursorAnchor.updatedAt).getTime();
      if (aMs > bMs || (aMs === bMs && String(m.id) > cursorAnchor.id)) {
        cursorAnchor = { updatedAt: m.updatedAt, id: String(m.id) };
      }
    }
    const nextCursor = cursorAnchor
      ? this.encodeInboxCursor({ updatedAt: cursorAnchor.updatedAt, id: cursorAnchor.id })
      : opts.cursor || null;

    const latestAt = rows.reduce((acc: string | null, m: any) => {
      const a = m.updatedAt ? new Date(m.updatedAt).toISOString() : null;
      if (!a) return acc;
      if (!acc) return a;
      return Date.parse(a) > Date.parse(acc) ? a : acc;
    }, null as string | null);

    const openN = rows.filter(
      (m) => !['CLOSED', 'REJECTED'].includes(m.status) && m.followUpStatus !== 'closed_lost',
    ).length;

    return {
      ok: true,
      wave: 'M63',
      shell: shellName,
      trueDiff: true,
      homeBypass: true,
      cursor: nextCursor,
      nextCursor,
      cursorDecoded: decodedCursor
        ? { ms: decodedCursor.ms, id: decodedCursor.id }
        : null,
      since: opts.since || null,
      knownCount: known.size,
      recentCount: rows.length,
      added,
      updated,
      removedIds,
      latestAt,
      // 轻量 KPI，非整包 home
      kpis: [
        {
          key: shellName === 'research' ? 'interest' : 'matches',
          label: shellName === 'research' ? '企业意向' : '推荐匹配',
          value: rows.length,
        },
        { key: 'open', label: '跟进中', value: openN },
      ],
      empty: rows.length
        ? null
        : {
            title: shellName === 'research' ? '暂时还没有企业意向' : '需求已发出，还在匹配中',
            body:
              shellName === 'research'
                ? '供给已上架。可以去需求广场看看，或等匹配跑一轮。'
                : '可以再补一条更具体的需求，或让运营跑一轮匹配。',
          },
      tipZh:
        added.length || updated.length || removedIds.length
          ? `收件箱差分：新增 ${added.length} · 更新 ${updated.length} · 移除 ${removedIds.length}（cursor 真查询 · 可 ETag 短缓存）。`
          : '收件箱无新匹配（cursor 真差分 · 未变可 304）。',
      busyClearZh: '匹配已同步，等待态已清理，可继续看一页纸。',
      etagReady: true,
      timingMs: Date.now() - t0,
    };
  }

  async getOpsDashCardPrefs(userId: string, tenantId = 'default', accountHint?: string) {
    const row = await this.prisma.savedView.findFirst({
      where: { userId, tenantId, scope: this.opsDashScope, name: this.opsDashName },
      orderBy: { updatedAt: 'desc' },
    });
    const q: any = row?.query || {};
    const order = Array.isArray(q.order) ? q.order.map(String) : null;
    const hidden = Array.isArray(q.hidden) ? q.hidden.map(String) : null;
    return {
      ok: true,
      wave: 'M47-sse-path-ticket-research-resume-home-alert',
      source: row ? 'server' : 'empty',
      accountHint: accountHint || null,
      prefs: row
        ? { order: order || [], hidden: hidden || [], updatedAt: row.updatedAt }
        : null,
      noteZh: row
        ? '已从服务端读取卡片偏好；本机仍可作离线回退。'
        : '服务端尚无偏好。若本机有旧配置，保存时会自动迁上来。',
      migrateHintZh: '登录后首次保存会把 localStorage 的 yanqi.ops.dashCards.v1:<账号> 迁到服务端。',
    };
  }

  async putOpsDashCardPrefs(
    userId: string,
    tenantId = 'default',
    body: { order?: string[]; hidden?: string[]; migrateFromLocal?: boolean },
  ) {
    const order = Array.isArray(body?.order) ? body.order.map(String).filter(Boolean) : [];
    const hidden = Array.isArray(body?.hidden) ? body.hidden.map(String).filter(Boolean) : [];
    const query = { order, hidden, v: 1 };
    const existing = await this.prisma.savedView.findFirst({
      where: { userId, tenantId, scope: this.opsDashScope, name: this.opsDashName },
    });
    let row;
    if (existing) {
      row = await this.prisma.savedView.update({
        where: { id: existing.id },
        data: { query, isDefault: true },
      });
    } else {
      row = await this.prisma.savedView.create({
        data: {
          userId,
          tenantId,
          scope: this.opsDashScope,
          name: this.opsDashName,
          query,
          isDefault: true,
        },
      });
    }
    return {
      ok: true,
      wave: 'M47-sse-path-ticket-research-resume-home-alert',
      source: 'server',
      migrated: Boolean(body?.migrateFromLocal),
      prefs: { order, hidden, updatedAt: row.updatedAt },
      noteZh: body?.migrateFromLocal
        ? '已从本机迁到服务端并保存。换浏览器登录也能看到同一套首页卡片。'
        : '卡片偏好已同步到服务端；本机仍保留一份作回退。',
    };
  }

}
