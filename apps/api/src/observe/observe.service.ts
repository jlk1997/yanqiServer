import { ForbiddenException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

const liveWhere = {
  publishStatus: 'published' as const,
  NOT: [
    { extensions: { path: ['quarantine'], equals: true } },
    { extensions: { path: ['source'], equals: 'demo' } },
    { extensions: { path: ['source'], equals: 'demo_fixture' } },
  ],
};

function cardLive(card: { publishStatus?: string | null; extensions?: any } | null | undefined) {
  if (!card) return false;
  if (card.publishStatus && card.publishStatus !== 'published') return false;
  const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  return !ext.quarantine && !shared.isDemoSource(ext.source);
}

type ParkPolicy = {
  id: string;
  tag: string;
  title: string;
  blurb: string;
  bodyZh?: string;
  sourceHint?: string;
  updatedAt?: string;
};

type ParkPack = {
  version: number;
  updatedAt?: string;
  hero?: { titleZh?: string; leadZh?: string };
  trustCues?: string[];
  regionHeat?: Array<{ region: string; supply: number; demand: number; matches: number; noteZh?: string }>;
  policies: ParkPolicy[];
  caseSeeds?: Array<{
    title: string;
    outcome?: string;
    summaryZh: string;
    detailZh?: string;
    demandAlias?: string;
    supplyAlias?: string;
    industryHint?: string;
    trlBand?: string;
  }>;
  briefTips?: string[];
};

@Injectable()
export class ObserveService {
  private dataPath = join(process.cwd(), '.data', 'park-observe.json');
  private fixturePath = join(process.cwd(), 'fixtures', 'park-observe.json');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private readRaw(): ParkPack {
    const prefer = existsSync(this.dataPath) ? this.dataPath : this.fixturePath;
    try {
      const raw = JSON.parse(readFileSync(prefer, 'utf8'));
      if (!raw.policies) raw.policies = [];
      return raw as ParkPack;
    } catch {
      return {
        version: 1,
        policies: [],
        regionHeat: [],
        trustCues: ['只读观察'],
        hero: { titleZh: '园区观察台', leadZh: '汇总与案例' },
        briefTips: [],
      };
    }
  }

  private writeRaw(pack: ParkPack) {
    const dir = join(process.cwd(), '.data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    pack.updatedAt = new Date().toISOString();
    writeFileSync(this.dataPath, JSON.stringify(pack, null, 2), 'utf8');
  }

  /** 确保演示案例已发布（按标题幂等补齐） */
  async ensureCaseSeeds() {
    const pack = this.readRaw();
    if (!pack.caseSeeds?.length) {
      const published = await this.prisma.caseStudy.count({ where: { status: 'published' } });
      return { seeded: 0, published };
    }
    let n = 0;
    for (const c of pack.caseSeeds) {
      const exists = await this.prisma.caseStudy.findFirst({
        where: { title: c.title, status: 'published' },
      });
      if (exists) continue;
      await this.prisma.caseStudy.create({
        data: {
          title: shared.publicCaseText(c.title),
          outcome: c.outcome || 'success',
          summaryZh: shared.publicCaseText(c.summaryZh),
          detailZh: c.detailZh ? shared.publicCaseText(c.detailZh) : null,
          demandAlias: c.demandAlias || null,
          supplyAlias: c.supplyAlias || null,
          industryHint: c.industryHint || null,
          trlBand: c.trlBand || null,
          status: 'published',
          publishedAt: new Date(),
          approvedBy: 'seed-park-m29',
          createdBy: 'observe-seed',
          meta: { source: 'park-observe-fixture' },
        },
      });
      n++;
    }
    const published = await this.prisma.caseStudy.count({ where: { status: 'published' } });
    return { seeded: n, published };
  }

  async getParkBoard() {
    await this.ensureCaseSeeds().catch(() => ({ seeded: 0 }));
    const pack = this.readRaw();
    const [orgs, outs, demands, caps, publishedCases, rawMatches] = await Promise.all([
      this.prisma.organization.count({ where: liveWhere }),
      this.prisma.outcome.count({ where: liveWhere }),
      this.prisma.demand.count({ where: liveWhere }),
      this.prisma.capability.count({ where: liveWhere }),
      this.prisma.caseStudy.findMany({
        where: { status: 'published' },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.matchResult.findMany({
        where: { totalScore: { gte: 0.45 }, status: { in: ['PENDING_REVIEW', 'APPROVED', 'CONTACTED', 'CLOSED'] } },
        orderBy: { totalScore: 'desc' },
        include: { demand: { include: { org: true } }, capability: { include: { org: true } }, outcome: { include: { org: true } } },
      }),
    ]);
    const visibleMatches = rawMatches.filter(
      (m) => shared.visibleToOrg((m.scoreBreakdown as any)?.action) && cardLive(m.demand) && cardLive(m.capability || m.outcome),
    );
    const matches = visibleMatches.length;
    const cases =
      publishedCases.length > 0
        ? publishedCases.map((c) => ({
            id: c.id,
            title: shared.publicCaseText(c.title),
            blurb: shared.publicCaseText(c.summaryZh || c.detailZh || ''),
            detailZh: shared.publicCaseText(c.detailZh || ''),
            outcome: c.outcome,
            demandAlias: c.demandAlias,
            supplyAlias: c.supplyAlias,
            industryHint: c.industryHint,
            trlBand: c.trlBand,
            score: null as number | null,
          }))
        : visibleMatches.slice(0, 6).map((m) => ({
            id: m.id,
            title: '一条可以对外讲述的对接',
            blurb: '机构真名、老师姓名和联系方式不出现在观察台。',
            detailZh: '观察台只保留已经发布、并且可以对外的对接。',
            outcome: 'success',
            demandAlias: '某需求方',
            supplyAlias: '某供给方',
            industryHint: null as string | null,
            trlBand: null as string | null,
            score: null as number | null,
          }));

    return {
      ok: true,
      wave: 'M32-moderation-share-hall',
      hero: pack.hero || { titleZh: '园区观察台', leadZh: '' },
      trustCues: pack.trustCues || ['只读观察'],
      stats: { orgs, outcomes: outs, capabilities: caps, demands, matches },
      regionHeat: pack.regionHeat || [],
      policies: pack.policies || [],
      cases,
      briefTips: pack.briefTips || [],
      editable: true,
      source: existsSync(this.dataPath) ? 'runtime' : 'fixture',
      updatedAt: pack.updatedAt || null,
    };
  }

  async savePolicies(body: { policies?: ParkPolicy[]; hero?: any; regionHeat?: any; briefTips?: string[]; trustCues?: string[] }, actor?: string) {
    const pack = this.readRaw();
    if (Array.isArray(body.policies)) pack.policies = body.policies;
    if (body.hero) pack.hero = { ...pack.hero, ...body.hero };
    if (Array.isArray(body.regionHeat)) pack.regionHeat = body.regionHeat;
    if (Array.isArray(body.briefTips)) pack.briefTips = body.briefTips;
    if (Array.isArray(body.trustCues)) pack.trustCues = body.trustCues;
    this.writeRaw(pack);
    await this.audit.log({
      action: 'observe.park.save',
      actor: actor || 'ops',
      targetType: 'ParkObserve',
      targetId: 'default',
      meta: { policyN: pack.policies.length },
    });
    return { ok: true, message: '园区观察内容已保存', updatedAt: pack.updatedAt, policies: pack.policies.length };
  }

  assertOps(req: any) {
    const role = req?.user?.role;
    if (role === 'ORG_USER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可改园区观察内容');
    }
    if (!req?.user && !req?.authMeta?.hasKey) {
      throw new ForbiddenException('需要登录或 API Key');
    }
  }
}
