import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Ext = Record<string, any>;

function asExt(v: unknown): Ext {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Ext;
  return {};
}

@Injectable()
export class LineageService {
  constructor(private prisma: PrismaService) {}

  private provenanceFromExt(ext: Ext, createdAt?: Date | null) {
    const source =
      ext.source ||
      ext.provenance ||
      ext.importSource ||
      (ext.crawlJobId ? 'crawl' : null) ||
      (ext.importJobId || ext.batchId ? 'import' : null) ||
      'unknown';
    return {
      source,
      sourceLabelZh:
        source === 'portal_self'
          ? '门户自助录入'
          : source === 'invite'
            ? '邀请认领'
            : source === 'authorized_import' || source === 'csv_manual' || source === 'import'
              ? '授权/CSV 导入'
              : source === 'crawl' || source === 'openalex' || source === 'open_alex'
                ? '采集任务'
                : source === 'seed' || source === 'demo'
                  ? '种子/演示'
                  : source === 'manual' || source === 'ops'
                    ? '人工录入'
                    : source === 'unknown'
                      ? '未标注（可能是早期数据或匹配生成）'
                      : String(source),
      importJobId: ext.importJobId || ext.batchId || null,
      crawlJobId: ext.crawlJobId || ext.jobId || null,
      createdBy: ext.createdBy || ext.actor || ext.author || null,
      notes: ext.lineageNote || ext.note || null,
      createdAt: createdAt ? createdAt.toISOString() : null,
      rawKeys: Object.keys(ext).slice(0, 24),
    };
  }

  async forMatch(matchId: string) {
    const m = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true } },
        outcome: { include: { org: true } },
        leads: true,
        broker: { select: { id: true, name: true, email: true } },
      },
    });
    if (!m) throw new NotFoundException('匹配不存在');

    const audits = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { targetType: 'MatchResult', targetId: matchId },
          ...(m.leads || []).map((l) => ({ targetType: 'Lead', targetId: l.id })),
          { targetType: 'Demand', targetId: m.demandId },
          ...(m.capabilityId ? [{ targetType: 'Capability', targetId: m.capabilityId }] : []),
          ...(m.outcomeId ? [{ targetType: 'Outcome', targetId: m.outcomeId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    const jobHints = await this.prisma.jobLog.findMany({
      where: {
        OR: [
          { payload: { path: ['matchId'], equals: matchId } },
          { message: { contains: matchId.slice(0, 10) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }).catch(() => []);

    const importJobs = await this.prisma.enterpriseImportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
    }).catch(() => []);

    const demandExt = asExt(m.demand?.extensions);
    const capExt = asExt(m.capability?.extensions);
    const outExt = asExt(m.outcome?.extensions);
    const demandOrgExt = asExt(m.demand?.org?.extensions);
    const supplyOrg = m.capability?.org || m.outcome?.org;
    const supplyOrgExt = asExt(supplyOrg?.extensions);

    const evidenceIds = [
      { entityType: 'Demand', entityId: m.demandId },
      m.capabilityId ? { entityType: 'Capability', entityId: m.capabilityId } : null,
      m.outcomeId ? { entityType: 'Outcome', entityId: m.outcomeId } : null,
    ].filter(Boolean) as Array<{ entityType: string; entityId: string }>;
    const fieldEvidence = evidenceIds.length
      ? await this.prisma.fieldEvidence.findMany({
          where: { OR: evidenceIds.map((e) => ({ entityType: e.entityType, entityId: e.entityId })) },
          orderBy: { createdAt: 'desc' },
          take: 30,
        })
      : [];
    const editors = audits
      .filter((a) => a.actor)
      .map((a) => ({
        at: a.createdAt.toISOString(),
        actor: a.actor,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        meta: a.meta,
      }));

    return {
      ok: true,
      matchId,
      match: {
        id: m.id,
        status: m.status,
        totalScore: m.totalScore,
        reason: m.reason,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        broker: m.broker,
        operatorNote: m.operatorNote,
      },
      cards: {
        demand: m.demand
          ? {
              id: m.demand.id,
              title: m.demand.title,
              org: m.demand.org?.name,
              provenance: this.provenanceFromExt(demandExt, m.demand.createdAt),
            }
          : null,
        capability: m.capability
          ? {
              id: m.capability.id,
              title: m.capability.title,
              org: m.capability.org?.name,
              provenance: this.provenanceFromExt(capExt, m.capability.createdAt),
            }
          : null,
        outcome: m.outcome
          ? {
              id: m.outcome.id,
              title: m.outcome.title,
              org: m.outcome.org?.name,
              provenance: this.provenanceFromExt(outExt, m.outcome.createdAt),
            }
          : null,
      },
      orgs: {
        demandOrg: m.demand?.org
          ? {
              id: m.demand.org.id,
              name: m.demand.org.name,
              provenance: this.provenanceFromExt(demandOrgExt, m.demand.org.createdAt),
            }
          : null,
        supplyOrg: supplyOrg
          ? {
              id: supplyOrg.id,
              name: supplyOrg.name,
              provenance: this.provenanceFromExt(supplyOrgExt, supplyOrg.createdAt),
            }
          : null,
      },
      fieldEvidence: fieldEvidence.map((f) => ({
        entityType: f.entityType,
        entityId: f.entityId,
        field: f.fieldKey,
        sourceCode: f.sourceCode,
        at: f.createdAt.toISOString(),
        locked: f.locked,
      })),
      edits: editors,
      relatedJobs: (jobHints as any[]).map((j) => ({
        id: j.id,
        queue: j.queue,
        jobName: j.jobName,
        status: j.status,
        message: j.message,
        createdAt: j.createdAt?.toISOString?.() || j.createdAt,
      })),
      recentImportBatches: (importJobs as any[]).slice(0, 5).map((j) => ({
        id: j.id,
        status: j.status,
        source: j.source || null,
        filename: j.filename || null,
        importedRows: j.importedRows,
        createdAt: j.createdAt?.toISOString?.() || j.createdAt,
        actorEmail: j.actorEmail || null,
      })),
      noteZh:
        '血缘来自卡/组织 extensions（source / importJobId / crawlJobId）+ AuditLog 编辑轨迹 + 相关 JobLog。匹配本身由算法生成，两侧卡才谈得上导入批次。',
    };
  }

  async forCard(kind: string, id: string) {
    const k = (kind || '').toLowerCase();
    let row: any = null;
    let targetType = '';
    if (k === 'demand' || k === 'demands') {
      row = await this.prisma.demand.findUnique({ where: { id }, include: { org: true } });
      targetType = 'Demand';
    } else if (k === 'capability' || k === 'capabilities') {
      row = await this.prisma.capability.findUnique({ where: { id }, include: { org: true } });
      targetType = 'Capability';
    } else if (k === 'outcome' || k === 'outcomes') {
      row = await this.prisma.outcome.findUnique({ where: { id }, include: { org: true } });
      targetType = 'Outcome';
    } else if (k === 'org' || k === 'organization' || k === 'orgs') {
      row = await this.prisma.organization.findUnique({ where: { id } });
      targetType = 'Organization';
    } else {
      throw new NotFoundException('kind 仅支持 demand|capability|outcome|org');
    }
    if (!row) throw new NotFoundException('记录不存在');
    const fieldEvidence = await this.prisma.fieldEvidence.findMany({
      where: { entityType: targetType, entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const audits = await this.prisma.auditLog.findMany({
      where: { targetType, targetId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      ok: true,
      kind: targetType,
      id,
      title: row.title || row.name,
      org: row.org?.name || null,
      provenance: this.provenanceFromExt(asExt(row.extensions), row.createdAt),
      fieldEvidence: fieldEvidence.map((f) => ({
        field: f.fieldKey,
        sourceCode: f.sourceCode,
        at: f.createdAt.toISOString(),
        locked: f.locked,
        valueText: f.valueText,
      })),
      publishStatus: row.publishStatus || null,
      publishBlockers: row.publishBlockers || [],
      edits: audits.map((a) => ({
        at: a.createdAt.toISOString(),
        actor: a.actor,
        action: a.action,
        meta: a.meta,
      })),
    };
  }
}
