import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac, randomBytes } from 'crypto';
import { FlagsService } from '../flags/flags.service';

export type PartnerEvent = 'match.approved' | 'lead.sent' | 'deal.moved' | string;

const EMAIL_KEYS = new Set(['to', 'email', 'actorEmail', 'personEmail', 'from', 'replyTo']);

function scrubOutbound(value: any): any {
  if (Array.isArray(value)) return value.map(scrubOutbound);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (EMAIL_KEYS.has(key) && typeof item === 'string') out[key] = item ? '已隐去' : item;
    else out[key] = scrubOutbound(item);
  }
  return out;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService, private flags: FlagsService) {}

  secret() {
    return process.env.PARTNER_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET || 'yanqi-partner-webhook-demo';
  }

  liveEnabled() {
    return process.env.WEBHOOK_LIVE === '1' || process.env.PARTNER_WEBHOOK_LIVE === '1';
  }

  targetUrl() {
    return process.env.PARTNER_WEBHOOK_URL || process.env.WEBHOOK_URL || '';
  }

  sign(body: string, ts: number) {
    const base = `${ts}.${body}`;
    return createHmac('sha256', this.secret()).update(base).digest('hex');
  }

  status() {
    return {
      ok: true,
      live: this.liveEnabled(),
      urlConfigured: Boolean(this.targetUrl()),
      urlHint: this.targetUrl() ? this.targetUrl().replace(/:\/\/.*@/, '://***@').slice(0, 80) : null,
      secretConfigured: Boolean(process.env.PARTNER_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET),
      noteZh:
        '默认干跑：写入投递日志并算好 HMAC，不真 POST。设 PARTNER_WEBHOOK_URL + WEBHOOK_LIVE=1 才外发。签名头：X-Yanqi-Timestamp / X-Yanqi-Signature (sha256=…)。事件：match.approved / lead.sent / deal.moved。',
      events: ['match.approved', 'lead.sent', 'deal.moved'],
      headers: {
        'X-Yanqi-Timestamp': 'unix 秒',
        'X-Yanqi-Signature': 'sha256=<hmac_hex of `${ts}.${rawBody}`>',
        'X-Yanqi-Event': '事件名',
        'X-Yanqi-Delivery': '投递 id',
      },
    };
  }

  async listDeliveries(take = 40) {
    return this.prisma.webhookDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, take)),
      include: { endpoint: { select: { id: true, name: true, url: true, enabled: true } } },
    });
  }

  async listEndpoints() {
    return this.prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async ensureDefaultEndpoint() {
    const url = this.targetUrl() || 'https://example.invalid/yanqi-webhook';
    let ep = await this.prisma.webhookEndpoint.findFirst({ where: { url } });
    if (!ep) {
      ep = await this.prisma.webhookEndpoint.create({
        data: {
          name: '环境默认端点',
          url,
          secret: this.secret(),
          events: ['match.approved', 'lead.sent', 'deal.moved'],
          enabled: Boolean(this.targetUrl()),
          note: '由 PARTNER_WEBHOOK_URL 驱动；无 URL 时占位且不启用',
        },
      });
    }
    return ep;
  }

  async emit(event: PartnerEvent, payload: Record<string, any>, tenantId = 'default') {
    const allowed = await this.flags.isEnabled('webhooks', tenantId);
    if (!allowed) {
      this.logger.warn(`webhook skipped: flag webhooks off tenant=${tenantId} event=${event}`);
      return { ok: false, skipped: true, message: '功能开关 webhooks 已关闭，未投递' };
    }
    const bodyObj = {
      id: `evt_${randomBytes(8).toString('hex')}`,
      event,
      createdAt: new Date().toISOString(),
      tenantId,
      data: scrubOutbound(payload),
    };
    const body = JSON.stringify(bodyObj);
    const ts = Math.floor(Date.now() / 1000);
    const sigHex = this.sign(body, ts);
    const signature = `sha256=${sigHex}`;
    const live = this.liveEnabled() && Boolean(this.targetUrl());
    let endpointId: string | null = null;
    try {
      const ep = await this.ensureDefaultEndpoint();
      endpointId = ep.id;
    } catch (e: any) {
      this.logger.warn(`ensure endpoint failed: ${e?.message || e}`);
    }

    const row = await this.prisma.webhookDelivery.create({
      data: {
        endpointId,
        tenantId,
        event,
        payload: bodyObj,
        status: live ? 'pending' : 'dry_run',
        attempts: 0,
        signature,
        dryRun: !live,
      },
    });

    if (!live) {
      this.logger.log(`webhook dry-run ${event} delivery=${row.id}`);
      return {
        ok: true,
        dryRun: true,
        deliveryId: row.id,
        signature,
        message: '已干跑记账，未外发（WEBHOOK_LIVE≠1 或未配 URL）',
      };
    }

    return this.attemptDeliver(row.id, body, ts, signature);
  }

  async attemptDeliver(id: string, body?: string, ts?: number, signature?: string) {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('投递记录不存在');
    const url = this.targetUrl();
    if (!url) {
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: { status: 'failed', lastError: '未配置 PARTNER_WEBHOOK_URL', attempts: { increment: 1 } },
      });
      return { ok: false, message: '未配置 URL' };
    }
    const payloadStr = body || JSON.stringify(row.payload);
    const timestamp = ts || Math.floor(Date.now() / 1000);
    const sig = signature || `sha256=${this.sign(payloadStr, timestamp)}`;
    const attempt = row.attempts + 1;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Yanqi-Timestamp': String(timestamp),
          'X-Yanqi-Signature': sig,
          'X-Yanqi-Event': row.event,
          'X-Yanqi-Delivery': row.id,
          'User-Agent': 'YanqiMatch-Webhook/1.0',
        },
        body: payloadStr,
      });
      const ok = res.status >= 200 && res.status < 300;
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: {
          attempts: attempt,
          lastStatusCode: res.status,
          signature: sig,
          status: ok ? 'delivered' : 'failed',
          lastError: ok ? null : `HTTP ${res.status}`,
          deliveredAt: ok ? new Date() : null,
          nextRetryAt: ok ? null : new Date(Date.now() + Math.min(3600_000, 5_000 * 2 ** Math.min(attempt, 6))),
          dryRun: false,
        },
      });
      return { ok, deliveryId: id, status: ok ? 'delivered' : 'failed', httpStatus: res.status };
    } catch (e: any) {
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: {
          attempts: attempt,
          status: 'failed',
          lastError: String(e?.message || e).slice(0, 300),
          nextRetryAt: new Date(Date.now() + Math.min(3600_000, 5_000 * 2 ** Math.min(attempt, 6))),
          dryRun: false,
        },
      });
      return { ok: false, deliveryId: id, message: String(e?.message || e) };
    }
  }

  async retryDue(limit = 10) {
    const now = new Date();
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'failed', nextRetryAt: { lte: now }, dryRun: false },
      take: Math.min(50, Math.max(1, limit)),
      orderBy: { nextRetryAt: 'asc' },
    });
    const results = [];
    for (const d of due) {
      results.push(await this.attemptDeliver(d.id));
    }
    return { ok: true, retried: results.length, results };
  }

  /** 手动重试一条 */
  async retryOne(id: string) {
    return this.attemptDeliver(id);
  }

  /** 自测：干跑或按环境外发一条 ping */
  async selfTest() {
    return this.emit('webhook.ping', { ping: true, at: new Date().toISOString() }, 'default');
  }
}
