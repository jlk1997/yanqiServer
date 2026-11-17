import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const SEED: Array<{
  code: string;
  title: string;
  scenario: string;
  bodyText: string;
  tags: string[];
  sortOrder: number;
}> = [
  {
    code: 'cold_uni',
    title: '冷启动高校实验室',
    scenario: 'cold_uni',
    tags: ['高校', '冷启动', '实验室'],
    sortOrder: 10,
    bodyText: `老师您好，我是研企通的技术经理人小蚁。

我们在梳理「{demandOrg}」提出的「{demandTitle}」时，看到贵团队在「{supplyTitle}」方向上的积累很契合（匹配说明：{reason}）。

想请教两件小事：
1）当前成果/平台大概处于 TRL 几？是否方便对外许可或联合攻关？
2）近期是否有意向对接对口企业做验证或小试？

若方便，我们可以安排 20 分钟线上沟通，不占用您太多时间。谢谢！`,
  },
  {
    code: 'enterprise_buy',
    title: '企业采购 / 技术窗口',
    scenario: 'enterprise_buy',
    tags: ['企业', '采购', '窗口'],
    sortOrder: 20,
    bodyText: `{personName}您好，我是研企通小蚁。

贵司关注的「{demandTitle}」与高校侧「{supplyTitle}」（{supplyOrg}）高度相关。对方已具备可沟通的技术接口，知识产权与许可方式也可进一步确认。

建议下一步：
- 对齐应用场景与验收口径（是否要上线/产线验证）
- 确认 TRL 与交付形态（报告 / 模块 / 联调）
- 如需，我方协助预约双方技术负责人当面（或线上）沟通

您看本周是否有 30 分钟窗口？我把一页纸摘要先行发您。`,
  },
  {
    code: 'diligence_pre_contract',
    title: '合同前尽调要点',
    scenario: 'diligence_pre_contract',
    tags: ['尽调', '合同', '知识产权'],
    sortOrder: 30,
    bodyText: `【合同前尽调清单 · 研企通】

对接：{demandOrg} ↔ {supplyOrg}
议题：{demandTitle} / {supplyTitle}

请双方会前尽量备齐：
1. 知识产权权属（学校 / 联合 / 个人）与是否已披露
2. 可许可范围（开放 / 可协商 / 独占）与地域、期限
3. 当前 TRL 与是否具备中试/工程化支持
4. 关键人员与决策链（技术负责人、成果转化办/法务）
5. 期望的合作形态（许可、联合开发、作价入股、服务采购）

说明：本清单用于降低沟通成本，不构成法律意见。正式合同请以双方法务审定为准。`,
  },
];

@Injectable()
export class PlaybooksService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSeed().catch(() => {});
  }

  async ensureSeed(tenantId = 'default') {
    const tid = tenantId || 'default';
    for (const s of SEED) {
      await this.prisma.brokerPlaybook.upsert({
        where: { tenantId_code: { tenantId: tid, code: s.code } },
        update: {},
        create: {
          tenantId: tid,
          code: s.code,
          title: s.title,
          scenario: s.scenario,
          bodyText: s.bodyText,
          tags: s.tags,
          sortOrder: s.sortOrder,
          active: true,
          note: 'M17 内置剧本',
        },
      });
    }
  }

  list(opts: { scenario?: string; activeOnly?: boolean; tenantId?: string } = {}) {
    const where: any = { tenantId: opts.tenantId || 'default' };
    if (opts.scenario) where.scenario = opts.scenario;
    if (opts.activeOnly !== false) where.active = true;
    return this.prisma.brokerPlaybook.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  get(id: string) {
    return this.prisma.brokerPlaybook.findUnique({ where: { id } });
  }

  async upsert(body: {
    id?: string;
    code: string;
    title: string;
    scenario?: string;
    bodyText: string;
    tags?: string[];
    active?: boolean;
    sortOrder?: number;
    note?: string;
  }) {
    if (body.id) {
      return this.prisma.brokerPlaybook.update({
        where: { id: body.id },
        data: {
          title: body.title,
          scenario: body.scenario || 'general',
          bodyText: body.bodyText,
          tags: body.tags || [],
          active: body.active !== false,
          sortOrder: body.sortOrder ?? 100,
          note: body.note,
        },
      });
    }
    return this.prisma.brokerPlaybook.upsert({
      where: { tenantId_code: { tenantId: 'default', code: body.code } },
      update: {
        title: body.title,
        scenario: body.scenario || 'general',
        bodyText: body.bodyText,
        tags: body.tags || [],
        active: body.active !== false,
        sortOrder: body.sortOrder ?? 100,
        note: body.note,
      },
      create: {
        tenantId: 'default',
        code: body.code,
        title: body.title,
        scenario: body.scenario || 'general',
        bodyText: body.bodyText,
        tags: body.tags || [],
        active: body.active !== false,
        sortOrder: body.sortOrder ?? 100,
        note: body.note,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.brokerPlaybook.delete({ where: { id } });
    return { ok: true };
  }


  /** 经纪人移动端剧本包：大白话卡片 + 下一步 chips，便于现场打电话 */
  private packEtag(tenantId: string, cards: Array<{ id: string; code: string; bodyText?: string; sortOrder?: number; updatedAt?: any }>) {
    const raw = cards
      .map((c) => `${c.id}|${c.code}|${c.sortOrder || 0}|${String(c.updatedAt || '')}|${createHash('sha1').update(c.bodyText || '').digest('hex').slice(0, 12)}`)
      .join('\n');
    return createHash('sha256').update(`${tenantId}\n${raw}`).digest('hex').slice(0, 32);
  }

  private packVersion(cards: Array<{ updatedAt?: any }>) {
    let max = 0;
    for (const c of cards) {
      const t = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
      if (t > max) max = t;
    }
    return max || Date.now();
  }

  /** 经纪人移动端剧本包：按租户 + version/etag 差分同步 */
  async mobilePack(opts: {
    tenantId?: string;
    sinceVersion?: number | string | null;
    clientEtag?: string | null;
    clientDirty?: boolean;
  } = {}) {
    const tenantId = opts.tenantId || 'default';
    await this.ensureSeed(tenantId).catch(() => {});
    const rows = await this.list({ activeOnly: true, tenantId });
    const SCENARIO_ZH: Record<string, string> = {
      cold_uni: '冷启动高校',
      enterprise_buy: '找企业窗口',
      diligence_pre_contract: '合同前尽调',
      general: '通用',
    };
    const CHIP_BY: Record<string, string[]> = {
      cold_uni: ['先问 TRL', '约 20 分钟', '发一页纸', '记下对接人'],
      enterprise_buy: ['对齐场景', '确认交付形态', '约技术负责人', '发摘要'],
      diligence_pre_contract: ['核权属', '核许可范围', '核决策链', '不给法律意见'],
    };
    const TIP_BY: Record<string, string> = {
      cold_uni: '打电话前先看一页纸；别一上来就要材料。',
      enterprise_buy: '先问验收口径，再谈价格和时间。',
      diligence_pre_contract: '这是沟通清单，不是合同；正式条款走法务。',
    };
    const cards = rows.map((pb) => {
      const lines = (pb.bodyText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const preview = lines.slice(0, 4).join('\n');
      const chips = CHIP_BY[pb.scenario] || ['看一页纸', '推进状态', '记备注'];
      return {
        id: pb.id,
        code: pb.code,
        titleZh: pb.title,
        scenario: pb.scenario,
        scenarioZh: SCENARIO_ZH[pb.scenario] || pb.scenario || '通用',
        tags: pb.tags || [],
        chips,
        tipZh: TIP_BY[pb.scenario] || '用大白话说清楚为什么对得上，再约下一步。',
        previewZh: preview,
        bodyText: pb.bodyText,
        sortOrder: pb.sortOrder,
        updatedAt: pb.updatedAt,
        tenantId,
      };
    });
    const etag = this.packEtag(tenantId, cards);
    const version = this.packVersion(cards);
    const sinceRaw = opts.sinceVersion;
    const sinceNum = sinceRaw == null || sinceRaw === '' ? null : Number(sinceRaw);
    const clientEtag = (opts.clientEtag || '').trim() || null;
    const conflict =
      Boolean(opts.clientDirty) && Boolean(clientEtag) && clientEtag !== etag;

    let mode: 'full' | 'delta' | 'not_modified' = 'full';
    let changedIds: string[] = cards.map((c) => c.id);
    let removedIds: string[] = [];
    let deltaCards = cards;

    if (clientEtag && clientEtag === etag && !opts.clientDirty) {
      mode = 'not_modified';
      changedIds = [];
      deltaCards = [];
    } else if (sinceNum != null && Number.isFinite(sinceNum) && sinceNum > 0) {
      mode = 'delta';
      deltaCards = cards.filter((c) => {
        const t = c.updatedAt ? new Date(c.updatedAt).getTime() : version;
        return t > sinceNum;
      });
      changedIds = deltaCards.map((c) => c.id);
      // 租户内已删：客户端需对照全量 id；此处给全量 id 清单便于差分
    }

    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      tenantId,
      version,
      etag,
      sync: {
        mode,
        sinceVersion: sinceNum,
        clientEtag,
        conflict,
        changedIds,
        removedIds,
        allIds: cards.map((c) => c.id),
        conflictZh: conflict
          ? '本机离线包与服务器不一致：您本机有未同步改动，服务器也已更新。请选择「保留本机」或「用服务器覆盖」。'
          : null,
        keepLocalZh: '保留本机（暂不覆盖）',
        takeServerZh: '用服务器覆盖本机',
      },
      bannerZh: '现场跟进剧本包：按租户差分同步；冲突时中文提示。点芯片记下一步，一键复制话术。',
      pwaHintZh: '用手机浏览器打开本页 →「添加到主屏幕」。首次在线打开会写入本机离线包（带 etag）。',
      offlineNoteZh: '本机 IndexedDB 按租户缓存；联网差分同步；版本冲突会明确提示，不会悄悄覆盖。',
      offline: {
        strategy: 'indexeddb',
        variant: 'tenant-etag',
        storeName: 'yanqi-playbook-pack',
        syncWhenOnline: true,
        statusHintsZh: {
          syncing: '正在按租户同步离线包…',
          cached: '已写入本机离线包',
          offlineCached: '当前离线 · 正在读本机缓存',
          onlineFresh: '已是最新 · 离线包已同步',
          empty: '尚未缓存，请联网后点同步',
          error: '离线包读写失败，仍可在线使用',
          conflict: '本机与服务器冲突 · 请选择保留哪边',
          notModified: '服务器无变更 · 继续用本机包',
        },
      },
      count: cards.length,
      cards: mode === 'delta' ? deltaCards : mode === 'not_modified' ? [] : cards,
      fullCards: cards,
      packedAt: new Date().toISOString(),
    };
  }

  /** 显式同步探测：冲突 / 无变更 / 更新 */
  async syncMobilePack(body: {
    tenantId?: string;
    clientEtag?: string;
    clientVersion?: number | string;
    clientDirty?: boolean;
    sinceVersion?: number | string;
  } = {}) {
    const pack = await this.mobilePack({
      tenantId: body.tenantId,
      sinceVersion: body.sinceVersion ?? body.clientVersion,
      clientEtag: body.clientEtag,
      clientDirty: Boolean(body.clientDirty),
    });
    const status = pack.sync.conflict
      ? 'conflict'
      : pack.sync.mode === 'not_modified'
        ? 'not_modified'
        : 'updated';
    const { ok: _ok, ...rest } = pack as any;
    return {
      ...rest,
      ok: true,
      status,
      statusZh:
        status === 'conflict'
          ? '冲突：本机与服务器不一致'
          : status === 'not_modified'
            ? '无变更：已是最新'
            : '有更新：请拉取服务器包',
    };
  }

  /** 套到线索/匹配上下文，生成可插入草稿的正文 */
  async apply(id: string, ctx: Record<string, string | null | undefined>) {
    const pb = await this.prisma.brokerPlaybook.findUnique({ where: { id } });
    if (!pb || !pb.active) throw new NotFoundException('剧本不存在或已停用');
    const map: Record<string, string> = {
      demandTitle: ctx.demandTitle || '（需求标题）',
      demandOrg: ctx.demandOrg || '（需求方）',
      supplyTitle: ctx.supplyTitle || '（供给标题）',
      supplyOrg: ctx.supplyOrg || '（供给方）',
      personName: ctx.personName || '负责人',
      reason: ctx.reason || '双方方向相近',
      trl: ctx.trl || '待确认',
    };
    let text = pb.bodyText;
    for (const [k, v] of Object.entries(map)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    const subject = `【研企通】${map.demandOrg} × ${map.supplyOrg} · ${pb.title}`;
    return {
      ok: true,
      playbook: { id: pb.id, code: pb.code, title: pb.title, scenario: pb.scenario },
      subject,
      body: text,
      noteZh: '已套用剧本，可一键写入线索草稿；发出前请人工改称呼与细节。',
    };
  }

  async applyToLead(playbookId: string, leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
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
    });
    if (!lead) throw new NotFoundException('线索不存在');
    const m = lead.match;
    const supplyTitle = m?.capability?.title || m?.outcome?.title || '';
    const supplyOrg = m?.capability?.org?.name || m?.outcome?.org?.name || '';
    const trl = m?.capability?.trl ?? m?.outcome?.trl;
    const applied = await this.apply(playbookId, {
      demandTitle: m?.demand?.title,
      demandOrg: m?.demand?.org?.name,
      supplyTitle,
      supplyOrg,
      personName: lead.person?.name,
      reason: m?.reason,
      trl: trl != null ? String(trl) : undefined,
    });
    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        draftSubject: applied.subject,
        draftBody: applied.body,
        status: lead.status === 'sent' ? lead.status : 'draft',
        playbookId: applied.playbook.id,
        playbookCode: applied.playbook.code,
      },
    });
    await this.recordFunnel({
      playbookId: applied.playbook.id,
      playbookCode: applied.playbook.code,
      leadId,
      matchId: lead.matchId,
      stage: 'applied',
      actor: 'ops',
      note: '套用剧本',
    });
    await this.recordFunnel({
      playbookId: applied.playbook.id,
      playbookCode: applied.playbook.code,
      leadId,
      matchId: lead.matchId,
      stage: 'draft',
      actor: 'ops',
      note: '写入草稿',
    });
    return { ...applied, lead: updated };
  }

  async recordFunnel(opts: {
    playbookId?: string | null;
    playbookCode?: string | null;
    leadId?: string | null;
    matchId?: string | null;
    stage: string;
    actor?: string;
    note?: string;
    meta?: any;
  }) {
    try {
      return await this.prisma.playbookFunnelEvent.create({
        data: {
          playbookId: opts.playbookId || null,
          playbookCode: opts.playbookCode || null,
          leadId: opts.leadId || null,
          matchId: opts.matchId || null,
          stage: opts.stage,
          actor: opts.actor || null,
          note: opts.note || null,
          meta: opts.meta || {},
        },
      });
    } catch (e) {
      return null;
    }
  }

  /** 经纪人标记剧本结果：intent | declined */
  async markOutcome(body: {
    leadId?: string;
    matchId?: string;
    stage: 'intent' | 'declined';
    playbookId?: string;
    note?: string;
    actor?: string;
  }) {
    const stage = body.stage;
    if (stage !== 'intent' && stage !== 'declined') {
      throw new BadRequestException('stage 仅支持 intent|declined');
    }
    let playbookId = body.playbookId || null;
    let playbookCode: string | null = null;
    let leadId = body.leadId || null;
    let matchId = body.matchId || null;
    if (leadId) {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (lead) {
        playbookId = playbookId || lead.playbookId;
        playbookCode = lead.playbookCode;
        matchId = matchId || lead.matchId;
      }
    }
    if (playbookId && !playbookCode) {
      const pb = await this.prisma.brokerPlaybook.findUnique({ where: { id: playbookId } });
      playbookCode = pb?.code || null;
    }
    const row = await this.recordFunnel({
      playbookId,
      playbookCode,
      leadId,
      matchId,
      stage,
      actor: body.actor || 'broker',
      note: body.note || (stage === 'intent' ? '标记有意向' : '标记婉拒'),
    });
    return { ok: true, event: row };
  }

  async funnelSummary(days = 30) {
    const since = new Date(Date.now() - Math.max(1, days) * 86400_000);
    const rows = await this.prisma.playbookFunnelEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const stages = ['applied', 'draft', 'dry_run', 'live_sent', 'intent', 'declined'] as const;
    const counts: Record<string, number> = Object.fromEntries(stages.map((s) => [s, 0]));
    for (const r of rows) {
      if (counts[r.stage] != null) counts[r.stage]++;
      else counts[r.stage] = (counts[r.stage] || 0) + 1;
    }
    const applied = counts.applied || 0;
    const rate = (n: number) => (applied ? Math.round((n / applied) * 1000) / 10 : 0);
    const labelZh: Record<string, string> = {
      applied: '已套用剧本',
      draft: '已写入草稿',
      dry_run: '干跑发送',
      live_sent: '真发邮件',
      intent: '对接有意向',
      declined: '婉拒/流失',
    };
    const strip = stages.map((s) => ({
      stage: s,
      labelZh: labelZh[s] || s,
      count: counts[s] || 0,
      pctFromApplied: rate(counts[s] || 0),
    }));
    // also lead-based reality check
    const leadsWithPb = await this.prisma.lead.count({ where: { playbookId: { not: null } } });
    const dry = await this.prisma.lead.count({ where: { playbookId: { not: null }, status: 'dry_run' } });
    const sent = await this.prisma.lead.count({ where: { playbookId: { not: null }, status: 'sent' } });
    return {
      ok: true,
      days,
      since: since.toISOString(),
      strip,
      counts,
      leadsWithPlaybook: leadsWithPb,
      leadsDryRun: dry,
      leadsLiveSent: sent,
      summaryZh: applied
        ? `近 ${days} 天：套用 ${applied} → 意向 ${counts.intent}（${rate(counts.intent)}%）· 婉拒 ${counts.declined} · 干跑 ${counts.dry_run} · 真发 ${counts.live_sent}`
        : `近 ${days} 天还没有剧本套用记录。去「跟进剧本」套一条线索草稿即可开始漏斗。`,
      recent: rows.slice(0, 25).map((r) => ({
        at: r.createdAt,
        stage: r.stage,
        playbookCode: r.playbookCode,
        leadId: r.leadId,
        matchId: r.matchId,
        actor: r.actor,
        note: r.note,
      })),
    };
  }
}
