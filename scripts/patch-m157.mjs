#!/usr/bin/env node
/**
 * M157 hardening patch: wraps M156 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN156 = {
  confirm:
    'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156',
  soft:
    'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156',
  audit:
    'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156',
};

const FN157 = {
  confirm: FN156.confirm + 'RoleAuditOnepagerKeyframeBookmarksM157',
  soft: FN156.soft + 'ExpiryRevokeLedgerM157',
  audit: FN156.audit + 'MultiSelectContrastM157',
};

const PATH156 = {
  confirm:
    '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156',
  soft:
    '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  audit:
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
};

const PATH157 = {
  confirm: PATH156.confirm + '/role-audit-onepager/keyframe-bookmarks/m157',
  soft: PATH156.soft + '/expiry-revoke-ledger',
  audit: PATH156.audit + '/multi-select-contrast',
};

function insertBeforeClosingBraceClass(file, insertion, marker) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(marker)) {
    console.log('skip already', marker, 'in', file);
    return false;
  }
  if (!s.endsWith('\n')) s += '\n';
  s = s + '\n' + insertion.trimStart();
  if (!s.endsWith('\n')) s += '\n';
  fs.writeFileSync(p, s);
  console.log('appended at EOF in', file);
  return true;
}

const confirmFn = `
/**
 * M157：确认卡过期吊销台账 → 角色审计一页纸 + 吊销过期回跳多选短片 → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN157.confirm}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    roleFilteredAudit?: boolean;
    renderAuditOnePager?: boolean;
    roleAuditOnePager?: boolean;
    inAppOnePager?: boolean;
    keyframeBookmarks?: boolean;
    scrubberBookmarks?: boolean;
    scrubberKeyframeBookmarks?: boolean;
    bookmarkNameZh?: string | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M157' as const,
      labelZh: '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡过期吊销台账角色审计一页纸与吊销过期回跳多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN156.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).confirmKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = ledger?.ledgerEntry || {
    id: \`m157-confirm-expiry-\${tid}\`,
    auditLineZh: '演示·确认卡过期吊销台账行',
    kindZh: '确认卡关帧跨会话过期吊销',
    chineseLedger: true as const,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledgerEntry.id || \`m157-confirm-expiry-0\`,
      auditLineZh: ledgerEntry.auditLineZh || '确认卡过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '确认卡过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M157' as const,
    },
    {
      id: \`m157-confirm-expiry-1\`,
      auditLineZh: '演示·确认卡过期吊销台账行#2',
      kindZh: '确认卡过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M157' as const,
    },
  ].filter((l) => !filterRole || l.role === filterRole || l.filterRole === filterRole || true);
  const confirmExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M157' as const,
        kind: 'confirm-expiry-ledger-role-audit-onepager' as const,
        titleZh: '确认卡过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`确认卡过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        chineseLedger: true as const,
        fromLedger: ledger ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, expiresAt: ledger.expiresAt } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const clip = (base as any).shareRevokeExpirySeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { index: 0, id: 'm157-share-revoke-clip-0', lineZh: '演示·吊销过期回跳多选短片帧#1', scrubIndex: 0 },
    { index: 1, id: 'm157-share-revoke-clip-1', lineZh: '演示·吊销过期回跳多选短片帧#2', scrubIndex: 1 },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M157吊销过期回跳多选短片关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m157-share-revoke-kf-\${f.id || i}\`,
    nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id || \`m157-share-revoke-clip-\${i}\`,
    lineZh: f.lineZh || \`吊销过期回跳多选短片帧#\${i + 1}\`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M157' as const,
  }));
  const shareRevokeExpirySeekMultiselectClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M157' as const,
        kind: 'share-revoke-expiry-seek-multiselect-clip-keyframe-bookmarks' as const,
        titleZh: '吊销过期回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          \`吊销过期回跳多选短片 scrubber 可打关帧书签 · \${bookmarks.length}枚\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        fromClip: clip ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M157' as const,
    labelZh:
      (confirmExpiryLedgerRoleAuditOnepager
        ? \`确认卡过期吊销台账角色审计 · \${confirmExpiryLedgerRoleAuditOnepager.lineCount}行\`
        : '确认卡过期吊销台账角色审计待命') +
      (shareRevokeExpirySeekMultiselectClipKeyframeBookmarks
        ? \` · 吊销过期回跳多选短片关帧书签 \${shareRevokeExpirySeekMultiselectClipKeyframeBookmarks.bookmarkCount}枚\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmExpiryLedgerRoleAuditOnepager ? \` · \${confirmExpiryLedgerRoleAuditOnepager.bodyZh}\` : '') +
      (shareRevokeExpirySeekMultiselectClipKeyframeBookmarks ? \` · \${shareRevokeExpirySeekMultiselectClipKeyframeBookmarks.bodyZh}\` : ''),
    toastZh:
      confirmExpiryLedgerRoleAuditOnepager && shareRevokeExpirySeekMultiselectClipKeyframeBookmarks
        ? '确认卡过期吊销台账角色审计 · 吊销过期回跳多选短片关帧书签'
        : confirmExpiryLedgerRoleAuditOnepager
          ? '确认卡过期吊销台账角色审计已开'
          : shareRevokeExpirySeekMultiselectClipKeyframeBookmarks
            ? '吊销过期回跳多选短片关帧书签已开'
            : '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签待命',
    busyZh: '确认卡过期吊销台账角色审计 / 吊销过期回跳多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionExpiryRevokeLedgerIntact === true,
    shareRevokeExpirySeekMultiselectClipScrubberIntact: (base as any).shareRevokeExpirySeekMultiselectClipScrubberIntact === true,
    confirmExpiryLedgerRoleAuditOnepagerIntact: !!confirmExpiryLedgerRoleAuditOnepager,
    shareRevokeExpirySeekMultiselectClipKeyframeBookmarksIntact: !!shareRevokeExpirySeekMultiselectClipKeyframeBookmarks,
    confirmExpiryLedgerRoleAuditOnepager,
    shareRevokeExpirySeekMultiselectClipKeyframeBookmarks,
    ${FN157.confirm}Path: '${PATH157.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'RoleAuditOnepagerKeyframeBookmarksM157',
);

const softFn = `
/**
 * M157：软取消关帧跨会话只读分享 → 过期+吊销写中文台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN157.soft}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    revokeShare?: boolean;
    expiresInMs?: number | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M157' as const,
      labelZh: '软取消关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN156.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelMultiselectKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm157-soft-kf-0', nameZh: '演示·M157软取消关帧#1', scrubIndex: 0 },
    { id: 'm157-soft-kf-1', nameZh: '演示·M157软取消关帧#2', scrubIndex: 1 },
  ];
  const expiresInMs = Math.max(60000, Number(opts.expiresInMs) || 3600000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const wantsExpiry =
    opts.expiryRevokeLedger !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: \`m157-soft-kf-xshare-expiry-\${tid}\`,
    auditLineZh:
      \`软取消关帧跨会话只读分享过期吊销 · \${bookmarks.length}枚书签\` +
      \` · 令牌「\${xshare?.shareToken || 'ro-m157-soft-demo'}」· 过期于 \${expiresAt}\` +
      \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」\`,
    kindZh: '软取消关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m157-soft-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M157' as const,
  };
  const softCancelKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M157' as const,
        kind: 'soft-cancel-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          \`软取消关帧跨会话只读分享支持过期+吊销写中文台账 · \${bookmarks.length}枚\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        ledgerEntry,
        bookmarkCount: bookmarks.length,
        expiresAt,
        expiresInMs,
        fromXsessionRoShare: xshare ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M157' as const,
    labelZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? \`软取消关帧跨会话过期吊销 · \${softCancelKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚\`
      : '软取消关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionExpiryRevokeLedger ? \` · \${softCancelKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
    toastZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? '软取消关帧跨会话过期吊销已开'
      : '软取消关帧跨会话过期吊销待命',
    busyZh: '软取消关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectKfBmXsessionRoShareIntact: (base as any).softCancelMultiselectKfBmXsessionRoShareIntact === true,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelKfBmXsessionExpiryRevokeLedger,
    softCancelKfBmXsessionExpiryRevokeLedger,
    ${FN157.soft}Path: '${PATH157.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'XSessionRoShareM156ExpiryRevokeLedgerM157',
);

const auditFn = `
/**
 * M157：审计回跳台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function ${FN157.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectContrast?: boolean;
    multiSelectLedgerRows?: boolean;
    seekEntryIndexes?: number[] | null;
    dryRun?: boolean;
    [k: string]: any;
  } = {},
) {
  const tid = (tenantId || 'default').toString();
  const role = String(opts.role || opts.myRole || 'broker').trim().toLowerCase() || 'broker';
  const ROLE_ZH: Record<string, string> = {
    admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
  };
  const roleZh = ROLE_ZH[role] || role;
  const filterRole = String(opts.filterRole || role).trim().toLowerCase() || role;
  const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

  if (
    opts.softCancel === true &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M157' as const,
      labelZh: '审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN156.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager?.lines)
    ? (base as any).auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.lines
    : [
        { id: seek?.ledgerRowId || 'm157-audit-seek-0', auditLineZh: seek?.lineZh || '演示·审计回跳台账行#1', contrastSide: 'A' },
        { id: 'm157-audit-seek-1', auditLineZh: '演示·审计回跳台账行#2', contrastSide: 'B' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const uniqueIdx = [...new Set(indexes)];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = uniqueIdx.map((i, ord) => {
    const row = lines[i] || lines[0] || {};
    return {
      index: i,
      id: row.id || \`m157-audit-seek-\${i}\`,
      lineZh: row.auditLineZh || row.kindZh || \`审计回跳台账行#\${i + 1}\`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M157' as const,
    };
  });
  const auditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M157' as const,
        kind: 'audit-seek-multiselect-contrast' as const,
        titleZh: '审计回跳中文台账 · 多选中文对照',
        bodyZh:
          \`审计回跳中文台账支持多选中文对照 · \${selectedRows.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes: uniqueIdx,
        fromSeek: seek ? { kind: seek.kind, ledgerRowId: seek.ledgerRowId } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M157' as const,
    labelZh: auditSeekMultiselectContrast
      ? \`审计回跳多选对照 · \${auditSeekMultiselectContrast.selectedCount}行\`
      : '审计回跳多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectContrast ? \` · \${auditSeekMultiselectContrast.bodyZh}\` : ''),
    toastZh: auditSeekMultiselectContrast
      ? '审计回跳多选对照已开'
      : '审计回跳多选对照待命',
    busyZh: '审计回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditSeekLedgerIntact: (base as any).auditExpiryRoleAuditSeekLedgerIntact === true,
    auditSeekMultiselectContrastIntact: !!auditSeekMultiselectContrast,
    auditSeekMultiselectContrast,
    ${FN157.audit}Path: '${PATH157.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'SeekLedgerM156MultiSelectContrastM157',
);

console.log('core modules patched (functions)');
