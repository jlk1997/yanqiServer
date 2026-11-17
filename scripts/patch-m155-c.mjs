#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const confirm154 = 'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154';
const confirm155 = confirm154 + 'XsessionRoShareMultiselectContrastM155';
const soft154 = 'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154';
const soft155 = soft154 + 'KeyframeBookmarksM155';
const audit154 = 'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154';
const audit155 = audit154 + 'RoleAuditOnepagerM155';
const fail154 = 'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154';
const fail155 = fail154 + 'SeekLedgerM155';
const ab154 = 'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154';
const ab155 = ab154 + 'KeyframeBookmarksM155';

const pathConfirm154 = 'recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154';
const pathConfirm155 = pathConfirm154 + '/xsession-ro-share/multiselect-contrast/m155';
const pathSoft154 = 'ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber';
const pathSoft155 = pathSoft154 + '/keyframe-bookmarks';
const pathAudit154 = 'inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger';
const pathAudit155 = pathAudit154 + '/role-audit-onepager';
const pathFail154 = 'enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager';
const pathFail155 = pathFail154 + '/seek-ledger';
const pathAb154 = 'enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber';
const pathAb155 = pathAb154 + '/keyframe-bookmarks';

const WAVE = 'M155-core-confirm-kf-bm-xsession-ro-share-share-revoke-expiry-seek-multiselect-soft-cancel-multiselect-clip-kf-bm-audit-expiry-role-audit-fail-attr-expiry-role-audit-seek-ab-role-audit-seek-multiselect-kf-bm';

const metricsPath = path.join(root, 'apps/api/src/metrics/metrics.controller.ts');
let m = fs.readFileSync(metricsPath, 'utf8');
if (!m.includes(confirm155)) {
  m = m.replace(
    `  ${confirm154},\n} from '../matches/bypass-contrast-board';`,
    `  ${confirm154},\n  ${confirm155},\n} from '../matches/bypass-contrast-board';`,
  );
  m = m.replace(
    `  ${audit154},\n} from '../workbench/anomaly-contrast-batch-rerun';`,
    `  ${audit154},\n  ${audit155},\n} from '../workbench/anomaly-contrast-batch-rerun';`,
  );
  m = m.replace(
    `  ${soft154},\n} from '../workbench/anomaly-chain-job';`,
    `  ${soft154},\n  ${soft155},\n} from '../workbench/anomaly-chain-job';`,
  );
  fs.writeFileSync(metricsPath, m);
  console.log('updated metrics imports');
} else {
  console.log('metrics imports already have M155');
}

m = fs.readFileSync(metricsPath, 'utf8');
if (!m.includes('ConfirmKfBmXsessionRoShareShareRevokeExpirySeekMultiselectM155Get')) {
  const routes = `

  /** M155：确认卡关帧跨会话只读分享 · 吊销过期回跳多选对照 */
  @Get('${pathConfirm155}')
  ConfirmKfBmXsessionRoShareShareRevokeExpirySeekMultiselectM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${confirm155}(tenantId, {
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true, shortClipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M155确认卡关帧', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true,
      crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m155-clip', targetSessionId: targetSessionId || 'session-peer-m155-clip',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
      pinpointAnnotate: true, annotateFields: ['org', 'person'], noteZh: '演示·M155确认卡关帧',
      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', dryRun: true,
    });
  }

  @Post('${pathConfirm155}')
  ConfirmKfBmXsessionRoShareShareRevokeExpirySeekMultiselectM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${confirm155}(tenantId, body || {});
  }

  /** M155：软取消多选短片关帧书签 */
  @Get('${pathSoft155}')
  SoftCancelMultiselectClipKeyframeBookmarksM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${soft155}(tenantId, {
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M155软取消多选短片关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m155-soft-cancel', targetSessionId: targetSessionId || 'session-peer-m155-soft-cancel',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true, dryRun: true,
    });
  }

  @Post('${pathSoft155}')
  SoftCancelMultiselectClipKeyframeBookmarksM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${soft155}(tenantId, { ...(body || {}), softCancel: body?.softCancel !== false, keyframeBookmarks: body?.keyframeBookmarks !== false, scrubberBookmarks: body?.scrubberBookmarks !== false });
  }

  /** M155：审计过期吊销角色审计一页纸 */
  @Get('${pathAudit155}')
  AuditKfBmXsessionExpiryRevokeRoleAuditM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${audit155}(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M155审计回跳关帧',
      crossSessionShare: true, crossSessionShareBookmarks: true, readOnlyShare: true, shareFfReplayBookmarks: true,
      sessionId: sessionId || 'session-demo-m155-audit-kf', targetSessionId: targetSessionId || 'session-peer-m155-audit-kf',
      exportClipFrames: true, clipFrames: true, shortClipFrames: true, inAppClipFrames: true,
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, dryRun: true,
    });
  }

  @Post('${pathAudit155}')
  AuditKfBmXsessionExpiryRevokeRoleAuditM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${audit155}(tenantId, body || {});
  }

`;
  const idx = m.lastIndexOf('\n}\n');
  m = m.slice(0, idx) + routes + m.slice(idx);
  fs.writeFileSync(metricsPath, m);
  console.log('added metrics routes');
} else {
  console.log('metrics routes already M155');
}

const icPath = path.join(root, 'apps/api/src/imports/imports.controller.ts');
let ic = fs.readFileSync(icPath, 'utf8');
if (!ic.includes('FailAttrExpiryRoleAuditSeekLedgerM155Get')) {
  const routes = `

  /** M155：失败归因过期角色审计回跳台账 */
  @Get('${pathFail155}')
  FailAttrExpiryRoleAuditSeekLedgerM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${fail155}(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M155失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m155-fail-attr', targetSessionId: targetSessionId || 'session-peer-m155-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('${pathFail155}')
  FailAttrExpiryRoleAuditSeekLedgerM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${fail155}(tenantId, body || {});
  }

  /** M155：A/B 失败归因角色审计回跳多选关帧书签 */
  @Get('${pathAb155}')
  AbFailAttrRoleAuditSeekMultiselectKeyframeBookmarksM155Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('seq') seq?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${ab155}(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m155',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M155 A/B失败归因角色审计回跳多选关帧',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M155 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m155-summary', targetSessionId: targetSessionId || 'session-peer-m155-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('${pathAb155}')
  AbFailAttrRoleAuditSeekMultiselectKeyframeBookmarksM155Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${ab155}(tenantId, body || {});
  }

`;
  const idx = ic.lastIndexOf('\n}\n');
  ic = ic.slice(0, idx) + routes + ic.slice(idx);
  fs.writeFileSync(icPath, ic);
  console.log('added imports.controller routes');
} else {
  console.log('imports.controller already M155');
}

const adminPath = path.join(root, 'apps/api/src/admin/admin.controller.ts');
let a = fs.readFileSync(adminPath, 'utf8');
a = a.replace(
  /maturityWave: 'M154-[^']+'/,
  `maturityWave: '${WAVE}'`,
);
if (!a.includes('matchConfirmKfBmXsessionRoShareShareRevokeExpirySeekMsSoftCancelMsClipKfBmAuditExpiryRoleAuditM155')) {
  a = a.replace(
    'conflictUiFailAttrExpiryLedgerRoleAuditAbRoleAuditSeekMsClipM154: true,',
    `conflictUiFailAttrExpiryLedgerRoleAuditAbRoleAuditSeekMsClipM154: true,
      matchConfirmKfBmXsessionRoShareShareRevokeExpirySeekMsSoftCancelMsClipKfBmAuditExpiryRoleAuditM155: true,
      conflictUiFailAttrExpiryRoleAuditSeekAbRoleAuditSeekMsKfBmM155: true,`,
  );
}
fs.writeFileSync(adminPath, a);
console.log('updated admin.controller');

console.log('done controllers');
