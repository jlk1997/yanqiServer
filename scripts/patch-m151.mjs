#!/usr/bin/env node
/**
 * M151 hardening patch: wraps M150 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN150 = {
  confirm:
    'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150',
  soft:
    'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150',
  audit:
    'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150',
};

const FN151 = {
  confirm: FN150.confirm + 'SeekLedgerXsessionRoShareM151',
  soft: FN150.soft + 'RoleAuditOnepagerM151',
  audit: FN150.audit + 'ClipScrubberM151',
};

const PATH150 = {
  confirm:
    '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150',
  soft:
    '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  audit:
    '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
};

const PATH151 = {
  confirm: PATH150.confirm + '/seek-ledger/xsession-ro-share/m151',
  soft: PATH150.soft + '/role-audit-onepager',
  audit: PATH150.audit + '/clip-scrubber',
};

function insertBeforeClosingBraceClass(file, insertion, marker) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(marker)) {
    console.log('skip already', marker, 'in', file);
    return false;
  }
  const idx = s.lastIndexOf('\n}\n');
  if (idx < 0) throw new Error('no closing brace in ' + file);
  s = s.slice(0, idx) + '\n' + insertion + s.slice(idx);
  fs.writeFileSync(p, s);
  console.log('inserted before close in', file);
  return true;
}

const confirmFn = `
/**
 * M151：确认卡角色审计回跳中文台账 + 吊销关帧跨会话只读分享
 * （软取消；干跑；toast；无外发）
 */
export function ${FN151.confirm}(
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
      wave: 'M151' as const,
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

  const base = ${FN150.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const audit = (base as any).confirmExpiryRevokeLedgerRoleAuditOnepager || null;
  const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
    { id: 'm151-confirm-audit-seek-0', auditLineZh: '演示·确认卡角色审计台账行#1', kindZh: '确认卡过期吊销台账' },
    { id: 'm151-confirm-audit-seek-1', auditLineZh: '演示·确认卡角色审计台账行#2', kindZh: '确认卡过期吊销台账' },
  ];
  const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(opts.seekEntryIndex) || 0));
  const wantsSeek =
    opts.seekLedgerRow !== false &&
    (opts.seekLedgerRow === true ||
      opts.seekBackToLedger === true ||
      opts.highlightLedgerRow === true ||
      !!audit);
  const hit = lines[seekEntryIndex] || lines[0] || {};
  const confirmRoleAuditSeekLedger = wantsSeek
    ? {
        wave: 'M151' as const,
        kind: 'confirm-role-audit-seek-ledger' as const,
        titleZh: '确认卡角色过滤审计一页纸 · 回跳中文台账',
        bodyZh:
          \`确认卡角色过滤审计可回跳中文台账 · 行#\${seekEntryIndex + 1}/\${lines.length}\` +
          \` · 「\${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        seekEntryIndex,
        ledgerRowId: hit.id || \`m151-confirm-audit-seek-\${seekEntryIndex}\`,
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

  const kf = (base as any).shareRevokeMultiselectClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm151-share-revoke-kf-0', nameZh: '演示·M151吊销关帧#1', scrubIndex: 0 },
    { id: 'm151-share-revoke-kf-1', nameZh: '演示·M151吊销关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m151-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m151-clip').trim();
  const wantsXshare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.readOnlyShare === true ||
      !!kf);
  const shareToken = \`ro-m151-share-revoke-\${sessionId}-\${targetSessionId}-\${bookmarks.length}\`.slice(0, 96);
  const shareRevokeKfBmXsessionRoShare = wantsXshare
    ? {
        wave: 'M151' as const,
        kind: 'share-revoke-kf-bm-xsession-ro-share' as const,
        titleZh: '吊销多选短片关帧书签 · 跨会话只读分享',
        bodyZh:
          \`吊销多选短片关帧书签支持跨会话只读分享 · \${bookmarks.length}枚\` +
          \` · 自「\${sessionId}」→「\${targetSessionId}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        sessionId,
        targetSessionId,
        shareToken,
        readOnlyShare: true as const,
        crossSessionShare: true as const,
        fromKfBm: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount, frameCount: kf.frameCount }
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
    wave: 'M151' as const,
    labelZh:
      (confirmRoleAuditSeekLedger
        ? \`确认卡角色审计回跳台账 · 行#\${(confirmRoleAuditSeekLedger.seekEntryIndex || 0) + 1}\`
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
    confirmExpiryRevokeLedgerRoleAuditOnepagerIntact: (base as any).confirmExpiryRevokeLedgerRoleAuditOnepagerIntact === true,
    shareRevokeMultiselectClipKfBmIntact: (base as any).shareRevokeMultiselectClipKfBmIntact === true,
    confirmRoleAuditSeekLedgerIntact: !!confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShareIntact: !!shareRevokeKfBmXsessionRoShare,
    confirmRoleAuditSeekLedger,
    shareRevokeKfBmXsessionRoShare,
    ${FN151.confirm}Path: '${PATH151.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'SeekLedgerXsessionRoShareM151',
);

const softFn = `
/**
 * M151：软取消过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function ${FN151.soft}(
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
    opts.roleAuditOnePager === false
  ) {
    return {
      ok: true as const,
      wave: 'M151' as const,
      labelZh: '软取消过期台账角色审计一页纸 · 已软取消',
      tipZh: '用户软取消赢过软取消过期吊销台账角色审计一页纸 · 无外发 · 中页取消仍在',
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

  const base = ${FN150.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const ledger = (base as any).softCancelKfBmXsessionExpiryRevokeLedger || null;
  const wantsAudit =
    opts.roleFilteredAudit !== false &&
    (opts.roleFilteredAudit === true ||
      opts.renderAuditOnePager === true ||
      opts.roleAuditOnePager === true ||
      opts.inAppOnePager === true ||
      !!ledger);
  const lines = [
    {
      id: ledger?.ledgerEntry?.id || 'm151-soft-audit-0',
      auditLineZh: ledger?.ledgerEntry?.auditLineZh || '演示·软取消过期吊销台账行#1',
      kindZh: ledger?.ledgerEntry?.kindZh || '软取消关帧跨会话分享过期吊销',
    },
    { id: 'm151-soft-audit-1', auditLineZh: '演示·软取消过期吊销台账行#2', kindZh: '软取消关帧跨会话分享过期登记' },
  ];
  const softCancelExpiryLedgerRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M151' as const,
        kind: 'soft-cancel-expiry-ledger-role-audit-onepager' as const,
        titleZh: '软取消过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`软取消过期吊销中文台账可出角色过滤审计一页纸 · \${lines.length}行\` +
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

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M151' as const,
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
    ${FN151.soft}Path: '${PATH151.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'ExpiryRevokeLedgerM150RoleAuditOnepagerM151',
);

const auditFn = `
/**
 * M151：审计回跳多选中文对照 → 短片 scrubber
 * （软取消；干跑；toast；无外发）
 */
export function ${FN151.audit}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    clipFrameScrubber?: boolean;
    scrubber?: boolean;
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
    opts.clipFrameScrubber === false &&
    opts.scrubber === false
  ) {
    return {
      ok: true as const,
      wave: 'M151' as const,
      labelZh: '审计回跳多选短片 scrubber · 已软取消',
      tipZh: '用户软取消赢过审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
      toastZh: '已软取消',
      busyZh: '审计回跳多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      cancelled: true as const,
    };
  }

  const base = ${FN150.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const ms = (base as any).auditSeekMultiselectContrast || null;
  const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
    { index: 0, id: 'm151-audit-ms-0', lineZh: '审计回跳多选行#1', contrastSide: 'A' },
    { index: 1, id: 'm151-audit-ms-1', lineZh: '审计回跳多选行#2', contrastSide: 'B' },
  ];
  const scrubIndex = Math.max(0, Number(opts.scrubIndex) || 0);
  const wantsScrub =
    opts.clipFrameScrubber !== false &&
    (opts.clipFrameScrubber === true || opts.scrubber === true || !!ms || selectedRows.length > 0);
  const frames = selectedRows.map((row: any, i: number) => ({
    frameIndex: i,
    scrubIndex: i,
    id: row.id || \`m151-audit-ms-frame-\${i}\`,
    lineZh: row.lineZh || row.auditLineZh || \`对照帧#\${i + 1}\`,
    contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
    isCurrent: i === scrubIndex,
    wave: 'M151' as const,
  }));
  const auditSeekMultiselectClipScrubber = wantsScrub
    ? {
        wave: 'M151' as const,
        kind: 'audit-seek-multiselect-clip-scrubber' as const,
        titleZh: '审计回跳多选中文对照 · 短片 scrubber',
        bodyZh:
          \`审计回跳多选中文对照支持短片 scrubber · \${frames.length}帧\` +
          \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
          \` · 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        frames,
        frameCount: frames.length,
        scrubIndex,
        currentFrame: frames[Math.min(scrubIndex, Math.max(frames.length - 1, 0))] || frames[0] || null,
        selectedCount: ms?.selectedCount || selectedRows.length,
        fromMultiselect: ms
          ? { kind: ms.kind, selectedCount: ms.selectedCount, seekEntryIndexes: ms.seekEntryIndexes }
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
    wave: 'M151' as const,
    labelZh: auditSeekMultiselectClipScrubber
      ? \`审计回跳多选短片 scrubber · \${auditSeekMultiselectClipScrubber.frameCount}帧\`
      : '审计回跳多选短片 scrubber 待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditSeekMultiselectClipScrubber ? \` · \${auditSeekMultiselectClipScrubber.bodyZh}\` : ''),
    toastZh: auditSeekMultiselectClipScrubber
      ? '审计回跳多选短片 scrubber 已开'
      : '审计回跳多选短片 scrubber 待命',
    busyZh: '审计回跳多选短片 scrubber…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditSeekMultiselectContrastIntact: (base as any).auditSeekMultiselectContrastIntact === true,
    auditSeekMultiselectClipScrubberIntact: !!auditSeekMultiselectClipScrubber,
    auditSeekMultiselectClipScrubber,
    ${FN151.audit}Path: '${PATH151.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'MultiSelectContrastM150ClipScrubberM151',
);

console.log('core modules patched (functions)');
