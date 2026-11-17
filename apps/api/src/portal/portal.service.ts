import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../plans/quota.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { FlagsService } from '../flags/flags.service';
import { FlywheelService } from '../flywheel/flywheel.service';
import { ChecklistsService } from '../checklists/checklists.service';
import { OutcomeType } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hashEmbed, detectRightsConflicts, visibleToOrg, ACTION_ZH, STAGE_ZH, publishDecision, inferDemandKind, summaryPublic, BLOCKER_ZH, isDemoSource } = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

function asStringArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v)
    .split(/[,，|、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class PortalService {
  constructor(
    private prisma: PrismaService,
    private quota: QuotaService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
    private flags: FlagsService,
    private checklists: ChecklistsService,
    private flywheel: FlywheelService,
  ) {}

  async publicHome() {
    const live = this.livePublicWhere();
    const [orgs, outs, demands, rawCases] = await Promise.all([
      this.prisma.organization.count({ where: live }),
      this.prisma.outcome.count({ where: live }),
      this.prisma.demand.count({ where: live }),
      this.prisma.matchResult.findMany({
        where: { totalScore: { gte: 0.5 }, status: { in: ['PENDING_REVIEW', 'APPROVED', 'CONTACTED'] } },
        orderBy: { totalScore: 'desc' },
        include: { demand: { include: { org: true } }, capability: true, outcome: true },
      }),
    ]);
    const visibleCases = rawCases.filter((m) => visibleToOrg((m.scoreBreakdown as any)?.action) && this.cardIsLive(m.demand) && this.cardIsLive(m.capability || m.outcome));
    const cases = visibleCases.slice(0, 6);
    const matches = visibleCases.length;
    const branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId: 'default' } });
    return {
      stats: { orgs, outs, demands, matches },
      cases: cases.map((m) => ({
        score: m.totalScore,
        demandTitle: m.demand?.title,
        demandOrg: m.demand?.org?.name,
        supplyTitle: m.capability?.title || m.outcome?.title,
        reason: m.reason,
      })),
      product: {
        name: branding?.productName || '研企通',
        tagline: branding?.tagline || '把实验室能力、科研成果和企业要解决的问题对上号',
        free: true,
        primaryColor: branding?.primaryColor || '#3d8bfd',
        logoUrl: branding?.logoUrl || null,
        customDomain: branding?.customDomain || null,
        domainStatus: branding?.domainStatus || 'stub',
      },
      branding,
    };
  }

  private orgMatchView(m: any) {
    const bd = (m?.scoreBreakdown || {}) as any;
    if (!visibleToOrg(bd.action)) return null;
    const teacher = m.primaryPerson || m.outcome?.person || m.capability?.person;
    const evidence = Array.isArray(bd.evidence) ? bd.evidence.map((e: any) => e.title).filter(Boolean).slice(0, 3) : [];
    return {
      id: m.id,
      totalScore: m.totalScore,
      status: m.status,
      reason: m.reason,
      demand: { title: m.demand?.title, org: { name: m.demand?.org?.name || null } },
      capability: m.capability ? { title: m.capability.title } : null,
      outcome: m.outcome ? { title: m.outcome.title } : null,
      teacherName: teacher?.name || null,
      collabModeLabel: bd.collabModeLabel || null,
      action: bd.action || null,
      actionZh: ACTION_ZH[bd.action] || null,
      sliceStageZh: STAGE_ZH[bd.sliceStage] || null,
      confidence: bd.confidence ?? null,
      evidenceTitles: evidence,
    };
  }

  private livePublicWhere(q?: string) {
    return {
      AND: [
        { publishStatus: 'published' },
        { NOT: { extensions: { path: ['quarantine'], equals: true } } },
        { NOT: { extensions: { path: ['source'], equals: 'demo_fixture' } } },
        { NOT: { extensions: { path: ['source'], equals: 'demo' } } },
        ...(q ? [{ title: { contains: q, mode: 'insensitive' as const } }] : []),
      ],
    };
  }

  private presentPublic(row: any, textKey: string) {
    const text = row.summaryPublic || row[textKey] || '';
    const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/\s+/g, ' ').trim().slice(0, 280);
    const org = row.org ? { id: row.org.id, name: row.org.name, region: row.org.region, type: row.org.type } : null;
    const keywords = (row.keywords || row.industry || row.ipcOrDisc || []).slice(0, 8);
    return {
      id: row.id,
      title: row.title,
      type: row.type || null,
      trl: row.trl ?? null,
      year: row.year || null,
      budgetBand: row.budgetBand || null,
      urgency: row.urgency || null,
      teacherName: row.person?.name || null,
      keywords,
      [textKey]: clean,
      summaryPublic: clean,
      org,
    };
  }

  private cardIsLive(card: any) {
    if (!card) return false;
    if (card.publishStatus && card.publishStatus !== 'published') return false;
    if (card.extensions?.quarantine) return false;
    if (isDemoSource(card.extensions?.source)) return false;
    return true;
  }

  publicOutcomes(q?: string) {
    return this.prisma.outcome.findMany({
      where: this.livePublicWhere(q),
      take: 40,
      orderBy: [{ personId: { sort: 'asc', nulls: 'last' } }, { year: 'desc' }, { createdAt: 'desc' }],
      include: { org: true, person: { select: { name: true } } },
    }).then((rows) => rows.map((row) => this.presentPublic(row, 'abstract')));
  }

  publicDemands(q?: string) {
    return this.prisma.demand.findMany({
      where: this.livePublicWhere(q),
      take: 40,
      orderBy: { createdAt: 'desc' },
      include: { org: true },
    }).then((rows) => rows.map((row) => this.presentPublic(row, 'problem')));
  }


  publicCapabilities(q?: string) {
    return this.prisma.capability.findMany({
      where: this.livePublicWhere(q),
      take: 40,
      orderBy: { updatedAt: 'desc' },
      include: { org: true, person: { select: { name: true } } },
    }).then((rows) => rows.map((row) => this.presentPublic(row, 'summary')));
  }

  publicMatches(q?: string) {
    return this.prisma.matchResult.findMany({
      where: {
        totalScore: { gte: 0.35 },
        status: { in: ['PENDING_REVIEW', 'APPROVED', 'CONTACTED'] },
        ...(q
          ? {
              OR: [
                { demand: { title: { contains: q, mode: 'insensitive' } } },
                { capability: { title: { contains: q, mode: 'insensitive' } } },
                { outcome: { title: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      take: 30,
      orderBy: { totalScore: 'desc' },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true, person: { select: { id: true, name: true } } } },
        outcome: { include: { org: true, person: { select: { id: true, name: true } } } },
        primaryPerson: { select: { id: true, name: true } },
      },
    }).then((rows) =>
      rows
        .filter((m) => {
          const action = (m.scoreBreakdown as any)?.action;
          if (!visibleToOrg(action)) return false;
          if (!this.cardIsLive(m.demand)) return false;
          const supply = m.capability || m.outcome;
          if (supply && !this.cardIsLive(supply)) return false;
          return true;
        })
        .map((m) => ({
        id: m.id,
        score: m.totalScore,
        status: m.status,
        reason: m.reason,
        demandTitle: m.demand?.title,
        demandOrg: m.demand?.org?.name,
        supplyTitle: m.capability?.title || m.outcome?.title,
        supplyOrg: m.capability?.org?.name || m.outcome?.org?.name,
        teacherName: m.primaryPerson?.name || m.outcome?.person?.name || m.capability?.person?.name || null,
        collabModeLabel: (m.scoreBreakdown as any)?.collabModeLabel || null,
      })),
    );
  }

    async workspace(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { org: true, memberships: { include: { org: true } } },
    });
    if (!user) throw new NotFoundException('用户不存在');
    if (!user.orgId) {
      const claimable = await this.prisma.organization.findMany({
        take: 30,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, type: true, region: true },
      });
      return {
        user: { id: user.id, email: user.email, name: user.name, role: user.role, planCode: user.planCode },
        org: null,
        capabilities: [],
        outcomes: [],
        demands: [],
        matches: [],
        supplyMatches: [],
        notifications: await this.prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        claimable,
        qualityHints: [],
      };
    }
    const [capabilities, outcomes, demands, notifications] = await Promise.all([
      this.prisma.capability.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.outcome.findMany({ where: { orgId: user.orgId }, take: 40, orderBy: { updatedAt: 'desc' } }),
      this.prisma.demand.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const demandIds = demands.map((d) => d.id);
    const matches = demandIds.length
      ? (await this.prisma.matchResult.findMany({
          where: { demandId: { in: demandIds } },
          orderBy: { totalScore: 'desc' },
          take: 40,
          include: {
            capability: { include: { person: { select: { id: true, name: true } } } },
            outcome: { include: { person: { select: { id: true, name: true } } } },
            demand: true,
            primaryPerson: { select: { id: true, name: true } },
            feedbacks: { take: 3, orderBy: { createdAt: 'desc' } },
          },
        })).map((m) => this.orgMatchView(m)).filter(Boolean).slice(0, 20)
      : [];
    const capIds = capabilities.map((c) => c.id);
    const outIds = outcomes.map((o) => o.id);
    const supplyMatches = (capIds.length || outIds.length)
      ? (await this.prisma.matchResult.findMany({
          where: {
            OR: [
              capIds.length ? { capabilityId: { in: capIds } } : undefined,
              outIds.length ? { outcomeId: { in: outIds } } : undefined,
            ].filter(Boolean) as any,
          },
          orderBy: { totalScore: 'desc' },
          take: 40,
          include: {
            demand: { include: { org: true } },
            capability: { include: { person: { select: { id: true, name: true } } } },
            outcome: { include: { person: { select: { id: true, name: true } } } },
            primaryPerson: { select: { id: true, name: true } },
            feedbacks: { take: 2 },
          },
        })).map((m) => this.orgMatchView(m)).filter(Boolean).slice(0, 20)
      : [];

    const qualityHints: string[] = [];
    if (!user.org?.summary) qualityHints.push('组织简介为空，建议补上几句主营/研究方向。');
    if (!demands.length && user.org?.type === 'ENTERPRISE') qualityHints.push('还没有需求卡，企业侧建议至少发一条真实需求。');
    if (!capabilities.length && !outcomes.length && user.org?.type !== 'ENTERPRISE') {
      qualityHints.push('还没有能力/成果卡，高校侧建议补一条可对外服务的能力。');
    }

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role, planCode: user.planCode, orgId: user.orgId },
      org: user.org,
      memberships: user.memberships,
      capabilities,
      outcomes,
      demands,
      matches,
      supplyMatches,
      notifications,
      qualityHints,
      unreadNotifications: notifications.filter((n) => !n.readAt).length,
    };
  }

  private async requireOrgUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('请先登录');
    if (!user.orgId) throw new BadRequestException('请先认领或创建组织，再维护卡片');
    return user;
  }

  private async assertCardQuota(userId: string) {
    const plan = await this.quota.planForUser(userId);
    const quotas = (plan?.quotas as any) || {};
    const limit = Number(quotas.cards ?? quotas.seats ?? 50);
    await this.quota.checkAndIncr(`user:${userId}`, 'cards', Math.max(limit, 5), 1);
  }

  async claimOrg(userId: string, body: { orgId?: string; orgName?: string; orgType?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('请先登录');
    if (user.orgId) throw new BadRequestException('你已绑定组织，如需换绑请联系运营');

    let orgId = body.orgId;
    if (!orgId && body.orgName) {
      const existing = await this.prisma.organization.findFirst({ where: { name: body.orgName } });
      if (existing) orgId = existing.id;
      else {
        const org = await this.prisma.organization.create({
          data: {
            name: body.orgName,
            type: (body.orgType as any) || 'ENTERPRISE',
            summary: '门户认领/新建',
            tenantId: 'default',
          },
        });
        orgId = org.id;
      }
    }
    if (!orgId) throw new BadRequestException('请提供 orgId 或 orgName');

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('组织不存在');

    await this.prisma.user.update({ where: { id: userId }, data: { orgId } });
    await this.prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: { roleInOrg: 'owner' },
      create: { userId, orgId, roleInOrg: 'owner' },
    });
    await this.notifications.create(
      userId,
      '已认领组织',
      `你已绑定「${org.name}」。可以在工作台维护能力、成果与需求卡。`,
      '/portal.html#workspace',
    );
    return { ok: true, org };
  }

  async updateMyOrg(userId: string, body: { summary?: string; region?: string; website?: string }) {
    const user = await this.requireOrgUser(userId);
    return this.prisma.organization.update({
      where: { id: user.orgId! },
      data: {
        summary: body.summary,
        region: body.region,
        website: body.website,
      },
    });
  }

  validateCapability(body: any) {
    if (!body?.title || String(body.title).trim().length < 2) throw new BadRequestException('能力标题至少 2 个字');
    if (!body?.summary || String(body.summary).trim().length < 12) {
      throw new BadRequestException('能力摘要请写清楚一点（至少 12 个字），方便对方看懂边界');
    }
    const keywords = asStringArray(body.keywords);
    if (!keywords.length) throw new BadRequestException('请至少填一个关键词（逗号分隔）');
    return {
      title: String(body.title).trim(),
      summary: String(body.summary).trim(),
      keywords,
      disciplines: asStringArray(body.disciplines),
      offerTypes: asStringArray(body.offerTypes).length ? asStringArray(body.offerTypes) : ['技术咨询'],
      teamSizeBand: body.teamSizeBand || null,
      contactPolicy: body.contactPolicy || null,
      trl: body.trl != null && body.trl !== '' ? Number(body.trl) : null,
      rights: body.rights || null,
      ipOwnership: body.ipOwnership || null,
      licenseOpenness: body.licenseOpenness || null,
      readinessBand: body.readinessBand || null,
};
  }

  validateOutcome(body: any) {
    if (!body?.title || String(body.title).trim().length < 2) throw new BadRequestException('成果标题至少 2 个字');
    if (!body?.abstract || String(body.abstract).trim().length < 12) throw new BadRequestException('成果摘要请写清楚一点（至少 12 个字）');
    const type = (body.type || 'OTHER') as OutcomeType;
    if (!Object.values(OutcomeType).includes(type)) throw new BadRequestException('成果类型不合法');
    return {
      title: String(body.title).trim(),
      type,
      abstract: String(body.abstract).trim(),
      ipcOrDisc: asStringArray(body.ipcOrDisc || body.keywords),
      trl: body.trl != null && body.trl !== '' ? Number(body.trl) : null,
      rights: body.rights || null,
      ipOwnership: body.ipOwnership || null,
      licenseOpenness: body.licenseOpenness || null,
      readinessBand: body.readinessBand || null,
      doi: body.doi || null,
      patentNo: body.patentNo || null,
};
  }

  validateDemand(body: any) {
    if (!body?.title || String(body.title).trim().length < 2) throw new BadRequestException('需求标题至少 2 个字');
    if (!body?.problem || String(body.problem).trim().length < 12) throw new BadRequestException('请把问题说清楚（至少 12 个字）');
    const industry = asStringArray(body.industry || body.keywords || body.tags);
    if (!industry.length) throw new BadRequestException('请至少填一个行业/标签，方便匹配');
    return {
      title: String(body.title).trim(),
      problem: String(body.problem).trim(),
      expectedOut: body.expectedOut ? String(body.expectedOut) : null,
      budgetBand: body.budgetBand || null,
      industry,
      urgency: body.urgency || null,
      regionPref: body.regionPref || null,
      licenseNeed: body.licenseNeed || null,
      minTrl: body.minTrl != null && body.minTrl !== '' ? Number(body.minTrl) : null,
      taxonomyCodes: asStringArray(body.taxonomyCodes),
    };
  }

  private async recordLocks(entityType: string, id: string, locks: string[], body: any) {
    for (const key of locks) {
      if (body?.[key] == null || String(body[key]).trim() === '') continue;
      const value = Array.isArray(body[key]) ? body[key].join('、') : String(body[key]);
      await this.prisma.fieldEvidence.create({
        data: {
          entityType,
          entityId: id,
          fieldKey: key,
          sourceCode: 'portal_self',
          valueText: value.slice(0, 500),
          locked: true,
        },
      });
    }
  }

  private touchedLocks(current: string[] | null | undefined, body: any, keys: string[]) {
    const next = new Set(current || []);
    for (const key of keys) {
      if (body && body[key] != null && String(body[key]).trim() !== '') next.add(key);
    }
    return [...next];
  }

  private withPublish(entity: 'demand' | 'capability' | 'outcome', fields: any) {
    const decision = publishDecision(entity, fields);
    const text = entity === 'demand' ? fields.problem : entity === 'outcome' ? fields.abstract : fields.summary;
    return {
      publishStatus: decision.status,
      publishBlockers: decision.blockers,
      summaryPublic: summaryPublic(text || ''),
      embeddingModel: 'hash',
      reviewedAt: new Date(),
      sourceUpdatedAt: new Date(),
      blockerZh: decision.blockers.map((code: string) => BLOCKER_ZH[code] || code),
      publishNoteZh: decision.status === 'published'
        ? '已可公开展示并参与匹配。'
        : '已保存，但还不能公开展示：' + decision.blockers.map((code: string) => BLOCKER_ZH[code] || code).join('；'),
    };
  }

  async createCapability(userId: string, body: any) {
    const user = await this.requireOrgUser(userId);
    await this.assertCardQuota(userId);
    const data = this.validateCapability(body);
    const embedding = hashEmbed([data.title, data.summary, ...data.keywords, ...data.disciplines].join(' '));
    const gate = this.withPublish('capability', { ...data, orgId: user.orgId, sourceCode: 'portal_self' });
    const row = await this.prisma.capability.create({
      data: {
        ...data,
        orgId: user.orgId!,
        embedding,
        extensions: { source: 'portal_self' },
        publishStatus: gate.publishStatus,
        publishBlockers: gate.publishBlockers,
        summaryPublic: gate.summaryPublic,
        embeddingModel: gate.embeddingModel,
        reviewedAt: gate.reviewedAt,
        sourceUpdatedAt: gate.sourceUpdatedAt,
      },
    });
    await this.notifications.create(userId, gate.publishStatus === 'published' ? '能力卡已发布' : '能力卡已保存', `「${row.title}」${gate.publishNoteZh}`, '/portal.html#workspace');
    return { ...row, blockerZh: gate.blockerZh, publishNoteZh: gate.publishNoteZh };
  }

  async updateCapability(userId: string, id: string, body: any) {
    const user = await this.requireOrgUser(userId);
    const cur = await this.prisma.capability.findUnique({ where: { id } });
    if (!cur || cur.orgId !== user.orgId) throw new ForbiddenException('只能改本组织的能力卡');
    const data = this.validateCapability({ ...cur, ...body, keywords: body.keywords ?? cur.keywords });
    const embedding = hashEmbed([data.title, data.summary, ...data.keywords, ...data.disciplines].join(' '));
    const gate = this.withPublish('capability', { ...data, orgId: user.orgId, personId: cur.personId, sourceCode: 'portal_self' });
    const lockedFields = this.touchedLocks(cur.lockedFields, body, ['title', 'summary', 'keywords', 'disciplines', 'trl', 'rights', 'ipOwnership', 'licenseOpenness', 'readinessBand']);
    const row = await this.prisma.capability.update({
      where: { id },
      data: {
        ...data,
        lockedFields,
        embedding,
        publishStatus: gate.publishStatus,
        publishBlockers: gate.publishBlockers,
        summaryPublic: gate.summaryPublic,
        embeddingModel: gate.embeddingModel,
        reviewedAt: gate.reviewedAt,
        sourceUpdatedAt: gate.sourceUpdatedAt,
      },
    });
    await this.recordLocks('Capability', row.id, lockedFields, body);
    return row;
  }

  async removeCapability(userId: string, id: string) {
    const user = await this.requireOrgUser(userId);
    const cur = await this.prisma.capability.findUnique({ where: { id } });
    if (!cur || cur.orgId !== user.orgId) throw new ForbiddenException('只能删本组织的能力卡');
    return this.prisma.capability.delete({ where: { id } });
  }

  async createOutcome(userId: string, body: any) {
    const user = await this.requireOrgUser(userId);
    await this.assertCardQuota(userId);
    const data = this.validateOutcome(body);
    const dup = await this.prisma.outcome.findFirst({
      where: { orgId: user.orgId!, title: data.title },
    });
    if (dup) throw new BadRequestException('本组织已有同名成果，请换个标题或去编辑原卡');
    const embedding = hashEmbed([data.title, data.abstract, ...(data.ipcOrDisc || [])].join(' '));
    const gate = this.withPublish('outcome', { ...data, orgId: user.orgId, sourceCode: 'portal_self' });
    const row = await this.prisma.outcome.create({
      data: {
        ...data,
        orgId: user.orgId!,
        embedding,
        extensions: { source: 'portal_self' },
        publishStatus: gate.publishStatus,
        publishBlockers: gate.publishBlockers,
        summaryPublic: gate.summaryPublic,
        embeddingModel: gate.embeddingModel,
        reviewedAt: gate.reviewedAt,
        sourceUpdatedAt: gate.sourceUpdatedAt,
      },
    });
    await this.notifications.create(userId, gate.publishStatus === 'published' ? '成果卡已发布' : '成果卡已保存', `「${row.title}」${gate.publishNoteZh}`, '/portal.html#workspace');
    return { ...row, blockerZh: gate.blockerZh, publishNoteZh: gate.publishNoteZh };
  }

  async updateOutcome(userId: string, id: string, body: any) {
    const user = await this.requireOrgUser(userId);
    const cur = await this.prisma.outcome.findUnique({ where: { id } });
    if (!cur || cur.orgId !== user.orgId) throw new ForbiddenException('只能改本组织的成果卡');
    const data = this.validateOutcome({ ...cur, ...body });
    const embedding = hashEmbed([data.title, data.abstract, ...(data.ipcOrDisc || [])].join(' '));
    const gate = this.withPublish('outcome', { ...data, orgId: user.orgId, personId: cur.personId, doi: data.doi, patentNo: data.patentNo, sourceCode: 'portal_self' });
    const lockedFields = this.touchedLocks(cur.lockedFields, body, ['title', 'abstract', 'ipcOrDisc', 'keywords', 'trl', 'rights', 'doi', 'patentNo']);
    const row = await this.prisma.outcome.update({
      where: { id },
      data: {
        ...data,
        lockedFields,
        embedding,
        publishStatus: gate.publishStatus,
        publishBlockers: gate.publishBlockers,
        summaryPublic: gate.summaryPublic,
        embeddingModel: gate.embeddingModel,
        reviewedAt: gate.reviewedAt,
        sourceUpdatedAt: gate.sourceUpdatedAt,
      },
    });
    await this.recordLocks('Outcome', row.id, lockedFields, body);
    return row;
  }

  async removeOutcome(userId: string, id: string) {
    const user = await this.requireOrgUser(userId);
    const cur = await this.prisma.outcome.findUnique({ where: { id } });
    if (!cur || cur.orgId !== user.orgId) throw new ForbiddenException('只能删本组织的成果卡');
    return this.prisma.outcome.delete({ where: { id } });
  }

  async createDemand(userId: string, body: any) {
    const user = await this.requireOrgUser(userId);
    await this.assertCardQuota(userId);
    const data = this.validateDemand(body);
    const dup = await this.prisma.demand.findFirst({ where: { orgId: user.orgId!, title: data.title } });
    if (dup) throw new BadRequestException('本组织已有同名需求');
    const embedding = hashEmbed([data.title, data.problem, data.expectedOut, ...(data.industry || [])].join(' '));
    const demandKind = inferDemandKind(body.demandKind, `${data.title} ${data.problem}`);
    const gate = this.withPublish('demand', { ...data, orgId: user.orgId, demandKind, sourceCode: 'portal_self' });
    const row = await this.prisma.demand.create({
      data: {
        ...data,
        orgId: user.orgId!,
        demandKind,
        embedding,
        extensions: { source: 'portal_self' },
        publishStatus: gate.publishStatus,
        publishBlockers: gate.publishBlockers,
        summaryPublic: gate.summaryPublic,
        embeddingModel: gate.embeddingModel,
        reviewedAt: gate.reviewedAt,
        sourceUpdatedAt: gate.sourceUpdatedAt,
      },
    });
    await this.notifications.create(
      userId,
      gate.publishStatus === 'published' ? '需求卡已发布' : '需求卡已保存',
      `「${row.title}」${gate.publishNoteZh}`,
      '/portal.html#workspace',
    );
    // 通知运营
    const ops = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OPERATOR'] }, active: true },
      take: 10,
    });
    for (const op of ops) {
      await this.notifications.create(
        op.id,
        '有机构新发了需求',
        `${user.name}（${user.email}）发布了需求「${row.title}」，建议尽快跑匹配。`,
        '/',
      );
    }
    return { ...row, blockerZh: gate.blockerZh, publishNoteZh: gate.publishNoteZh };
  }

  async updateDemand(userId: string, id: string, body: any) {
    const user = await this.requireOrgUser(userId);
    const cur = await this.prisma.demand.findUnique({ where: { id } });
    if (!cur || cur.orgId !== user.orgId) throw new ForbiddenException('只能改本组织的需求卡');
    const data = this.validateDemand({ ...cur, ...body });
    const embedding = hashEmbed([data.title, data.problem, data.expectedOut, ...(data.industry || [])].join(' '));
    const demandKind = inferDemandKind(body.demandKind || cur.demandKind, `${data.title} ${data.problem}`);
    const gate = this.withPublish('demand', { ...data, orgId: user.orgId, demandKind, sourceCode: 'portal_self' });
    const lockedFields = this.touchedLocks(cur.lockedFields, body, ['title', 'problem', 'industry', 'keywords', 'expectedOut', 'budgetBand']);
    const row = await this.prisma.demand.update({
      where: { id },
      data: {
        ...data,
        demandKind,
        lockedFields,
        embedding,
        publishStatus: gate.publishStatus,
        publishBlockers: gate.publishBlockers,
        summaryPublic: gate.summaryPublic,
        embeddingModel: gate.embeddingModel,
        reviewedAt: gate.reviewedAt,
        sourceUpdatedAt: gate.sourceUpdatedAt,
      },
    });
    await this.recordLocks('Demand', row.id, lockedFields, body);
    return row;
  }

  async removeDemand(userId: string, id: string) {
    const user = await this.requireOrgUser(userId);
    const cur = await this.prisma.demand.findUnique({ where: { id } });
    if (!cur || cur.orgId !== user.orgId) throw new ForbiddenException('只能删本组织的需求卡');
    return this.prisma.demand.delete({ where: { id } });
  }

  /** 机构侧匹配状态时间线：状态变更 + 跟进事件 + 线索触达 */
  async matchTimeline(userId: string, matchId: string) {
    const user = await this.requireOrgUser(userId);
    const match = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true } },
        outcome: { include: { org: true } },
        broker: { select: { id: true, name: true, email: true } },
        leads: { include: { person: true }, orderBy: { updatedAt: 'desc' } },
        followUps: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!match) throw new NotFoundException('匹配不存在');
    const orgIds = new Set(
      [match.demand?.orgId, match.capability?.orgId, match.outcome?.orgId].filter(Boolean) as string[],
    );
    if (!user.orgId || !orgIds.has(user.orgId)) {
      throw new ForbiddenException('只能查看与本组织相关的对接时间线');
    }
    const statusLabel: Record<string, string> = {
      PENDING_REVIEW: '待运营复核',
      APPROVED: '已通过',
      REJECTED: '已驳回',
      CONTACTED: '已触达',
      CLOSED: '已关闭',
    };
    const followLabel: Record<string, string> = {
      assigned: '已分派经纪人',
      contacting: '联系中',
      interested: '有意向',
      closed_won: '已成交',
      closed_lost: '已流失',
    };
    const events: Array<{ at: string; title: string; detail?: string; tone?: string }> = [];
    events.push({
      at: match.createdAt.toISOString(),
      title: '生成匹配',
      detail: `得分 ${Math.round(match.totalScore * 100)} · ${match.reason || ''}`.slice(0, 200),
      tone: 'info',
    });
    if (match.assignedAt) {
      events.push({
        at: match.assignedAt.toISOString(),
        title: '分派经纪人',
        detail: match.broker?.name || match.brokerId || '',
        tone: 'info',
      });
    }
    for (const f of match.followUps || []) {
      events.push({
        at: f.createdAt.toISOString(),
        title: followLabel[f.toStatus] || f.toStatus || '跟进',
        detail: f.note || `${f.fromStatus || '—'} → ${f.toStatus || '—'}`,
        tone: 'success',
      });
    }
    for (const lead of match.leads || []) {
      if (lead.approvedAt) {
        events.push({
          at: lead.approvedAt.toISOString(),
          title: '线索已审核',
          detail: lead.draftSubject || '',
          tone: 'info',
        });
      }
      if (lead.sentAt) {
        events.push({
          at: lead.sentAt.toISOString(),
          title: lead.status === 'dry_run' ? '干跑发送（未真发）' : '已发送触达',
          detail: `${lead.status}${lead.sendMode ? ' · ' + lead.sendMode : ''}`,
          tone: lead.status === 'failed' ? 'danger' : 'success',
        });
      }
      if (lead.failReason) {
        events.push({
          at: lead.updatedAt.toISOString(),
          title: '发送失败',
          detail: lead.failReason.slice(0, 180),
          tone: 'danger',
        });
      }
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
    return {
      ok: true,
      match: {
        id: match.id,
        totalScore: match.totalScore,
        status: match.status,
        statusLabel: statusLabel[match.status] || match.status,
        followUpStatus: match.followUpStatus,
        followUpLabel: followLabel[match.followUpStatus || ''] || match.followUpStatus,
        reason: match.reason,
        demandTitle: match.demand?.title,
        supplyTitle: match.capability?.title || match.outcome?.title,
        brokerName: match.broker?.name || null,
      },
      events,
    };
  }
  private statusMachine(): Record<string, { label: string; next: string[]; orgActions: string[] }> {
    return {
      PENDING_REVIEW: { label: '待运营复核', next: [], orgActions: [] },
      APPROVED: { label: '已通过', next: [], orgActions: ['request_contact'] },
      REJECTED: { label: '已驳回', next: [], orgActions: [] },
      CONTACTED: { label: '已触达', next: [], orgActions: ['confirm_interest', 'decline'] },
      CLOSED: { label: '已关闭', next: [], orgActions: [] },
    };
  }

  /** 机构侧「我的对接」完整列表 + 可执行动作 */
  async myDeals(userId: string) {
    const user = await this.requireOrgUser(userId);
    const orgId = user.orgId!;
    const caps = await this.prisma.capability.findMany({ where: { orgId }, select: { id: true } });
    const outs = await this.prisma.outcome.findMany({ where: { orgId }, select: { id: true } });
    const dems = await this.prisma.demand.findMany({ where: { orgId }, select: { id: true } });
    const where = {
      OR: [
        dems.length ? { demandId: { in: dems.map((d) => d.id) } } : undefined,
        caps.length ? { capabilityId: { in: caps.map((c) => c.id) } } : undefined,
        outs.length ? { outcomeId: { in: outs.map((o) => o.id) } } : undefined,
      ].filter(Boolean) as any[],
    };
    const rows = where.OR.length
      ? await this.prisma.matchResult.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { totalScore: 'desc' }],
          take: 80,
          include: {
            demand: { include: { org: true } },
            capability: { include: { org: true, person: { select: { id: true, name: true } } } },
            outcome: { include: { org: true, person: { select: { id: true, name: true } } } },
            primaryPerson: { select: { id: true, name: true } },
            broker: { select: { id: true, name: true } },
            leads: { take: 3, orderBy: { updatedAt: 'desc' } },
            followUps: { take: 5, orderBy: { createdAt: 'desc' } },
          },
        })
      : [];
    const machine = this.statusMachine();
    const followLabel: Record<string, string> = {
      assigned: '已分派经纪人',
      contacting: '联系中',
      interested: '有意向',
      closed_won: '已成交',
      closed_lost: '已流失',
    };
    const items = rows.filter((m) => visibleToOrg((m.scoreBreakdown as any)?.action)).map((m) => {
        const st = machine[m.status as keyof typeof machine] || { label: m.status, orgActions: [] as string[] };
        const isDemandSide = dems.some((d) => d.id === m.demandId);
        const followUpStatus = m.followUpStatus;
        let boardColumn: string = 'requested';
        if (followUpStatus === 'closed_won') boardColumn = 'closed';
        else if (followUpStatus === 'closed_lost' || m.status === 'REJECTED') boardColumn = 'declined';
        else if (m.status === 'CLOSED') boardColumn = 'closed';
        else if (followUpStatus === 'interested' || m.status === 'CONTACTED') boardColumn = 'intent';
        else if (followUpStatus === 'assigned' || followUpStatus === 'contacting' || m.status === 'APPROVED')
          boardColumn = 'progress';
        const supply = m.capability || m.outcome;
        const conflictPack = detectRightsConflicts(
          {
            licenseNeed: (m.demand as any)?.licenseNeed,
            minTrl: (m.demand as any)?.minTrl,
            expectedOut: m.demand?.expectedOut,
            problem: m.demand?.problem,
            title: m.demand?.title,
          },
          {
            licenseOpenness: (supply as any)?.licenseOpenness,
            rights: (supply as any)?.rights,
            trl: (supply as any)?.trl,
            readinessBand: (supply as any)?.readinessBand,
            title: supply?.title,
          },
        );
        const conflicts = conflictPack.conflicts || [];
        return {
          id: m.id,
          totalScore: m.totalScore,
          status: m.status,
          statusLabel: st.label,
          followUpStatus: m.followUpStatus,
          followUpLabel: followLabel[m.followUpStatus || ''] || m.followUpStatus,
          boardColumn,
          reason: m.reason,
          side: isDemandSide ? 'demand' : 'supply',
          demandTitle: m.demand?.title,
          demandOrg: m.demand?.org?.name,
          supplyTitle: m.capability?.title || m.outcome?.title,
          supplyOrg: m.capability?.org?.name || m.outcome?.org?.name,
          teacherName: m.primaryPerson?.name || m.outcome?.person?.name || m.capability?.person?.name || null,
          collabModeLabel: (m.scoreBreakdown as any)?.collabModeLabel || null,
          brokerName: m.broker?.name || null,
          allowedActions: st.orgActions || [],
          updatedAt: m.updatedAt,
          conflicts,
          conflictChips: conflicts.map((c: { labelZh: string; tipZh: string; tone: string }) => ({ label: c.labelZh, tip: c.tipZh, tone: c.tone })),
          recentFollowUps: (m.followUps || []).map((f) => ({
            at: f.createdAt,
            to: f.toStatus,
            note: f.note,
          })),
        };
      });
    // M19：挂合同前清单进度
    for (const it of items) {
      try {
        const cl = await this.checklists.summary(it.id);
        (it as any).checklistPct = cl.pct;
        (it as any).checklistSummaryZh = cl.summaryZh;
        (it as any).checklistWarn = cl.warnOnIntent;
        (it as any).criticalOpenCount = cl.criticalOpenCount;
      } catch (_) {
        (it as any).checklistPct = null;
      }
    }

    const boardColumns = [
      { key: 'requested', title: '待处理 / 已请求' },
      { key: 'progress', title: '推进中' },
      { key: 'intent', title: '有意向' },
      { key: 'closed', title: '已成交 / 关闭' },
      { key: 'declined', title: '已婉拒 / 流失' },
    ].map((c) => ({
      ...c,
      count: items.filter((i) => i.boardColumn === c.key).length,
      itemIds: items.filter((i) => i.boardColumn === c.key).map((i) => i.id),
    }));
    return {
      ok: true,
      orgId,
      machine,
      boardColumns,
      items,
    };
  }

  async orgDealAction(userId: string, matchId: string, action: string, note?: string, force = false) {
    const user = await this.requireOrgUser(userId);
    const deals = await this.myDeals(userId);
    const item = deals.items.find((x) => x.id === matchId);
    if (!item) throw new ForbiddenException('无权操作该对接');
    if (!(item.allowedActions || []).includes(action as any)) {
      throw new BadRequestException(`当前状态不允许动作：${action}`);
    }
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');

    if (action === 'request_contact') {
      await this.prisma.matchResult.update({
        where: { id: matchId },
        data: {
          operatorNote: note || '机构请求进一步联系',
          followUpNote: '机构请求联系',
        },
      });
      const ops = await this.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'OPERATOR'] }, active: true },
        take: 8,
      });
      for (const op of ops) {
        await this.notifications.create(
          op.id,
          '机构请求联系',
          `${user.name} 对匹配「${item.demandTitle}」请求进一步触达。`,
          '/',
        );
      }
      return { ok: true, message: '已通知运营，稍后会有人跟进' };
    }
    if (action === 'confirm_interest') {
      const gate = await this.checklists.gateIntent(matchId, force);
      if (gate.softBlock) {
        return {
          ok: false,
          warning: true,
          softBlock: true,
          message: gate.message,
          checklist: gate.checklist,
          needForce: true,
        };
      }
      await this.prisma.matchResult.update({
        where: { id: matchId },
        data: {
          followUpStatus: 'interested' as any,
          followUpNote: note || '机构确认有意向',
          followUpAt: new Date(),
          status: 'CONTACTED',
        },
      });
      await this.prisma.brokerFollowUpEvent.create({
        data: {
          matchId,
          actorEmail: user.email,
          fromStatus: match.followUpStatus || null,
          toStatus: 'interested',
          note: note || '机构确认有意向',
          meta: { source: 'portal_org' },
        },
      });
      return { ok: true, message: '已标记有意向' };
    }
    if (action === 'decline') {
      await this.prisma.matchResult.update({
        where: { id: matchId },
        data: {
          followUpStatus: 'closed_lost' as any,
          followUpNote: note || '机构婉拒',
          followUpAt: new Date(),
          status: 'CLOSED',
        },
      });
      await this.prisma.brokerFollowUpEvent.create({
        data: {
          matchId,
          actorEmail: user.email,
          fromStatus: match.followUpStatus || null,
          toStatus: 'closed_lost',
          note: note || '机构婉拒',
          meta: { source: 'portal_org' },
        },
      });
      return { ok: true, message: '已关闭该对接' };
    }
    throw new BadRequestException('未知动作');
  }


  /** 看板拖拽：机构把对接挪到目标列（带权限校验），返回 previous 便于撤销 */
  async moveDealColumn(userId: string, matchId: string, toColumn: string, note?: string, force = false) {
    const user = await this.requireOrgUser(userId);
    await this.flags.assertEnabled('board_dnd', user.tenantId || 'default', '看板拖拽已关闭。运维可在「功能开关」打开 board_dnd。');
    const deals = await this.myDeals(userId);
    const item = deals.items.find((x) => x.id === matchId);
    if (!item) throw new ForbiddenException('无权操作该对接');
    const fromColumn = item.boardColumn || 'requested';
    if (fromColumn === toColumn) {
      return { ok: true, message: '已在该列', fromColumn, toColumn, unchanged: true };
    }
    const allowed: Record<string, string[]> = {
      requested: ['progress', 'declined'],
      progress: ['intent', 'declined', 'requested', 'closed'],
      intent: ['closed', 'declined', 'progress'],
      closed: ['requested', 'intent'],
      declined: ['requested', 'progress'],
    };
    if (!(allowed[fromColumn] || []).includes(toColumn)) {
      throw new BadRequestException(`不能从「${fromColumn}」拖到「${toColumn}」，请换一条允许的路径`);
    }
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    const previous = {
      status: match.status,
      followUpStatus: match.followUpStatus,
      followUpNote: match.followUpNote,
      boardColumn: fromColumn,
    };
    const patch: any = { followUpAt: new Date(), followUpNote: note || `看板拖到 ${toColumn}` };
    if (toColumn === 'requested') {
      patch.status = 'PENDING_REVIEW';
      patch.followUpStatus = null;
    } else if (toColumn === 'progress') {
      patch.status = 'APPROVED';
      patch.followUpStatus = match.followUpStatus === 'contacting' ? 'contacting' : 'assigned';
    } else if (toColumn === 'intent') {
      const gate = await this.checklists.gateIntent(matchId, force);
      if (gate.softBlock) {
        return {
          ok: false,
          warning: true,
          softBlock: true,
          message: gate.message,
          checklist: gate.checklist,
          needForce: true,
          fromColumn,
          toColumn,
        };
      }
      patch.status = 'CONTACTED';
      patch.followUpStatus = 'interested';
    } else if (toColumn === 'closed') {
      patch.status = 'CLOSED';
      patch.followUpStatus = 'closed_won';
    } else if (toColumn === 'declined') {
      patch.status = 'CLOSED';
      patch.followUpStatus = 'closed_lost';
    } else {
      throw new BadRequestException('未知列：' + toColumn);
    }
    await this.prisma.matchResult.update({ where: { id: matchId }, data: patch });
    await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorEmail: user.email,
        fromStatus: match.followUpStatus || null,
        toStatus: patch.followUpStatus || 'requested',
        note: note || `门户看板：${fromColumn} → ${toColumn}`,
        meta: { source: 'portal_board_dnd', fromColumn, toColumn },
      },
    });
    const colLabel: Record<string, string> = {
      requested: '待处理',
      progress: '推进中',
      intent: '有意向',
      closed: '已成交/关闭',
      declined: '已婉拒',
    };
    try {
      await this.webhooks.emit(
        'deal.moved',
        {
          matchId,
          fromColumn,
          toColumn,
          actorEmail: user.email,
          note: note || null,
        },
        match.tenantId || user.tenantId || 'default',
      );
    } catch (_) {}
    if (toColumn === 'intent' || toColumn === 'declined') {
      try {
        const lead = await this.prisma.lead.findFirst({
          where: { matchId, playbookId: { not: null } },
          orderBy: { updatedAt: 'desc' },
        });
        await this.prisma.playbookFunnelEvent.create({
          data: {
            playbookId: lead?.playbookId || null,
            playbookCode: lead?.playbookCode || null,
            leadId: lead?.id || null,
            matchId,
            stage: toColumn === 'intent' ? 'intent' : 'declined',
            actor: user.email,
            note: note || `看板挪到 ${toColumn}`,
          },
        });
      } catch (_) {}
    }
    return {
      ok: true,
      message: `已挪到「${colLabel[toColumn] || toColumn}」`,
      fromColumn,
      toColumn,
      previous,
      undo: { matchId, toColumn: fromColumn },
    };
  }

  async myUsage(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('请先登录');
    const snap = await this.quota.meteringSnapshot({
      userId,
      tenantId: user.tenantId || 'default',
    });
    const flagPack = await this.flags.listResolved(user.tenantId || 'default');
    return { ...snap, flags: flagPack.flags };
  }



  async dealChecklist(userId: string, matchId: string) {
    const deals = await this.myDeals(userId);
    if (!deals.items.find((x) => x.id === matchId)) throw new ForbiddenException('无权查看该对接清单');
    return this.checklists.summary(matchId);
  }

  async toggleDealChecklist(
    userId: string,
    matchId: string,
    code: string,
    body: { done?: boolean; note?: string },
  ) {
    const user = await this.requireOrgUser(userId);
    const deals = await this.myDeals(userId);
    if (!deals.items.find((x) => x.id === matchId)) throw new ForbiddenException('无权改该对接清单');
    return this.checklists.setItem(matchId, code, {
      done: body.done,
      note: body.note,
      actor: user.email || userId,
    });
  }


  /** 一句话发需求：解析草稿（不入库） */
  parseOneLineDemand(text: string) {
    return this.flywheel.parseDemandPaste(text);
  }

  /** 确认后直接发布到本组织；太薄且未强制时只返回提示 */
  async publishOneLineDemand(userId: string, text: string, opts: { force?: boolean } = {}) {
    const parsed = this.flywheel.parseDemandPaste(text);
    if (!parsed.draft) return parsed;
    if ((parsed as any).thin && !opts.force && !(parsed as any).ok) {
      return {
        ok: false,
        thin: true,
        hints: (parsed as any).hints || [],
        message: (parsed as any).message || '信息有点薄，按提示补两句，或确认仍要发布',
        draft: parsed.draft,
        canForce: true,
      };
    }
    const d = parsed.draft;
    const industry = (d.industry && d.industry.length) ? d.industry : ['先进制造'];
    // 一句话路径：问题可能偏短，补足到校验下限
    let problem = String(d.problem || '');
    if (problem.length < 12) problem = problem + '（机构一句话补充：详见标题与标签）';
    const row = await this.createDemand(userId, {
      title: d.title,
      problem,
      expectedOut: d.expectedOut,
      budgetBand: d.budgetBand,
      industry,
      taxonomyCodes: d.taxonomyCodes || [],
      licenseNeed: d.licenseNeed,
      minTrl: d.minTrl,
      urgency: d.urgency || '中',
      regionPref: d.regionPref,
    });
    return { ok: true, demand: row, draft: d, noteZh: row.publishNoteZh || '已保存到本组织。' };
  }

}
