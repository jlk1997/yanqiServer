import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'path';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

function leadFace(card: any) {
  if (!card) return null;
  const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  return { publishStatus: card.publishStatus, quarantine: Boolean(ext.quarantine), source: ext.source };
}

function leadVisible(row: any) {
  const match = row?.match;
  const breakdown = match?.scoreBreakdown && typeof match.scoreBreakdown === 'object' ? match.scoreBreakdown : {};
  return !shared.externalShareBlock({
    action: breakdown.action,
    cards: [leadFace(match?.demand), leadFace(match?.capability), leadFace(match?.outcome)].filter(Boolean),
  });
}
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../common/audit.service';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private audit: AuditService,
  ) {}

  async list(status?: string, scope: { orgId?: string; brokerId?: string } = {}) {
    const where: any = {};
    if (status) where.status = status;
    if (scope.orgId) {
      where.match = {
        OR: [
          { demand: { orgId: scope.orgId } },
          { capability: { orgId: scope.orgId } },
          { outcome: { orgId: scope.orgId } },
        ],
      };
    } else if (scope.brokerId) {
      where.match = { brokerId: scope.brokerId };
    }
    const rows = await this.prisma.lead.findMany({
      where: Object.keys(where).length ? where : undefined,
      include: {
        person: true,
        match: {
          include: {
            demand: { include: { org: true } },
            capability: { include: { org: true } },
            outcome: { include: { org: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (scope.brokerId) return rows.filter((row) => leadVisible(row));
    if (!scope.orgId) return rows;
    return rows.filter((row) => leadVisible(row)).map((row) => this.hideContact(row));
  }

  async get(id: string, scope: { orgId?: string; brokerId?: string } = {}) {
    const row = await this.prisma.lead.findUniqueOrThrow({
      where: { id },
      include: {
        person: true,
        match: { include: { demand: true, capability: true, outcome: true } },
      },
    });
    if (!scope.orgId && !scope.brokerId) return row;
    const match = row.match as any;
    if (scope.brokerId) {
      if (match?.brokerId !== scope.brokerId || !leadVisible(row)) throw new NotFoundException('线索不存在');
      return row;
    }
    const owns =
      match?.demand?.orgId === scope.orgId || match?.capability?.orgId === scope.orgId || match?.outcome?.orgId === scope.orgId;
    if (!owns || !leadVisible(row)) throw new NotFoundException('线索不存在');
    return this.hideContact(row);
  }

  private hideContact(row: any) {
    if (!row?.person) return row;
    return { ...row, person: { ...row.person, email: null, phone: null } };
  }

  async update(id: string, data: any) {
    const current = await this.prisma.lead.findUniqueOrThrow({ where: { id } });
    const locked = current.status === 'approved' || current.status === 'sent';
    const touchesBody =
      data.draftSubject !== undefined ||
      data.draftBody !== undefined ||
      data.personId !== undefined ||
      (data.status !== undefined && data.status !== current.status);
    if (locked && touchesBody) {
      throw new BadRequestException('这条草稿已经人审或发过，不能再改');
    }
    if (['approved', 'sent', 'dry_run'].includes(data.status) && data.status !== current.status) {
      throw new BadRequestException('发送请走审核发送，不能直接改状态');
    }
    const allowed: any = {};
    for (const k of ['status', 'draftSubject', 'draftBody', 'channel', 'personId']) {
      if (data[k] !== undefined) allowed[k] = data[k];
    }
    return this.prisma.lead.update({ where: { id }, data: allowed });
  }

  async approveAndSend(id: string, actor = 'ops', confirmLive?: boolean) {
    return this.mail.approveAndSend(id, actor, confirmLive);
  }

  async exportCsv(status?: string, scope: { orgId?: string; brokerId?: string } = {}) {
    const rows = await this.list(status, scope);
    const header = [
      '线索ID',
      '状态',
      '渠道',
      '发送模式',
      '联系人',
      '邮箱',
      '需求',
      '需求方',
      '供给方',
      '匹配分',
      '主题草稿',
      '审核时间',
      '发送时间',
      '失败原因',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      const supply = r.match?.capability?.title || r.match?.outcome?.title || '';
      const supplyOrg = r.match?.capability?.org?.name || r.match?.outcome?.org?.name || '';
      const cells = [
        r.id,
        r.status,
        r.channel,
        r.sendMode || '',
        r.person?.name || '',
        r.person?.email || '',
        (r.match?.demand?.title || '').replace(/,/g, '，'),
        (r.match?.demand?.org?.name || '').replace(/,/g, '，'),
        `${supply}（${supplyOrg}）`.replace(/,/g, '，'),
        String(r.match?.totalScore ?? ''),
        (r.draftSubject || '').replace(/,/g, '，'),
        r.approvedAt ? new Date(r.approvedAt).toISOString() : '',
        r.sentAt ? new Date(r.sentAt).toISOString() : '',
        (r.failReason || '').replace(/,/g, '，'),
      ];
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    }
    return lines.join('\n');
  }
}
