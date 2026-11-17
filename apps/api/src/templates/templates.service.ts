import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { DOC_TEMPLATE_SEED } from './templates.seed';

function fill(md: string, vars: Record<string, string>) {
  return md.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : `（${k}未填）`));
}

@Injectable()
export class TemplatesService implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async onModuleInit() {
    try {
      await this.ensureSeed();
    } catch (e) {
      console.warn('[templates] seed skip', (e as Error)?.message);
    }
  }

  async ensureSeed() {
    const n = await this.prisma.docTemplate.count();
    if (n >= 3) return { ok: true, seeded: false, count: n };
    for (const t of DOC_TEMPLATE_SEED) {
      await this.prisma.docTemplate.upsert({
        where: { tenantId_code: { tenantId: 'default', code: t.code } },
        create: {
          code: t.code,
          title: t.title,
          kind: t.kind,
          bodyMd: t.bodyMd,
          placeholders: t.placeholders,
          sortOrder: t.sortOrder,
          active: true,
        },
        update: {
          title: t.title,
          bodyMd: t.bodyMd,
          placeholders: t.placeholders,
          sortOrder: t.sortOrder,
          active: true,
        },
      });
    }
    return { ok: true, seeded: true, count: await this.prisma.docTemplate.count() };
  }

  async list(kind?: string) {
    await this.ensureSeed();
    const where: any = { active: true };
    if (kind) where.kind = kind;
    const items = await this.prisma.docTemplate.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return {
      ok: true,
      disclaimerZh: '所有模板仅为业务沟通骨架，不构成法律意见；本系统不提供电子签。',
      items,
    };
  }

  async upsert(body: any, actor = 'ops') {
    const code = String(body.code || '').trim();
    if (!code) throw new BadRequestException('需要 code');
    const row = await this.prisma.docTemplate.upsert({
      where: { tenantId_code: { tenantId: body.tenantId || 'default', code } },
      create: {
        code,
        title: body.title || code,
        kind: body.kind || 'general',
        bodyMd: body.bodyMd || '',
        bodyHtml: body.bodyHtml || null,
        placeholders: body.placeholders || [],
        disclaimerZh: body.disclaimerZh,
        active: body.active != null ? Boolean(body.active) : true,
        sortOrder: body.sortOrder != null ? Number(body.sortOrder) : 100,
      },
      update: {
        title: body.title,
        kind: body.kind,
        bodyMd: body.bodyMd,
        bodyHtml: body.bodyHtml,
        placeholders: body.placeholders,
        disclaimerZh: body.disclaimerZh,
        active: body.active != null ? Boolean(body.active) : undefined,
        sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
      },
    });
    await this.audit.log({
      action: 'doc_template.upsert',
      actor,
      targetType: 'DocTemplate',
      targetId: row.id,
      meta: { code },
    });
    return { ok: true, item: row };
  }

  async remove(id: string, actor = 'ops') {
    await this.prisma.docTemplate.delete({ where: { id } });
    await this.audit.log({
      action: 'doc_template.delete',
      actor,
      targetType: 'DocTemplate',
      targetId: id,
      meta: {},
    });
    return { ok: true };
  }

  async contextFromMatch(matchId: string) {
    const m = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true } },
        outcome: { include: { org: true } },
        broker: true,
        checklistItems: true,
      },
    });
    if (!m) throw new NotFoundException('匹配不存在');
    const supply = m.capability || m.outcome;
    const supplyOrg = m.capability?.org || m.outcome?.org;
    const done = (m.checklistItems || []).filter((c) => c.done).length;
    const total = (m.checklistItems || []).length || 1;
    const dateZh = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    return {
      matchId: m.id,
      demandOrg: m.demand?.org?.name || '',
      supplyOrg: supplyOrg?.name || '',
      demandTitle: m.demand?.title || '',
      supplyTitle: supply?.title || '',
      problem: m.demand?.problem || '',
      trl: supply && 'trl' in supply && supply.trl != null ? String(supply.trl) : '',
      licenseNeed: (m.demand as any)?.licenseNeed || '',
      budgetBand: m.demand?.budgetBand || '',
      brokerName: m.broker?.name || m.broker?.email || '未分派',
      region: m.demand?.regionPref || supplyOrg?.region || '',
      checklistPct: String(Math.round((done / total) * 100)),
      dateZh,
      score: String(Math.round((m.totalScore || 0) * 100)),
    };
  }

  async generate(opts: {
    templateId?: string;
    code?: string;
    matchId?: string;
    vars?: Record<string, string>;
    actor?: string;
  }) {
    let tpl =
      (opts.templateId &&
        (await this.prisma.docTemplate.findUnique({ where: { id: opts.templateId } }))) ||
      null;
    if (!tpl && opts.code) {
      tpl = await this.prisma.docTemplate.findFirst({
        where: { code: opts.code, active: true },
      });
    }
    if (!tpl) throw new NotFoundException('模板不存在');
    let ctx: Record<string, string> = {};
    if (opts.matchId) ctx = await this.contextFromMatch(opts.matchId);
    Object.assign(ctx, opts.vars || {});
    const bodyMd =
      `> ${tpl.disclaimerZh || '本稿不构成法律意见。'}\n\n` + fill(tpl.bodyMd, ctx);
    const title = `${tpl.title} · ${ctx.demandTitle || ctx.matchId || '草稿'}`;
    const draft = await this.prisma.docDraft.create({
      data: {
        templateId: tpl.id,
        matchId: opts.matchId || null,
        title,
        bodyMd,
        filledFrom: ctx,
        createdBy: opts.actor || 'ops',
      },
    });
    await this.audit.log({
      action: 'doc_draft.generate',
      actor: opts.actor || 'ops',
      targetType: 'DocDraft',
      targetId: draft.id,
      meta: { templateCode: tpl.code, matchId: opts.matchId || null },
    });
    return {
      ok: true,
      draft,
      downloadName: `${tpl.code}-${(opts.matchId || 'draft').slice(0, 8)}.md`,
      disclaimerZh: tpl.disclaimerZh,
    };
  }

  async getDraft(id: string) {
    const d = await this.prisma.docDraft.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!d) throw new NotFoundException('草稿不存在');
    return { ok: true, draft: d };
  }

  async listDrafts(matchId?: string, take = 30) {
    const items = await this.prisma.docDraft.findMany({
      where: matchId ? { matchId } : {},
      orderBy: { createdAt: 'desc' },
      take,
      include: { template: { select: { code: true, title: true, kind: true } } },
    });
    return { ok: true, items };
  }
}
