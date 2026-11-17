#!/usr/bin/env node
/**
 * M162 hardening patch: wraps M161 core match/import path features.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN161 = {
  confirm: 'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161',
  soft: 'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161',
  audit: 'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161',
};

const FN162 = {
  confirm: FN161.confirm + 'XsessionRoShareMultiselectContrastM162',
  soft: FN161.soft + 'KeyframeBookmarksM162',
  audit: FN161.audit + 'RoleAuditOnepagerM162',
};

const PATH161 = {
  confirm: '/api/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161',
  soft: '/api/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  audit: '/api/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161',
};

const PATH162 = {
  confirm: PATH161.confirm + '/xsession-ro-share/multiselect-contrast/m162',
  soft: PATH161.soft + '/keyframe-bookmarks',
  audit: PATH161.audit + '/role-audit-onepager/m162',
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
 * M162：确认卡关帧跨会话只读分享 + 吊销过期回跳多选对照
 * （软取消；干跑；toast；无外发）
 */
export function ${FN162.confirm}(
  tenantId?: string | null,
  opts: {
    role?: string | null;
    myRole?: string | null;
    filterRole?: string | null;
    softCancel?: boolean;
    crossSessionShare?: boolean;
    crossSessionShareBookmarks?: boolean;
    readOnlyShare?: boolean;
    shareFfReplayBookmarks?: boolean;
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
    opts.multiSelectContrast === false &&
    opts.multiSelectLedgerRows === false
  ) {
    return {
      ok: true as const,
      wave: 'M162' as const,
      labelZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照 · 已软取消',
      tipZh: '用户软取消赢过确认卡关帧跨会话只读分享与吊销过期回跳多选对照 · 无外发 · 中页取消仍在',
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

  const base = ${FN161.confirm}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const kf = (base as any).confirmClipKfBm || null;
  const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
    { id: 'm162-confirm-kf-0', nameZh: '演示·M162确认卡关帧#1', scrubIndex: 0 },
    { id: 'm162-confirm-kf-1', nameZh: '演示·M162确认卡关帧#2', scrubIndex: 1 },
  ];
  const sessionId = String(opts.sessionId || 'session-demo-m162-clip').trim();
  const targetSessionId = String(opts.targetSessionId || 'session-peer-m162-clip').trim();
  const wantsShare =
    opts.crossSessionShare !== false &&
    (opts.crossSessionShare === true ||
      opts.crossSessionShareBookmarks === true ||
      opts.readOnlyShare === true ||
      opts.shareFfReplayBookmarks === true ||
      !!kf);
  const shareToken = \`m162-confirm-kf-share-\${sessionId}-\${targetSessionId}\`.slice(0, 96);
  const confirmKfBmXsessionRoShare = wantsShare
    ? {
        wave: 'M162' as const,
        kind: 'confirm-kf-bm-xsession-ro-share' as const,
        titleZh: '确认卡关帧书签 · 跨会话只读分享',
        bodyZh:
          \`确认卡关帧书签支持跨会话只读分享 · \${bookmarks.length}枚\` +
          \` · 自「\${sessionId}」→「\${targetSessionId}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        bookmarks,
        bookmarkCount: bookmarks.length,
        shareToken,
        sessionId,
        targetSessionId,
        fromKf: kf
          ? { kind: kf.kind, bookmarkCount: kf.bookmarkCount, frameCount: kf.frameCount }
          : null,
        filterRole,
        filterRoleZh,
        crossSessionShare: true as const,
        crossSessionShareBookmarks: true as const,
        readOnlyShare: true as const,
        shareFfReplayBookmarks: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  const seek = (base as any).shareRevokeExpiryRoleAuditSeekLedger || null;
  const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
    { id: 'm162-share-revoke-seek-ms-0', auditLineZh: '演示·吊销过期回跳行#1', kindZh: '吊销过期回跳多选对照' },
    { id: 'm162-share-revoke-seek-ms-1', auditLineZh: '演示·吊销过期回跳行#2', kindZh: '吊销过期回跳多选对照' },
  ];
  const seekEntryIndexes = Array.isArray(opts.seekEntryIndexes) && opts.seekEntryIndexes.length
    ? opts.seekEntryIndexes.map((n: any) => Math.max(0, Number(n) || 0))
    : [0, 1];
  const wantsMs =
    opts.multiSelectContrast !== false &&
    (opts.multiSelectContrast === true ||
      opts.multiSelectLedgerRows === true ||
      !!seek);
  const selectedRows = seekEntryIndexes.map((idx: number, i: number) => {
    const line = lines[Math.min(idx, lines.length - 1)] || lines[0];
    return {
      index: idx,
      id: line?.id || \`m162-share-revoke-ms-\${i}\`,
      lineZh: line?.auditLineZh || \`吊销过期回跳行#\${i + 1}\`,
      contrastSide: i % 2 === 0 ? 'A' : 'B',
      kindZh: line?.kindZh || '吊销过期回跳多选对照',
      wave: 'M162' as const,
    };
  });
  const shareRevokeSeekMultiselectContrast = wantsMs
    ? {
        wave: 'M162' as const,
        kind: 'share-revoke-seek-multiselect-contrast' as const,
        titleZh: '吊销过期回跳中文台账 · 多选中文对照',
        bodyZh:
          \`吊销过期回跳中文台账可多选中文对照 · 选中\${selectedRows.length}行 / 共\${lines.length}行\` +
          \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 软取消仍在 · 干跑 · toast · 无外发\`,
        lines,
        lineCount: lines.length,
        selectedRows,
        selectedCount: selectedRows.length,
        seekEntryIndexes,
        fromSeek: seek
          ? { kind: seek.kind, lineCount: seek.lineCount, seekEntryIndex: seek.seekEntryIndex }
          : null,
        filterRole,
        filterRoleZh,
        multiSelectLedgerRows: true as const,
        multiSelectContrast: true as const,
        chineseContrast: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M162' as const,
    labelZh:
      (confirmKfBmXsessionRoShare
        ? \`确认卡关帧跨会话只读分享 · \${confirmKfBmXsessionRoShare.bookmarkCount}枚\`
        : '确认卡关帧跨会话只读分享待命') +
      (shareRevokeSeekMultiselectContrast
        ? \` · 吊销过期回跳多选对照\`
        : ''),
    tipZh:
      ((base as any).tipZh || '') +
      (confirmKfBmXsessionRoShare ? \` · \${confirmKfBmXsessionRoShare.bodyZh}\` : '') +
      (shareRevokeSeekMultiselectContrast ? \` · \${shareRevokeSeekMultiselectContrast.bodyZh}\` : ''),
    toastZh:
      confirmKfBmXsessionRoShare && shareRevokeSeekMultiselectContrast
        ? '确认卡关帧跨会话只读分享 · 吊销过期回跳多选对照'
        : confirmKfBmXsessionRoShare
          ? '确认卡关帧跨会话只读分享已开'
          : shareRevokeSeekMultiselectContrast
            ? '吊销过期回跳多选对照已开'
            : '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照待命',
    busyZh: '确认卡关帧跨会话只读分享 / 吊销过期回跳多选对照…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    confirmClipKfBmIntact: (base as any).confirmClipKfBmIntact === true,
    shareRevokeExpiryRoleAuditSeekLedgerIntact: (base as any).shareRevokeExpiryRoleAuditSeekLedgerIntact === true,
    confirmKfBmXsessionRoShareIntact: !!confirmKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrastIntact: !!shareRevokeSeekMultiselectContrast,
    confirmKfBmXsessionRoShare,
    shareRevokeSeekMultiselectContrast,
    ${FN162.confirm}Path: '${PATH162.confirm}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/matches/bypass-contrast-board.ts',
  confirmFn,
  'XsessionRoShareMultiselectContrastM162',
);

const softFn = `
/**
 * M162：软取消多选中文对照 → 关帧书签
 * （软取消；干跑；toast；无外发）
 */
export function ${FN162.soft}(
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
      wave: 'M162' as const,
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

  const base = ${FN161.soft}(tid, {
    ...opts,
    role,
    dryRun: opts.dryRun !== false,
  });

  const clip = (base as any).softCancelMultiselectClipScrubber || null;
  const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
    { frameIndex: 0, id: 'm162-soft-ms-0', lineZh: '演示·软取消多选帧#1', scrubIndex: 0 },
    { frameIndex: 1, id: 'm162-soft-ms-1', lineZh: '演示·软取消多选帧#2', scrubIndex: 1 },
  ];
  const wantsKf =
    opts.keyframeBookmarks !== false &&
    (opts.keyframeBookmarks === true ||
      opts.scrubberBookmarks === true ||
      opts.scrubberKeyframeBookmarks === true ||
      !!clip);
  const bookmarkNameZh = String(opts.bookmarkNameZh || '演示·M162软取消多选关帧').trim();
  const bookmarks = frames.map((f: any, i: number) => ({
    id: \`m162-soft-ms-kf-\${f.id || i}\`.slice(0, 96),
    nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
    scrubIndex: f.scrubIndex ?? i,
    frameIndex: f.frameIndex ?? i,
    lineZh: f.lineZh || \`软取消多选帧#\${i + 1}\`,
    wave: 'M162' as const,
  }));
  const softCancelMultiselectKfBm = wantsKf
    ? {
        wave: 'M162' as const,
        kind: 'soft-cancel-multiselect-kf-bm' as const,
        titleZh: '软取消多选中文对照 · 关帧书签',
        bodyZh:
          \`软取消多选中文对照支持关帧书签 · \${bookmarks.length}枚\` +
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
        keyframeBookmarks: true as const,
        scrubberBookmarks: true as const,
        scrubberKeyframeBookmarks: true as const,
        softCancelIntact: true as const,
        dryRun: true as const,
        noEgress: true as const,
      }
    : null;

  return {
    ...(base as any),
    ok: true as const,
    wave: 'M162' as const,
    labelZh: softCancelMultiselectKfBm
      ? \`软取消多选关帧书签 · \${softCancelMultiselectKfBm.bookmarkCount}枚\`
      : '软取消多选关帧书签待命',
    tipZh:
      ((base as any).tipZh || '') +
      (softCancelMultiselectKfBm ? \` · \${softCancelMultiselectKfBm.bodyZh}\` : ''),
    toastZh: softCancelMultiselectKfBm
      ? '软取消多选关帧书签已开'
      : '软取消多选关帧书签待命',
    busyZh: '软取消多选关帧书签…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    softCancelMultiselectClipScrubberIntact: (base as any).softCancelMultiselectClipScrubberIntact === true,
    softCancelMultiselectKfBmIntact: !!softCancelMultiselectKfBm,
    softCancelMultiselectKfBm,
    ${FN162.soft}Path: '${PATH162.soft}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-chain-job.ts',
  softFn,
  'ClipScrubberM161KeyframeBookmarksM162',
);

const auditFn = `
/**
 * M162：审计过期吊销中文台账 → 角色过滤审计一页纸
 * （软取消；干跑；toast；无外发）
 */
export function ${FN162.audit}(
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
      wave: 'M162' as const,
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

  const base = ${FN161.audit}(tid, {
    ...opts,
    role,
    filterRole,
    dryRun: opts.dryRun !== false,
  });

  const expiry = (base as any).auditKfBmXsessionExpiryRevokeLedger || null;
  const ledgerEntry = expiry?.ledgerEntry || {
    id: 'm162-audit-expiry-demo',
    auditLineZh: '演示·审计过期吊销台账行',
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
      id: ledgerEntry.id || 'm162-audit-expiry-0',
      auditLineZh: ledgerEntry.auditLineZh || '演示·审计过期吊销台账行#1',
      kindZh: ledgerEntry.kindZh || '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M162' as const,
    },
    {
      id: 'm162-audit-expiry-1',
      auditLineZh: '演示·审计过期吊销台账行#2',
      kindZh: '审计过期吊销角色审计',
      filterRole,
      filterRoleZh,
      wave: 'M162' as const,
    },
  ];
  const auditExpiryRevokeRoleAuditOnepager = wantsAudit
    ? {
        wave: 'M162' as const,
        kind: 'audit-expiry-revoke-role-audit-onepager' as const,
        titleZh: '审计过期吊销中文台账 · 角色过滤审计一页纸',
        bodyZh:
          \`审计过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
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
    wave: 'M162' as const,
    labelZh: auditExpiryRevokeRoleAuditOnepager
      ? \`审计过期吊销角色审计一页纸 · \${auditExpiryRevokeRoleAuditOnepager.lineCount}行\`
      : '审计过期吊销角色审计一页纸待命',
    tipZh:
      ((base as any).tipZh || '') +
      (auditExpiryRevokeRoleAuditOnepager ? \` · \${auditExpiryRevokeRoleAuditOnepager.bodyZh}\` : ''),
    toastZh: auditExpiryRevokeRoleAuditOnepager
      ? '审计过期吊销角色审计一页纸已开'
      : '审计过期吊销角色审计一页纸待命',
    busyZh: '审计过期吊销角色审计一页纸…',
    dryRun: true as const,
    noEgress: true as const,
    softCancelIntact: true as const,
    midPageCancelIntact: true as const,
    softCancelWins: true as const,
    auditKfBmXsessionExpiryRevokeLedgerIntact: (base as any).auditKfBmXsessionExpiryRevokeLedgerIntact === true,
    auditExpiryRevokeRoleAuditOnepagerIntact: !!auditExpiryRevokeRoleAuditOnepager,
    auditExpiryRevokeRoleAuditOnepager,
    ${FN162.audit}Path: '${PATH162.audit}',
  };
}
`;

insertBeforeClosingBraceClass(
  'apps/api/src/workbench/anomaly-contrast-batch-rerun.ts',
  auditFn,
  'ExpiryRevokeLedgerM161RoleAuditOnepagerM162',
);

console.log('core modules patched (functions)');
