import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MetricsService } from './metrics.service';
import { homeCacheAlert, homeCacheCurveShellAlert } from '../workbench/home-cache-stats';
import { inboxDeltaCacheAlert, inboxDeltaCurveShellAlert } from '../workbench/inbox-delta-cache';
import {
  dispatchHomeCacheCurveAlertDualChannel,
  dispatchInboxDeltaCurveAlertDualChannel,
} from '../workbench/curve-alert-channels';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

export type OpsAlert = {
  id: string;
  kind: 'queue_backlog' | 'error_rate' | 'smtp_unreachable' | 'match_eval' | 'home_cache_hit_rate' | 'inbox_delta_hit_rate' | 'info';
  level: 'info' | 'warn' | 'critical';
  message: string;
  at: string;
  meta?: any;
  acked?: boolean;
};

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private dir = join(process.cwd(), '.data', 'alerts');
  private file = join(this.dir, 'latest.json');
  private lastWebhookAt = 0;

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private metrics: MetricsService,
  ) {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    } catch (_) {}
  }

  private readStore(): { alerts: OpsAlert[]; evaluatedAt?: string } {
    try {
      if (!existsSync(this.file)) return { alerts: [] };
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return { alerts: [] };
    }
  }

  private writeStore(data: { alerts: OpsAlert[]; evaluatedAt: string }) {
    writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  list() {
    const store = this.readStore();
    const active = (store.alerts || []).filter((a) => !a.acked);
    const channels = {
      inApp: {
        id: 'in_app_badge',
        labelZh: '通道一：运维台徽章',
        noteZh: '打开运维台就能看到告警数量；点评估会刷新。',
        live: true,
      },
      fileSink: {
        id: 'file_sink',
        labelZh: '通道二：本地文件槽',
        path: '.data/alerts/channel2-sink.jsonl',
        noteZh: '每条活跃告警追加一行 JSON；适合值班脚本 tail -f，不是邮件、不是短信。',
        live: true,
      },
      webhookStub: {
        id: 'webhook_stub',
        labelZh: '可选 webhook（干跑）',
        configured: Boolean(process.env.OPS_ALERT_WEBHOOK_URL),
        live: process.env.OPS_ALERT_WEBHOOK_LIVE === '1',
        noteZh:
          '配置 OPS_ALERT_WEBHOOK_URL 后默认只写干跑文件；只有 OPS_ALERT_WEBHOOK_LIVE=1 才真 POST。未接企业微信/飞书实机。',
      },
    };
    return {
      ok: true,
      evaluatedAt: store.evaluatedAt || null,
      activeCount: active.length,
      criticalCount: active.filter((a) => a.level === 'critical').length,
      warnCount: active.filter((a) => a.level === 'warn').length,
      alerts: store.alerts || [],
      channels,
      escalationZh:
        active.some((a) => a.level === 'critical')
          ? '有紧急告警：先看任务队列与匹配评测；邮件若不可达多半是出网拦截，别反复点真发。'
          : active.some((a) => a.kind === 'home_cache_hit_rate')
            ? '首页短缓存命中率偏低：少强制 ?fresh=1，确认写后 bust 后是否复用 ETag；详见 /api/metrics/home-cache。'
            : active.length
              ? '有告警待处理：优先确认 SMTP/队列，再决定是否重跑任务。'
              : '当前无活跃告警。',
      webhookStub: channels.webhookStub,
    };
  }

  ack(id: string) {
    const store = this.readStore();
    for (const a of store.alerts || []) {
      if (a.id === id) a.acked = true;
    }
    this.writeStore({ alerts: store.alerts || [], evaluatedAt: store.evaluatedAt || new Date().toISOString() });
    return { ok: true, id };
  }

  async evaluate(actor = 'system') {
    const alerts: OpsAlert[] = [];
    const now = new Date().toISOString();
    const push = (a: Omit<OpsAlert, 'id' | 'at' | 'acked'>) => {
      alerts.push({ ...a, id: `${a.kind}-${Date.now()}-${alerts.length}`, at: now, acked: false });
    };

    // queue
    const q = await this.metrics.checkQueueBacklog(actor).catch(() => null);
    if (q?.alert) {
      push({
        kind: 'queue_backlog',
        level: (q.alert.level as any) || 'warn',
        message: q.alert.message,
        meta: { failed24h: q.failed24h, runningOrQueued: q.runningOrQueued },
      });
    }

    // error rate from latency samples (5xx)
    const lat = this.metrics.latencySummary(15 * 60_000) as any;
    const er = this.metrics.errorRateSummary(15 * 60_000);
    if (er.total >= 20 && er.rate >= 0.05) {
      push({
        kind: 'error_rate',
        level: er.rate >= 0.15 ? 'critical' : 'warn',
        message: `近 15 分钟 5xx 占比 ${(er.rate * 100).toFixed(1)}%（${er.err5xx}/${er.total}），请看慢接口与任务日志。`,
        meta: { ...er, p95: lat?.p95 },
      });
    }

    // smtp
    const smtp = this.mail.getCachedHealth();
    if (smtp.configured && smtp.reachable === false) {
      push({
        kind: 'smtp_unreachable',
        level: 'warn',
        message: smtp.lastErrorZh || 'SMTP 不可达（常见：沙箱出网拦了 587/465）',
        meta: { host: smtp.host, egressHint: smtp.egressHint },
      });
    }

    // match eval
    try {
      const p = join(process.cwd(), '.data', 'metrics', 'match-eval-latest.json');
      if (existsSync(p)) {
        const ev = JSON.parse(readFileSync(p, 'utf8'));
        if (ev && ev.ok === false) {
          push({
            kind: 'match_eval',
            level: 'critical',
            message: `匹配评测未通过：${(ev.failures || []).slice(0, 3).join('；') || '见 match-eval-latest.json'}`,
            meta: { passed: ev.passed, total: ev.total },
          });
        }
      }
    } catch (_) {}

    // M47：home 短缓存命中率过低
    try {
      const hc = homeCacheAlert();
      if (hc.alerting) {
        push({
          kind: 'home_cache_hit_rate',
          level: 'warn',
          message: hc.messageZh,
          meta: {
            hitRate: hc.hitRate,
            hitRatePct: hc.hitRatePct,
            threshold: hc.threshold,
            samples: hc.samples,
            minSamples: hc.minSamples,
          },
        });
      }
    } catch (_) {}

    // M51：分壳曲线持续偏低 → 运维徽章 + 双通道草稿
    try {
      const curve = homeCacheCurveShellAlert();
      if (curve.alerting) {
        push({
          kind: 'home_cache_hit_rate',
          level: 'warn',
          message: curve.messageZh,
          meta: {
            source: 'curve_shell',
            shells: (curve.shells || []).filter((s: any) => s.alerting).map((s: any) => s.shell),
            threshold: curve.threshold,
            dualChannel: true,
          },
        });
      }
      dispatchHomeCacheCurveAlertDualChannel({});
    } catch (_) {}

    // M64：收件箱 delta 分壳持续偏低 → 徽章 + 自愈提示 + 双通道干跑
    try {
      const idc = inboxDeltaCacheAlert();
      if (idc.alerting) {
        push({
          kind: 'inbox_delta_hit_rate',
          level: 'warn',
          message: idc.messageZh,
          meta: {
            hitRate: idc.hitRate,
            hitRatePct: idc.hitRatePct,
            threshold: idc.threshold,
            samples: idc.samples,
            minSamples: idc.minSamples,
          },
        });
      }
      const curve = inboxDeltaCurveShellAlert();
      if (curve.alerting) {
        push({
          kind: 'inbox_delta_hit_rate',
          level: 'warn',
          message: curve.messageZh,
          meta: {
            source: 'curve_shell',
            shells: (curve.shells || []).filter((s: any) => s.alerting).map((s: any) => s.shell),
            threshold: curve.threshold,
            dualChannel: true,
            selfHealHintsZh: curve.selfHealHintsZh || [],
            suggestedBustShells: curve.selfHeal?.suggestedBustShells || [],
          },
        });
      }
      dispatchInboxDeltaCurveAlertDualChannel({});
    } catch (_) {}

    // keep recent acked history (last 30) + new active
    const prev = this.readStore().alerts || [];
    const ackedKeep = prev.filter((a) => a.acked).slice(-20);
    const merged = [...ackedKeep, ...alerts].slice(-50);
    this.writeStore({ alerts: merged, evaluatedAt: now });

    this.appendFileSink(alerts);
    await this.maybeWebhook(alerts);

    if (alerts.length) {
      this.logger.warn(`ops alerts: ${alerts.map((a) => a.kind + '/' + a.level).join(', ')}`);
    }
    return this.list();
  }

  /** 通道二：追加 JSONL，给值班脚本用 */
  private appendFileSink(alerts: OpsAlert[]) {
    if (!alerts.length) return;
    try {
      const sink = join(this.dir, 'channel2-sink.jsonl');
      const lines = alerts
        .map((a) =>
          JSON.stringify({
            channel: 'file_sink',
            labelZh: '通道二：本地文件槽',
            ...a,
            escalationZh:
              a.level === 'critical'
                ? '紧急：先停批量重跑，查队列与评测；SMTP 不通别硬发。'
                : '留意：看运维徽章详情后再动手。',
          }),
        )
        .join('\n');
      appendFileSync(sink, lines + '\n', 'utf8');
    } catch (e: any) {
      this.logger.warn('file sink write failed: ' + (e?.message || e));
    }
  }

  private async maybeWebhook(alerts: OpsAlert[]) {
    const url = process.env.OPS_ALERT_WEBHOOK_URL;
    if (!url || !alerts.length) return;
    if (Date.now() - this.lastWebhookAt < 60_000) return;
    this.lastWebhookAt = Date.now();
    // 明确干跑：除非 OPS_ALERT_WEBHOOK_LIVE=1，否则只记日志不发
    const live = process.env.OPS_ALERT_WEBHOOK_LIVE === '1';
    const payload = {
      stub: !live,
      product: '研企通',
      noteZh: live ? 'LIVE 开关已开，尝试 POST' : '干跑桩：未设置 OPS_ALERT_WEBHOOK_LIVE=1，不真实外发',
      alerts,
      at: new Date().toISOString(),
    };
    if (!live) {
      try {
        writeFileSync(join(this.dir, 'webhook-dry-run-latest.json'), JSON.stringify(payload, null, 2));
      } catch (_) {}
      return;
    }
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      this.logger.warn(`alert webhook failed: ${e?.message || e}`);
    }
  }
}
