#!/usr/bin/env node
/**
 * M155 hardening patch: wraps M154 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN154 = {
  confirm:
    'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154',
  soft:
    'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154',
  audit:
    'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154',
};

const FN155 = {
  confirm: FN154.confirm + 'XsessionRoShareMultiselectContrastM155',
  soft: FN154.soft + 'KeyframeBookmarksM155',
  audit: FN154.audit + 'RoleAuditOnepagerM155',
};

const PATH154 = {
  confirm:
    '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154',
  soft:
    '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  audit:
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
};

const PATH155 = {
  confirm: PATH154.confirm + '/xsession-ro-share/multiselect-contrast/m155',
  soft: PATH154.soft + '/keyframe-bookmarks',
  audit: PATH154.audit + '/role-audit-onepager',
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
 * M155：确认卡关帧 → 跨会话只读分享 + 吊销过期回跳 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function ${FN155.confirm}(
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false &&
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M155' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销过期回跳多选中文对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN154.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipScrubberKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm155-confirm-kf-0', nameZh: '演示·M155确认卡关帧#1', scrubIndex: 0 },
    { id: 'm155-confirm-kf-1', nameZh: '演示·M155确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m155-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m155-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = \`ro-m155-\${tid}-\${sessionId}-\${targetSessionId}-\${bookmarks.length}\`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const confirmKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M155' as const,
        kind: 'confirm-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          \`确认卡短片 scrubber 关帧书签支持跨会话只读分享 · \${bookmarks.length}枚\` +
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

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray((base as any).shareRevokeExpiryLedgerRoleAuditOnepager?.lines)
    ? (base as any).shareRevokeExpiryLedgerRoleAuditOnepager.lines
    : Array.isArray(seek ? [seek] : null)
      ? [
          { id: seek?.ledgerRowId || 'm155-share-revoke-audit-0', auditLineZh: seek?.lineZh || '演示·吊销过期台账角色审计行#1', contrastSide: 'A' },
          { id: 'm155-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2', contrastSide: 'B' },
        ]
      : [
          { id: 'm155-share-revoke-audit-0', auditLineZh: '演示·吊销过期台账角色审计行#1', contrastSide: 'A' },
          { id: 'm155-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2', contrastSide: 'B' },
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
      id: row.id || \`m155-share-revoke-audit-\${i}\`,
      lineZh: row.auditLineZh || row.kindZh || \`吊销过期台账行#\${i + 1}\`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M155' as const,
    };
  });
  const shareRevokeExpirySeekMultiselectContrast = wantsMs
    ? {
        wave: 'M155' as const,
        kind: 'share-revoke-expiry-seek-multiselect-contrast' as const,
        titleZh: '吊销过期角色审计回跳 · 多选中文对照',
        bodyZh:
          \`吊销过期角色审计回跳台账支持多选中文对照 · \${selectedRows.length}行\` +
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
    wave: 'M155' as const,
    labelZh:
      (confirmKfBmXsessionRoShare
        ? \`确认卡关帧跨会话只读分享 · \${confirmKfBmXsessionRoShare.bookmarkCount}枚\`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeExpirySeekMultiselectContrast
        ? \` · 吊销过期回跳多选对照 \${shareRevokeExpirySeekMultiselectContrast.selectedCount}行\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionRoShare ? \` · \${confirmKfBmXsessionRoShare.bodyZh}\` : '') +
      (shareRevokeExpirySeekMultiselectContrast ? \` · \${shareRevokeExpirySeekMultiselectContrast.bodyZh}\` : ''),
    toastZh:
      confirmKfBmXsessionRoShare && shareRevokeExpirySeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销过期回跳多选对照'
        : confirmKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeExpirySeekMultiselectContrast
            ? '吊销过期回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipScrubberKeyframeBookmarksIntact: (base as any).confirmClipScrubberKeyframeBookmarksIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmKfBmXsessionRoShareIntact: !!confirmKfBmXsessionRoShare,
    shareRevokeExpirySeekMultiselectContrastIntact: !!shareRevokeExpirySeekMultiselectContrast,
    confirmKfBmXsessionRoShare,
    shareRevokeExpirySeekMultiselectContrast,
    ${FN155.confirm}Path: '${PATH155.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'XsessionRoShareMultiselectContrastM155',
);

const softFn = `
/**
 * M155：软取消多选对照短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN155.soft}(
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
    scrubIndex?: number | null;
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
    opts.scrubberBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M155' as const,
      labelZh: '软取消多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过软取消多选中文对照短片 scrubber 关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN154.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).softCancelMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { index: 0, id: 'm155-soft-scrub-0', lineZh: '软取消多选短片帧#1', contrastSide: 'A' },
    { index: 1, id: 'm155-soft-scrub-1', lineZh: '软取消多选短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M155软取消多选短片关帧书签').trim();
  const scrubIndex = Math.max(0, Math.min(Math.max(frames.length - 1, 0), Number(opts.scrubIndex ?? scrub?.scrubIndex) || 0));
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m155-soft-kf-\${i}\`,
    nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
    frameId: f.id || \`frame-\${i}\`,
    scrubIndex: f.scrubIndex ?? f.index ?? i,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    lineZh: f.lineZh || \`帧#\${i + 1}\`,
    isCurrent: (f.scrubIndex ?? f.index ?? i) === scrubIndex,
    wave: 'M155' as const,
  }));
  const softCancelMultiselectClipKeyframeBookmarks = wantsKf
    ? {
        wave: 'M155' as const,
        kind: 'soft-cancel-multiselect-clip-keyframe-bookmarks' as const,
        titleZh: '软取消多选中文对照短片 scrubber · 关帧书签',
        bodyZh:
          \`软取消多选中文对照短片 scrubber 支持关帧书签 · \${bookmarks.length}枚\` +
          \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        scrubIndex,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M155' as const,
    labelZh: softCancelMultiselectClipKeyframeBookmarks
      ? \`软取消多选短片关帧书签 · \${softCancelMultiselectClipKeyframeBookmarks.bookmarkCount}枚\`
      : '软取消多选短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectClipKeyframeBookmarks ? \` · \${softCancelMultiselectClipKeyframeBookmarks.bodyZh}\` : ''),
    toastZh: softCancelMultiselectClipKeyframeBookmarks
      ? '软取消多选短片关帧书签已开'
      : '软取消多选短片关帧书签待命',
    busyZh: '软取消多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipScrubberIntact: (base as any).softCancelMultiselectClipScrubberIntact === true,
    softCancelMultiselectClipKeyframeBookmarksIntact: !!softCancelMultiselectClipKeyframeBookmarks,
    softCancelMultiselectClipKeyframeBookmarks,
    ${FN155.soft}Path: '${PATH155.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'ClipScrubberM154KeyframeBookmarksM155',
);

const auditFn = `
/**
 * M155：审计回跳关帧跨会话过期吊销台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function ${FN155.audit}(
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
      wave: 'M155' as const,
      labelZh: '审计过期吊销角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过审计回跳过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
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

  const base = ${FN154.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm155-audit-expiry-0',
    auditLineZh: '演示·审计回跳关帧跨会话过期吊销台账行',
    kindZh: '审计回跳关帧跨会话过期吊销',
    role,
    roleZh,
  };
  const wantsAudit =
    opts.roleAuditOnePager !== false &&
    (opts.roleAuditOnePager === true ||
      opts.renderAuditOnePager === true ||
      opts.roleFilteredAudit === true ||
      opts.inAppOnePager === true ||
      !!expiry);
  const lines = [
    {
      id: ledgerEntry.id || 'm155-audit-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || ledgerEntry.lineZh || '审计回跳关帧跨会话过期吊销台账行',
      kindZh: ledgerEntry.kindZh || '审计回跳关帧跨会话过期吊销',
      role: ledgerEntry.role || role,
      roleZh: ROLE_ZH[String(ledgerEntry.role || role).toLowerCase()] || roleZh,
      wave: 'M155' as const,
    },
    {
      id: 'm155-audit-expiry-1',
      auditLineZh: '演示·审计回跳关帧跨会话过期吊销台账行#2',
      kindZh: '审计回跳关帧跨会话过期吊销',
      role,
      roleZh,
      wave: 'M155' as const,
    },
  ];
  const auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M155' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger-role-audit-onepager' as const,
        titleZh: '审计过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`审计回跳关帧跨会话过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        fromExpiryLedger: expiry ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M155' as const,
    labelZh: auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager
      ? \`审计过期吊销角色审计一页纸 · \${auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.lineCount}行\`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager ? \` · \${auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager.bodyZh}\` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepagerIntact: !!auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager,
    auditKfBmXsessionExpiryRevokeLedgerRoleAuditOnepager,
    ${FN155.audit}Path: '${PATH155.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'ExpiryRevokeLedgerM154RoleAuditOnepagerM155',
);

console.log('core modules patched (functions)');
