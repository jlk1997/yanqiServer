#!/usr/bin/env node
/**
 * M169 hardening patch: wraps M168 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN168 = {
  confirm: "shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167KeyframeBookmarksSeekLedgerM168",
  soft: "forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168",
  audit: "softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167ExpiryRevokeLedgerM168",
};

const FN169 = {
  confirm: FN168.confirm + 'XsessionRoShareMultiselectContrastM169',
  soft: FN168.soft + 'KeyframeBookmarksM169',
  audit: FN168.audit + 'RoleAuditOnepagerM169',
};

const PATH168 = {
  confirm: "/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167/keyframe-bookmarks/seek-ledger/m168",
  soft: "/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168",
  audit: "/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167/expiry-revoke-ledger/m168",
};

const PATH169 = {
  confirm: PATH168.confirm + '/xsession-ro-share/multiselect-contrast/m169',
  soft: PATH168.soft + '/keyframe-bookmarks/m169',
  audit: PATH168.audit + '/role-audit-onepager/m169',
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
 * M169：确认卡关帧跨会话只读分享 + 吊销回跳多选对照
 * （软取消；干跑；toast；无外发）
 */
export function ${FN169.confirm}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    readOnlyShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    sessionId?: string | null;
    targetSessionId?: string | null;
    multiSelectLedgerRows?: boolean;
    multiSelectContrast?: boolean;
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectLedgerRows === false &&
    opts.multiSelectContrast === false
  ) {
    return {
      ok: true as const,
      wave: 'M169' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销回跳多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN168.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm169-confirm-kf-0', nameZh: '演示·M169确认卡关帧#1', scrubIndex: 0 },
    { id: 'm169-confirm-kf-1', nameZh: '演示·M169确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m169-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m169-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = \`m169-confirm-kf-share-\${tid}-\${sessionId}\`.slice(0, 96);
  const confirmClipKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M169' as const,
        kind: 'confirm-clip-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          \`确认卡关帧书签可跨会话只读分享 · \${bookmarks.length}枚\` +
          \` · 自「\${sessionId}」→「\${targetSessionId}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        shareToken,
        sessionId,
        targetSessionId,
        readOnly: true as const,
        fromKf: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) && seek.lines.length
    ? seek.lines
    : [
        { id: 'm169-share-revoke-seek-0', auditLineZh: '演示·吊销回跳台账行#1', kindZh: '吊销回跳台账', lineZh: '演示·吊销回跳台账行#1', contrastSide: 'A' },
        { id: 'm169-share-revoke-seek-1', auditLineZh: '演示·吊销回跳台账行#2', kindZh: '吊销回跳台账', lineZh: '演示·吊销回跳台账行#2', contrastSide: 'B' },
      ];
  const indexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    : [0, Math.min(1, Math.max(lines.length - 1, 0))];
  const wantsMs =
    opts.multiSelectLedgerRows !== false &&
    (opts.multiSelectLedgerRows === true ||
      opts.multiSelectContrast === true ||
      !!seek);
  const selectedRows = indexes.map((idx, i) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || \`m169-share-revoke-ms-\${idx}\`,
      lineZh: hit.lineZh || hit.auditLineZh || hit.kindZh || \`吊销回跳台账行#\${idx + 1}\`,
      contrastSide: hit.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      wave: 'M169' as const,
    };
  });
  const shareRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M169' as const,
        kind: 'share-revoke-seek-multiselect-contrast' as const,
        titleZh: '吊销回跳中文台账 · 多选中文对照',
        bodyZh:
          \`吊销回跳中文台账可多选中文对照 · 选中\${selectedRows.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        lines,
        lineCount: lines.length,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes: indexes,
        fromSeek: seek
          ? { kind: seek.kind, lineCount: seek.lineCount, seekEntryIndex: seek.seekEntryIndex }
          : null,
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
    wave: 'M169' as const,
    labelZh:
      (confirmClipKfBmXsessionRoShare
        ? \`确认卡关帧跨会话只读分享 · \${confirmClipKfBmXsessionRoShare.bookmarkCount}枚\`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeSeekMultiselectContrast
        ? \` · 吊销回跳多选对照\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipKfBmXsessionRoShare ? \` · \${confirmClipKfBmXsessionRoShare.bodyZh}\` : '') +
      (shareRevokeSeekMultiselectContrast ? \` · \${shareRevokeSeekMultiselectContrast.bodyZh}\` : ''),
    toastZh:
      confirmClipKfBmXsessionRoShare && shareRevokeSeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销回跳多选对照'
        : confirmClipKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeSeekMultiselectContrast
            ? '吊销回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipKeyframeBookmarksIntact: (base as any).confirmClipKeyframeBookmarksIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmClipKfBmXsessionRoShareIntact: !!confirmClipKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrastIntact: !!shareRevokeSeekMultiselectContrast,
    confirmClipKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrast,
    ${FN169.confirm}Path: '${PATH169.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'XsessionRoShareMultiselectContrastM169',
);

const softFn = `
/**
 * M169：软取消多选中文对照短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN169.soft}(
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
    opts.scrubberBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M169' as const,
      labelZh: '软取消多选关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消多选关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN168.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).softCancelMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm169-soft-ms-0', lineZh: '演示·软取消多选帧#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm169-soft-ms-1', lineZh: '演示·软取消多选帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M169软取消多选关帧').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m169-soft-ms-kf-\${f.id || i}\`.slice(0, 96),
    nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
    scrubIndex: f.scrubIndex ?? i,
    frameIndex: f.frameIndex ?? i,
    lineZh: f.lineZh || \`软取消多选帧#\${i + 1}\`,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M169' as const,
  }));
  const softCancelMultiselectKeyframeBookmarks = wantsKf
    ? {
        wave: 'M169' as const,
        kind: 'soft-cancel-multiselect-keyframe-bookmarks' as const,
        titleZh: '软取消多选中文对照短片 scrubber · 关帧书签',
        bodyZh:
          \`软取消多选短片 scrubber 可打关帧书签 · \${bookmarks.length}枚\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        frames,
        frameCount: frames.length,
        fromClip: clip
          ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex }
          : null,
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
    wave: 'M169' as const,
    labelZh: softCancelMultiselectKeyframeBookmarks
      ? \`软取消多选关帧书签 · \${softCancelMultiselectKeyframeBookmarks.bookmarkCount}枚\`
      : '软取消多选关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectKeyframeBookmarks ? \` · \${softCancelMultiselectKeyframeBookmarks.bodyZh}\` : ''),
    toastZh: softCancelMultiselectKeyframeBookmarks
      ? '软取消多选关帧书签已开'
      : '软取消多选关帧书签待命',
    busyZh: '软取消多选关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipScrubberIntact: (base as any).softCancelMultiselectClipScrubberIntact === true,
    softCancelMultiselectKeyframeBookmarksIntact: !!softCancelMultiselectKeyframeBookmarks,
    softCancelMultiselectKeyframeBookmarks,
    ${FN169.soft}Path: '${PATH169.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'ClipScrubberM168KeyframeBookmarksM169',
);

const auditFn = `
/**
 * M169：审计关帧跨会话过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function ${FN169.audit}(
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
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M169' as const,
      labelZh: '审计过期吊销角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计过期吊销角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN168.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm169-audit-expiry-demo',
    auditLineZh: '演示·审计关帧跨会话过期吊销台账行',
    kindZh: '审计关帧跨会话分享过期吊销',
  };
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm169-audit-expiry-role-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·审计过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M169' as const,
    },
    {
      id: 'm169-audit-expiry-role-1',
      auditLineZh: '演示·审计过期吊销台账行#2',
      kindZh: '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M169' as const,
    },
  ];
  const auditExpiryRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M169' as const,
        kind: 'audit-expiry-role-audit-onepager' as const,
        titleZh: '审计关帧跨会话过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`审计关帧跨会话过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        lines,
        lineCount: lines.length,
        ledgerEntry,
        fromExpiry: expiry
          ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount, expiresAt: expiry.expiresAt }
          : null,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        renderAuditOnePager: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M169' as const,
    labelZh: auditExpiryRoleAuditOnepager
      ? \`审计过期吊销角色审计一页纸 · \${auditExpiryRoleAuditOnepager.lineCount}行\`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRoleAuditOnepager ? \` · \${auditExpiryRoleAuditOnepager.bodyZh}\` : ''),
    toastZh: auditExpiryRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditExpiryRoleAuditOnepagerIntact: !!auditExpiryRoleAuditOnepager,
    auditExpiryRoleAuditOnepager,
    ${FN169.audit}Path: '${PATH169.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'ExpiryRevokeLedgerM168RoleAuditOnepagerM169',
);

console.log('core modules patched (functions)');
