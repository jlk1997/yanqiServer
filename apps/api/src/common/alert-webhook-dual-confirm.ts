/**
 * M54：告警 Webhook 双确认草稿流
 * create draft → 中文确认卡 → confirm 后仍默认 dry-run（写干跑文件，绝不真出网）
 * 即使误传 live / OPS_ALERT_WEBHOOK_LIVE=1，本流也强制 dry-run stub。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { tenantExportQuotaWarnings } from '../imports/conflict-export-async';
import { homeCacheCurveShellAlert } from '../workbench/home-cache-stats';

export type AlertWebhookDraftKind = 'export_quota' | 'home_cache_curve';
export type AlertWebhookDraftStatus = 'pending_confirm' | 'confirmed_dry_run' | 'cancelled' | 'expired';

export type AlertWebhookDraft = {
  draftId: string;
  kind: AlertWebhookDraftKind;
  status: AlertWebhookDraftStatus;
  titleZh: string;
  bodyZh: string;
  level: string;
  alerting: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  actor?: string | null;
  tenantId?: string | null;
  confirmCard: {
    headingZh: string;
    summaryZh: string;
    riskZh: string;
    stepsZh: string[];
    confirmBtnZh: string;
    cancelBtnZh: string;
    dryRunOnlyZh: string;
    previewBodyZh: string;
  };
  dryRunPath?: string | null;
  confirmedAt?: string | null;
  wave: string;
};

const DATA_DIR = join(process.cwd(), '.data');
const STORE_FILE = join(DATA_DIR, 'alert-webhook-drafts.json');
const DRY_DIR = join(DATA_DIR, 'alerts', 'webhook-dual-confirm');
const drafts = new Map<string, AlertWebhookDraft>();
let loaded = false;
let persistTimer: NodeJS.Timeout | null = null;

const DRAFT_TTL_MS = 30 * 60 * 1000;

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DRY_DIR)) mkdirSync(DRY_DIR, { recursive: true });
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    ensureDirs();
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
      const items = Array.isArray(raw?.items) ? raw.items : [];
      const now = Date.now();
      for (const it of items) {
        if (!it?.draftId) continue;
        if (it.status === 'pending_confirm' && it.expiresAt && Date.parse(it.expiresAt) < now) {
          it.status = 'expired';
          it.updatedAt = new Date().toISOString();
        }
        drafts.set(String(it.draftId), it as AlertWebhookDraft);
      }
    }
  } catch (_) {}
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      ensureDirs();
      const items = [...drafts.values()].slice(-100);
      writeFileSync(
        STORE_FILE,
        JSON.stringify({ wave: 'M54', updatedAt: new Date().toISOString(), items }, null, 0),
        'utf8',
      );
    } catch (_) {}
  }, 40);
}

function touch(d: AlertWebhookDraft, patch: Partial<AlertWebhookDraft>) {
  Object.assign(d, patch, { updatedAt: new Date().toISOString() });
  schedulePersist();
}

function buildQuotaPayload(tenantId?: string | null) {
  const warn = tenantExportQuotaWarnings({ tenantId });
  const names = (warn.warnings || []).map((w) => w.tenantId).slice(0, 8);
  const alerting = warn.worstLevel !== 'ok';
  const titleZh = alerting
    ? `【研企通】导出租户磁盘配额告警：${names.join('、') || '多租户'}`
    : '【研企通】导出租户磁盘配额正常（Webhook 干跑核对）';
  const detailLines = (warn.warnings.length ? warn.warnings : warn.tenants.slice(0, 3))
    .map((w) => `· ${w.tenantId}：${w.badgeZh}（${Math.round(w.bytes / 1024)}KB / ${Math.round(w.quotaBytes / 1048576)}MB）`)
    .join('\n');
  const bodyZh = alerting
    ? `${warn.badgeZh}\n${warn.tipZh}\n\n${detailLines}\n\n建议：运营台清理导出产物或扩 CONFLICT_EXPORT_TENANT_DISK_QUOTA_BYTES。`
    : `${warn.badgeZh}\n${warn.tipZh}\n本草稿仅用于核对 Webhook 双确认文案，默认不会出网。`;
  return {
    titleZh,
    bodyZh,
    level: warn.worstLevel,
    alerting,
    meta: { kind: 'export_quota' as const, names, warn },
  };
}

function buildCurvePayload() {
  const alert = homeCacheCurveShellAlert({});
  const shells = (alert.shells || []).filter((s) => s.alerting).map((s) => s.shell);
  const titleZh = alert.alerting
    ? `【研企通】首页短缓存命中曲线偏低：${shells.join('、') || '多壳'}`
    : '【研企通】首页短缓存命中曲线正常（Webhook 干跑核对）';
  const bodyZh = alert.alerting
    ? `${alert.messageZh}\n\n建议：少用 ?fresh=1；确认写后 bust 与 ETag 复用。`
    : `${alert.messageZh}\n本草稿仅用于核对 Webhook 双确认文案，默认不会出网。`;
  return {
    titleZh,
    bodyZh,
    level: alert.level || 'info',
    alerting: !!alert.alerting,
    meta: { kind: 'home_cache_curve' as const, shells, alert },
  };
}

function makeConfirmCard(kind: AlertWebhookDraftKind, titleZh: string, bodyZh: string, alerting: boolean) {
  const kindZh = kind === 'export_quota' ? '导出租户配额' : '首页命中曲线';
  return {
    headingZh: `确认发送「${kindZh}」告警 Webhook？`,
    summaryZh: titleZh,
    riskZh: alerting
      ? '当前为告警态。确认后仍只写本地干跑文件，不会真实 POST 到企业微信/飞书/任意外网。'
      : '当前为正常态核对。确认后仍只写本地干跑文件，不会真实出网。',
    stepsZh: [
      '① 已创建草稿（待确认）',
      '② 请核对下方中文标题与正文',
      '③ 点「确认干跑」→ 落盘 dry-run，绝不真发',
      '④ 若不想继续，点取消即可',
    ],
    confirmBtnZh: '确认干跑（不真发）',
    cancelBtnZh: '取消草稿',
    dryRunOnlyZh:
      '安全策略：本双确认流强制 dry-run。忽略 live / OPS_ALERT_WEBHOOK_LIVE，也不会发起任何出网 HTTP。',
    previewBodyZh: bodyZh,
  };
}

export function createAlertWebhookDraft(opts: {
  kind: AlertWebhookDraftKind;
  tenantId?: string | null;
  actor?: string | null;
}): { ok: true; draft: AlertWebhookDraft; messageZh: string; confirmPath: string; tipZh: string } {
  ensureLoaded();
  const kind = opts.kind === 'home_cache_curve' ? 'home_cache_curve' : 'export_quota';
  const pack = kind === 'export_quota' ? buildQuotaPayload(opts.tenantId) : buildCurvePayload();
  const draftId = 'awhd_' + randomBytes(10).toString('hex');
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + DRAFT_TTL_MS).toISOString();
  const confirmCard = makeConfirmCard(kind, pack.titleZh, pack.bodyZh, pack.alerting);
  const draft: AlertWebhookDraft = {
    draftId,
    kind,
    status: 'pending_confirm',
    titleZh: pack.titleZh,
    bodyZh: pack.bodyZh,
    level: String(pack.level),
    alerting: pack.alerting,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    actor: opts.actor || null,
    tenantId: opts.tenantId || null,
    confirmCard,
    dryRunPath: null,
    confirmedAt: null,
    wave: 'M54',
  };
  drafts.set(draftId, draft);
  schedulePersist();
  return {
    ok: true,
    draft,
    messageZh: `已创建 ${kind === 'export_quota' ? '配额' : '曲线'} Webhook 草稿，请打开确认卡核对后再点「确认干跑」。`,
    confirmPath: `/api/metrics/alerts/webhook-draft/${draftId}`,
    tipZh: '第二步看确认卡；第三步 confirm 仍 dry-run，不会真出网。',
  };
}

export function getAlertWebhookDraft(draftId: string) {
  ensureLoaded();
  const d = drafts.get(String(draftId));
  if (!d) {
    return {
      ok: false as const,
      empty: true,
      messageZh: '找不到该 Webhook 草稿（可能已过期或已清理）',
    };
  }
  if (d.status === 'pending_confirm' && Date.parse(d.expiresAt) < Date.now()) {
    touch(d, { status: 'expired' });
  }
  return {
    ok: true as const,
    empty: false,
    wave: 'M54',
    draft: d,
    confirmCard: d.confirmCard,
    awaitingConfirm: d.status === 'pending_confirm',
    tipZh:
      d.status === 'pending_confirm'
        ? '请核对确认卡中文内容，再 POST .../confirm 执行干跑；或 POST .../cancel 取消。'
        : d.status === 'confirmed_dry_run'
          ? '已确认并完成干跑落盘，未真出网。'
          : d.status === 'cancelled'
            ? '草稿已取消。'
            : '草稿已过期，请重新创建。',
  };
}

export function cancelAlertWebhookDraft(draftId: string) {
  ensureLoaded();
  const d = drafts.get(String(draftId));
  if (!d) return { ok: false, messageZh: '找不到草稿' };
  if (d.status !== 'pending_confirm') {
    return { ok: true, draftId, status: d.status, messageZh: '草稿已不在待确认态', draft: d };
  }
  touch(d, { status: 'cancelled' });
  return { ok: true, draftId, status: 'cancelled', messageZh: '已取消 Webhook 草稿', draft: d };
}

/**
 * 确认：强制 dry-run。即使 body.live=true 或环境变量开了 LIVE，本接口也不出网。
 */
export function confirmAlertWebhookDraft(
  draftId: string,
  opts?: { live?: boolean; actor?: string | null },
) {
  ensureLoaded();
  const d = drafts.get(String(draftId));
  if (!d) return { ok: false, messageZh: '找不到草稿' };
  if (d.status === 'pending_confirm' && Date.parse(d.expiresAt) < Date.now()) {
    touch(d, { status: 'expired' });
  }
  if (d.status !== 'pending_confirm') {
    return {
      ok: false,
      messageZh:
        d.status === 'confirmed_dry_run'
          ? '该草稿已确认过干跑，请新建草稿'
          : d.status === 'cancelled'
            ? '草稿已取消'
            : '草稿已过期，请重新创建',
      draft: d,
    };
  }

  const liveRequested = opts?.live === true || process.env.OPS_ALERT_WEBHOOK_LIVE === '1';
  ensureDirs();
  const at = new Date().toISOString();
  const dryFile = join(DRY_DIR, `${d.draftId}-dry-run.json`);
  const dryPayload = {
    stub: true,
    live: false,
    liveRequestedButForcedDry: !!liveRequested,
    product: '研企通',
    kind: d.kind,
    draftId: d.draftId,
    at,
    titleZh: d.titleZh,
    bodyZh: d.bodyZh,
    level: d.level,
    alerting: d.alerting,
    actor: opts?.actor || d.actor || null,
    tenantId: d.tenantId || null,
    noteZh:
      'M54 双确认 Webhook：已确认但仍强制 dry-run。未发起任何出网 HTTP；仅写本地干跑文件供值班核对。',
    payloadPreview: {
      text: `${d.titleZh}\n${d.bodyZh}`,
      level: d.level,
    },
    wave: 'M54',
  };
  writeFileSync(dryFile, JSON.stringify(dryPayload, null, 2), 'utf8');
  touch(d, {
    status: 'confirmed_dry_run',
    dryRunPath: dryFile,
    confirmedAt: at,
    actor: opts?.actor || d.actor || null,
  });

  return {
    ok: true,
    wave: 'M54',
    dualConfirm: true,
    dryRun: true,
    live: false,
    liveRequestedButForcedDry: !!liveRequested,
    draftId: d.draftId,
    draft: d,
    dryRunFile: `.data/alerts/webhook-dual-confirm/${d.draftId}-dry-run.json`,
    messageZh: liveRequested
      ? '已确认：即便请求/环境要求真发，本流仍强制干跑落盘，未出网。'
      : '已确认并完成 Webhook 干跑落盘，未真出网。',
    tipZh: '中文标题与正文已写入 dry-run 文件；真外发不在本流开启范围内。',
  };
}

export function listAlertWebhookDrafts(limit = 20) {
  ensureLoaded();
  return [...drafts.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.min(Math.max(limit, 1), 50));
}


/** M55：过期草稿清理（pending 过期标 expired；可删 confirmed/cancelled/expired 旧项） */
export function cleanupExpiredAlertWebhookDrafts(opts?: { dropDead?: boolean; olderThanMs?: number }) {
  ensureLoaded();
  const now = Date.now();
  let expiredMarked = 0;
  let removed = 0;
  const dropDead = opts?.dropDead !== false;
  const olderThanMs = opts?.olderThanMs ?? DRAFT_TTL_MS;
  for (const [id, d] of [...drafts.entries()]) {
    if (d.status === 'pending_confirm' && d.expiresAt && Date.parse(d.expiresAt) < now) {
      touch(d, { status: 'expired' });
      expiredMarked++;
    }
    if (dropDead && (d.status === 'expired' || d.status === 'cancelled' || d.status === 'confirmed_dry_run')) {
      const updated = Date.parse(d.updatedAt || d.createdAt || '') || 0;
      if (now - updated >= olderThanMs) {
        drafts.delete(id);
        removed++;
      }
    }
  }
  if (expiredMarked || removed) schedulePersist();
  return {
    ok: true,
    wave: 'M55',
    expiredMarked,
    removed,
    remaining: drafts.size,
    tipZh: `已标记过期 ${expiredMarked}、清理失效草稿 ${removed}；当前台账 ${drafts.size} 条。`,
  };
}

export function peekAlertWebhookDualConfirmMeta() {
  ensureLoaded();
  const byStatus: Record<string, number> = {};
  for (const d of drafts.values()) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  }
  return {
    wave: 'M54',
    dualConfirm: true,
    forceDryRun: true,
    liveEgress: false,
    kinds: ['export_quota', 'home_cache_curve'],
    draftTtlMinutes: Math.round(DRAFT_TTL_MS / 60000),
    createPath: '/api/metrics/alerts/webhook-draft',
    byStatus,
    totalTracked: drafts.size,
    tipZh: '创建草稿 → 看确认卡 → 确认仍 dry-run。本流永不真出网。M55 可用 cleanup 清过期草稿。',
  };
}
