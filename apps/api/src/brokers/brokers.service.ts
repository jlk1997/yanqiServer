import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CommissionsService } from '../commissions/commissions.service';
import { BrokerFollowStatus, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const shared = require(path.join(__dirname, '../../../../packages/shared/src/match-lib.js'));

function cardFace(card: any) {
  if (!card) return null;
  const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  return { publishStatus: card.publishStatus, quarantine: Boolean(ext.quarantine), source: ext.source };
}

function externalFace(match: any) {
  const breakdown = match?.scoreBreakdown && typeof match.scoreBreakdown === 'object' ? match.scoreBreakdown : {};
  return shared.externalShareBlock({
    action: breakdown.action,
    cards: [cardFace(match?.demand), cardFace(match?.capability), cardFace(match?.outcome)].filter(Boolean),
  });
}

const FLOW: BrokerFollowStatus[] = [
  BrokerFollowStatus.assigned,
  BrokerFollowStatus.contacting,
  BrokerFollowStatus.interested,
  BrokerFollowStatus.closed_won,
  BrokerFollowStatus.closed_lost,
];

const LABEL: Record<string, string> = {
  assigned: '已分派',
  contacting: '联系中',
  interested: '有意向',
  closed_won: '已成交',
  closed_lost: '已流失',
};

/** 各阶段默认下次跟进 SLA（小时） */
const SLA_HOURS: Record<string, number> = {
  assigned: 48,
  contacting: 72,
  interested: 120,
};

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 3600_000);
}

@Injectable()
export class BrokersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private commissions: CommissionsService,
  ) {}

  listBrokers(tenantId?: string) {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.BROKER,
        active: true,
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true, email: true, name: true, tenantId: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  statusLabels() {
    return LABEL;
  }

  async assign(matchId: string, brokerId: string, actor?: string) {
    const broker = await this.prisma.user.findUnique({ where: { id: brokerId } });
    if (!broker || broker.role !== UserRole.BROKER) {
      throw new BadRequestException('目标用户不是经纪人');
    }
    const match = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: { demand: true, capability: true, outcome: true },
    });
    if (!match) throw new NotFoundException('匹配不存在');
    const block = externalFace(match);
    if (block) {
      throw new BadRequestException(
        block.code === 'not_ready' ? '这条还在内部观察，先不要分派经纪人' : block.message.replace('不能对外展示', '先不要分派经纪人'),
      );
    }
    const row = await this.prisma.matchResult.update({
      where: { id: matchId },
      data: {
        brokerId,
        assignedAt: new Date(),
        followUpStatus: BrokerFollowStatus.assigned,
        followUpAt: new Date(),
        followUpNote: '已分派给经纪人，等待首次联系',
        slaHours: SLA_HOURS.assigned,
        slaDueAt: addHours(new Date(), SLA_HOURS.assigned),
        nextFollowUp: addHours(new Date(), SLA_HOURS.assigned),
        tenantId: match.tenantId || broker.tenantId || 'default',
      },
      include: {
        demand: { include: { org: true } },
        capability: true,
        outcome: true,
        broker: { select: { id: true, name: true, email: true } },
        followUps: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorEmail: actor || 'ops',
        fromStatus: null,
        toStatus: BrokerFollowStatus.assigned,
        note: `分派给 ${broker.name}（${broker.email}）`,
      },
    });
    await this.notifications.create(
      brokerId,
      '新的匹配跟进任务',
      `已分派匹配「${row.demand?.title || matchId}」，请跟进对接。`,
      '/#brokers',
      'info',
    );
    await this.audit.log({
      action: 'match.assign_broker',
      actor: actor || 'ops',
      targetType: 'MatchResult',
      targetId: matchId,
      meta: { brokerId, brokerName: broker.name, followUpStatus: 'assigned' },
    });
    return row;
  }

  async unassign(matchId: string, actor?: string) {
    const before = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!before) throw new NotFoundException('匹配不存在');
    const row = await this.prisma.matchResult.update({
      where: { id: matchId },
      data: {
        brokerId: null,
        assignedAt: null,
        followUpStatus: null,
        followUpNote: null,
        followUpAt: null,
      },
    });
    await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorEmail: actor || 'ops',
        fromStatus: before.followUpStatus || null,
        toStatus: 'unassigned',
        note: '取消分派',
      },
    });
    await this.audit.log({
      action: 'match.unassign_broker',
      actor: actor || 'ops',
      targetType: 'MatchResult',
      targetId: matchId,
    });
    return row;
  }

  async listAssigned(brokerId?: string, tenantId?: string) {
    const rows = await this.prisma.matchResult.findMany({
      where: {
        ...(brokerId ? { brokerId } : { brokerId: { not: null } }),
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true } },
        outcome: { include: { org: true } },
        broker: { select: { id: true, name: true, email: true } },
        leads: true,
        followUps: { orderBy: { createdAt: 'desc' }, take: 15 },
      },
      orderBy: [{ followUpAt: 'desc' }, { assignedAt: 'desc' }, { totalScore: 'desc' }],
    });
    if (!brokerId) return rows;
    return rows.filter((row) => !externalFace(row));
  }

  async timeline(matchId: string) {
    const match = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: {
        demand: { include: { org: true } },
        broker: { select: { id: true, name: true, email: true } },
        followUps: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!match) throw new NotFoundException('匹配不存在');
    return {
      match,
      labels: LABEL,
      allowedNext: this.nextStatuses(match.followUpStatus),
    };
  }

  nextStatuses(current?: BrokerFollowStatus | null): BrokerFollowStatus[] {
    if (!current) return [BrokerFollowStatus.assigned];
    if (current === BrokerFollowStatus.closed_won || current === BrokerFollowStatus.closed_lost) {
      return [];
    }
    if (current === BrokerFollowStatus.assigned) {
      return [BrokerFollowStatus.contacting, BrokerFollowStatus.closed_lost];
    }
    if (current === BrokerFollowStatus.contacting) {
      return [BrokerFollowStatus.interested, BrokerFollowStatus.closed_lost];
    }
    if (current === BrokerFollowStatus.interested) {
      return [BrokerFollowStatus.closed_won, BrokerFollowStatus.closed_lost];
    }
    return FLOW;
  }

  async advance(
    matchId: string,
    toStatus: string,
    note: string | undefined,
    actor: { uid?: string; email?: string; role?: string },
  ) {
    if (!FLOW.includes(toStatus as BrokerFollowStatus) && toStatus !== 'unassigned') {
      throw new BadRequestException('非法跟进状态');
    }
    const match = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: { demand: true, capability: true, outcome: true },
    });
    if (!match) throw new NotFoundException('匹配不存在');
    if (!match.brokerId) throw new BadRequestException('尚未分派经纪人');
    if (toStatus !== 'closed_lost') {
      const block = externalFace(match);
      if (block) {
        throw new BadRequestException(
          block.code === 'not_ready' ? '这条还在内部观察，先不要往下跟' : block.message.replace('不能对外展示', '先不要往下跟'),
        );
      }
    }
    if (actor.role === 'BROKER' && actor.uid && match.brokerId !== actor.uid) {
      throw new ForbiddenException('只能推进自己的跟进任务');
    }
    const from = match.followUpStatus;
    const allowed = this.nextStatuses(from);
    if (!allowed.includes(toStatus as BrokerFollowStatus)) {
      throw new BadRequestException(
        `不能从「${LABEL[from || ''] || from || '空'}」直接到「${LABEL[toStatus] || toStatus}」。允许：${allowed
          .map((s) => LABEL[s])
          .join('、')}`,
      );
    }
    const row = await this.prisma.matchResult.update({
      where: { id: matchId },
      data: {
        followUpStatus: toStatus as BrokerFollowStatus,
        followUpNote: note || LABEL[toStatus] || toStatus,
        followUpAt: new Date(),
        status:
          toStatus === 'closed_won' || toStatus === 'closed_lost'
            ? 'CLOSED'
            : toStatus === 'contacting' || toStatus === 'interested'
              ? 'CONTACTED'
              : match.status,
        operatorNote: note || match.operatorNote,
        slaHours: SLA_HOURS[toStatus] ?? null,
        slaDueAt:
          toStatus === 'closed_won' || toStatus === 'closed_lost'
            ? null
            : SLA_HOURS[toStatus]
              ? addHours(new Date(), SLA_HOURS[toStatus])
              : match.slaDueAt,
        nextFollowUp:
          toStatus === 'closed_won' || toStatus === 'closed_lost'
            ? null
            : SLA_HOURS[toStatus]
              ? addHours(new Date(), SLA_HOURS[toStatus])
              : match.nextFollowUp,
      },
      include: {
        demand: { include: { org: true } },
        broker: { select: { id: true, name: true, email: true } },
        followUps: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorId: actor.uid,
        actorEmail: actor.email || 'ops',
        fromStatus: from || null,
        toStatus,
        note: note || null,
      },
    });
    if (match.brokerId) {
      await this.notifications.create(
        match.brokerId,
        `跟进状态 → ${LABEL[toStatus] || toStatus}`,
        note || `匹配 ${matchId} 已更新跟进状态`,
        '/#brokers',
        toStatus.startsWith('closed') ? 'success' : 'info',
      );
    }
    await this.audit.log({
      action: 'broker.follow_up',
      actor: actor.email || actor.uid || 'ops',
      targetType: 'MatchResult',
      targetId: matchId,
      meta: { from, to: toStatus, note },
    });
    // 成交 → 佣金账本幂等入账（演示，永不扣款）
    let commission: any = null;
    if (toStatus === 'closed_won' && match.brokerId) {
      commission = await this.commissions.reconcileClosedWon(matchId, actor.email || actor.uid || 'ops');
    }
    return { ...row, commission };
  }

  async addNote(matchId: string, note: string, actor: { uid?: string; email?: string; role?: string }) {
    if (!note?.trim()) throw new BadRequestException('备注不能为空');
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    if (actor.role === 'BROKER' && actor.uid && match.brokerId !== actor.uid) {
      throw new ForbiddenException('只能给自己的任务写备注');
    }
    const ev = await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorId: actor.uid,
        actorEmail: actor.email || 'ops',
        fromStatus: match.followUpStatus || null,
        toStatus: match.followUpStatus || 'assigned',
        note: note.trim(),
        meta: { kind: 'note' },
      },
    });
    await this.prisma.matchResult.update({
      where: { id: matchId },
      data: { followUpNote: note.trim(), followUpAt: new Date() },
    });
    await this.audit.log({
      action: 'broker.follow_note',
      actor: actor.email || 'ops',
      targetType: 'MatchResult',
      targetId: matchId,
      meta: { noteId: ev.id },
    });
    return this.timeline(matchId);
  }

  async setNextFollowUp(matchId: string, nextFollowUp: string | Date, actor: { uid?: string; email?: string; role?: string }) {
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    if (actor.role === 'BROKER' && actor.uid && match.brokerId !== actor.uid) {
      throw new ForbiddenException('只能改自己的任务');
    }
    const due = new Date(nextFollowUp);
    if (Number.isNaN(due.getTime())) throw new BadRequestException('下次跟进时间不合法');
    const row = await this.prisma.matchResult.update({
      where: { id: matchId },
      data: { nextFollowUp: due, slaDueAt: due, followUpAt: new Date() },
    });
    await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorId: actor.uid,
        actorEmail: actor.email || 'ops',
        fromStatus: match.followUpStatus || null,
        toStatus: match.followUpStatus || 'assigned',
        note: `设置下次跟进：${due.toISOString()}`,
        meta: { kind: 'sla_schedule' },
      },
    });
    return row;
  }

  /** SLA 看板：逾期 / 即将到期 / 提醒列表 */
  async slaBoard(opts: { brokerId?: string; tenantId?: string } = {}) {
    const now = Date.now();
    const soon = now + 24 * 3600_000;
    const rows = await this.listAssigned(opts.brokerId, opts.tenantId);
    const enriched = rows.map((m: any) => {
      const due = m.slaDueAt || m.nextFollowUp;
      const dueMs = due ? new Date(due).getTime() : null;
      let slaState: 'none' | 'ok' | 'due_soon' | 'overdue' | 'closed' = 'none';
      if (m.followUpStatus === 'closed_won' || m.followUpStatus === 'closed_lost') slaState = 'closed';
      else if (dueMs != null) {
        if (dueMs < now) slaState = 'overdue';
        else if (dueMs <= soon) slaState = 'due_soon';
        else slaState = 'ok';
      }
      return {
        ...m,
        slaState,
        slaDueAt: m.slaDueAt,
        nextFollowUp: m.nextFollowUp,
        hoursLeft:
          dueMs == null || slaState === 'closed'
            ? null
            : Math.round(((dueMs - now) / 3600_000) * 10) / 10,
      };
    });
    const overdue = enriched.filter((x) => x.slaState === 'overdue');
    const dueSoon = enriched.filter((x) => x.slaState === 'due_soon');
    return {
      ok: true,
      counts: {
        total: enriched.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        ok: enriched.filter((x) => x.slaState === 'ok').length,
      },
      overdue,
      dueSoon,
      items: enriched,
      policy: SLA_HOURS,
      labels: LABEL,
    };
  }

  async remindOverdue(actor = 'ops') {
    const board = await this.slaBoard();
    let notified = 0;
    for (const m of board.overdue) {
      if (!m.brokerId) continue;
      await this.notifications.create(
        m.brokerId,
        '跟进已逾期',
        `「${m.demand?.title || m.id}」已超过 SLA，请尽快联系或更新状态。`,
        '/#brokers',
        'warn',
      );
      notified++;
    }
    await this.audit.log({
      action: 'broker.sla_remind',
      actor,
      targetType: 'BrokerSLA',
      meta: { overdue: board.counts.overdue, notified },
    });
    return { ok: true, counts: board.counts, notified, message: `已向 ${notified} 个逾期任务发站内提醒` };
  }

  attachmentsDir(matchId: string) {
    const safeId = String(matchId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!safeId || safeId !== matchId) {
      throw new BadRequestException('匹配 ID 不合法');
    }
    const root = path.resolve(process.cwd(), '.data', 'attachments');
    const dir = path.resolve(root, safeId);
    if (!dir.startsWith(root + path.sep) && dir !== root) {
      throw new BadRequestException('非法附件路径');
    }
    return dir;
  }

  listAttachments(matchId: string) {
    return this.prisma.dealAttachment.findMany({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addAttachment(
    matchId: string,
    input: { fileName: string; contentBase64?: string; textContent?: string; mimeType?: string; kind?: string; note?: string },
    actor?: string,
  ) {
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    const dir = this.attachmentsDir(matchId);
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(input.fileName || 'file.txt').replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]+/g, '_').slice(0, 120);
    const storageName = `${Date.now()}_${safeName}`;
    const storagePath = path.join(dir, storageName);
    let buf: Buffer;
    if (input.contentBase64) buf = Buffer.from(input.contentBase64, 'base64');
    else buf = Buffer.from(input.textContent || '', 'utf8');
    if (buf.length > 5_000_000) throw new BadRequestException('附件太大（演示上限 5MB）');
    fs.writeFileSync(storagePath, buf);
    const row = await this.prisma.dealAttachment.create({
      data: {
        matchId,
        fileName: safeName,
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: buf.length,
        storagePath,
        kind: input.kind || 'deal_proof',
        note: input.note || null,
        uploadedBy: actor || 'ops',
      },
    });
    await this.prisma.brokerFollowUpEvent.create({
      data: {
        matchId,
        actorEmail: actor || 'ops',
        fromStatus: match.followUpStatus || null,
        toStatus: match.followUpStatus || 'assigned',
        note: `上传附件：${safeName}`,
        meta: { kind: 'attachment', attachmentId: row.id },
      },
    });
    await this.audit.log({
      action: 'broker.attachment',
      actor: actor || 'ops',
      targetType: 'DealAttachment',
      targetId: row.id,
      meta: { matchId, fileName: safeName, size: buf.length },
    });
    return row;
  }

  async readAttachmentFile(id: string) {
    const row = await this.prisma.dealAttachment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('附件不存在');
    const root = path.resolve(process.cwd(), '.data', 'attachments');
    const full = path.resolve(row.storagePath);
    if (!full.startsWith(root + path.sep)) throw new BadRequestException('非法附件路径');
    if (!fs.existsSync(full)) throw new NotFoundException('文件已丢失');
    return { row, buffer: fs.readFileSync(full) };
  }

  /** M20 经纪人产能看板 */
  async capacityBoard(opts: { overdueWarnAt?: number; tenantId?: string } = {}) {
    const warnAt = opts.overdueWarnAt != null ? Number(opts.overdueWarnAt) : 3;
    const brokers = await this.listBrokers(opts.tenantId);
    const now = Date.now();
    const rows = [];
    for (const b of brokers) {
      const matches = await this.prisma.matchResult.findMany({
        where: {
          brokerId: b.id,
          ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
        },
        select: {
          id: true,
          status: true,
          followUpStatus: true,
          slaDueAt: true,
          nextFollowUp: true,
          totalScore: true,
        },
      });
      const open = matches.filter(
        (m) => m.followUpStatus !== 'closed_won' && m.followUpStatus !== 'closed_lost' && m.status !== 'CLOSED',
      );
      const overdue = open.filter((m) => {
        const due = m.slaDueAt || m.nextFollowUp;
        return due && new Date(due).getTime() < now;
      });
      const byStage: Record<string, number> = {
        assigned: 0,
        contacting: 0,
        interested: 0,
        closed_won: 0,
        closed_lost: 0,
        unset: 0,
      };
      for (const m of matches) {
        const st = m.followUpStatus || 'unset';
        byStage[st] = (byStage[st] || 0) + 1;
      }
      const leads = await this.prisma.lead.findMany({
        where: { match: { brokerId: b.id }, playbookId: { not: null } },
        select: { id: true, status: true, playbookCode: true, matchId: true },
      });
      const funnelEvents = await this.prisma.playbookFunnelEvent.groupBy({
        by: ['stage'],
        where: {
          matchId: { in: matches.map((m) => m.id) },
        },
        _count: { _all: true },
      });
      const funnel: Record<string, number> = {};
      for (const f of funnelEvents) funnel[f.stage] = f._count._all;
      const applied = funnel.applied || 0;
      const intent = funnel.intent || 0;
      const conversion = applied ? Math.round((intent / applied) * 1000) / 10 : null;
      const capacityWarning = overdue.length > warnAt;
      rows.push({
        brokerId: b.id,
        name: b.name,
        email: b.email,
        openCount: open.length,
        overdueCount: overdue.length,
        dueSoonCount: open.filter((m) => {
          const due = m.slaDueAt || m.nextFollowUp;
          if (!due) return false;
          const t = new Date(due).getTime();
          return t >= now && t <= now + 24 * 3600_000;
        }).length,
        byStage,
        playbookLeads: leads.length,
        funnel,
        funnelConversionPct: conversion,
        capacityWarning,
        warningZh: capacityWarning
          ? `逾期 ${overdue.length} 单超过阈值 ${warnAt}，建议减负或催办`
          : null,
      });
    }
    rows.sort((a, b) => b.overdueCount - a.overdueCount || b.openCount - a.openCount);
    return {
      ok: true,
      overdueWarnAt: warnAt,
      summaryZh: rows.some((r) => r.capacityWarning)
        ? `有 ${rows.filter((r) => r.capacityWarning).length} 位经纪人逾期偏多，请看产能预警`
        : '暂无产能预警',
      brokers: rows,
    };
  }

}
