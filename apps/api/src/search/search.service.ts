import { Injectable } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async unified(q: string, types?: string[], take = 8, publishedOnly = false) {
    const query = (q || '').trim();
    if (query.length < 1) return { ok: true, q: query, items: [], noteZh: '输入关键词开始搜' };
    const want = new Set((types || []).filter(Boolean));
    const all = !want.size;
    const items: Array<{ type: string; id: string; title: string; subtitle?: string; scoreHint?: string; href?: string }> = [];

    const like = { contains: query, mode: 'insensitive' as const };
    const pub = publishedOnly
      ? {
          publishStatus: 'published' as const,
          NOT: [
            { extensions: { path: ['quarantine'], equals: true } },
            { extensions: { path: ['source'], equals: 'demo' } },
            { extensions: { path: ['source'], equals: 'demo_fixture' } },
          ],
        }
      : {};

    if (all || want.has('org')) {
      const rows = await this.prisma.organization.findMany({
        where: { ...pub, OR: [{ name: like }, { summary: like }, { region: like }] },
        take,
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of rows) {
        items.push({ type: 'org', id: r.id, title: r.name, subtitle: `${r.type} · ${r.region || '地域未填'}`, href: '/#orgs' });
      }
    }
    if (all || want.has('demand')) {
      const rows = await this.prisma.demand.findMany({
        where: { ...pub, OR: [{ title: like }, { problem: like }] },
        take,
        include: { org: true },
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of rows) {
        items.push({ type: 'demand', id: r.id, title: r.title, subtitle: this.stateSubtitle(r.publishStatus, r.org?.name), href: '/#match' });
      }
    }
    if (all || want.has('capability')) {
      const rows = await this.prisma.capability.findMany({
        where: { ...pub, OR: [{ title: like }, { summary: like }] },
        take,
        include: { org: true },
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of rows) {
        items.push({ type: 'capability', id: r.id, title: r.title, subtitle: this.stateSubtitle(r.publishStatus, r.org?.name), href: '/#orgs' });
      }
    }
    if (all || want.has('outcome')) {
      const rows = await this.prisma.outcome.findMany({
        where: { ...pub, OR: [{ title: like }, { abstract: like }] },
        take,
        include: { org: true },
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of rows) {
        items.push({ type: 'outcome', id: r.id, title: r.title, subtitle: this.stateSubtitle(r.publishStatus, r.org?.name), href: '/#orgs' });
      }
    }
    if (all || want.has('match')) {
      const rows = await this.prisma.matchResult.findMany({
        where: {
          OR: [{ reason: like }, { demand: { title: like } }, { capability: { title: like } }, { outcome: { title: like } }],
        },
        take,
        include: { demand: true, capability: true, outcome: true },
        orderBy: { totalScore: 'desc' },
      });
      const visibleRows = publishedOnly
        ? rows.filter((r) => shared.visibleToOrg((r.scoreBreakdown as any)?.action) && this.cardLive(r.demand) && this.cardLive(r.capability || r.outcome))
        : rows;
      for (const r of visibleRows) {
        const supply = r.capability?.title || r.outcome?.title || '-';
        items.push({
          type: 'match',
          id: r.id,
          title: `${r.demand?.title || ''} → ${supply}`,
          subtitle: `${this.matchState((r.scoreBreakdown as any)?.action)}${Math.round((r.totalScore || 0) * 100)}分 · ${r.status}`,
          scoreHint: String(r.totalScore),
          href: '/#match',
        });
      }
    }
    if ((all || want.has('lead')) && !publishedOnly) {
      const rows = await this.prisma.lead.findMany({
        where: { OR: [{ draftSubject: like }, { draftBody: like }, { status: like }] },
        take,
        include: { person: true, match: { include: { demand: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of rows) {
        items.push({
          type: 'lead',
          id: r.id,
          title: r.draftSubject || '无主题线索',
          subtitle: `${r.status} · ${r.person?.email || r.person?.name || '无联系人'} · ${r.match?.demand?.title || ''}`,
          href: '/#leads',
        });
      }
    }

    return {
      ok: true,
      q: query,
      count: items.length,
      items,
      types: ['org', 'demand', 'capability', 'outcome', 'match', 'lead'],
      noteZh: '统一搜索：组织 / 需求 / 能力 / 成果 / 匹配 / 线索。运维台按 / 打开。',
    };
  }

  private cardLive(card: { publishStatus?: string | null; extensions?: any } | null | undefined) {
    if (!card) return false;
    if (card.publishStatus && card.publishStatus !== 'published') return false;
    const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
    if (ext.quarantine || shared.isDemoSource(ext.source)) return false;
    return true;
  }

  private stateSubtitle(status: string | null | undefined, orgName?: string | null) {
    const prefix = status && status !== 'published' ? '未发布 · ' : '';
    return `${prefix}${orgName || ''}`.trim();
  }

  private matchState(action?: string | null) {
    if (action === 'SHADOW') return '影子 · ';
    if (action === 'HOLD') return '搁置 · ';
    if (action === 'REVIEW') return '可复核 · ';
    if (action === 'FIND_PEOPLE') return '可找人 · ';
    return '';
  }

  async byTaxonomy(code: string, take = 20) {
    if (!code) return { ok: true, code: '', items: [] };
    const likeCodes = [code];
    let kids: { code: string }[] = [];
    try { kids = await this.prisma.taxonomyTag.findMany({ where: { parentCode: code, active: true } }); } catch { kids = []; }
    likeCodes.push(...kids.map((k: any) => k.code));
    const items: Array<{ type: string; id: string; title: string; subtitle?: string }> = [];
    const live = {
      publishStatus: 'published' as const,
      NOT: [
        { extensions: { path: ['quarantine'], equals: true } },
        { extensions: { path: ['source'], equals: 'demo' } },
        { extensions: { path: ['source'], equals: 'demo_fixture' } },
      ],
    };
    const caps = await this.prisma.capability.findMany({
      where: { ...live, taxonomyCodes: { hasSome: likeCodes } },
      take,
      include: { org: true },
    });
    for (const r of caps) items.push({ type: 'capability', id: r.id, title: r.title, subtitle: r.org?.name });
    const outs = await this.prisma.outcome.findMany({
      where: { ...live, taxonomyCodes: { hasSome: likeCodes } },
      take,
      include: { org: true },
    });
    for (const r of outs) items.push({ type: 'outcome', id: r.id, title: r.title, subtitle: r.org?.name });
    const dems = await this.prisma.demand.findMany({
      where: { ...live, taxonomyCodes: { hasSome: likeCodes } },
      take,
      include: { org: true },
    });
    for (const r of dems) items.push({ type: 'demand', id: r.id, title: r.title, subtitle: r.org?.name });
    return { ok: true, code, expanded: likeCodes, items };
  }

}
