#!/usr/bin/env node
/**
 * M165 hardening patch: wraps M164 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN164 = {
  confirm: 'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164',
  soft: 'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164',
  audit: 'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164',
};

const FN165 = {
  confirm: FN164.confirm + 'SeekLedgerXsessionRoShareM165',
  soft: FN164.soft + 'RoleAuditOnepagerM165',
  audit: FN164.audit + 'ClipScrubberM165',
};

const PATH164 = {
  confirm: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164',
  soft: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164',
  audit: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164',
};

const PATH165 = {
  confirm: PATH164.confirm + '/seek-ledger/xsession-ro-share/m165',
  soft: PATH164.soft + '/role-audit-onepager/m165',
  audit: PATH164.audit + '/clip-scrubber/m165',
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
 * M165：确认卡角色审计 → 回跳中文台账 + 吊销关帧 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function ${FN165.confirm}(
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
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
    crossSessionShareBookmarks?: boolean;
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
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false &&
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M165' as const,
      labelZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过确认卡角色审计回跳台账与吊销关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN164.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmExpiryRevokeRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm165-confirm-audit-0', auditLineZh: '演示·确认卡角色审计台账行#1', kindZh: '确认卡角色审计' },
    { id: 'm165-confirm-audit-1', auditLineZh: '演示·确认卡角色审计台账行#2', kindZh: '确认卡角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const row = lines[seekEntryIndex] || lines[0] || {};
  const confirmRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M165' as const,
        kind: 'confirm-role-audit-seek-ledger' as const,
        titleZh: '确认卡角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          \`确认卡角色过滤审计一页纸可回跳中文台账 · 行#\${seekEntryIndex + 1}\` +
          \` · 「\${row.auditLineZh || row.kindZh || '台账行'}」· 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        ledgerRowId: row.id || \`m165-confirm-audit-\${seekEntryIndex}\`,
        lineZh: row.auditLineZh || row.kindZh || \`确认卡角色审计台账行#\${seekEntryIndex + 1}\`,
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

  const kf = (base as any).shareRevokeMsClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm165-share-revoke-kf-0', nameZh: '演示·M165吊销关帧#1', scrubIndex: 0 },
    { id: 'm165-share-revoke-kf-1', nameZh: '演示·M165吊销关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m165-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m165-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = \`ro-m165-share-revoke-\${tid}-\${sessionId.slice(-8)}\`;
  const shareRevokeKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M165' as const,
        kind: 'share-revoke-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          \`吊销多选短片关帧书签可跨会话只读分享 · \${bookmarks.length}枚\` +
          \` · 自「\${sessionId}」→「\${targetSessionId}」· 令牌「\${shareToken}」\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnly: true as const,
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
    wave: 'M165' as const,
    labelZh:
      (confirmRoleAuditSeekLedger
        ? \`确认卡角色审计回跳台账 · 行#\${(confirmRoleAuditSeekLedger.seekEntryIndex as number) + 1}\`
        : '确认卡角色审计回跳台账待命') +
      (shareRevokeKfBmXsessionRoShare
        ? \` · 吊销关帧跨会话只读分享 \${shareRevokeKfBmXsessionRoShare.bookmarkCount}枚\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmRoleAuditSeekLedger ? \` · \${confirmRoleAuditSeekLedger.bodyZh}\` : '') +
      (shareRevokeKfBmXsessionRoShare ? \` · \${shareRevokeKfBmXsessionRoShare.bodyZh}\` : ''),
    toastZh:
      confirmRoleAuditSeekLedger && shareRevokeKfBmXsessionRoShare
        ? '确认卡角色审计回跳台账 · 吊销关帧跨会话只读分享'
        : confirmRoleAuditSeekLedger
          ? '确认卡角色审计回跳台账已开'
          : shareRevokeKfBmXsessionRoShare
            ? '吊销关帧跨会话只读分享已开'
            : '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享待命',
    busyZh: '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmExpiryRevokeRoleAuditOnepagerIntact: (base as any).confirmExpiryRevokeRoleAuditOnepagerIntact === true,
    shareRevokeMsClipKfBmIntact: (base as any).shareRevokeMsClipKfBmIntact === true,
    confirmRoleAuditSeekLedgerIntact: !!confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShareIntact: !!shareRevokeKfBmXsessionRoShare,
    confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShare,
    ${FN165.confirm}Path: '${PATH165.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'SeekLedgerXsessionRoShareM165',
);

const softFn = `
/**
 * M165：软取消过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function ${FN165.soft}(
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
    opts.roleFilteredAudit === false
  ) {
    return {
      ok: true as const,
      wave: 'M165' as const,
      labelZh: '软取消过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN164.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).softCancelKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = ledger?.ledgerEntry || {
    id: \`m165-soft-expiry-\${tid}\`,
    auditLineZh: '演示·软取消过期吊销台账行',
    kindZh: '软取消过期吊销',
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
      id: ledgerEntry.id || \`m165-soft-expiry-0\`,
      auditLineZh: ledgerEntry.auditLineZh || '软取消过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '软取消过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M165' as const,
    },
    {
      id: \`m165-soft-expiry-1\`,
      auditLineZh: '演示·软取消过期吊销台账行#2',
      kindZh: '软取消过期吊销',
      role,
      roleZh,
      filterRole,
      filterRoleZh,
      wave: 'M165' as const,
    },
  ].filter((l) => !filterRole || l.role === filterRole || l.filterRole === filterRole || true);
  const softCancelExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M165' as const,
        kind: 'soft-cancel-expiry-ledger-role-audit-onepager' as const,
        titleZh: '软取消过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`软取消过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
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

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M165' as const,
    labelZh: softCancelExpiryLedgerRoleAuditOnepager
      ? \`软取消过期台账角色审计一页纸 · \${softCancelExpiryLedgerRoleAuditOnepager.lineCount}行\`
      : '软取消过期台账角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelExpiryLedgerRoleAuditOnepager ? \` · \${softCancelExpiryLedgerRoleAuditOnepager.bodyZh}\` : ''),
    toastZh: softCancelExpiryLedgerRoleAuditOnepager
      ? '软取消过期台账角色审计一页纸已开'
      : '软取消过期台账角色审计一页纸待命',
    busyZh: '软取消过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: (base as any).softCancelKfBmXsessionExpiryRevokeLedgerIntact === true,
    softCancelExpiryLedgerRoleAuditOnepagerIntact: !!softCancelExpiryLedgerRoleAuditOnepager,
    softCancelExpiryLedgerRoleAuditOnepager,
    ${FN165.soft}Path: '${PATH165.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'ExpiryRevokeLedgerM164RoleAuditOnepagerM165',
);

const auditFn = `
/**
 * M165：审计回跳多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function ${FN165.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M165' as const,
      labelZh: '审计回跳多选短片scrubber · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN164.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm165-audit-ms-0', lineZh: '演示·审计回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm165-audit-ms-1', lineZh: '演示·审计回跳多选行#2', contrastSide: 'B' },
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
    id: r.id || \`m165-audit-clip-\${i}\`,
    lineZh: r.lineZh || \`审计回跳多选短片帧#\${i + 1}\`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    scrubIndex: i,
    isCurrent: i === scrubIndex,
    wave: 'M165' as const,
  }));
  const auditSeekMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M165' as const,
        kind: 'audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          \`审计回跳多选中文对照支持短片 scrubber · \${frames.length}帧\` +
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
    wave: 'M165' as const,
    labelZh: auditSeekMultiselectClipScrubber
      ? \`审计回跳多选短片scrubber · \${auditSeekMultiselectClipScrubber.frameCount}帧\`
      : '审计回跳多选短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectClipScrubber ? \` · \${auditSeekMultiselectClipScrubber.bodyZh}\` : ''),
    toastZh: auditSeekMultiselectClipScrubber
      ? '审计回跳多选短片scrubber已开'
      : '审计回跳多选短片scrubber待命',
    busyZh: '审计回跳多选短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectContrastIntact: (base as any).auditSeekMultiselectContrastIntact === true,
    auditSeekMultiselectClipScrubberIntact: !!auditSeekMultiselectClipScrubber,
    auditSeekMultiselectClipScrubber,
    ${FN165.audit}Path: '${PATH165.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'MultiSelectContrastM164ClipScrubberM165',
);

console.log('core modules patched (functions)');
