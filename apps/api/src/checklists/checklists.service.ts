import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

/** 合同前默认模板：关键项未勾完时「确认意向」仅警告（可 force） */
export const CHECKLIST_TEMPLATE: Array<{
  code: string;
  labelZh: string;
  critical: boolean;
  sortOrder: number;
}> = [
  { code: 'ip_clear', labelZh: '知识产权路径清晰（权属/许可可谈）', critical: true, sortOrder: 10 },
  { code: 'trl_gate', labelZh: 'TRL/就绪度达到需求门槛或可解释偏差', critical: true, sortOrder: 20 },
  { code: 'budget_owner', labelZh: '预算与决策人已确认', critical: true, sortOrder: 30 },
  { code: 'nda', labelZh: '保密协议（NDA）意向或已签', critical: false, sortOrder: 40 },
  { code: 'sample_data', labelZh: '样例数据/现场条件可提供', critical: false, sortOrder: 50 },
  { code: 'rights_path', labelZh: '成果转化路径（许可/作价/联合）已口头对齐', critical: false, sortOrder: 60 },
  { code: 'contact_ready', labelZh: '双方对接人与窗口时间已约', critical: false, sortOrder: 70 },
];

@Injectable()
export class ChecklistsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async ensureForMatch(matchId: string) {
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    const existing = await this.prisma.dealChecklistItem.findMany({ where: { matchId } });
    const have = new Set(existing.map((e) => e.code));
    const toCreate = CHECKLIST_TEMPLATE.filter((t) => !have.has(t.code));
    if (toCreate.length) {
      await this.prisma.dealChecklistItem.createMany({
        data: toCreate.map((t) => ({
          matchId,
          code: t.code,
          labelZh: t.labelZh,
          critical: t.critical,
          sortOrder: t.sortOrder,
        })),
      });
    }
    return this.summary(matchId);
  }

  async summary(matchId: string) {
    await this.ensureSeedOnly(matchId);
    const items = await this.prisma.dealChecklistItem.findMany({
      where: { matchId },
      orderBy: { sortOrder: 'asc' },
    });
    const total = items.length;
    const done = items.filter((i) => i.done).length;
    const criticalOpen = items.filter((i) => i.critical && !i.done);
    const pct = total ? Math.round((done / total) * 100) : 0;
    return {
      ok: true,
      matchId,
      total,
      done,
      pct,
      criticalOpenCount: criticalOpen.length,
      criticalOpen: criticalOpen.map((c) => ({ code: c.code, labelZh: c.labelZh })),
      warnOnIntent: criticalOpen.length > 0,
      items: items.map((i) => ({
        id: i.id,
        code: i.code,
        labelZh: i.labelZh,
        critical: i.critical,
        done: i.done,
        note: i.note,
        doneAt: i.doneAt,
        doneBy: i.doneBy,
        sortOrder: i.sortOrder,
      })),
      summaryZh: criticalOpen.length
        ? `清单完成 ${pct}% · 仍有 ${criticalOpen.length} 项关键未勾：${criticalOpen.map((c) => c.labelZh).join('、')}`
        : `清单完成 ${pct}% · 关键项已齐`,
    };
  }

  private async ensureSeedOnly(matchId: string) {
    const n = await this.prisma.dealChecklistItem.count({ where: { matchId } });
    if (!n) {
      const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
      if (!match) throw new NotFoundException('匹配不存在');
      await this.prisma.dealChecklistItem.createMany({
        data: CHECKLIST_TEMPLATE.map((t) => ({
          matchId,
          code: t.code,
          labelZh: t.labelZh,
          critical: t.critical,
          sortOrder: t.sortOrder,
        })),
      });
    }
  }

  async setItem(
    matchId: string,
    code: string,
    body: { done?: boolean; note?: string; actor?: string },
  ) {
    await this.ensureSeedOnly(matchId);
    const row = await this.prisma.dealChecklistItem.findUnique({
      where: { matchId_code: { matchId, code } },
    });
    if (!row) throw new NotFoundException('清单项不存在');
    const done = body.done != null ? Boolean(body.done) : !row.done;
    const item = await this.prisma.dealChecklistItem.update({
      where: { id: row.id },
      data: {
        done,
        note: body.note != null ? body.note : row.note,
        doneAt: done ? new Date() : null,
        doneBy: done ? body.actor || 'ops' : null,
      },
    });
    await this.audit.log({
      action: 'deal_checklist.toggle',
      actor: body.actor || 'ops',
      targetType: 'MatchResult',
      targetId: matchId,
      meta: { code, done, note: body.note || null },
    });
    const sum = await this.summary(matchId);
    return { ok: true, item, checklist: sum };
  }

  /** 确认意向前门禁：默认警告；force 才放行 */
  async gateIntent(matchId: string, force = false) {
    const sum = await this.summary(matchId);
    if (!sum.warnOnIntent) {
      return { ok: true, blocked: false, warning: false, checklist: sum };
    }
    if (force) {
      return {
        ok: true,
        blocked: false,
        warning: true,
        forced: true,
        checklist: sum,
        message: '已强制确认意向（关键清单项仍未齐）',
      };
    }
    return {
      ok: false,
      blocked: false,
      warning: true,
      softBlock: true,
      checklist: sum,
      message: `确认意向前提醒：${sum.summaryZh}。若业务上仍要推进，请带 force=true 再试。`,
    };
  }
}
