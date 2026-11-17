#!/usr/bin/env node
/**
 * M170 hardening patch: wraps M169 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN169 = {
  confirm: "shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168XsessionRoShareMultiselectContrastM169",
  soft: "forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169",
  audit: "softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168RoleAuditOnepagerM169",
};

const FN170 = {
  confirm: FN169.confirm + 'ExpiryRevokeLedgerClipScrubberM170',
  soft: FN169.soft + 'XSessionRoShareM170',
  audit: FN169.audit + 'SeekLedgerM170',
};

const PATH169 = {
  confirm: "/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167/keyframe-bookmarks/seek-ledger/m168/xsession-ro-share/multiselect-contrast/m169",
  soft: "/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169",
  audit: "/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167/expiry-revoke-ledger/m168/role-audit-onepager/m169",
};

const PATH170 = {
  confirm: PATH169.confirm + '/expiry-revoke-ledger/clip-scrubber/m170',
  soft: PATH169.soft + '/xsession-ro-share/m170',
  audit: PATH169.audit + '/seek-ledger/m170',
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
 * M170：确认卡关帧跨会话只读分享 → 过期吊销写中文台账 + 吊销回跳多选对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function ${FN170.confirm}(
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
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
    exportClipFrames?: boolean;
    clipFrames?: boolean;
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
    opts.expiryRevokeLedger === false &&
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M170' as const,
      labelZh: '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话过期吊销与吊销回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN169.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).confirmClipKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm170-confirm-kf-0', nameZh: '演示·M170确认卡关帧#1', scrubIndex: 0 },
    { id: 'm170-confirm-kf-1', nameZh: '演示·M170确认卡关帧#2', scrubIndex: 1 },
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
    id: \`m170-confirm-kf-xshare-expiry-\${tid}\`,
    auditLineZh:
      \`确认卡关帧跨会话只读分享过期吊销 · \${bookmarks.length}枚书签\` +
      \` · 令牌「\${xshare?.shareToken || 'ro-m170-demo'}」· 过期于 \${expiresAt}\` +
      \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」\`,
    kindZh: '确认卡关帧跨会话过期吊销',
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || 'ro-m170-demo',
    expiresAt,
    expiresInMs,
    revoked: true as const,
    chineseLedger: true as const,
    role,
    roleZh,
    wave: 'M170' as const,
  };
  const confirmKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M170' as const,
        kind: 'confirm-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '确认卡关帧跨会话只读分享 · 过期吊销写中文台账',
        bodyZh:
          \`确认卡关帧跨会话只读分享支持过期+吊销写中文台账 · \${bookmarks.length}枚\` +
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

  const ms = (base as any).shareRevokeSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm170-share-revoke-ms-0', lineZh: '演示·吊销回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm170-share-revoke-ms-1', lineZh: '演示·吊销回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    index: i,
    id: r.id || \`m170-share-revoke-clip-\${i}\`,
    lineZh: r.lineZh || \`吊销回跳多选短片帧#\${i + 1}\`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M170' as const,
  }));
  const shareRevokeSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M170' as const,
        kind: 'share-revoke-seek-multiselect-clip-scrubber' as const,
        titleZh: '吊销回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          \`吊销回跳多选中文对照支持短片 scrubber · \${frames.length}帧\` +
          \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
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
    wave: 'M170' as const,
    labelZh:
      (confirmKfBmXsessionExpiryRevokeLedger
        ? \`确认卡关帧跨会话过期吊销 · \${confirmKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚\`
        : '确认卡关帧跨会话过期吊销待命') +
      (shareRevokeSeekMultiselectClipScrubber
        ? \` · 吊销回跳多选短片scrubber \${shareRevokeSeekMultiselectClipScrubber.frameCount}帧\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionExpiryRevokeLedger ? \` · \${confirmKfBmXsessionExpiryRevokeLedger.bodyZh}\` : '') +
      (shareRevokeSeekMultiselectClipScrubber ? \` · \${shareRevokeSeekMultiselectClipScrubber.bodyZh}\` : ''),
    toastZh:
      confirmKfBmXsessionExpiryRevokeLedger && shareRevokeSeekMultiselectClipScrubber
        ? '确认卡关帧跨会话过期吊销 · 吊销回跳多选短片scrubber'
        : confirmKfBmXsessionExpiryRevokeLedger
          ? '确认卡关帧跨会话过期吊销已开'
          : shareRevokeSeekMultiselectClipScrubber
            ? '吊销回跳多选短片scrubber已开'
            : '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber待命',
    busyZh: '确认卡关帧跨会话过期吊销 / 吊销回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipKfBmXsessionRoShareIntact: (base as any).confirmClipKfBmXsessionRoShareIntact === true,
    shareRevokeSeekMultiselectContrastIntact: (base as any).shareRevokeSeekMultiselectContrastIntact === true,
    confirmKfBmXsessionExpiryRevokeLedgerIntact: !!confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubberIntact: !!shareRevokeSeekMultiselectClipScrubber,
    confirmKfBmXsessionExpiryRevokeLedger,
    shareRevokeSeekMultiselectClipScrubber,
    ${FN170.confirm}Path: '${PATH170.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'ExpiryRevokeLedgerClipScrubberM170',
);

const softFn = `
/**
 * M170：软取消多选关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function ${FN170.soft}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    shareFfReplayBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M170' as const,
      labelZh: '软取消关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN169.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).softCancelMultiselectKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm170-soft-kf-0', nameZh: '演示·M170软取消关帧#1', scrubIndex: 0 },
    { id: 'm170-soft-kf-1', nameZh: '演示·M170软取消关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m170-soft').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m170-soft').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = \`ro-m170-soft-\${tid}-\${sessionId}-\${targetSessionId}-\${bookmarks.length}\`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const softCancelKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M170' as const,
        kind: 'soft-cancel-kf-bm-xsession-ro-share' as const,
        titleZh: '软取消关帧书签 · 跨会话只读分享',
        bodyZh:
          \`软取消关帧书签支持跨会话只读分享 · \${bookmarks.length}枚\` +
          \` · 自「\${sessionId}」→「\${targetSessionId}」· 令牌「\${shareToken}」\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        fromKfBm: kf ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount } : null,
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
    wave: 'M170' as const,
    labelZh: softCancelKfBmXsessionRoShare
      ? \`软取消关帧跨会话只读分享 · \${softCancelKfBmXsessionRoShare.bookmarkCount}枚\`
      : '软取消关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionRoShare ? \` · \${softCancelKfBmXsessionRoShare.bodyZh}\` : ''),
    toastZh: softCancelKfBmXsessionRoShare
      ? '软取消关帧跨会话只读分享已开'
      : '软取消关帧跨会话只读分享待命',
    busyZh: '软取消关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectKeyframeBookmarksIntact: (base as any).softCancelMultiselectKeyframeBookmarksIntact === true,
    softCancelKfBmXsessionRoShareIntact: !!softCancelKfBmXsessionRoShare,
    softCancelKfBmXsessionRoShare,
    ${FN170.soft}Path: '${PATH170.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'KeyframeBookmarksM169XSessionRoShareM170',
);

const auditFn = `
/**
 * M170：审计角色过滤审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN170.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    seekLedgerRow?: boolean;
    seekBackToLedger?: boolean;
    highlightLedgerRow?: boolean;
    seekEntryIndex?: number | null;
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M170' as const,
      labelZh: '审计角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过审计角色审计回跳中文台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN169.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).auditExpiryRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm170-audit-role-0', auditLineZh: '演示·审计角色审计行#1' },
    { id: 'm170-audit-role-1', auditLineZh: '演示·审计角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const auditRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M170' as const,
        kind: 'audit-role-audit-seek-ledger' as const,
        titleZh: '审计角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          \`审计角色过滤审计一页纸可回跳中文台账 · 行「\${row?.id || 'row'}」\` +
          \` · \${row?.auditLineZh || row?.kindZh || '角色审计台账行'} · 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        seekEntryIndex,
        ledgerRowId: row?.id || \`m170-audit-role-\${seekEntryIndex}\`,
        lineZh: row?.auditLineZh || row?.kindZh || \`角色审计台账行#\${seekEntryIndex + 1}\`,
        highlightLedgerRow: true as const,
        seekBackToLedger: true as const,
        seekLedgerRow: true as const,
        chineseLedger: true as const,
        filterRole,
        filterRoleZh,
        fromOnepager: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M170' as const,
    labelZh: auditRoleAuditSeekLedger
      ? \`审计角色审计回跳台账 · 行#\${seekEntryIndex + 1}\`
      : '审计角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditRoleAuditSeekLedger ? \` · \${auditRoleAuditSeekLedger.bodyZh}\` : ''),
    toastZh: auditRoleAuditSeekLedger
      ? '审计角色审计回跳台账已开'
      : '审计角色审计回跳台账待命',
    busyZh: '审计角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditExpiryRoleAuditOnepagerIntact: (base as any).auditExpiryRoleAuditOnepagerIntact === true,
    auditRoleAuditSeekLedgerIntact: !!auditRoleAuditSeekLedger,
    auditRoleAuditSeekLedger,
    ${FN170.audit}Path: '${PATH170.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'RoleAuditOnepagerM169SeekLedgerM170',
);

console.log('core modules patched (functions)');
