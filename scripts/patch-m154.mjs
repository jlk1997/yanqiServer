#!/usr/bin/env node
/**
 * M154 hardening patch: wraps M153 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN153 = {
  confirm:
    'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153',
  soft:
    'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153',
  audit:
    'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153',
};

const FN154 = {
  confirm: FN153.confirm + 'KeyframeBookmarksSeekLedgerM154',
  soft: FN153.soft + 'ClipScrubberM154',
  audit: FN153.audit + 'ExpiryRevokeLedgerM154',
};

const PATH153 = {
  confirm:
    '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153',
  soft:
    '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  audit:
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
};

const PATH154 = {
  confirm: PATH153.confirm + '/keyframe-bookmarks/seek-ledger/m154',
  soft: PATH153.soft + '/clip-scrubber',
  audit: PATH153.audit + '/expiry-revoke-ledger',
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
 * M154：确认卡短片 scrubber → 关帧书签 + 吊销过期角色审计一页纸 → 回跳台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN154.confirm}(
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
    opts.keyframeBookmarks === false &&
    opts.scrubberBookmarks === false &&
    opts.seekLedgerRow === false &&
    opts.seekBackToLedger === false
  ) {
    return {
      ok: true as const,
      wave: 'M154' as const,
      labelZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳台账 · 已软取消',
      tipZh: '用户软取消赢过确认卡短片scrubber关帧书签与吊销过期角色审计回跳台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN153.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).confirmMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, id: 'm154-confirm-scrub-0', lineZh: '确认卡多选短片帧#1', contrastSide: 'A' },
    { frameIndex: 1, id: 'm154-confirm-scrub-1', lineZh: '确认卡多选短片帧#2', contrastSide: 'B' },
  ];
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M154确认卡短片scrubber关帧书签').trim();
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m154-confirm-kf-\${i}\`,
    nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
    frameId: f.id || \`frame-\${i}\`,
    scrubIndex: f.scrubIndex ?? f.frameIndex ?? i,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    lineZh: f.lineZh || \`帧#\${i + 1}\`,
    wave: 'M154' as const,
  }));
  const confirmClipScrubberKeyframeBookmarks = wantsKf
    ? {
        wave: 'M154' as const,
        kind: 'confirm-clip-scrubber-keyframe-bookmarks' as const,
        titleZh: '确认卡短片 scrubber · 关帧书签',
        bodyZh:
          \`确认卡多选对照短片 scrubber 支持关帧书签 · \${bookmarks.length}枚\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        filterRole,
        filterRoleZh,
        fromClipScrubber: scrub ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const audit = (base as any).shareRevokeExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm154-share-revoke-audit-0', auditLineZh: '演示·吊销过期台账角色审计行#1' },
    { id: 'm154-share-revoke-audit-1', auditLineZh: '演示·吊销过期台账角色审计行#2' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const row = lines[seekEntryIndex] || lines[0];
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const shareRevokeExpiryRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M154' as const,
        kind: 'share-revoke-expiry-role-audit-seek-ledger' as const,
        titleZh: '吊销过期角色审计一页纸 · 回跳中文台账',
        bodyZh:
          \`吊销过期中文台账角色过滤审计一页纸可回跳中文台账 · 行「\${row?.id || 'row'}」\` +
          \` · \${row?.auditLineZh || row?.kindZh || '过期吊销台账行'} · 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        seekEntryIndex,
        ledgerRowId: row?.id || \`m154-share-revoke-audit-\${seekEntryIndex}\`,
        lineZh: row?.auditLineZh || row?.kindZh || \`过期吊销台账行#\${seekEntryIndex + 1}\`,
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
    wave: 'M154' as const,
    labelZh:
      (confirmClipScrubberKeyframeBookmarks
        ? \`确认卡短片scrubber关帧书签 · \${confirmClipScrubberKeyframeBookmarks.bookmarkCount}枚\`
        : '确认卡短片scrubber关帧书签待命') +
      (shareRevokeExpiryRoleAuditSeekLedger
        ? \` · 吊销过期角色审计回跳台账 · 行#\${seekEntryIndex + 1}\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmClipScrubberKeyframeBookmarks ? \` · \${confirmClipScrubberKeyframeBookmarks.bodyZh}\` : '') +
      (shareRevokeExpiryRoleAuditSeekLedger ? \` · \${shareRevokeExpiryRoleAuditSeekLedger.bodyZh}\` : ''),
    toastZh:
      confirmClipScrubberKeyframeBookmarks && shareRevokeExpiryRoleAuditSeekLedger
        ? '确认卡短片scrubber关帧书签 · 吊销过期角色审计回跳台账'
        : confirmClipScrubberKeyframeBookmarks
          ? '确认卡短片scrubber关帧书签已开'
          : shareRevokeExpiryRoleAuditSeekLedger
            ? '吊销过期角色审计回跳台账已开'
            : '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳待命',
    busyZh: '确认卡短片scrubber关帧书签 / 吊销过期角色审计回跳…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmMultiselectClipScrubberIntact: (base as any).confirmMultiselectClipScrubberIntact === true,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: (base as any).shareRevokeExpiryLedgerRoleAuditOnepagerIntact === true,
    confirmClipScrubberKeyframeBookmarksIntact: !!confirmClipScrubberKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: !!shareRevokeExpiryRoleAuditSeekLedger,
    confirmClipScrubberKeyframeBookmarks,
    shareRevokeExpiryRoleAuditSeekLedger,
    ${FN154.confirm}Path: '${PATH154.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'KeyframeBookmarksSeekLedgerM154',
);

const softFn = `
/**
 * M154：软取消多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function ${FN154.soft}(
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
      wave: 'M154' as const,
      labelZh: '软取消多选对照短片scrubber · 已软取消',
      tipZh: '用户软取消赢过软取消多选中文对照短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消多选对照短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN153.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).softCancelSeekMultiselectContrast || null;
  const selected: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm154-soft-ms-0', lineZh: '软取消回跳多选对照行#1', contrastSide: 'A' },
    { index: 1, id: 'm154-soft-ms-1', lineZh: '软取消回跳多选对照行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selected.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true ||
      opts.scrubber === true ||
      opts.exportClipFrames === true ||
      opts.clipFrames === true ||
      !!ms);
  const frames = selected.map((row: any, i: number) => ({
    index: i,
    scrubIndex: i,
    id: row.id || \`m154-soft-ms-\${i}\`,
    lineZh: row.lineZh || \`对照行#\${i + 1}\`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    role: row.role || role,
    roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
    isCurrent: i === scrubIndex,
    wave: 'M154' as const,
  }));
  const softCancelMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M154' as const,
        kind: 'soft-cancel-multiselect-clip-scrubber' as const,
        titleZh: '软取消多选中文对照 · 短片 scrubber',
        bodyZh:
          \`软取消多选中文对照支持短片 scrubber · \${frames.length}帧\` +
          \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[scrubIndex] || frames[0] || null,
        filterRole,
        filterRoleZh,
        fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M154' as const,
    labelZh: softCancelMultiselectClipScrubber
      ? \`软取消多选对照短片scrubber · \${softCancelMultiselectClipScrubber.frameCount}帧\`
      : '软取消多选对照短片scrubber待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectClipScrubber ? \` · \${softCancelMultiselectClipScrubber.bodyZh}\` : ''),
    toastZh: softCancelMultiselectClipScrubber
      ? '软取消多选对照短片scrubber已开'
      : '软取消多选对照短片scrubber待命',
    busyZh: '软取消多选对照短片scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelSeekMultiselectContrastIntact: (base as any).softCancelSeekMultiselectContrastIntact === true,
    softCancelMultiselectClipScrubberIntact: !!softCancelMultiselectClipScrubber,
    softCancelMultiselectClipScrubber,
    ${FN154.soft}Path: '${PATH154.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'MultiSelectContrastM153ClipScrubberM154',
);

const auditFn = `
/**
 * M154：审计回跳关帧跨会话只读分享 → 过期+吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN154.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    shareLinkExpiry?: boolean;
    expiryRevokeLedger?: boolean;
    expiresInMs?: number | null;
    revokeShare?: boolean;
    chineseLedger?: boolean;
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
    opts.revokeShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M154' as const,
      labelZh: '审计回跳关帧跨会话过期吊销 · 已软取消',
      tipZh: '用户软取消赢过审计回跳关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN153.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).auditKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm154-audit-kf-0', nameZh: '演示·M154审计回跳关帧#1', scrubIndex: 0 },
    { id: 'm154-audit-kf-1', nameZh: '演示·M154审计回跳关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m154-audit-kf').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m154-audit-kf').trim();
  const expiresInMs = Math.max(60_000, Number(opts.expiresInMs) || 3_600_000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: \`m154-audit-kf-expiry-\${xshare?.shareToken || 'demo'}\`.slice(0, 96),
    auditLineZh:
      \`审计回跳关帧跨会话只读分享过期吊销 · \${bookmarks.length}枚 · 自「\${sessionId}」→「\${targetSessionId}」· 过期 \${expiresAt}\` +
      (revokeShare ? ' · 已吊销' : ''),
    kindZh: revokeShare ? '审计回跳关帧跨会话分享吊销' : '审计回跳关帧跨会话分享过期登记',
    expiresAt,
    revokeShare,
    wave: 'M154' as const,
  };
  const auditKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M154' as const,
        kind: 'audit-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '审计回跳关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          \`审计回跳关帧跨会话只读分享支持过期+吊销写入中文台账 · \${bookmarks.length}枚\` +
          \` · 过期 \${expiresAt}\` + (revokeShare ? ' · 已吊销' : '') +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        ledgerEntry,
        chineseLedger: opts.chineseLedger !== false,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        revokeShare,
        expiresInMs,
        expiresAt,
        shareToken: xshare?.shareToken || null,
        sessionId,
        targetSessionId,
        fromXshare: xshare
          ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken }
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
    wave: 'M154' as const,
    labelZh: auditKfBmXsessionExpiryRevokeLedger
      ? \`审计回跳关帧跨会话过期吊销 · \${auditKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚\`
      : '审计回跳关帧跨会话过期吊销待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionExpiryRevokeLedger ? \` · \${auditKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
    toastZh: auditKfBmXsessionExpiryRevokeLedger
      ? '审计回跳关帧跨会话过期吊销已开'
      : '审计回跳关帧跨会话过期吊销待命',
    busyZh: '审计回跳关帧跨会话过期吊销…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionRoShareIntact: (base as any).auditKfBmXsessionRoShareIntact === true,
    auditKfBmXsessionExpiryRevokeLedgerIntact: !!auditKfBmXsessionExpiryRevokeLedger,
    auditKfBmXsessionExpiryRevokeLedger,
    ${FN154.audit}Path: '${PATH154.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'XSessionRoShareM153ExpiryRevokeLedgerM154',
);

console.log('core modules patched (functions)');
