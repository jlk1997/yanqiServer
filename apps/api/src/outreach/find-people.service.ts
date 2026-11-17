import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const shared = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

@Injectable()
export class FindPeopleService {
  constructor(private prisma: PrismaService) {}

  async gaps(status = 'open') {
    return this.prisma.contactGap.findMany({
      where: status ? { status } : undefined,
      include: { match: { include: { demand: true, capability: true, outcome: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findForMatch(matchId: string) {
    const match = await this.prisma.matchResult.findUnique({
      where: { id: matchId },
      include: {
        demand: { include: { org: true } },
        capability: { include: { org: true, person: true } },
        outcome: { include: { org: true, person: true, authorships: { include: { person: true }, orderBy: { authorOrder: 'asc' } } } },
      },
    });
    if (!match) throw new NotFoundException('匹配不存在');
    const breakdown = (match.scoreBreakdown || {}) as any;
    const stage = breakdown.sliceStage || 'accumulating';
    if (stage === 'accumulating' || breakdown.action === 'SHADOW' || breakdown.action === 'HOLD') {
      return {
        ok: false,
        code: 'slice_not_ready',
        message: '这个产业切片还在蓄水或这条匹配被搁置，先不找人',
        action: breakdown.action || 'SHADOW',
        sliceStage: stage,
      };
    }
    const sliceKey = breakdown.sliceKey;
    if (sliceKey) {
      const paused = await this.prisma.featureFlag.findUnique({ where: { key: 'slice-outreach:' + sliceKey } });
      if (paused && paused.enabled === false) {
        return {
          ok: false,
          code: 'slice_paused',
          message: paused.note || '这个产业方向近期多次被标成领域不对，找人已暂停',
          sliceKey,
        };
      }
    }
    const resolved = await this.resolveContact(match);
    if (!resolved.person || !resolved.contact) {
      const gap = await this.prisma.contactGap.create({
        data: {
          matchId,
          reason: resolved.person ? 'no_contact' : 'no_person',
          status: 'open',
          note: resolved.note,
        },
      });
      return { ok: false, code: gap.reason, gapId: gap.id, message: resolved.note, person: resolved.person };
    }
    const since = new Date(Date.now() - 7 * 86400000);
    const recent = await this.prisma.lead.findFirst({
      where: { personId: resolved.person.id, createdAt: { gte: since }, status: { in: ['draft', 'approved', 'sent', 'dry_run'] } },
    });
    if (recent) {
      return { ok: false, code: 'frequency_cap', message: '同一联系人 7 天内已有待发草稿', leadId: recent.id };
    }
    const draft = shared.buildOutreachDraft({
      demandTitle: match.demand.title,
      demandOrg: match.demand.org.name,
      supplyTitle: match.capability?.title || match.outcome?.title,
      supplyOrg: match.capability?.org?.name || match.outcome?.org?.name,
      reason: match.reason || '',
      personName: resolved.person.name,
      collabModeLabel: breakdown.collabModeLabel || shared.COLLAB_LABEL?.[breakdown.collabMode] || '',
      inviteUrl: `${process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3100'}/invite.html`,
    });
    const existing = await this.prisma.lead.findFirst({ where: { matchId, channel: 'email_draft' } });
    if (existing && ['approved', 'sent', 'dry_run'].includes(existing.status)) {
      return { ok: false, code: 'already_reviewed', leadId: existing.id, message: '这条草稿已经人审或发过，不再覆盖' };
    }
    const lead = existing
      ? await this.prisma.lead.update({
          where: { id: existing.id },
          data: {
            personId: resolved.person.id,
            draftSubject: draft.subject,
            draftBody: draft.body,
            status: 'draft',
          },
        })
      : await this.prisma.lead.create({
          data: {
            matchId,
            personId: resolved.person.id,
            channel: 'email_draft',
            status: 'draft',
            draftSubject: draft.subject,
            draftBody: draft.body,
          },
        });
    const nextBreakdown = Object.assign({}, breakdown, { action: 'FIND_PEOPLE' });
    await this.prisma.matchResult.update({
      where: { id: matchId },
      data: { primaryPersonId: resolved.person.id, scoreBreakdown: nextBreakdown },
    });
    return { ok: true, leadId: lead.id, person: { id: resolved.person.id, name: resolved.person.name }, contact: resolved.contact, sentAt: lead.sentAt };
  }

  private async resolveContact(match: any) {
    const authors = match.outcome?.authorships || [];
    const corresponding = authors.find((a: any) => a.isCorresponding)?.person;
    const first = authors[0]?.person;
    const capPerson = match.capability?.person;
    const outcomePerson = match.outcome?.person;
    const ordered = [corresponding, first, outcomePerson, capPerson].filter(Boolean);
    let person = ordered[0] || null;
    if (!person && match.primaryPersonId) {
      person = await this.prisma.person.findUnique({ where: { id: match.primaryPersonId } });
    }
    const orgId = match.capability?.orgId || match.outcome?.orgId;
    if (person) {
      const contact = await this.pickContact(person.id, null);
      if (contact) return { person, contact, note: '老师联系点' };
    }
    if (orgId) {
      const labContact = await this.pickContact(null, orgId);
      if (labContact) {
        if (!person) {
          person = await this.prisma.person.findFirst({ where: { OR: [{ labOrgId: orgId }, { orgId }] } });
        }
        if (person) return { person, contact: labContact, note: '实验室公开联系点' };
      }
      const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
      const collegeId = person?.collegeOrgId;
      if (collegeId) {
        const secretary = await this.prisma.person.findFirst({
          where: { collegeOrgId: collegeId, role: { contains: '秘书' } },
        });
        if (secretary) {
          const contact = await this.pickContact(secretary.id, null);
          if (contact) return { person: secretary, contact, note: '学院秘书' };
        }
      }
      if (org && !person) {
        return { person: null, contact: null, note: '没有解析到老师' };
      }
    }
    if (!person) return { person: null, contact: null, note: '没有解析到老师' };
    return { person, contact: null, note: '有老师，没有可用联系点' };
  }

  private async pickContact(personId: string | null, orgId: string | null) {
    const row = await this.prisma.contactPoint.findFirst({
      where: {
        confidence: { gte: 0.6 },
        ...(personId ? { personId } : { orgId: orgId || undefined }),
      },
      orderBy: { confidence: 'desc' },
    });
    if (row && this.validContact(row.kind, row.value)) return row;
    if (personId) {
      const person = await this.prisma.person.findUnique({ where: { id: personId } });
      if (person?.email && this.validContact('email', person.email)) {
        return { kind: 'email', value: person.email, confidence: 0.7, sourceCode: person.source || 'person' };
      }
    }
    return null;
  }

  private validContact(kind: string, value: string) {
    if (!value) return false;
    if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (kind === 'phone') return /[0-9]{6,}/.test(value);
    return value.trim().length >= 2;
  }

  async reject(matchId: string, reason: string, comment?: string) {
    const allowed = ['wrong_field', 'trl_low', 'rights', 'wrong_person', 'duplicate', 'other'];
    const code = allowed.includes(reason) ? reason : 'other';
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    const breakdown = Object.assign({}, (match.scoreBreakdown || {}) as any, { action: 'HOLD', rejectReason: code });
    await this.prisma.matchResult.update({
      where: { id: matchId },
      data: { status: 'REJECTED', operatorNote: comment || code, scoreBreakdown: breakdown },
    });
    await this.prisma.matchFeedback.create({
      data: { matchId, useful: false, kind: 'reject', source: 'ops', comment: code + (comment ? ' ' + comment : '') },
    });
    let slicePaused = false;
    if (code === 'wrong_field' && breakdown.sliceKey) {
      const since = new Date(Date.now() - 30 * 86400000);
      const n = await this.prisma.matchFeedback.count({
        where: {
          kind: 'reject',
          comment: { startsWith: 'wrong_field' },
          createdAt: { gte: since },
          match: { scoreBreakdown: { path: ['sliceKey'], equals: breakdown.sliceKey } },
        },
      });
      if (n >= 5) {
        slicePaused = true;
        await this.prisma.featureFlag.upsert({
          where: { key: 'slice-outreach:' + breakdown.sliceKey },
          update: { enabled: false, note: '这个方向近期多次被标成领域不对，找人已暂停' },
          create: {
            key: 'slice-outreach:' + breakdown.sliceKey,
            enabled: false,
            note: '这个方向近期多次被标成领域不对，找人已暂停',
          },
        });
      }
    }
    if (code === 'wrong_person' && match.primaryPersonId) {
      await this.prisma.dataQualityIssue.create({
        data: {
          entityType: 'Person',
          entityId: match.primaryPersonId,
          code: 'ambiguous_person',
          severity: 'warn',
          message: '找人被标成找错人，需要核对是不是同名老师',
          meta: { matchId },
        },
      });
    }
    return { ok: true, matchId, reason: code, slicePaused };
  }

  async fillGap(gapId: string, input: { email?: string; phone?: string; personName?: string }) {
    const gap = await this.prisma.contactGap.findUnique({
      where: { id: gapId },
      include: {
        match: {
          include: {
            capability: true,
            outcome: true,
            primaryPerson: true,
          },
        },
      },
    });
    if (!gap || gap.status !== 'open') throw new NotFoundException('缺口不存在或已处理');
    const email = String(input.email || '').trim();
    const phone = String(input.phone || '').trim();
    if (!email && !phone) return { ok: false, message: '请填写邮箱或电话' };
    if (email && !this.validContact('email', email)) return { ok: false, message: '邮箱格式不对' };
    if (phone && !this.validContact('phone', phone)) return { ok: false, message: '电话至少要有 6 位数字' };

    let person = gap.match.primaryPerson;
    if (!person) {
      const name = String(input.personName || '').trim();
      if (!name) return { ok: false, message: '还没有老师，请先写上老师姓名' };
      const orgId = gap.match.capability?.orgId || gap.match.outcome?.orgId || null;
      person = await this.prisma.person.create({
        data: {
          name,
          nameNorm: shared.normalizeName(name),
          orgId,
          email: email || null,
          phone: phone || null,
          source: 'ops_fill',
          role: '老师',
          publishStatus: 'published',
        },
      });
      await this.prisma.matchResult.update({ where: { id: gap.matchId }, data: { primaryPersonId: person.id } });
      if (gap.match.outcomeId) {
        await this.prisma.outcome.update({ where: { id: gap.match.outcomeId }, data: { personId: person.id } });
      }
    } else {
      const patch: Record<string, string> = {};
      if (email && !person.email) patch.email = email;
      if (phone && !person.phone) patch.phone = phone;
      if (!person.nameNorm) patch.nameNorm = shared.normalizeName(person.name);
      if (Object.keys(patch).length) {
        person = await this.prisma.person.update({ where: { id: person.id }, data: patch });
      }
    }

    if (email) await this.ensureContact(person.id, 'email', email);
    if (phone) await this.ensureContact(person.id, 'phone', phone);
    await this.prisma.contactGap.update({
      where: { id: gapId },
      data: { status: 'filled', note: '运营补录联系点' },
    });
    const draft = await this.findForMatch(gap.matchId);
    return {
      ok: true,
      gapId,
      person: { id: person.id, name: person.name },
      draft,
      message: draft.ok ? '联系点已补上，草稿已生成，尚未发送' : (draft.message || '联系点已补上'),
    };
  }

  private async ensureContact(personId: string, kind: string, value: string) {
    const existing = await this.prisma.contactPoint.findFirst({ where: { personId, kind, value } });
    if (existing) return existing;
    return this.prisma.contactPoint.create({
      data: { personId, kind, value, sourceCode: 'ops_fill', confidence: 0.9, isPublic: false },
    });
  }
}
