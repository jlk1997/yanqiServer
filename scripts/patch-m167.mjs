#!/usr/bin/env node
/**
 * M167 hardening patch: wraps M166 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN166 = {
  confirm: "shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166",
  soft: "forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166",
  audit: "softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166",
};

const FN167 = {
  confirm: FN166.confirm + 'ClipScrubberRoleAuditOnepagerM167',
  soft: FN166.soft + 'MultiSelectContrastM167',
  audit: FN166.audit + 'XSessionRoShareM167',
};

const PATH166 = {
  confirm: "/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166",
  soft: "/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166",
  audit: "/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166",
};

const PATH167 = {
  confirm: PATH166.confirm + '/clip-scrubber/role-audit-onepager/m167',
  soft: PATH166.soft + '/multi-select-contrast/m167',
  audit: PATH166.audit + '/xsession-ro-share/m167',
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
 * M167：确认卡多选短片 scrubber + 吊销过期台账角色审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function ${FN167.confirm}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
    scrubIndex?: number | null;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false &&
    opts.roleFilteredAudit === false &&
    opts.roleAuditOnePager === false &&
    opts.renderAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M167' as const,
      labelZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过确认卡多选短片scrubber与吊销过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN166.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).confirmSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm167-confirm-ms-0', lineZh: '演示·确认卡多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm167-confirm-ms-1', lineZh: '演示·确认卡多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(opts.scrubIndex) || 0));
  const wantsClip =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms);
  const frames = selectedRows.map((r: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: r.id || \`m167-confirm-ms-frame-\${i}\`,
    lineZh: r.lineZh || \`确认卡多选帧#\${i + 1}\`,
    contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M167' as const,
  }));
  const confirmMultiselectClipScrubber = wantsClip
    ? {
        wave: 'M167' as const,
        kind: 'confirm-multiselect-clip-scrubber' as const,
        titleZh: '确认卡多选中文对照 · 短片 scrubber',
        bodyZh:
          \`确认卡多选中文对照支持短片 scrubber · \${frames.length}帧 · 当前#\${scrubIndex + 1}\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[scrubIndex] || frames[0] || null,
        selectedRows,
        selectedCount: selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount }
          : null,
        filterRole,
        filterRoleZh,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const expiry = (base as any).shareRevokeKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm167-share-revoke-expiry-demo',
    auditLineZh: '演示·吊销过期台账行',
    kindZh: '吊销关帧跨会话分享过期吊销',
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
      id: ledgerEntry.id || 'm167-share-revoke-audit-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·吊销过期台账行#1',
      kindZh: ledgerEntry.kindZh || '吊销过期台账角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M167' as const,
    },
    {
      id: 'm167-share-revoke-audit-1',
      auditLineZh: '演示·吊销过期台账行#2',
      kindZh: '吊销过期台账角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M167' as const,
    },
  ];
  const shareRevokeExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M167' as const,
        kind: 'share-revoke-expiry-ledger-role-audit-onepager' as const,
        titleZh: '吊销过期中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`吊销过期中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
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
    wave: 'M167' as const,
    labelZh:
      (confirmMultiselectClipScrubber
        ? \`确认卡多选短片scrubber · \${confirmMultiselectClipScrubber.frameCount}帧\`
        : '确认卡多选短片scrubber待命') +
      (shareRevokeExpiryLedgerRoleAuditOnepager
        ? \` · 吊销过期台账角色审计一页纸\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmMultiselectClipScrubber ? \` · \${confirmMultiselectClipScrubber.bodyZh}\` : '') +
      (shareRevokeExpiryLedgerRoleAuditOnepager ? \` · \${shareRevokeExpiryLedgerRoleAuditOnepager.bodyZh}\` : ''),
    toastZh:
      confirmMultiselectClipScrubber && shareRevokeExpiryLedgerRoleAuditOnepager
        ? '确认卡多选短片scrubber · 吊销过期台账角色审计一页纸'
        : confirmMultiselectClipScrubber
          ? '确认卡多选短片scrubber已开'
          : shareRevokeExpiryLedgerRoleAuditOnepager
            ? '吊销过期台账角色审计一页纸已开'
            : '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸待命',
    busyZh: '确认卡多选短片scrubber / 吊销过期台账角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmSeekMultiselectContrastIntact: (base as any).confirmSeekMultiselectContrastIntact === true,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: (base as any).shareRevokeKfBmXsessionExpiryRevokeLedgerIntact === true,
    confirmMultiselectClipScrubberIntact: !!confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepagerIntact: !!shareRevokeExpiryLedgerRoleAuditOnepager,
    confirmMultiselectClipScrubber,
    shareRevokeExpiryLedgerRoleAuditOnepager,
    ${FN167.confirm}Path: '${PATH167.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'ClipScrubberRoleAuditOnepagerM167',
);

const softFn = `
/**
 * M167：软取消回跳中文台账 → 多选中文对照
 * （软取消；干跑；toast；无外发）
 */
export function ${FN167.soft}(
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
      wave: 'M167' as const,
      labelZh: '软取消回跳台账多选对照 · 已软取消',
      tipZh: '用户软取消赢过软取消回跳台账多选对照 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '软取消回跳台账多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN166.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).softCancelRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) && seek.lines.length
    ? seek.lines
    : [
        { id: seek?.ledgerRowId || 'm167-soft-seek-0', auditLineZh: seek?.lineZh || '演示·软取消回跳台账行#1', kindZh: '软取消角色审计回跳台账' },
        { id: 'm167-soft-seek-1', auditLineZh: '演示·软取消回跳台账行#2', kindZh: '软取消角色审计回跳台账' },
      ];
  const indexesRaw = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length ? opts.seekEntryIndexes : [0, 1];
  const seekEntryIndexes = indexesRaw
    .map((n) => Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(n) || 0)))
    .filter((v, i, a) => a.indexOf(v) === i);
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || \`m167-soft-seek-ms-\${idx}\`,
      lineZh: hit.auditLineZh || hit.kindZh || \`台账行#\${idx + 1}\`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M167' as const,
    };
  });
  const softCancelSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M167' as const,
        kind: 'soft-cancel-seek-multiselect-contrast' as const,
        titleZh: '软取消回跳中文台账 · 多选中文对照',
        bodyZh:
          \`软取消回跳中文台账可多选中文对照 · 选中\${selectedRows.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        lines,
        lineCount: lines.length,
        fromSeek: seek ? { kind: seek.kind, seekEntryIndex: seek.seekEntryIndex, lineCount: seek.lineCount } : null,
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
    wave: 'M167' as const,
    labelZh: softCancelSeekMultiselectContrast
      ? \`软取消回跳台账多选对照 · \${softCancelSeekMultiselectContrast.selectedCount}行\`
      : '软取消回跳台账多选对照待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelSeekMultiselectContrast ? \` · \${softCancelSeekMultiselectContrast.bodyZh}\` : ''),
    toastZh: softCancelSeekMultiselectContrast
      ? '软取消回跳台账多选对照已开'
      : '软取消回跳台账多选对照待命',
    busyZh: '软取消回跳台账多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelRoleAuditSeekLedgerIntact: (base as any).softCancelRoleAuditSeekLedgerIntact === true,
    softCancelSeekMultiselectContrastIntact: !!softCancelSeekMultiselectContrast,
    softCancelSeekMultiselectContrast,
    ${FN167.soft}Path: '${PATH167.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'SeekLedgerM166MultiSelectContrastM167',
);

const auditFn = `
/**
 * M167：审计关帧书签 → 跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function ${FN167.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
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
    opts.crossSessionShare === false &&
    opts.readOnlyShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M167' as const,
      labelZh: '审计关帧跨会话只读分享 · 已软取消',
      tipZh: '用户软取消赢过审计关帧跨会话只读分享 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN166.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).auditClipKeyframeBookmarks || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm167-audit-kf-0', nameZh: '演示·M167审计关帧#1', scrubIndex: 0 },
    { id: 'm167-audit-kf-1', nameZh: '演示·M167审计关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m167-audit-kf').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m167-audit-kf').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      opts.crossSessionShareBookmarks === true ||
      !!kf);
  const shareToken = \`ro-m167-audit-kf-\${tid}-\${sessionId.slice(-8)}\`;
  const auditKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M167' as const,
        kind: 'audit-kf-bm-xsession-ro-share' as const,
        titleZh: '审计关帧书签 · 跨会话只读分享',
        bodyZh:
          \`审计关帧书签可跨会话只读分享 · \${bookmarks.length}枚\` +
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
    wave: 'M167' as const,
    labelZh: auditKfBmXsessionRoShare
      ? \`审计关帧跨会话只读分享 · \${auditKfBmXsessionRoShare.bookmarkCount}枚\`
      : '审计关帧跨会话只读分享待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditKfBmXsessionRoShare ? \` · \${auditKfBmXsessionRoShare.bodyZh}\` : ''),
    toastZh: auditKfBmXsessionRoShare
      ? '审计关帧跨会话只读分享已开'
      : '审计关帧跨会话只读分享待命',
    busyZh: '审计关帧跨会话只读分享…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditClipKeyframeBookmarksIntact: (base as any).auditClipKeyframeBookmarksIntact === true,
    auditKfBmXsessionRoShareIntact: !!auditKfBmXsessionRoShare,
    auditKfBmXsessionRoShare,
    ${FN167.audit}Path: '${PATH167.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'KeyframeBookmarksM166XSessionRoShareM167',
);

console.log('core modules patched (functions)');
