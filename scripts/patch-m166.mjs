#!/usr/bin/env node
/**
 * M166 hardening patch: wraps M165 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN165 = {
  confirm: 'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165',
  soft: 'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165',
  audit: 'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165',
};

const FN166 = {
  confirm: FN165.confirm + 'MultiselectContrastExpiryRevokeLedgerM166',
  soft: FN165.soft + 'SeekLedgerM166',
  audit: FN165.audit + 'KeyframeBookmarksM166',
};

const PATH165 = {
  confirm: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165',
  soft: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165',
  audit: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165',
};

const PATH166 = {
  confirm: PATH165.confirm + '/multiselect-contrast/expiry-revoke-ledger/m166',
  soft: PATH165.soft + '/seek-ledger/m166',
  audit: PATH165.audit + '/keyframe-bookmarks/m166',
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
 * M166：确认卡回跳台账 → 多选中文对照 + 吊销关帧跨会话只读分享 → 过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN166.confirm}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
    seekEntryIndexes?: number[] | null;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
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
    opts.multiSelectLedgerRows === false &&
    opts.expiryRevokeLedger === false &&
    opts.shareLinkExpiry === false
  ) {
    return {
      ok: true as const,
      wave: 'M166' as const,
      labelZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过确认卡回跳台账多选对照与吊销关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN165.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).confirmExpiryRevokeRoleAuditOnepager?.lines)
    ? (base as any).confirmExpiryRevokeRoleAuditOnepager.lines
    : [
        { id: 'm166-confirm-seek-0', auditLineZh: '演示·确认卡回跳台账行#1', kindZh: '确认卡回跳台账' },
        { id: 'm166-confirm-seek-1', auditLineZh: '演示·确认卡回跳台账行#2', kindZh: '确认卡回跳台账' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const uniqueIdx = [...new Set(indexes)];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = uniqueIdx.map((i) => {
    const row = lines[i] || lines[0] || {};
    return {
      index: i,
      id: row.id || \`m166-confirm-seek-\${i}\`,
      lineZh: row.auditLineZh || row.kindZh || \`确认卡回跳台账行#\${i + 1}\`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      wave: 'M166' as const,
    };
  });
  const confirmSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M166' as const,
        kind: 'confirm-seek-multiselect-contrast' as const,
        titleZh: '确认卡回跳中文台账 · 多选中文对照',
        bodyZh:
          \`确认卡回跳中文台账可多选中文对照 · \${selectedRows.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        selectedRows,
        selectedCount: selectedRows.length,
        fromSeek: seek ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, lineCount: seek.lineCount } : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const xshare = (base as any).shareRevokeKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm166-share-revoke-kf-0', nameZh: '演示·M166吊销关帧#1', scrubIndex: 0 },
    { id: 'm166-share-revoke-kf-1', nameZh: '演示·M166吊销关帧#2', scrubIndex: 1 },
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
    id: \`m166-share-revoke-expiry-\${tid}\`,
    auditLineZh: \`吊销关帧跨会话过期吊销 · \${bookmarks.length}枚 · 到期 \${expiresAt}\`,
    kindZh: '吊销关帧跨会话过期吊销',
    chineseLedger: true as const,
    expiresAt,
    bookmarkCount: bookmarks.length,
    shareToken: xshare?.shareToken || \`ro-m166-share-revoke-\${tid}\`,
    wave: 'M166' as const,
  };
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M166' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          \`吊销关帧跨会话只读分享支持过期吊销进中文台账 · \${bookmarks.length}枚\` +
          \` · 到期「\${expiresAt}」· 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        expiresAt,
        expiresInMs,
        ledgerEntry,
        chineseLedger: true as const,
        fromXshare: xshare ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken } : null,
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
    wave: 'M166' as const,
    labelZh:
      (confirmSeekMultiselectContrast
        ? \`确认卡回跳台账多选对照 · \${confirmSeekMultiselectContrast.selectedCount}行\`
        : '确认卡回跳台账多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? \` · 吊销关帧跨会话过期吊销 \${shareRevokeKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSeekMultiselectContrast ? \` · \${confirmSeekMultiselectContrast.bodyZh}\` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? \` · \${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
    toastZh:
      confirmSeekMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡回跳台账多选对照 · 吊销关帧跨会话过期吊销'
        : confirmSeekMultiselectContrast
          ? '确认卡回跳台账多选对照已开'
          : shareRevokeKfBmXsessionExpiryRevokeLedger
            ? '吊销关帧跨会话过期吊销已开'
            : '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销待命',
    busyZh: '确认卡回跳台账多选对照 / 吊销关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmRoleAuditSeekLedgerIntact: (base as any).confirmRoleAuditSeekLedgerIntact === true,
    shareRevokeKfBmXsessionRoShareIntact: (base as any).shareRevokeKfBmXsessionRoShareIntact === true,
    confirmSeekMultiselectContrastIntact: !!confirmSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmSeekMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    ${FN166.confirm}Path: '${PATH166.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'MultiselectContrastExpiryRevokeLedgerM166',
);

const softFn = `
/**
 * M166：软取消角色过滤审计 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN166.soft}(
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
      wave: 'M166' as const,
      labelZh: '软取消角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过软取消角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN165.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm166-soft-audit-0', auditLineZh: '演示·软取消角色审计台账行#1', kindZh: '软取消角色审计' },
    { id: 'm166-soft-audit-1', auditLineZh: '演示·软取消角色审计台账行#2', kindZh: '软取消角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[seekEntryIndex] || lines[0] || {};
  const softCancelRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M166' as const,
        kind: 'soft-cancel-role-audit-seek-ledger' as const,
        titleZh: '软取消角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          \`软取消角色过滤审计一页纸可回跳中文台账 · 行#\${seekEntryIndex + 1}\` +
          \` · 「\${row.auditLineZh || row.kindZh || '台账行'}」· 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        ledgerRowId: row.id || \`m166-soft-audit-\${seekEntryIndex}\`,
        lineZh: row.auditLineZh || row.kindZh || \`软取消角色审计台账行#\${seekEntryIndex + 1}\`,
        seekEntryIndex,
        lineCount: lines.length,
        fromAudit: audit ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole } : null,
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
    wave: 'M166' as const,
    labelZh: softCancelRoleAuditSeekLedger
      ? \`软取消角色审计回跳台账 · 行#\${(softCancelRoleAuditSeekLedger.seekEntryIndex as number) + 1}\`
      : '软取消角色审计回跳台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelRoleAuditSeekLedger ? \` · \${softCancelRoleAuditSeekLedger.bodyZh}\` : ''),
    toastZh: softCancelRoleAuditSeekLedger
      ? '软取消角色审计回跳台账已开'
      : '软取消角色审计回跳台账待命',
    busyZh: '软取消角色审计回跳台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: (base as any).softCancelExpiryLedgerRoleAuditOnepagerIntact === true,
    softCancelRoleAuditSeekLedgerIntact: !!softCancelRoleAuditSeekLedger,
    softCancelRoleAuditSeekLedger,
    ${FN166.soft}Path: '${PATH166.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'RoleAuditOnepagerM165SeekLedgerM166',
);

const auditFn = `
/**
 * M166：审计短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN166.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
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
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M166' as const,
      labelZh: '审计短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN165.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).auditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { index: 0, id: 'm166-audit-clip-0', lineZh: '演示·审计短片帧#1', scrubIndex: 0 },
    { index: 1, id: 'm166-audit-clip-1', lineZh: '演示·审计短片帧#2', scrubIndex: 1 },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M166审计短片关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m166-audit-kf-\${f.id || i}\`,
    nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id || \`m166-audit-clip-\${i}\`,
    lineZh: f.lineZh || \`审计短片帧#\${i + 1}\`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M166' as const,
  }));
  const auditClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M166' as const,
        kind: 'audit-clip-keyframe-bookmarks' as const,
        titleZh: '审计短片 scrubber · 关帧书签',
        bodyZh:
          \`审计短片 scrubber 可打关帧书签 · \${bookmarks.length}枚\` +
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
    wave: 'M166' as const,
    labelZh: auditClipKeyframeBookmarks
      ? \`审计短片关帧书签 · \${auditClipKeyframeBookmarks.bookmarkCount}枚\`
      : '审计短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditClipKeyframeBookmarks ? \` · \${auditClipKeyframeBookmarks.bodyZh}\` : ''),
    toastZh: auditClipKeyframeBookmarks
      ? '审计短片关帧书签已开'
      : '审计短片关帧书签待命',
    busyZh: '审计短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectClipScrubberIntact: (base as any).auditSeekMultiselectClipScrubberIntact === true,
    auditClipKeyframeBookmarksIntact: !!auditClipKeyframeBookmarks,
    auditClipKeyframeBookmarks,
    ${FN166.audit}Path: '${PATH166.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'ClipScrubberM165KeyframeBookmarksM166',
);

console.log('core modules patched (functions)');
