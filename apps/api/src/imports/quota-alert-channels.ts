/**
 * M53：导出租户配额告警双通道
 * 通道一：运营台徽章 / GET .../quota-warnings（已有）
 * 通道二：站内通知草稿 + Webhook 干跑 + 邮件草稿桩（中文文案，默认不真发）
 * 级别：near(soft) / critical / over（与徽章一致）
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tenantExportQuotaWarnings, type TenantQuotaWarnLevel } from './conflict-export-async';

const ALERT_DIR = join(process.cwd(), '.data', 'alerts');
const NOTIFY_DRAFT = join(ALERT_DIR, 'quota-alert-notify-draft.json');
const WEBHOOK_DRY = join(ALERT_DIR, 'quota-alert-webhook-dry-run.json');
const EMAIL_DRAFT = join(ALERT_DIR, 'quota-alert-email-draft.json');
const LATEST = join(ALERT_DIR, 'quota-alert-dual-latest.json');

function ensureDir() {
  if (!existsSync(ALERT_DIR)) mkdirSync(ALERT_DIR, { recursive: true });
}

function levelTitleZh(level: TenantQuotaWarnLevel): string {
  if (level === 'over') return '已超额';
  if (level === 'critical') return '危急';
  if (level === 'near') return '接近上限';
  return '正常';
}

export function dispatchExportQuotaAlertDualChannel(opts?: {
  tenantId?: string | null;
  force?: boolean;
}) {
  ensureDir();
  const warn = tenantExportQuotaWarnings({ tenantId: opts?.tenantId });
  const at = new Date().toISOString();
  const alerting = warn.worstLevel !== 'ok';
  const names = (warn.warnings || []).map((w) => w.tenantId).slice(0, 8);
  const titleZh = alerting
    ? `【研企通】导出租户磁盘配额${levelTitleZh(warn.worstLevel)}：${names.join('、') || '多租户'}`
    : '【研企通】导出租户磁盘配额正常';
  const detailLines = (warn.warnings.length ? warn.warnings : warn.tenants.slice(0, 3))
    .map((w) => `· ${w.tenantId}：${w.badgeZh}（${Math.round(w.bytes / 1024)}KB / ${Math.round(w.quotaBytes / 1048576)}MB）`)
    .join('\n');
  const bodyZh = alerting
    ? `${warn.badgeZh}\n${warn.tipZh}\n\n${detailLines}\n\n建议：运营台点「清理导出产物」或 POST .../conflict-export/async/cleanup；也可扩 CONFLICT_EXPORT_TENANT_DISK_QUOTA_BYTES。\n本通知为通道二草稿/干跑，默认不外发邮件或 Webhook。`
    : `${warn.badgeZh}\n${warn.tipZh}\n样本与阈值见运营台「导出租户配额」徽章。无需值班动作。`;

  const channel1 = {
    id: 'ops_badge',
    labelZh: '通道一：运营台配额徽章 / quota-warnings',
    live: true,
    delivered: true,
    copyZh: warn.badgeZh,
    level: warn.worstLevel,
    pathHint: '/api/imports/enterprise/conflict-export/async/quota-warnings · 运营台观测页',
  };

  const notifyDraft = {
    channel: 'in_app_notify_draft',
    labelZh: '站内通知草稿（未推送真实用户收件箱）',
    at,
    titleZh,
    bodyZh,
    level: warn.worstLevel,
    alerting,
    tenants: names,
    wave: 'M53',
    noteZh: '草稿已落盘；接入真实站内信/IM 后可由此模板推送。当前不打扰终端用户。',
  };

  const webhookDry = {
    stub: true,
    live: false,
    product: '研企通',
    kind: 'export_tenant_quota_alert',
    at,
    titleZh,
    bodyZh,
    alerting,
    level: warn.worstLevel,
    softRatio: warn.softRatio,
    criticalRatio: warn.criticalRatio,
    noteZh:
      'Webhook 干跑：未真实 POST。配置 OPS_ALERT_WEBHOOK_URL 且 OPS_ALERT_WEBHOOK_LIVE=1 时，可走通用告警通道；配额专用仍默认干跑以免刷屏。',
    payloadPreview: {
      text: `${titleZh}\n${bodyZh}`,
      level: warn.worstLevel,
      alertingCount: warn.alertingCount,
    },
    wave: 'M53',
  };

  const emailDraft = {
    channel: 'email_draft_stub',
    labelZh: '邮件草稿桩（不真发）',
    at,
    toZh: '运维值班邮箱（未配置则仅存草稿）',
    subjectZh: titleZh,
    textZh: bodyZh,
    htmlZh: `<p><strong>${titleZh}</strong></p><pre style="white-space:pre-wrap;font-family:sans-serif">${bodyZh.replace(/</g, '&lt;')}</pre><p style="color:#666">此为研企通 M53 导出租户配额告警邮件草稿桩，CONFIRM_LIVE_SEND 未开时不会外发。</p>`,
    liveSend: false,
    noteZh: '邮件草稿已写本地文件；真发需 SMTP 双确认，本接口从不自动真发。',
    wave: 'M53',
  };

  writeFileSync(NOTIFY_DRAFT, JSON.stringify(notifyDraft, null, 2), 'utf8');
  writeFileSync(WEBHOOK_DRY, JSON.stringify(webhookDry, null, 2), 'utf8');
  writeFileSync(EMAIL_DRAFT, JSON.stringify(emailDraft, null, 2), 'utf8');

  const channel2 = {
    id: 'notify_webhook_email_stub',
    labelZh: '通道二：站内通知草稿 + Webhook 干跑 + 邮件草稿桩',
    live: false,
    delivered: true,
    copyZh: bodyZh,
    files: {
      notifyDraft: '.data/alerts/quota-alert-notify-draft.json',
      webhookDryRun: '.data/alerts/quota-alert-webhook-dry-run.json',
      emailDraft: '.data/alerts/quota-alert-email-draft.json',
    },
    noteZh: '默认干跑/草稿；中文标题与正文已写好，接真实通道时直接复用。',
  };

  const result = {
    ok: true as const,
    wave: 'M53',
    dualChannel: true as const,
    at,
    alerting,
    level: warn.worstLevel,
    badgeZh: warn.badgeZh,
    messageZh: warn.badgeZh,
    tipZh: alerting
      ? '已走双通道：运营台徽章（通道一）+ 通知/Webhook/邮件草稿桩（通道二，不真发）。'
      : '配额正常：仍刷新双通道草稿为「正常」状态，便于核对文案与落盘路径。',
    channels: { channel1, channel2 },
    warnings: warn,
  };
  writeFileSync(LATEST, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

export function peekExportQuotaAlertDualChannelLatest() {
  try {
    if (!existsSync(LATEST)) {
      return {
        ok: true,
        empty: true,
        wave: 'M53',
        tipZh: '尚未派发过配额双通道；POST /api/imports/enterprise/conflict-export/async/quota-warnings/notify 可生成草稿。',
      };
    }
    return { ok: true, empty: false, ...(JSON.parse(readFileSync(LATEST, 'utf8')) as object) };
  } catch {
    return { ok: false, messageZh: '读取配额双通道落盘失败' };
  }
}
