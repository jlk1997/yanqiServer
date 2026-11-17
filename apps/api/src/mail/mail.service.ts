import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { QuotaService } from '../plans/quota.service';
import { join } from 'path';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  fromName: string;
  opsName: string;
};

type SmtpHealth = {
  configured: boolean;
  mode: string;
  confirmLiveSend: boolean;
  liveSendReady: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  userMasked: string | null;
  from: string | null;
  fromName: string;
  opsName: string;
  reachable: boolean | null;
  lastCheckAt: string | null;
  lastError: string | null;
  lastErrorZh: string | null;
  egressHint: string | null;
};

function envFirst(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

/** 把 CHANNEL_EMAIL_* 别名灌进 SMTP_* / MAIL_*，方便运维按渠道名配置 */
export function applyChannelEmailAliases() {
  const map: Array<[string, string]> = [
    ['CHANNEL_EMAIL_SMTP_HOST', 'SMTP_HOST'],
    ['CHANNEL_EMAIL_SMTP_PORT', 'SMTP_PORT'],
    ['CHANNEL_EMAIL_SMTP_USER', 'SMTP_USER'],
    ['CHANNEL_EMAIL_SMTP_PASSWORD', 'SMTP_PASS'],
    ['CHANNEL_EMAIL_FROM', 'SMTP_FROM'],
    ['CHANNEL_EMAIL_FROM_NAME', 'MAIL_FROM_NAME'],
    ['CHANNEL_EMAIL_OPS_NAME', 'OPS_DISPLAY_NAME'],
  ];
  for (const [from, to] of map) {
    if ((!process.env[to] || !String(process.env[to]).trim()) && process.env[from]) {
      process.env[to] = process.env[from];
    }
  }
  // FROM 若只有邮箱、没有显示名，用小蚁拼上
  const fromName = envFirst('MAIL_FROM_NAME', 'CHANNEL_EMAIL_FROM_NAME', 'OPS_DISPLAY_NAME') || '小蚁';
  const rawFrom = envFirst('SMTP_FROM', 'CHANNEL_EMAIL_FROM');
  if (rawFrom && !/[<>]/.test(rawFrom) && rawFrom.includes('@')) {
    process.env.SMTP_FROM = `${fromName} <${rawFrom}>`;
  } else if (rawFrom && !process.env.SMTP_FROM) {
    process.env.SMTP_FROM = rawFrom;
  }
}

function maskEmail(s?: string | null) {
  if (!s) return null;
  const at = s.indexOf('@');
  if (at < 1) return s.slice(0, 2) + '***';
  return s.slice(0, Math.min(2, at)) + '***' + s.slice(at);
}

function explainSmtpErrorZh(err: any): { zh: string; egressHint: string | null } {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  const lower = msg.toLowerCase();
  const egress =
    /greeting never received|etimedout|econnreset|econnrefused|socket closed|tls|disconnected|network|timeout|enotfound/i.test(
      msg + ' ' + code,
    );
  if (egress || /greeting never received/i.test(msg)) {
    return {
      zh: '连不上邮件服务器（常见原因：本机/沙箱出网拦住了 smtp 的 587/465 端口）。配置本身可能是对的，但当前环境发不出去。请换能出网的机器，或让运维放行 smtp.qq.com:587。',
      egressHint:
        '本环境对 smtp.qq.com:587/465 出网受限时会出现 Greeting never received / TLS 断开。产品侧会诚实记失败，不会假装已送达。',
    };
  }
  if (/invalid login|auth|535|534/i.test(msg + code)) {
    return {
      zh: 'SMTP 账号或授权码不对。QQ 邮箱要用「授权码」而不是登录密码。',
      egressHint: null,
    };
  }
  return { zh: 'SMTP 校验失败：' + msg.slice(0, 200), egressHint: null };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private lastHealth: SmtpHealth | null = null;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private webhooks: WebhooksService,
    private quota: QuotaService,
  ) {
    applyChannelEmailAliases();
  }

  private brandingProductName: string | null = null;
  private brandingLoadedAt = 0;

  displayNames() {
    return {
      fromName: envFirst('MAIL_FROM_NAME', 'CHANNEL_EMAIL_FROM_NAME') || '小蚁',
      opsName: envFirst('OPS_DISPLAY_NAME', 'CHANNEL_EMAIL_OPS_NAME', 'MAIL_FROM_NAME') || '小蚁',
      productName: this.brandingProductName || process.env.PRODUCT_NAME || '研企通',
    };
  }

  /** 从租户白标刷新产品名（邮件模板用） */
  async refreshBrandingNames(tenantId = 'default') {
    try {
      const b = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
      if (b?.productName) this.brandingProductName = b.productName;
      this.brandingLoadedAt = Date.now();
    } catch (_) {}
    return this.displayNames();
  }

  async ensureBrandingNames() {
    if (!this.brandingProductName || Date.now() - this.brandingLoadedAt > 60_000) {
      await this.refreshBrandingNames();
    }
    return this.displayNames();
  }

  smtpConfigured(): boolean {
    applyChannelEmailAliases();
    return Boolean(envFirst('SMTP_HOST', 'CHANNEL_EMAIL_SMTP_HOST') && envFirst('SMTP_FROM', 'CHANNEL_EMAIL_FROM'));
  }

  getSmtpConfig(): SmtpConfig | null {
    applyChannelEmailAliases();
    if (!this.smtpConfigured()) return null;
    const names = this.displayNames();
    const host = envFirst('SMTP_HOST', 'CHANNEL_EMAIL_SMTP_HOST')!;
    const from = envFirst('SMTP_FROM', 'CHANNEL_EMAIL_FROM')!;
    return {
      host,
      port: Number(envFirst('SMTP_PORT', 'CHANNEL_EMAIL_SMTP_PORT') || 587),
      secure:
        envFirst('SMTP_SECURE') === '1' ||
        envFirst('SMTP_SECURE') === 'true',
      user: envFirst('SMTP_USER', 'CHANNEL_EMAIL_SMTP_USER') || undefined,
      pass: envFirst('SMTP_PASS', 'CHANNEL_EMAIL_SMTP_PASSWORD') || undefined,
      from,
      fromName: names.fromName,
      opsName: names.opsName,
    };
  }

  /** 不泄漏密钥的健康快照 */
  getCachedHealth(): SmtpHealth {
    const smtp = this.getSmtpConfig();
    const names = this.displayNames();
    const mode = process.env.SMTP_MODE || 'draft_only';
    const confirm = process.env.CONFIRM_LIVE_SEND === '1' || process.env.CONFIRM_LIVE_SEND === 'true';
    const base: SmtpHealth = {
      configured: Boolean(smtp),
      mode,
      confirmLiveSend: confirm,
      liveSendReady: Boolean(smtp && mode === 'live' && confirm),
      host: smtp?.host || null,
      port: smtp?.port ?? null,
      secure: smtp?.secure || false,
      userMasked: maskEmail(smtp?.user || null),
      from: smtp?.from || null,
      fromName: names.fromName,
      opsName: names.opsName,
      reachable: this.lastHealth?.reachable ?? null,
      lastCheckAt: this.lastHealth?.lastCheckAt ?? null,
      lastError: this.lastHealth?.lastError ?? null,
      lastErrorZh: this.lastHealth?.lastErrorZh ?? null,
      egressHint: this.lastHealth?.egressHint ?? null,
    };
    return base;
  }

  async verifySmtp(actor = 'ops'): Promise<SmtpHealth> {
    applyChannelEmailAliases();
    const snap = this.getCachedHealth();
    if (!snap.configured) {
      const empty: SmtpHealth = {
        ...snap,
        reachable: false,
        lastCheckAt: new Date().toISOString(),
        lastError: 'not_configured',
        lastErrorZh: '还没配 SMTP。可在环境变量写 SMTP_* 或 CHANNEL_EMAIL_*。',
        egressHint: null,
      };
      this.lastHealth = empty;
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'smtp_verify',
          payload: { configured: false },
          status: 'failed',
          message: empty.lastErrorZh!,
        },
      });
      return empty;
    }
    const smtp = this.getSmtpConfig()!;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        connectionTimeout: 12_000,
        greetingTimeout: 12_000,
        socketTimeout: 15_000,
        tls: { rejectUnauthorized: false },
      });
      await transporter.verify();
      const ok: SmtpHealth = {
        ...snap,
        reachable: true,
        lastCheckAt: new Date().toISOString(),
        lastError: null,
        lastErrorZh: null,
        egressHint: null,
      };
      this.lastHealth = ok;
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'smtp_verify',
          payload: { host: smtp.host, port: smtp.port, ok: true },
          status: 'done',
          message: `SMTP 连通正常：${smtp.host}:${smtp.port}`,
        },
      });
      await this.audit.log({
        action: 'smtp.verify.ok',
        actor,
        targetType: 'Mail',
        targetId: smtp.host,
        meta: { port: smtp.port, user: maskEmail(smtp.user) },
      });
      return ok;
    } catch (e: any) {
      const { zh, egressHint } = explainSmtpErrorZh(e);
      const raw = String(e?.message || e).slice(0, 400);
      const bad: SmtpHealth = {
        ...snap,
        reachable: false,
        lastCheckAt: new Date().toISOString(),
        lastError: raw,
        lastErrorZh: zh,
        egressHint,
      };
      this.lastHealth = bad;
      this.logger.warn(`SMTP verify failed: ${raw}`);
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'smtp_verify',
          payload: {
            host: smtp.host,
            port: smtp.port,
            ok: false,
            // 故意不写密码
            error: raw,
            egressLikely: Boolean(egressHint),
          },
          status: 'failed',
          message: zh.slice(0, 300),
        },
      });
      await this.audit.log({
        action: 'smtp.verify.failed',
        actor,
        targetType: 'Mail',
        targetId: smtp.host,
        meta: { error: raw, zh, egressLikely: Boolean(egressHint) },
      });
      return bad;
    }
  }

  /** 仅允许向配置发件人自己发一封连通测试信（双确认） */
  async sendSelfTest(actor = 'ops', confirmLive?: boolean) {
    const health = await this.verifySmtp(actor);
    if (!health.reachable) {
      return {
        ok: false,
        mode: 'blocked',
        health,
        message: health.lastErrorZh || 'SMTP 不可达，已跳过试发。',
      };
    }
    if (!this.liveSendAllowed(confirmLive)) {
      return {
        ok: false,
        mode: 'dry_run',
        health,
        message: '试发需要 SMTP_MODE=live + CONFIRM_LIVE_SEND=1 + confirmLive=true。',
      };
    }
    const smtp = this.getSmtpConfig()!;
    const to = smtp.user || smtp.from.match(/<([^>]+)>/)?.[1] || smtp.from;
    const names = this.displayNames();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        connectionTimeout: 12_000,
        greetingTimeout: 12_000,
        socketTimeout: 20_000,
      });
      const info = await transporter.sendMail({
        from: smtp.from,
        to,
        subject: `【${names.productName}】小蚁连通测试`,
        text: this.renderTemplate('self_test', { opsName: names.opsName }),
      });
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'smtp_self_test',
          payload: { to, messageId: info.messageId },
          status: 'done',
          message: `自测信已发往 ${to}`,
        },
      });
      await this.audit.log({
        action: 'smtp.self_test',
        actor,
        targetType: 'Mail',
        targetId: to,
        meta: { messageId: info.messageId },
      });
      return { ok: true, mode: 'smtp', to, messageId: info.messageId, message: `已发自测信到 ${to}` };
    } catch (e: any) {
      const { zh, egressHint } = explainSmtpErrorZh(e);
      const raw = String(e?.message || e).slice(0, 400);
      this.lastHealth = {
        ...health,
        reachable: false,
        lastCheckAt: new Date().toISOString(),
        lastError: raw,
        lastErrorZh: zh,
        egressHint,
      };
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'smtp_self_test',
          payload: { to, error: raw },
          status: 'failed',
          message: zh.slice(0, 300),
        },
      });
      return { ok: false, mode: 'smtp', message: zh, health: this.lastHealth };
    }
  }

  renderTemplate(
    kind: 'approve' | 'invite' | 'match_ready' | 'self_test' | string,
    vars: Record<string, string>,
  ) {
    const names = this.displayNames();
    const ops = vars.opsName || names.opsName;
    const product = names.productName;
    if (kind === 'self_test') {
      return `${ops} 你好：\n\n这是「${product}」的 SMTP 连通测试信。收到即说明发信链路通了。\n\n— ${ops}（${product}）`;
    }
    if (kind === 'approve') {
      return `${vars.who || '老师/负责人'}您好：\n\n我是${ops}，来自「${product}」。\n\n${vars.body || ''}\n\n如有问题直接回复本邮件即可。\n\n— ${ops} · ${product}`;
    }
    if (kind === 'invite') {
      return `${vars.who || '老师/负责人'}您好：\n\n我是${ops}（${product}）。邀请您完善机构档案：${vars.inviteUrl || ''}\n\n说明：${vars.reason || '方便后续精准对接，不会自动群发营销信。'}\n\n— ${ops}`;
    }
    if (kind === 'match_ready') {
      return `${vars.who || '您好'}：\n\n「${product}」已为您准备好一条对接建议：\n需求：${vars.demandTitle || '-'}\n供给：${vars.supplyTitle || '-'}\n理由：${vars.reason || '-'}\n\n运营（${ops}）会人工复核后再正式触达。\n\n— ${ops} · ${product}`;
    }
    return vars.body || '';
  }

  /** 真发必须：SMTP_MODE=live 且 CONFIRM_LIVE_SEND=1，且请求 confirmLive=true */
  private liveSendAllowed(confirmLive?: boolean) {
    const modeLive = process.env.SMTP_MODE === 'live';
    const envConfirm = process.env.CONFIRM_LIVE_SEND === '1' || process.env.CONFIRM_LIVE_SEND === 'true';
    return Boolean(modeLive && envConfirm && confirmLive === true);
  }


  listTemplates() {
    const names = this.displayNames();
    return [
      {
        kind: 'invite',
        name: '邀请完善档案',
        description: '邀请高校/企业补档案，强调不自动群发',
        subject: `【${names.productName}】邀请您完善机构档案`,
        vars: ['who', 'inviteUrl', 'reason'],
      },
      {
        kind: 'approve',
        name: '审核通过说明',
        description: '人审通过后的跟进说明（可套到线索草稿）',
        subject: `【${names.productName}】对接进展说明`,
        vars: ['who', 'body'],
      },
      {
        kind: 'match_ready',
        name: '匹配就绪通知',
        description: '高分匹配待复核/待触达时给机构或运营看',
        subject: `【${names.productName}】有一条对接建议待确认`,
        vars: ['who', 'demandTitle', 'supplyTitle', 'reason'],
      },
      {
        kind: 'self_test',
        name: '连通测试',
        description: '仅发给发件账号自己',
        subject: `【${names.productName}】小蚁连通测试`,
        vars: ['opsName'],
      },
    ];
  }

  previewTemplate(kind: string, vars: Record<string, string> = {}) {
    const names = this.displayNames();
    const meta = this.listTemplates().find((x) => x.kind === kind) || this.listTemplates()[0];
    const subject =
      kind === 'invite'
        ? `【${names.productName}】邀请您完善机构档案`
        : kind === 'approve'
          ? `【${names.productName}】对接进展说明`
          : kind === 'match_ready'
            ? `【${names.productName}】有一条对接建议待确认`
            : meta.subject;
    const body = this.renderTemplate(kind, {
      who: vars.who || '老师/负责人',
      inviteUrl: vars.inviteUrl || (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3100') + '/invite.html',
      reason: vars.reason || '方便后续精准对接',
      body: vars.body || '我们已经完成人工复核，后续由小蚁跟您约短沟通。',
      demandTitle: vars.demandTitle || '（需求标题）',
      supplyTitle: vars.supplyTitle || '（能力/成果标题）',
      opsName: names.opsName,
    });
    return {
      ok: true,
      kind,
      fromName: names.fromName,
      opsName: names.opsName,
      subject,
      body,
      note: '模板署名小蚁/研企通。真发仍受 SMTP 出网与双确认门闸约束。',
    };
  }

  async applyTemplateToLead(leadId: string, kind: string, vars: Record<string, string> = {}, actor = 'ops') {
    await this.ensureBrandingNames();
    const lead = await this.prisma.lead.findUniqueOrThrow({
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
    if (['approved', 'sent', 'dry_run'].includes(lead.status)) {
      throw new BadRequestException('这条草稿已经人审或发过，不再套模板覆盖');
    }
    const supplyTitle = lead.match?.capability?.title || lead.match?.outcome?.title || '';
    const preview = this.previewTemplate(kind, {
      who: lead.person?.name || vars.who || '老师/负责人',
      demandTitle: lead.match?.demand?.title || vars.demandTitle || '',
      supplyTitle: supplyTitle || vars.supplyTitle || '',
      reason: lead.match?.reason || vars.reason || '',
      body: vars.body || lead.draftBody || '',
      inviteUrl:
        vars.inviteUrl ||
        `${process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3100'}/invite.html?org=${encodeURIComponent(
          lead.match?.capability?.org?.name || lead.match?.outcome?.org?.name || '',
        )}`,
    });
    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        draftSubject: preview.subject,
        draftBody: preview.body,
        status: 'draft',
      },
    });
    await this.audit.log({
      action: 'lead.template_apply',
      actor,
      targetType: 'Lead',
      targetId: leadId,
      meta: { kind },
    });
    return { ok: true, lead: updated, preview };
  }

  private cardFace(card: any) {
    if (!card) return null;
    const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
    return {
      publishStatus: card.publishStatus,
      quarantine: Boolean(ext.quarantine),
      source: ext.source,
    };
  }

  /** 影子、未发布、隔离、演示、暂停切片、七天内已真发过的联系人，都不能再出信。 */
  private async assertSendable(lead: any) {
    const breakdown = lead.match?.scoreBreakdown && typeof lead.match.scoreBreakdown === 'object' ? lead.match.scoreBreakdown : {};
    let slicePaused = false;
    if (breakdown.sliceKey) {
      const paused = await this.prisma.featureFlag.findUnique({ where: { key: 'slice-outreach:' + breakdown.sliceKey } });
      slicePaused = Boolean(paused && paused.enabled === false);
    }
    let recentContact = false;
    if (lead.personId) {
      const since = new Date(Date.now() - 7 * 86400000);
      const other = await this.prisma.lead.findFirst({
        where: { id: { not: lead.id }, personId: lead.personId, status: 'sent', sentAt: { gte: since } },
        select: { id: true },
      });
      recentContact = Boolean(other);
    }
    const block = shared.outreachBlock({
      action: breakdown.action,
      cards: [this.cardFace(lead.match?.demand), this.cardFace(lead.match?.capability), this.cardFace(lead.match?.outcome)].filter(Boolean),
      personStatus: lead.person?.publishStatus,
      slicePaused,
      recentContact,
    });
    if (block) throw new BadRequestException(block.message);
  }

  /** 审核通过并入队发送：默认干跑；真发需双确认 */
  async approveAndSend(leadId: string, actor = 'ops', confirmLive?: boolean) {
    const lead = await this.prisma.lead.findUniqueOrThrow({
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

    if (!lead.draftSubject || !lead.draftBody) {
      throw new BadRequestException('草稿主题或正文为空，请先重写草稿');
    }
    if (lead.status === 'sent' || (lead.status === 'approved' && lead.sentAt)) {
      throw new BadRequestException('该线索已发送过，勿重复发送');
    }
    await this.assertSendable(lead);

    const to = lead.person?.email?.trim();
    if (!to) {
      throw new BadRequestException('联系人邮箱为空，请先补全 Person.email');
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: actor,
      },
    });

    await this.audit.log({
      action: 'lead.approve',
      actor,
      targetType: 'Lead',
      targetId: leadId,
      meta: { to, subject: lead.draftSubject },
    });

    if (lead.matchId) {
      await this.prisma.matchResult.update({
        where: { id: lead.matchId },
        data: { status: 'APPROVED' },
      });
    }

    const smtp = this.getSmtpConfig();
    const wantLive = this.liveSendAllowed(confirmLive);
    const forceDry =
      !wantLive ||
      process.env.SMTP_MODE === 'draft_only' ||
      process.env.SMTP_FORCE_DRY_RUN === '1' ||
      !smtp;

    if (confirmLive && !wantLive) {
      await this.audit.log({
        action: 'lead.send.live_refused',
        actor,
        targetType: 'Lead',
        targetId: leadId,
        meta: {
          to,
          reason: '需要 SMTP_MODE=live 且 CONFIRM_LIVE_SEND=1 且 body.confirmLive=true',
          smtpMode: process.env.SMTP_MODE || null,
          confirmEnv: process.env.CONFIRM_LIVE_SEND || null,
          hasSmtp: Boolean(smtp),
        },
      });
    }

    const names = this.displayNames();
    // 发出前给正文补上小蚁署名（若草稿还没有）
    let bodyText = lead.draftBody;
    if (!bodyText.includes(names.opsName) && !bodyText.includes('小蚁')) {
      bodyText = `${bodyText}\n\n— ${names.opsName} · ${names.productName}`;
    }

    if (forceDry) {
      const reason = !smtp
        ? '未配置 SMTP_* / CHANNEL_EMAIL_*'
        : !wantLive
          ? '未满足双确认（SMTP_MODE=live + CONFIRM_LIVE_SEND=1 + confirmLive）'
          : 'SMTP_MODE=draft_only 或 FORCE_DRY';
      this.logger.log(
        `[dry-run] 邮件未真发 | to=${to} | subject=${lead.draftSubject} | reason=${reason}`,
      );
      const updated = await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'dry_run',
          sendMode: 'dry_run',
          sentAt: new Date(),
          failReason: null,
        },
      });
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'approve_send',
          payload: { leadId, to, mode: 'dry_run' },
          status: 'done',
          message: `干跑发送：${to} · ${lead.draftSubject}`,
        },
      });
      await this.audit.log({
        action: 'lead.send.dry_run',
        actor,
        targetType: 'Lead',
        targetId: leadId,
        meta: { to, subject: lead.draftSubject },
      });
      if (lead.matchId) {
        await this.prisma.matchResult.update({
          where: { id: lead.matchId },
          data: { status: 'CONTACTED', operatorNote: '干跑发送（未真连 SMTP）' },
        });
      }
      try {
        await this.webhooks.emit(
          'lead.sent',
          {
            leadId,
            matchId: lead.matchId,
            to,
            mode: 'dry_run',
            subject: lead.draftSubject,
          },
          'default',
        );
      } catch (_) {}
      try { await this.quota.incr('tenant:default', 'mail_dry', 1); } catch (_) {}
      try {
        const leadRow = await this.prisma.lead.findUnique({ where: { id: leadId } });
        if (leadRow?.playbookId) {
          await this.prisma.playbookFunnelEvent.create({
            data: {
              playbookId: leadRow.playbookId,
              playbookCode: leadRow.playbookCode,
              leadId,
              matchId: leadRow.matchId,
              stage: 'dry_run',
              actor,
              note: '干跑发送',
            },
          });
        }
      } catch (_) {}
      return {
        ok: true,
        mode: 'dry_run',
        lead: updated,
        message:
          '已审核通过并干跑发送（日志已记）。真发需同时：配置 SMTP_* 或 CHANNEL_EMAIL_*、SMTP_MODE=live、CONFIRM_LIVE_SEND=1、请求体 confirmLive=true。发件人显示名：' +
          names.fromName,
      };
    }

    await this.audit.log({
      action: 'lead.send.live_attempt',
      actor,
      targetType: 'Lead',
      targetId: leadId,
      meta: { to, subject: lead.draftSubject, confirmLive: true, fromName: names.fromName },
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtp!.host,
        port: smtp!.port,
        secure: smtp!.secure,
        auth: smtp!.user ? { user: smtp!.user, pass: smtp!.pass } : undefined,
        connectionTimeout: 12_000,
        greetingTimeout: 12_000,
        socketTimeout: 20_000,
      });
      const info = await transporter.sendMail({
        from: smtp!.from,
        to,
        subject: lead.draftSubject,
        text: bodyText,
      });
      const updated = await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'sent',
          sendMode: 'smtp',
          sentAt: new Date(),
          failReason: null,
        },
      });
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'approve_send',
          payload: { leadId, to, mode: 'smtp', messageId: info.messageId },
          status: 'done',
          message: `已真发：${to}`,
        },
      });
      await this.audit.log({
        action: 'lead.send.smtp',
        actor,
        targetType: 'Lead',
        targetId: leadId,
        meta: { to, messageId: info.messageId },
      });
      if (lead.matchId) {
        await this.prisma.matchResult.update({
          where: { id: lead.matchId },
          data: { status: 'CONTACTED' },
        });
      }
      try {
        await this.webhooks.emit(
          'lead.sent',
          {
            leadId,
            matchId: lead.matchId,
            to,
            mode: 'smtp',
            subject: lead.draftSubject,
            messageId: info.messageId,
          },
          'default',
        );
      } catch (_) {}
      try { await this.quota.incr('tenant:default', 'mail_live', 1); } catch (_) {}
      try {
        const leadRow = await this.prisma.lead.findUnique({ where: { id: leadId } });
        if (leadRow?.playbookId) {
          await this.prisma.playbookFunnelEvent.create({
            data: {
              playbookId: leadRow.playbookId,
              playbookCode: leadRow.playbookCode,
              leadId,
              matchId: leadRow.matchId,
              stage: 'live_sent',
              actor,
              note: '真发邮件',
            },
          });
        }
      } catch (_) {}
      return { ok: true, mode: 'smtp', lead: updated, messageId: info.messageId, message: `已发送至 ${to}` };
    } catch (e: any) {
      const { zh, egressHint } = explainSmtpErrorZh(e);
      const reason = zh;
      const raw = String(e?.message || e).slice(0, 500);
      this.lastHealth = {
        ...this.getCachedHealth(),
        reachable: false,
        lastCheckAt: new Date().toISOString(),
        lastError: raw,
        lastErrorZh: zh,
        egressHint,
      };
      const updated = await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'failed',
          sendMode: 'smtp',
          failReason: reason.slice(0, 500),
        },
      });
      await this.prisma.jobLog.create({
        data: {
          queue: 'mail',
          jobName: 'approve_send',
          payload: { leadId, to, error: raw, egressLikely: Boolean(egressHint) },
          status: 'failed',
          message: reason.slice(0, 300),
        },
      });
      await this.audit.log({
        action: 'lead.send.failed',
        actor,
        targetType: 'Lead',
        targetId: leadId,
        meta: { to, reason, raw },
      });
      return { ok: false, mode: 'smtp', lead: updated, message: '发送失败：' + reason };
    }
  }
}
