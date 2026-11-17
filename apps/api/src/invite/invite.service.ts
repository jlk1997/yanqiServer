import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { OrgType } from '@prisma/client';
import { rateLimit } from '../common/rate-limit';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { embedText } = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

@Injectable()
export class InviteService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async claim(
    body: {
      orgName: string;
      orgType?: string;
      region?: string;
      contactName: string;
      contactEmail?: string;
      contactRole?: string;
      cardKind: 'capability' | 'demand' | 'outcome';
      title: string;
      summary: string;
      tags?: string[];
    },
    ip?: string,
  ) {
    const ipKey = ip || 'unknown';
    const rlIp = rateLimit(`invite:ip:${ipKey}`, 8, 10 * 60_000);
    if (!rlIp.ok) throw new BadRequestException(`提交过于频繁，请 ${rlIp.retryAfterSec}s 后再试`);

    const orgName = (body.orgName || '').trim();
    const contactName = (body.contactName || '').trim();
    const title = (body.title || '').trim();
    if (!orgName || !contactName || !title || !body.summary?.trim()) {
      throw new BadRequestException('请填写机构名称、联系人、标题与简介');
    }
    if (body.contactEmail) {
      const rlMail = rateLimit(`invite:mail:${body.contactEmail}`, 5, 10 * 60_000);
      if (!rlMail.ok) throw new BadRequestException('同一邮箱提交过于频繁，请稍后再试');
      const since = new Date(Date.now() - 10 * 60 * 1000);
      const recent = await this.prisma.person.count({
        where: { email: body.contactEmail, createdAt: { gte: since } },
      });
      if (recent >= 5) throw new BadRequestException('提交过于频繁，请稍后再试');
    }

    const typeMap: Record<string, OrgType> = {
      UNIVERSITY: OrgType.UNIVERSITY,
      LAB_INSTITUTE: OrgType.LAB_INSTITUTE,
      ENTERPRISE: OrgType.ENTERPRISE,
      GOVERNMENT: OrgType.GOVERNMENT,
      OTHER: OrgType.OTHER,
      高校: OrgType.UNIVERSITY,
      实验室: OrgType.LAB_INSTITUTE,
      企业: OrgType.ENTERPRISE,
    };
    const orgType = typeMap[body.orgType || ''] || OrgType.ENTERPRISE;

    let org = await this.prisma.organization.findFirst({ where: { name: orgName } });
    if (!org) {
      org = await this.prisma.organization.create({
        data: {
          name: orgName,
          type: orgType,
          region: body.region || null,
          summary: '邀请落地页认领',
          extensions: { source: 'invite' },
        },
      });
    }

    let person = await this.prisma.person.findFirst({
      where: { orgId: org.id, name: contactName },
    });
    const pdata = {
      orgId: org.id,
      name: contactName,
      role: body.contactRole || null,
      email: body.contactEmail || null,
      source: 'invite',
      consent: 'self_submitted',
    };
    if (person) person = await this.prisma.person.update({ where: { id: person.id }, data: pdata });
    else person = await this.prisma.person.create({ data: pdata });

    const tags = (body.tags || []).map((t) => String(t).trim()).filter(Boolean);
    const emb = await embedText([title, body.summary, ...tags].join(' '));
    let card: any;
    if (body.cardKind === 'demand') {
      card = await this.prisma.demand.create({
        data: {
          orgId: org.id,
          title,
          problem: body.summary,
          industry: tags,
          regionPref: body.region || null,
          embedding: emb,
          extensions: { source: 'invite' },
        },
      });
    } else if (body.cardKind === 'outcome') {
      card = await this.prisma.outcome.create({
        data: {
          orgId: org.id,
          title,
          type: 'OTHER',
          abstract: body.summary,
          ipcOrDisc: tags,
          embedding: emb,
          extensions: { source: 'invite' },
        },
      });
    } else {
      card = await this.prisma.capability.create({
        data: {
          orgId: org.id,
          title,
          summary: body.summary,
          keywords: tags,
          disciplines: tags.slice(0, 4),
          offerTypes: ['技术咨询', '联合攻关'],
          embedding: emb,
          extensions: { source: 'invite' },
        },
      });
    }

    await this.prisma.jobLog.create({
      data: {
        queue: 'invite',
        jobName: 'claim',
        payload: { orgId: org.id, personId: person.id, cardKind: body.cardKind, cardId: card.id },
        status: 'done',
        message: `邀请认领：${orgName} / ${title}`,
      },
    });

    await this.audit.log({
      action: 'invite.claim',
      actor: contactName,
      targetType: 'Organization',
      targetId: org.id,
      ip: ipKey,
      meta: { cardKind: body.cardKind, cardId: card.id, title },
    });

    return {
      ok: true,
      message: '已收到，运营将人工复核后纳入匹配。本页不会群发邮件。',
      orgId: org.id,
      personId: person.id,
      cardId: card.id,
      cardKind: body.cardKind,
    };
  }
}
