#!/usr/bin/env node
/**
 * M152 hardening patch: wraps M151 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN151 = {
  confirm:
    'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151',
  soft:
    'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151',
  audit:
    'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151',
};

const FN152 = {
  confirm: FN151.confirm + 'MultiselectContrastExpiryRevokeLedgerM152',
  soft: FN151.soft + 'SeekLedgerM152',
  audit: FN151.audit + 'KeyframeBookmarksM152',
};

const PATH151 = {
  confirm:
    '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151',
  soft:
    '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  audit:
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
};

const PATH152 = {
  confirm: PATH151.confirm + '/multiselect-contrast/expiry-revoke-ledger/m152',
  soft: PATH151.soft + '/seek-ledger',
  audit: PATH151.audit + '/keyframe-bookmarks',
};

function insertBeforeClosingBraceClass(file, insertion, marker) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(marker)) {
    console.log('skip already', marker, 'in', file);
    return false;
  }
  // Append at EOF (do NOT insert before last } — that nests inside the previous export fn).
  if (!s.endsWith('\n')) s += '\n';
  s = s + '\n' + insertion.trimStart();
  if (!s.endsWith('\n')) s += '\n';
  fs.writeFileSync(p, s);
  console.log('appended at EOF in', file);
  return true;
}

const confirmFn = `
/**
 * M152：确认卡回跳台账多选中文对照 + 吊销关帧跨会话分享过期吊销进台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN152.confirm}(
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false &&
    opts.shareLinkExpiry === false &&
    opts.expiryRevokeLedger === false &&
    opts.revokeShare === false
  ) {
    return {
      ok: true as const,
      wave: 'M152' as const,
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

  const base = ${FN151.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const seek = (base as any).confirmRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm152-confirm-seek-ms-0', auditLineZh: '演示·确认卡回跳台账行#1', kindZh: '确认卡角色审计回跳台账' },
    { id: 'm152-confirm-seek-ms-1', auditLineZh: '演示·确认卡回跳台账行#2', kindZh: '确认卡角色审计回跳台账' },
  ];
  const indexesRaw = Array.isArray(opts.seekEntryIndexes) ? opts.seekEntryIndexes : [0, 1];
  const seekEntryIndexes = indexesRaw
    .map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
    .filter((v, i, a) => a.indexOf(v) === i);
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      seekEntryIndexes.length > 0 ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx) => {
    const hit = lines[idx] || lines[0] || {};
    return {
      index: idx,
      id: hit.id || \`m152-confirm-seek-ms-\${idx}\`,
      lineZh: hit.auditLineZh || hit.kindZh || \`台账行#\${idx + 1}\`,
      contrastSide: idx % 2 === 0 ? 'A' : 'B',
      wave: 'M152' as const,
    };
  });
  const confirmSeekLedgerMultiselectContrast = wantsMs
    ? {
        wave: 'M152' as const,
        kind: 'confirm-seek-ledger-multiselect-contrast' as const,
        titleZh: '确认卡回跳中文台账 · 多选中文对照',
        bodyZh:
          \`确认卡回跳中文台账支持多选中文对照 · 选中\${selectedRows.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        lines,
        lineCount: lines.length,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        chineseContrast: true as const,
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

  const xshare = (base as any).shareRevokeKfBmXsessionRoShare || null;
  const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
    { id: 'm152-share-revoke-kf-0', nameZh: '演示·M152吊销关帧#1', scrubIndex: 0 },
    { id: 'm152-share-revoke-kf-1', nameZh: '演示·M152吊销关帧#2', scrubIndex: 1 },
  ];
  const expiresInMs = Math.max(60_000, Number(opts.expiresInMs) || 3_600_000);
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const wantsExpiry =
    opts.shareLinkExpiry !== false &&
    (opts.shareLinkExpiry === true ||
      opts.expiryRevokeLedger === true ||
      opts.revokeShare === true ||
      !!xshare);
  const ledgerEntry = {
    id: \`m152-share-revoke-expiry-\${xshare?.shareToken || 'demo'}\`.slice(0, 96),
    auditLineZh:
      \`吊销关帧跨会话只读分享过期吊销 · \${bookmarks.length}枚 · 自「\${xshare?.sessionId || 'session-demo-m152'}」→「\${xshare?.targetSessionId || 'session-peer-m152'}」· 过期 \${expiresAt}\`,
    kindZh: '吊销关帧跨会话分享过期吊销',
    expiresAt,
    revokeShare: opts.revokeShare !== false,
    wave: 'M152' as const,
  };
  const shareRevokeKfBmXsessionExpiryRevokeLedger = wantsExpiry
    ? {
        wave: 'M152' as const,
        kind: 'share-revoke-kf-bm-xsession-expiry-revoke-ledger' as const,
        titleZh: '吊销关帧跨会话只读分享 · 过期吊销进中文台账',
        bodyZh:
          \`吊销关帧跨会话只读分享支持过期+吊销写入中文台账 · \${bookmarks.length}枚\` +
          \` · 过期 \${expiresAt} · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        ledgerEntry,
        chineseLedger: opts.chineseLedger !== false,
        shareLinkExpiry: true as const,
        expiryRevokeLedger: true as const,
        revokeShare: opts.revokeShare !== false,
        expiresInMs,
        expiresAt,
        shareToken: xshare?.shareToken || null,
        sessionId: xshare?.sessionId || null,
        targetSessionId: xshare?.targetSessionId || null,
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
    wave: 'M152' as const,
    labelZh:
      (confirmSeekLedgerMultiselectContrast
        ? \`确认卡回跳台账多选对照 · \${confirmSeekLedgerMultiselectContrast.selectedCount}行\`
        : '确认卡回跳台账多选对照待命') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger
        ? \` · 吊销关帧跨会话过期吊销进台账\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmSeekLedgerMultiselectContrast ? \` · \${confirmSeekLedgerMultiselectContrast.bodyZh}\` : '') +
      (shareRevokeKfBmXsessionExpiryRevokeLedger ? \` · \${shareRevokeKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
    toastZh:
      confirmSeekLedgerMultiselectContrast && shareRevokeKfBmXsessionExpiryRevokeLedger
        ? '确认卡回跳台账多选对照 · 吊销关帧跨会话过期吊销'
        : confirmSeekLedgerMultiselectContrast
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
    confirmSeekLedgerMultiselectContrastIntact: !!confirmSeekLedgerMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedgerIntact: !!shareRevokeKfBmXsessionExpiryRevokeLedger,
    confirmSeekLedgerMultiselectContrast,
    shareRevokeKfBmXsessionExpiryRevokeLedger,
    ${FN152.confirm}Path: '${PATH152.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'MultiselectContrastExpiryRevokeLedgerM152',
);

const softFn = `
/**
 * M152：软取消角色过滤审计一页纸 → 回跳中文台账
 * （软取消；干跑；toast；无外发）
 */
export function ${FN152.soft}(
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
      wave: 'M152' as const,
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

  const base = ${FN151.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).softCancelExpiryLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm152-soft-audit-seek-0', auditLineZh: '演示·软取消角色审计台账行#1', kindZh: '软取消过期台账角色审计' },
    { id: 'm152-soft-audit-seek-1', auditLineZh: '演示·软取消角色审计台账行#2', kindZh: '软取消过期台账角色审计' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const hit = lines[seekEntryIndex] || lines[0] || {};
  const softCancelRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M152' as const,
        kind: 'soft-cancel-role-audit-seek-ledger' as const,
        titleZh: '软取消角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          \`软取消角色过滤审计可回跳中文台账 · 行#\${seekEntryIndex + 1}/\${lines.length}\` +
          \` · 「\${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        seekEntryIndex,
        ledgerRowId: hit.id || \`m152-soft-audit-seek-\${seekEntryIndex}\`,
        lineZh: hit.auditLineZh || hit.kindZh || \`台账行#\${seekEntryIndex + 1}\`,
        lines,
        lineCount: lines.length,
        highlightLedgerRow: true as const,
        seekLedgerRow: true as const,
        seekBackToLedger: true as const,
        chineseLedger: true as const,
        fromAudit: audit
          ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
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
    wave: 'M152' as const,
    labelZh: softCancelRoleAuditSeekLedger
      ? \`软取消角色审计回跳台账 · 行#\${(softCancelRoleAuditSeekLedger.seekEntryIndex || 0) + 1}\`
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
    ${FN152.soft}Path: '${PATH152.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'RoleAuditOnepagerM151SeekLedgerM152',
);

const auditFn = `
/**
 * M152：审计回跳多选短片 scrubber → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN152.audit}(
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
      wave: 'M152' as const,
      labelZh: '审计回跳短片关帧书签 · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片关帧书签 · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN151.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const scrub = (base as any).auditSeekMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
    { frameIndex: 0, scrubIndex: 0, id: 'm152-audit-ms-frame-0', lineZh: '审计回跳多选帧#1', contrastSide: 'A' },
    { frameIndex: 1, scrubIndex: 1, id: 'm152-audit-ms-frame-1', lineZh: '审计回跳多选帧#2', contrastSide: 'B' },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!scrub);
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m152-audit-seek-kf-\${i}\`,
    nameZh: opts.bookmarkNameZh ? \`\${opts.bookmarkNameZh}#\${i + 1}\` : (f.lineZh || \`演示·M152审计回跳关帧#\${i + 1}\`),
    scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
    frameId: f.id,
    contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    wave: 'M152' as const,
  }));
  const auditSeekClipKfBm = wantsKf
    ? {
        wave: 'M152' as const,
        kind: 'audit-seek-clip-kf-bm' as const,
        titleZh: '审计回跳多选短片 scrubber · 关帧书签',
        bodyZh:
          \`审计回跳多选短片 scrubber 支持关帧书签 · \${bookmarks.length}枚\` +
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
    wave: 'M152' as const,
    labelZh: auditSeekClipKfBm
      ? \`审计回跳短片关帧书签 · \${auditSeekClipKfBm.bookmarkCount}枚\`
      : '审计回跳短片关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekClipKfBm ? \` · \${auditSeekClipKfBm.bodyZh}\` : ''),
    toastZh: auditSeekClipKfBm
      ? '审计回跳短片关帧书签已开'
      : '审计回跳短片关帧书签待命',
    busyZh: '审计回跳短片关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectClipScrubberIntact: (base as any).auditSeekMultiselectClipScrubberIntact === true,
    auditSeekClipKfBmIntact: !!auditSeekClipKfBm,
    auditSeekClipKfBm,
    ${FN152.audit}Path: '${PATH152.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'ClipScrubberM151KeyframeBookmarksM152',
);

console.log('core modules patched (functions)');
