/**
 * M51：分壳命中曲线告警双通道
 * 通道一：运营台横幅 / 曲线摘要（已有 GET .../curve/alerts）
 * 通道二：站内通知草稿 + Webhook 干跑 + 邮件草稿桩（中文文案，默认不真发）
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homeCacheCurveShellAlert } from './home-cache-stats';
import { inboxDeltaCurveShellAlert } from './inbox-delta-cache';

const ALERT_DIR = join(process.cwd(), '.data', 'alerts');
const NOTIFY_DRAFT = join(ALERT_DIR, 'curve-alert-notify-draft.json');
const WEBHOOK_DRY = join(ALERT_DIR, 'curve-alert-webhook-dry-run.json');
const EMAIL_DRAFT = join(ALERT_DIR, 'curve-alert-email-draft.json');
const LATEST = join(ALERT_DIR, 'curve-alert-dual-latest.json');

function ensureDir() {
  if (!existsSync(ALERT_DIR)) mkdirSync(ALERT_DIR, { recursive: true });
}

export function dispatchHomeCacheCurveAlertDualChannel(opts?: {
  lookback?: number;
  minPoints?: number;
  force?: boolean;
}) {
  ensureDir();
  const alert = homeCacheCurveShellAlert({
    lookback: opts?.lookback,
    minPoints: opts?.minPoints,
  });
  const at = new Date().toISOString();
  const alertingShells = (alert.shells || []).filter((s) => s.alerting).map((s) => s.shell);
  const titleZh = alert.alerting
    ? `【研企通】首页短缓存命中曲线持续偏低：${alertingShells.join('、') || '多壳'}`
    : '【研企通】首页短缓存命中曲线正常';
  const bodyZh = alert.alerting
    ? `${alert.messageZh}\n\n建议：少用 ?fresh=1 强制刷新；确认写后 bust 后是否复用 ETag；对照 /api/metrics/home-cache/curve。\n本通知为通道二草稿/干跑，默认不外发邮件或 Webhook。`
    : `${alert.messageZh}\n样本与阈值见运营台「命中曲线」。无需值班动作。`;

  const channel1 = {
    id: 'ops_banner',
    labelZh: '通道一：运营台横幅 / 曲线摘要',
    live: true,
    delivered: true,
    copyZh: alert.messageZh,
    pathHint: '/api/metrics/home-cache/curve/alerts · 运营台观测页',
  };

  const notifyDraft = {
    channel: 'in_app_notify_draft',
    labelZh: '站内通知草稿（未推送真实用户收件箱）',
    at,
    titleZh,
    bodyZh,
    level: alert.level,
    alerting: alert.alerting,
    shells: alertingShells,
    wave: 'M51',
    noteZh: '草稿已落盘；接入真实站内信/IM 后可由此模板推送。当前不打扰终端用户。',
  };

  const webhookDry = {
    stub: true,
    live: false,
    product: '研企通',
    kind: 'home_cache_curve_alert',
    at,
    titleZh,
    bodyZh,
    alerting: alert.alerting,
    shells: alertingShells,
    thresholdPct: alert.thresholdPct,
    noteZh:
      'Webhook 干跑：未真实 POST。配置 OPS_ALERT_WEBHOOK_URL 且 OPS_ALERT_WEBHOOK_LIVE=1 时，可走通用告警 evaluate 通道；曲线专用仍默认干跑以免刷屏。',
    payloadPreview: {
      text: `${titleZh}\n${bodyZh}`,
      level: alert.level,
    },
    wave: 'M51',
  };

  const emailDraft = {
    channel: 'email_draft_stub',
    labelZh: '邮件草稿桩（不真发）',
    at,
    toZh: '运维值班邮箱（未配置则仅存草稿）',
    subjectZh: titleZh,
    textZh: bodyZh,
    htmlZh: `<p><strong>${titleZh}</strong></p><pre style="white-space:pre-wrap;font-family:sans-serif">${bodyZh.replace(/</g, '&lt;')}</pre><p style="color:#666">此为研企通 M51 曲线告警邮件草稿桩，CONFIRM_LIVE_SEND 未开时不会外发。</p>`,
    liveSend: false,
    noteZh: '邮件草稿已写本地文件；真发需 SMTP 双确认，本接口从不自动真发。',
    wave: 'M51',
  };

  // 告警中或 force 时刷新通道二产物；正常时也写一份 latest 方便冒烟核对
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
      notifyDraft: '.data/alerts/curve-alert-notify-draft.json',
      webhookDryRun: '.data/alerts/curve-alert-webhook-dry-run.json',
      emailDraft: '.data/alerts/curve-alert-email-draft.json',
    },
    noteZh: '默认干跑/草稿；中文标题与正文已写好，接真实通道时直接复用。',
  };

  const result = {
    ok: true as const,
    wave: 'M51',
    dualChannel: true as const,
    at,
    alerting: alert.alerting,
    level: alert.level,
    messageZh: alert.messageZh,
    tipZh: alert.alerting
      ? '已走双通道：运营台横幅（通道一）+ 通知/Webhook/邮件草稿桩（通道二，不真发）。'
      : '曲线正常：仍刷新双通道草稿为「正常」状态，便于核对文案与落盘路径。',
    channels: { channel1, channel2 },
    alert,
  };
  writeFileSync(LATEST, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

export function peekCurveAlertDualChannelLatest() {
  try {
    if (!existsSync(LATEST)) {
      return {
        ok: true,
        empty: true,
        wave: 'M51',
        tipZh: '尚未派发过双通道；POST /api/metrics/home-cache/curve/alerts/notify 可生成草稿。',
      };
    }
    return { ok: true, empty: false, ...(JSON.parse(readFileSync(LATEST, 'utf8')) as object) };
  } catch {
    return { ok: false, messageZh: '读取双通道落盘失败' };
  }
}

const INBOX_NOTIFY_DRAFT = join(ALERT_DIR, 'inbox-delta-curve-alert-notify-draft.json');
const INBOX_WEBHOOK_DRY = join(ALERT_DIR, 'inbox-delta-curve-alert-webhook-dry-run.json');
const INBOX_EMAIL_DRAFT = join(ALERT_DIR, 'inbox-delta-curve-alert-email-draft.json');
const INBOX_LATEST = join(ALERT_DIR, 'inbox-delta-curve-alert-dual-latest.json');

/** M65：收件箱分壳偏低 → 双通道干跑 + 自愈提示（不真外发） */
export function dispatchInboxDeltaCurveAlertDualChannel(opts?: {
  lookback?: number;
  minPoints?: number;
  force?: boolean;
  /** M69：壳 HIT 趋势拐点中文（并入双通道干跑正文） */
  inflectionZh?: string | null;
  recoveryZh?: string | null;
  inflectionAlerting?: boolean;
}) {
  ensureDir();
  const alert = inboxDeltaCurveShellAlert({
    lookback: opts?.lookback,
    minPoints: opts?.minPoints,
  });
  const at = new Date().toISOString();
  const alertingShells = (alert.shells || []).filter((s) => s.alerting).map((s) => s.shell);
  const titleZh = alert.alerting
    ? `【研企通】收件箱 delta 命中曲线持续偏低：${alertingShells.join('、') || '多壳'}`
    : opts?.inflectionZh
      ? '【研企通】收件箱壳 HIT 趋势拐点（干跑）'
      : '【研企通】收件箱 delta 命中曲线正常';
  const healLines = (alert.selfHealHintsZh || []).length
    ? '\n\n【自愈提示】\n' + (alert.selfHealHintsZh || []).map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '';
  const inflectionBlock = opts?.inflectionZh
    ? '\n\n【M69 趋势拐点】\n' + String(opts.inflectionZh)
    : '';
  const recoveryBlock = opts?.recoveryZh
    ? '\n\n【M69 复探针回升判定】\n' + String(opts.recoveryZh)
    : '';
  const bodyZh = alert.alerting
    ? `${alert.messageZh}${healLines}${inflectionBlock}${recoveryBlock}\n\n建议：少用 ?fresh=1；确认匹配写后 bust 后是否复用 ETag；对照 /api/metrics/inbox-delta-cache/curve。\n本通知为通道二草稿/干跑，默认不外发邮件或 Webhook。`
    : `${alert.messageZh}${inflectionBlock}${recoveryBlock}\n样本与阈值见运营台收件箱命中徽章。无需值班动作。`;

  const channel1 = {
    id: 'ops_banner',
    labelZh: '通道一：运营台横幅 / 收件箱曲线摘要',
    live: true,
    delivered: true,
    copyZh: alert.messageZh,
    pathHint: '/api/metrics/inbox-delta-cache/curve/alerts · 运营台观测页',
  };

  const notifyDraft = {
    channel: 'in_app_notify_draft',
    labelZh: '站内通知草稿（未推送真实用户收件箱）',
    at,
    titleZh,
    bodyZh,
    level: alert.level,
    alerting: alert.alerting,
    shells: alertingShells,
    wave: 'M65',
    kind: 'inbox_delta_curve_alert',
    noteZh: '草稿已落盘；当前不打扰终端用户。',
  };

  const webhookDry = {
    stub: true,
    live: false,
    product: '研企通',
    kind: 'inbox_delta_curve_alert',
    at,
    titleZh,
    bodyZh,
    alerting: alert.alerting,
    shells: alertingShells,
    thresholdPct: alert.thresholdPct,
    noteZh:
      'Webhook 干跑：未真实 POST。曲线专用默认干跑以免刷屏；不扩张导出/SSE/配额子系统。',
    payloadPreview: {
      text: `${titleZh}\n${bodyZh}`,
      level: alert.level,
    },
    wave: 'M65',
  };

  const emailDraft = {
    channel: 'email_draft_stub',
    labelZh: '邮件草稿桩（不真发）',
    at,
    toZh: '运维值班邮箱（未配置则仅存草稿）',
    subjectZh: titleZh,
    textZh: bodyZh,
    htmlZh: `<p><strong>${titleZh}</strong></p><pre style="white-space:pre-wrap;font-family:sans-serif">${bodyZh.replace(/</g, '&lt;')}</pre><p style="color:#666">此为研企通 M64 收件箱曲线告警邮件草稿桩（含自愈提示），不自动真发。</p>`,
    liveSend: false,
    noteZh: '邮件草稿已写本地文件；真发需 SMTP 双确认，本接口从不自动真发。',
    wave: 'M65',
  };

  writeFileSync(INBOX_NOTIFY_DRAFT, JSON.stringify(notifyDraft, null, 2), 'utf8');
  writeFileSync(INBOX_WEBHOOK_DRY, JSON.stringify(webhookDry, null, 2), 'utf8');
  writeFileSync(INBOX_EMAIL_DRAFT, JSON.stringify(emailDraft, null, 2), 'utf8');

  const channel2 = {
    id: 'notify_webhook_email_stub',
    labelZh: '通道二：站内通知草稿 + Webhook 干跑 + 邮件草稿桩',
    live: false,
    delivered: true,
    copyZh: bodyZh,
    files: {
      notifyDraft: '.data/alerts/inbox-delta-curve-alert-notify-draft.json',
      webhookDryRun: '.data/alerts/inbox-delta-curve-alert-webhook-dry-run.json',
      emailDraft: '.data/alerts/inbox-delta-curve-alert-email-draft.json',
    },
    noteZh: '默认干跑/草稿；中文标题与正文已写好。',
  };

  const result = {
    ok: true as const,
    wave: 'M70',
    dualChannel: true as const,
    kind: 'inbox_delta_curve_alert',
    at,
    alerting: Boolean(alert.alerting) || Boolean(opts?.inflectionAlerting),
    level: alert.level,
    messageZh: alert.messageZh,
    inflectionZh: opts?.inflectionZh || null,
    recoveryZh: opts?.recoveryZh || null,
    tipZh: alert.alerting
      ? '已走双通道：运营台横幅（通道一）+ 通知/Webhook/邮件草稿桩（通道二，不真发）。'
      : opts?.inflectionZh
        ? '已将趋势拐点文案写入双通道干跑草稿（不真外发）。'
        : '曲线正常：仍刷新双通道草稿为「正常」状态，便于核对文案与落盘路径。',
    channels: { channel1, channel2 },
    alert,
    selfHealHintsZh: alert.selfHealHintsZh || [],
    selfHeal: alert.selfHeal || null,
  };
  writeFileSync(INBOX_LATEST, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

export function peekInboxDeltaCurveAlertDualChannelLatest() {
  try {
    if (!existsSync(INBOX_LATEST)) {
      return {
        ok: true,
        empty: true,
        wave: 'M65',
        tipZh: '尚未派发过收件箱双通道；POST /api/metrics/inbox-delta-cache/curve/alerts/notify 可生成草稿。',
      };
    }
    return { ok: true, empty: false, ...(JSON.parse(readFileSync(INBOX_LATEST, 'utf8')) as object) };
  } catch {
    return { ok: false, messageZh: '读取收件箱双通道落盘失败' };
  }
}
