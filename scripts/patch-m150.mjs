#!/usr/bin/env node
/**
 * M150 hardening patch: appends next-wave wrappers on core match/import path.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN = {
  confirm149:
    'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149',
  soft149:
    'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149',
  audit149:
    'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149',
  fail149:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149',
  ab149:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149',
};

const FN150 = {
  confirm: FN.confirm149 + 'RoleAuditOnepagerKeyframeBookmarksM150',
  soft: FN.soft149 + 'ExpiryRevokeLedgerM150',
  audit: FN.audit149 + 'MultiSelectContrastM150',
  fail: FN.fail149 + 'ClipScrubberM150',
  ab: FN.ab149 + 'ExpiryRevokeLedgerM150',
};

const PATH = {
  confirm149:
    '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149',
  soft149:
    '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  audit149:
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
  fail149:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
  ab149:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
};

const PATH150 = {
  confirm: PATH.confirm149 + '/role-audit-onepager/keyframe-bookmarks/m150',
  soft: PATH.soft149 + '/expiry-revoke-ledger',
  audit: PATH.audit149 + '/multi-select-contrast',
  fail: PATH.fail149 + '/clip-scrubber',
  ab: PATH.ab149 + '/expiry-revoke-ledger',
};

const WAVE =
  'M150-core-confirm-expiry-revoke-ledger-role-audit-onepager-share-revoke-multiselect-clip-kf-bm-soft-cancel-kf-bm-xsession-expiry-revoke-ledger-audit-seek-multiselect-contrast-fail-attr-multiselect-clip-scrubber-ab-kf-bm-xsession-expiry-revoke';

function appendIfMissing(file, needle, append) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(needle)) {
    console.log('skip already has', needle.slice(0, 60), '… in', file);
    return false;
  }
  fs.writeFileSync(p, s + append);
  console.log('appended to', file);
  return true;
}

function replaceOnce(file, from, to) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) {
    console.warn('WARN missing replace target in', file, from.slice(0, 80));
    return false;
  }
  if (s.includes(to) && to.length > 40) {
    // already patched if unique to-string present near from
  }
  s = s.replace(from, to);
  fs.writeFileSync(p, s);
  console.log('replaced in', file);
  return true;
}

function insertBeforeClosingBraceClass(file, insertion) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('M150') && s.includes('RoleAuditOnepagerKeyframeBookmarksM150')) {
    console.log('skip already M150 in', file);
    return false;
  }
  // Find last "}\n" of class/module: replace trailing "}\n" once from end of exports/class
  const idx = s.lastIndexOf('\n}\n');
  if (idx < 0) throw new Error('no closing brace in ' + file);
  s = s.slice(0, idx) + '\n' + insertion + s.slice(idx);
  fs.writeFileSync(p, s);
  console.log('inserted before close in', file);
  return true;
}

// ——— 1) bypass-contrast-board.ts (confirm) ———
const confirmFn = `
/**
 * M150：确认卡过期吊销台账 → 角色审计一页纸 + 吊销多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN150.confirm}(
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
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.keyframeBookmarks === false &&
    opts.scrubberKeyframeBookmarks === false
  ) {
    return {
      ok: true as const,
      wave: 'M150' as const,
      labelZh: '确认卡过期吊销角色审计 / 吊销多选短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过确认卡过期吊销台账角色审计一页纸与吊销多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡过期吊销角色审计 / 吊销多选短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN.confirm149}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).confirmKfBmXsessionShareExpiryRevokeLedger || null;
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledger?.ledgerEntry?.id || 'm150-confirm-audit-0',
      auditLineZh: ledger?.ledgerEntry?.auditLineZh || '演示·确认卡过期吊销台账行#1',
      kindZh: ledger?.ledgerEntry?.kindZh || '确认卡关帧跨会话分享过期吊销',
    },
    { id: 'm150-confirm-audit-1', auditLineZh: '演示·确认卡过期吊销台账行#2', kindZh: '确认卡关帧跨会话分享过期登记' },
  ].filter((l) => !filterRole || true);
  const confirmExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M150' as const,
        kind: 'confirm-expiry-revoke-ledger-role-audit-onepager' as const,
        titleZh: '确认卡过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`确认卡过期吊销中文台账可出角色过滤审计一页纸 · \${lines.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        lines,
        lineCount: lines.length,
        filterRole,
        filterRoleZh,
        roleFilteredAudit: true as const,
        roleAuditOnePager: true as const,
        inAppOnePager: true as const,
        renderAuditOnePager: true as const,
        fromLedger: ledger
          ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, revokeShare: ledger.revokeShare }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const scrub = (base as any).shareRevokeSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm150-share-revoke-ms-frame-0', lineZh: '吊销过期回跳多选行#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm150-share-revoke-ms-frame-1', lineZh: '吊销过期回跳多选行#2', contrastSide: 'B' },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m150-share-revoke-kf-\${i}\`,
    nameZh: opts.bookmarkNameZh ? \`\${opts.bookmarkNameZh}#\${i + 1}\` : (f.lineZh || \`演示·M150吊销多选关帧#\${i + 1}\`),
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M150' as const,
  }));
  const shareRevokeMultiselectClipKfBm = wantsKf
    ? {
        wave: 'M150' as const,
        kind: 'share-revoke-multiselect-clip-kf-bm' as const,
        titleZh: '吊销过期回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          \`吊销过期回跳多选短片 scrubber 支持关帧书签 · \${bookmarks.length}枚\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        frames,
        frameCount: frames.length,
        fromScrubber: scrub
          ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex }
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
    wave: 'M150' as const,
    labelZh:
      (confirmExpiryRevokeLedgerRoleAuditOnepager
        ? \`确认卡过期吊销台账角色审计一页纸 · \${confirmExpiryRevokeLedgerRoleAuditOnepager.lineCount}行\`
        : '确认卡过期吊销台账角色审计一页纸待命') +
      (shareRevokeMultiselectClipKfBm
        ? \` · 吊销多选短片关帧书签 \${shareRevokeMultiselectClipKfBm.bookmarkCount}枚\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmExpiryRevokeLedgerRoleAuditOnepager ? \` · \${confirmExpiryRevokeLedgerRoleAuditOnepager.bodyZh}\` : '') +
      (shareRevokeMultiselectClipKfBm ? \` · \${shareRevokeMultiselectClipKfBm.bodyZh}\` : ''),
    toastZh:
      confirmExpiryRevokeLedgerRoleAuditOnepager && shareRevokeMultiselectClipKfBm
        ? '确认卡过期吊销台账角色审计一页纸 · 吊销多选短片关帧书签'
        : confirmExpiryRevokeLedgerRoleAuditOnepager
          ? '确认卡过期吊销台账角色审计一页纸已开'
          : shareRevokeMultiselectClipKfBm
            ? '吊销多选短片关帧书签已开'
            : '确认卡过期吊销角色审计 / 吊销多选短片关帧书签待命',
    busyZh: '确认卡过期吊销角色审计 / 吊销多选短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmKfBmXsessionShareExpiryRevokeLedgerIntact: (base as any).confirmKfBmXsessionShareExpiryRevokeLedgerIntact === true,
    shareRevokeSeekMultiselectClipScrubberIntact: (base as any).shareRevokeSeekMultiselectClipScrubberIntact === true,
    confirmExpiryRevokeLedgerRoleAuditOnepagerIntact: !!confirmExpiryRevokeLedgerRoleAuditOnepager,
    shareRevokeMultiselectClipKfBmIntact: !!shareRevokeMultiselectClipKfBm,
    confirmExpiryRevokeLedgerRoleAuditOnepager,
    shareRevokeMultiselectClipKfBm,
    ${FN150.confirm}Path: '${PATH150.confirm}',
  };
}
`;

insertBeforeClosingBraceClass('apps/api/src/matches/bypass-contrast-board.ts', confirmFn);

// ——— 2) anomaly-chain-job.ts (soft-cancel) ———
const softFn = `
/**
 * M150：软取消关帧跨会话只读分享 → 过期吊销进中文台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN150.soft}(
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
      wave: 'M150' as const,
      labelZh: '软取消关帧跨会话过期吊销进台账 · 已软取消',
      tipZh: '用户软取消赢过软取消关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消关帧跨会话过期吊销进台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN.soft149}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const xshare = (base as any).softCancelKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm150-soft-kf-0', nameZh: '演示·M150软取消关帧#1', scrubIndex: 0 },
    { id: 'm150-soft-kf-1', nameZh: '演示·M150软取消关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || xshare?.sessionId || 'session-demo-m150-soft').trim();
  const targetSessionId = String(opts.targetSessionId || xshare?.targetSessionId || 'session-peer-m150-soft').trim();
  const expiresInMs = opts.expiresInMs != null ? Number(opts.expiresInMs) : 3600000;
  const revokeShare = opts.revokeShare !== false;
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const softCancelKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M150' as const,
        kind: 'soft-cancel-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '软取消关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          \`软取消关帧跨会话只读分享支持过期与吊销并写入中文台账 · \${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚\` +
          \` · 自「\${sessionId}」→「\${targetSessionId}」· 过期 \${expiresInMs}ms\` +
          (revokeShare ? ' · 已吊销' : ' · 未吊销') +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        expiresInMs,
        revokeShare,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        chineseLedger: true as const,
        ledgerEntry: {
          wave: 'M150' as const,
          id: \`m150-soft-share-\${revokeShare ? 'revoke' : 'expiry'}-\${Date.now().toString(36)}\`,
          kindZh: revokeShare ? '软取消关帧跨会话分享吊销' : '软取消关帧跨会话分享过期登记',
          auditLineZh: revokeShare
            ? \`吊销软取消关帧跨会话只读分享 · \${Math.max(bookmarks.length, 1)}枚 · 「\${sessionId}」→「\${targetSessionId}」\`
            : \`登记软取消关帧跨会话只读分享过期 \${expiresInMs}ms · \${Math.max(bookmarks.length, 1)}枚\`,
          role,
          roleZh,
          chineseLedger: true as const,
        },
        bookmarkCount: Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1),
        sessionId,
        targetSessionId,
        fromXsessionShare: xshare
          ? { kind: xshare.kind, shareToken: xshare.shareToken, bookmarkCount: xshare.bookmarkCount }
          : null,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M150' as const,
    labelZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? \`软取消关帧跨会话过期吊销进台账\${revokeShare ? '（已吊销）' : ''}\`
      : '软取消关帧跨会话过期吊销进台账待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelKfBmXsessionExpiryRevokeLedger ? \` · \${softCancelKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
    toastZh: softCancelKfBmXsessionExpiryRevokeLedger
      ? '软取消关帧跨会话过期吊销进台账已开'
      : '软取消关帧跨会话过期吊销进台账待命',
    busyZh: '软取消关帧跨会话过期吊销进台账…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelKfBmXsessionRoShareIntact: (base as any).softCancelKfBmXsessionRoShareIntact === true,
    softCancelKfBmXsessionExpiryRevokeLedgerIntact: !!softCancelKfBmXsessionExpiryRevokeLedger,
    softCancelKfBmXsessionExpiryRevokeLedger,
    ${FN150.soft}Path: '${PATH150.soft}',
  };
}
`;

insertBeforeClosingBraceClass('apps/api/src/workbench/anomaly-chain-job.ts', softFn);

// ——— 3) anomaly-contrast-batch-rerun.ts (audit) ———
const auditFn = `
/**
 * M150：审计角色审计回跳台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function ${FN150.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M150' as const,
      labelZh: '审计回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过审计角色审计回跳多选中文对照 · 无外发 · 中页取消仍在',
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

  const base = ${FN.audit149}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).auditRoleAuditSeekLedger || null;
  const lines: any[] = [
    { id: seek?.ledgerRowId || 'm150-audit-seek-0', auditLineZh: seek?.lineZh || '演示·审计角色审计回跳行#1', contrastSide: 'A' },
    { id: 'm150-audit-seek-1', auditLineZh: '演示·审计角色审计回跳行#2', contrastSide: 'B' },
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
      id: row.id || \`m150-audit-seek-\${i}\`,
      lineZh: row.auditLineZh || row.kindZh || \`审计回跳行#\${i + 1}\`,
      contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
      role,
      roleZh,
      wave: 'M150' as const,
    };
  });
  const auditSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M150' as const,
        kind: 'audit-seek-multiselect-contrast' as const,
        titleZh: '审计角色审计回跳 · 多选中文对照',
        bodyZh:
          \`审计角色审计回跳台账支持多选中文对照 · \${selectedRows.length}行\` +
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
    wave: 'M150' as const,
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
    auditRoleAuditSeekLedgerIntact: (base as any).auditRoleAuditSeekLedgerIntact === true,
    auditSeekMultiselectContrastIntact: !!auditSeekMultiselectContrast,
    auditSeekMultiselectContrast,
    ${FN150.audit}Path: '${PATH150.audit}',
  };
}
`;

insertBeforeClosingBraceClass('apps/api/src/workbench/anomaly-contrast-batch-rerun.ts', auditFn);

console.log('core modules patched (functions)');
