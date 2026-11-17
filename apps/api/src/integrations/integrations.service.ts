import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const FETCH_TIMEOUT_MS = Number(process.env.INTEGRATIONS_TIMEOUT_MS || 8000);
const FETCH_RETRIES = Number(process.env.INTEGRATIONS_RETRIES || 2);

async function fetchWithTimeoutRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const retries = opts.retries ?? FETCH_RETRIES;
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, attempt: i + 1 };
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr || new Error('fetch failed');
}

@Injectable()
export class IntegrationsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async onModuleInit() {
    const defaults: Array<[string, string, any]> = [
      [
        'chatwoot',
        '会话客服（Chatwoot CE）',
        {
          accountId: null,
          inboxId: null,
          note: '配置 baseUrl + apiToken 后可干跑推送线索会话；默认不真连外网。',
          contract: {
            dryRunAction: 'create_conversation',
            livePath: '/api/v1/accounts/{accountId}/conversations',
            required: ['baseUrl', 'apiToken'],
          },
        },
      ],
      [
        'aitoearn',
        '社媒触达（AiToEarn）',
        {
          channels: ['wechat', 'xiaohongshu', 'linkedin'],
          note: '配置后可把邀约草稿干跑同步到 AiToEarn；默认不真发。',
          contract: {
            dryRunAction: 'publish_draft',
            livePath: '/api/publish',
            required: ['baseUrl', 'apiToken'],
          },
        },
      ],
    ];
    for (const [provider, note, meta] of defaults) {
      await this.prisma.integrationConfig.upsert({
        where: { provider },
        update: {},
        create: {
          provider,
          enabled: false,
          note,
          meta,
          baseUrl: process.env[`${provider.toUpperCase()}_BASE_URL`] || null,
          apiToken: process.env[`${provider.toUpperCase()}_TOKEN`] || null,
        },
      });
    }
  }

  list() {
    return this.prisma.integrationConfig.findMany({ orderBy: { provider: 'asc' } });
  }

  async upsert(
    provider: string,
    body: { enabled?: boolean; baseUrl?: string; apiToken?: string; meta?: any; note?: string },
  ) {
    const row = await this.prisma.integrationConfig.upsert({
      where: { provider },
      update: {
        enabled: body.enabled,
        baseUrl: body.baseUrl,
        apiToken: body.apiToken === '' ? null : body.apiToken,
        meta: body.meta,
        note: body.note,
      },
      create: {
        provider,
        enabled: Boolean(body.enabled),
        baseUrl: body.baseUrl,
        apiToken: body.apiToken || null,
        meta: body.meta || {},
        note: body.note,
      },
    });
    await this.audit.log({
      action: 'integration.upsert',
      actor: 'ops',
      targetType: 'IntegrationConfig',
      targetId: provider,
      meta: { enabled: row.enabled, hasToken: Boolean(row.apiToken), baseUrl: row.baseUrl },
    });
    return this.safe(row);
  }

  private async saveProbe(provider: string, result: {
    ok: boolean;
    status: string;
    message: string;
    meta?: any;
  }) {
    await this.prisma.integrationConfig.update({
      where: { provider },
      data: {
        lastProbeAt: new Date(),
        lastProbeOk: result.ok,
        lastProbeStatus: result.status,
        lastProbeMessage: result.message,
        lastProbeMeta: result.meta || {},
      },
    });
  }

  async probe(provider: string) {
    const row = await this.prisma.integrationConfig.findUnique({ where: { provider } });
    if (!row) {
      return { ok: false, status: 'missing', message: '未配置该集成' };
    }
    if (!row.enabled) {
      const r = { ok: false, status: 'disabled', message: `${provider} 未启用` };
      await this.saveProbe(provider, r);
      return { ...r, config: this.safe(await this.reload(provider)) };
    }
    if (!row.baseUrl) {
      const r = { ok: false, status: 'incomplete', message: '缺 baseUrl' };
      await this.saveProbe(provider, r);
      return { ...r, config: this.safe(await this.reload(provider)) };
    }
    if (!row.apiToken) {
      const r = { ok: false, status: 'incomplete', message: '缺 apiToken' };
      await this.saveProbe(provider, r);
      return { ...r, config: this.safe(await this.reload(provider)) };
    }

    const live = process.env.INTEGRATIONS_LIVE === '1';
    if (!live) {
      const r = {
        ok: true,
        status: 'ready_dry_run',
        message: `${provider} 配置齐全，可干跑（未设 INTEGRATIONS_LIVE=1，不做真实 HTTP）`,
        meta: { live: false, contract: (row.meta as any)?.contract || null },
      };
      await this.saveProbe(provider, r);
      await this.audit.log({
        action: `integration.${provider}.probe`,
        actor: 'ops',
        targetType: 'IntegrationConfig',
        targetId: provider,
        meta: r as any,
      });
      return { ...r, config: this.safe(await this.reload(provider)) };
    }

    // 真探测：打一个轻量 GET/HEAD
    try {
      const healthUrl =
        provider === 'chatwoot'
          ? `${row.baseUrl.replace(/\/$/, '')}/auth/sign_in`
          : `${row.baseUrl.replace(/\/$/, '')}/api/health`;
      const res = await fetchWithTimeoutRetry(healthUrl, {
        method: 'GET',
        headers: {
          api_access_token: row.apiToken || '',
          Authorization: `Bearer ${row.apiToken || ''}`,
        },
      });
      const r = {
        ok: res.status < 500,
        status: res.ok || res.status === 401 || res.status === 404 ? 'live_reachable' : 'live_error',
        message: `真实探测 HTTP ${res.status}（attempt ${res.attempt}）`,
        meta: { live: true, httpStatus: res.status, bodyPreview: res.text.slice(0, 120) },
      };
      await this.saveProbe(provider, r);
      await this.audit.log({
        action: `integration.${provider}.probe_live`,
        actor: 'ops',
        targetType: 'IntegrationConfig',
        targetId: provider,
        meta: r as any,
      });
      return { ...r, config: this.safe(await this.reload(provider)) };
    } catch (e: any) {
      const r = {
        ok: false,
        status: 'live_unreachable',
        message: e?.message || String(e),
        meta: { live: true },
      };
      await this.saveProbe(provider, r);
      return { ...r, config: this.safe(await this.reload(provider)) };
    }
  }

  private async reload(provider: string) {
    return this.prisma.integrationConfig.findUniqueOrThrow({ where: { provider } });
  }

  /**
   * 干跑契约：固定 stubPayload 形状，写 JobLog + Audit。
   * INTEGRATIONS_LIVE=1 才真 HTTP（超时+重试+审计）。
   */
  async dryRunSend(
    provider: string,
    payload: { leadId?: string; matchId?: string; title?: string; body?: string; channel?: string },
  ) {
    const probe = await this.probe(provider);
    const live = process.env.INTEGRATIONS_LIVE === '1';
    const job = await this.prisma.jobLog.create({
      data: {
        queue: 'integrations',
        jobName: `${provider}.send`,
        payload: { ...payload, live, probeStatus: (probe as any).status } as any,
        status: 'running',
        message: live ? '尝试真实外发…' : '干跑中…',
      },
    });

    const contractAction = provider === 'chatwoot' ? 'create_conversation' : 'publish_draft';
    const stubPayload = {
      provider,
      action: contractAction,
      title: payload.title || '',
      body: (payload.body || '').slice(0, 200),
      channel: payload.channel || (provider === 'aitoearn' ? 'wechat' : 'inbox'),
      leadId: payload.leadId || null,
      matchId: payload.matchId || null,
      source: 'yanqi-match',
      schemaVersion: 1,
    };

    if (!probe.ok && (probe as any).status !== 'ready_dry_run' && (probe as any).status !== 'live_reachable') {
      // probe.ok false for disabled/incomplete — block
      if (['disabled', 'incomplete', 'missing', 'live_unreachable'].includes((probe as any).status)) {
        const updated = await this.prisma.jobLog.update({
          where: { id: job.id },
          data: { status: 'failed', message: probe.message },
        });
        return { ok: false, status: 'blocked', message: probe.message, job: updated, probe, stubPayload };
      }
    }

    if (!live) {
      const updated = await this.prisma.jobLog.update({
        where: { id: job.id },
        data: {
          status: 'dry_run',
          message:
            provider === 'chatwoot'
              ? '已干跑：模拟创建 Chatwoot 会话（未连外网）'
              : '已干跑：模拟同步 AiToEarn 草稿（未连外网）',
          payload: { ...payload, live: false, stubPayload } as any,
        },
      });
      await this.audit.log({
        action: `integration.${provider}.dry_run`,
        actor: 'ops',
        targetType: payload.leadId ? 'Lead' : 'MatchResult',
        targetId: payload.leadId || payload.matchId || undefined,
        meta: stubPayload as any,
      });
      return {
        ok: true,
        status: 'dry_run',
        message: updated.message,
        stubPayload,
        contract: { schemaVersion: 1, requiredFields: ['provider', 'action', 'title', 'body', 'channel'] },
        job: updated,
      };
    }

    const row = await this.prisma.integrationConfig.findUnique({ where: { provider } });
    try {
      const url =
        provider === 'chatwoot'
          ? `${row!.baseUrl!.replace(/\/$/, '')}/api/v1/accounts/${(row!.meta as any)?.accountId || '1'}/conversations`
          : `${row!.baseUrl!.replace(/\/$/, '')}/api/publish`;
      const res = await fetchWithTimeoutRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          api_access_token: row!.apiToken || '',
          Authorization: `Bearer ${row!.apiToken || ''}`,
        },
        body: JSON.stringify({
          title: payload.title,
          content: payload.body,
          channel: payload.channel,
          meta: { leadId: payload.leadId, matchId: payload.matchId, source: 'yanqi-match' },
        }),
      });
      const updated = await this.prisma.jobLog.update({
        where: { id: job.id },
        data: {
          status: res.ok ? 'sent' : 'failed',
          message: res.ok
            ? `外发成功 HTTP ${res.status}`
            : `外发失败 HTTP ${res.status}: ${res.text.slice(0, 200)}`,
          payload: { ...payload, live: true, httpStatus: res.status, attempt: res.attempt } as any,
        },
      });
      await this.audit.log({
        action: `integration.${provider}.live_send`,
        actor: 'ops',
        targetType: payload.leadId ? 'Lead' : 'MatchResult',
        targetId: payload.leadId || payload.matchId || undefined,
        meta: { ok: res.ok, status: res.status, attempt: res.attempt },
      });
      await this.saveProbe(provider, {
        ok: res.ok,
        status: res.ok ? 'live_sent' : 'live_send_failed',
        message: updated.message || '',
        meta: { httpStatus: res.status },
      });
      return { ok: res.ok, status: updated.status, message: updated.message, job: updated, stubPayload };
    } catch (e: any) {
      const updated = await this.prisma.jobLog.update({
        where: { id: job.id },
        data: { status: 'failed', message: e?.message || String(e) },
      });
      await this.audit.log({
        action: `integration.${provider}.live_error`,
        actor: 'ops',
        targetType: 'IntegrationConfig',
        targetId: provider,
        meta: { error: e?.message || String(e) },
      });
      return { ok: false, status: 'failed', message: updated.message, job: updated, stubPayload };
    }
  }

  safe(row: any) {
    return {
      provider: row.provider,
      enabled: row.enabled,
      baseUrl: row.baseUrl,
      hasToken: Boolean(row.apiToken),
      note: row.note,
      meta: row.meta,
      lastProbeAt: row.lastProbeAt,
      lastProbeOk: row.lastProbeOk,
      lastProbeStatus: row.lastProbeStatus,
      lastProbeMessage: row.lastProbeMessage,
      lastProbeMeta: row.lastProbeMeta,
      updatedAt: row.updatedAt,
    };
  }
}
