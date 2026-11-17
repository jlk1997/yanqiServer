import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

export const BADGE_LABELS: Record<string, string> = {
  verified_import: '授权导入核验',
  peer_reviewed: '同行/专家复核',
  complete_profile: '档案较完整',
  duplicate_clean: '已去重清洗',
  ops_endorsed: '运营背书',
};

export const BADGE_KEYS = Object.keys(BADGE_LABELS);

@Injectable()
export class QualityBadgesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  labels() {
    return { ok: true, badges: BADGE_KEYS.map((k) => ({ key: k, labelZh: BADGE_LABELS[k] })) };
  }

  /** 档案完整度 0–1（自动） */
  completeness(kind: string, row: any): number {
    let score = 0;
    let n = 0;
    const add = (ok: boolean, w = 1) => {
      n += w;
      if (ok) score += w;
    };
    if (kind === 'org') {
      add(Boolean(row.name));
      add(Boolean(row.summary && String(row.summary).length > 20), 1.2);
      add(Boolean(row.region));
      add(Boolean(row.website));
      add(Boolean(row.creditCode));
      add((row.trustBadges || []).length > 0, 0.8);
    } else if (kind === 'capability') {
      add(Boolean(row.title));
      add(Boolean(row.summary && String(row.summary).length > 20), 1.2);
      add((row.keywords || []).length >= 2);
      add((row.disciplines || []).length >= 1);
      add(row.trl != null);
      add(Boolean(row.ipOwnership || row.rights || row.licenseOpenness));
      add(Boolean(row.readinessBand));
    } else if (kind === 'outcome') {
      add(Boolean(row.title));
      add(Boolean(row.abstract && String(row.abstract).length > 30), 1.2);
      add((row.ipcOrDisc || []).length >= 1);
      add(row.trl != null);
      add(Boolean(row.rights || row.ipOwnership || row.licenseOpenness));
      add(Boolean(row.doi || row.patentNo));
      add(Boolean(row.readinessBand));
    }
    return n ? Math.round((score / n) * 1000) / 1000 : 0;
  }

  async forTarget(kind: string, id: string) {
    const k = kind.toLowerCase();
    let row: any;
    if (k === 'org' || k === 'organization') {
      row = await this.prisma.organization.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('组织不存在');
      const auto = this.completeness('org', row);
      return {
        ok: true,
        kind: 'Organization',
        id,
        name: row.name,
        trustBadges: row.trustBadges || [],
        badgeLabels: (row.trustBadges || []).map((b: string) => BADGE_LABELS[b] || b),
        qualityScore: row.qualityScore ?? auto,
        autoCompleteness: auto,
      };
    }
    if (k === 'capability') {
      row = await this.prisma.capability.findUnique({ where: { id }, include: { org: true } });
      if (!row) throw new NotFoundException('能力卡不存在');
      const auto = this.completeness('capability', row);
      return {
        ok: true,
        kind: 'Capability',
        id,
        title: row.title,
        org: row.org?.name,
        orgBadges: row.org?.trustBadges || [],
        trustBadges: row.trustBadges || [],
        badgeLabels: (row.trustBadges || []).map((b: string) => BADGE_LABELS[b] || b),
        trl: row.trl,
        rights: row.rights,
        ipOwnership: row.ipOwnership,
        licenseOpenness: row.licenseOpenness,
        readinessBand: row.readinessBand,
        qualityScore: auto,
        autoCompleteness: auto,
      };
    }
    if (k === 'outcome') {
      row = await this.prisma.outcome.findUnique({ where: { id }, include: { org: true } });
      if (!row) throw new NotFoundException('成果卡不存在');
      const auto = this.completeness('outcome', row);
      return {
        ok: true,
        kind: 'Outcome',
        id,
        title: row.title,
        org: row.org?.name,
        orgBadges: row.org?.trustBadges || [],
        trustBadges: row.trustBadges || [],
        badgeLabels: (row.trustBadges || []).map((b: string) => BADGE_LABELS[b] || b),
        trl: row.trl,
        rights: row.rights,
        ipOwnership: row.ipOwnership,
        licenseOpenness: row.licenseOpenness,
        readinessBand: row.readinessBand,
        qualityScore: auto,
        autoCompleteness: auto,
      };
    }
    throw new BadRequestException('kind 仅支持 org|capability|outcome');
  }

  async setBadges(
    kind: string,
    id: string,
    badges: string[],
    actor = 'ops',
    qualityScore?: number | null,
  ) {
    const clean = [...new Set((badges || []).filter((b) => BADGE_KEYS.includes(b)))];
    const k = kind.toLowerCase();
    let targetType = '';
    let row: any;
    if (k === 'org' || k === 'organization') {
      targetType = 'Organization';
      const auto = this.completeness('org', await this.prisma.organization.findUniqueOrThrow({ where: { id } }));
      row = await this.prisma.organization.update({
        where: { id },
        data: {
          trustBadges: clean,
          qualityScore: qualityScore != null ? qualityScore : auto,
        },
      });
    } else if (k === 'capability') {
      targetType = 'Capability';
      row = await this.prisma.capability.update({
        where: { id },
        data: { trustBadges: clean },
      });
    } else if (k === 'outcome') {
      targetType = 'Outcome';
      row = await this.prisma.outcome.update({
        where: { id },
        data: { trustBadges: clean },
      });
    } else {
      throw new BadRequestException('kind 不支持');
    }
    await this.audit.log({
      action: 'trust_badge.set',
      actor,
      targetType,
      targetId: id,
      meta: { badges: clean, qualityScore: qualityScore ?? null },
    });
    return { ok: true, kind: targetType, id, trustBadges: clean, row };
  }

  async clearBadges(kind: string, id: string, actor = 'ops') {
    return this.setBadges(kind, id, [], actor, null);
  }

  /** 匹配卡片用的聚合信任信号 */
  async signalsForMatch(match: any) {
    const org = match.capability?.org || match.outcome?.org;
    const supply = match.capability || match.outcome;
    const orgBadges = org?.trustBadges || [];
    const supplyBadges = supply?.trustBadges || [];
    const merged = [...new Set([...orgBadges, ...supplyBadges])];
    const auto =
      supply != null
        ? this.completeness(match.capability ? 'capability' : 'outcome', supply)
        : 0;
    return {
      trustBadges: merged,
      badgeLabels: merged.map((b) => BADGE_LABELS[b] || b),
      orgBadges,
      supplyBadges,
      qualityScore: org?.qualityScore ?? auto,
      trl: supply?.trl ?? null,
      rights: supply?.rights ?? null,
      ipOwnership: supply?.ipOwnership ?? null,
      licenseOpenness: supply?.licenseOpenness ?? null,
      readinessBand: supply?.readinessBand ?? null,
    };
  }
}
