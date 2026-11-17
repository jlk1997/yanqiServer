#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const confirm157 = 'shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157';
const confirm158 = confirm157 + 'SeekLedgerXsessionRoShareM158';
const soft157 = 'forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157';
const soft158 = soft157 + 'RoleAuditOnepagerM158';
const audit157 = 'softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157';
const audit158 = audit157 + 'ClipScrubberM158';
const fail157 = 'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157';
const fail158 = fail157 + 'KeyframeBookmarksM158';
const ab157 = 'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157';
const ab158 = ab157 + 'RoleAuditOnepagerM158';

const pathConfirm157 = 'recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157';
const pathConfirm158 = pathConfirm157 + '/seek-ledger/xsession-ro-share/m158';
const pathSoft157 = 'ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger';
const pathSoft158 = pathSoft157 + '/role-audit-onepager';
const pathAudit157 = 'inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast';
const pathAudit158 = pathAudit157 + '/clip-scrubber';
const pathFail157 = 'enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber';
const pathFail158 = pathFail157 + '/keyframe-bookmarks';
const pathAb157 = 'enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger';
const pathAb158 = pathAb157 + '/role-audit-onepager';

const WAVE = 'M158-core-confirm-role-audit-seek-ledger-share-revoke-kf-bm-xsession-ro-share-soft-cancel-expiry-ledger-role-audit-onepager-audit-seek-ms-clip-scrubber-fail-attr-clip-kf-bm-ab-expiry-revoke-role-audit-onepager';

const metricsPath = path.join(root, 'apps/api/src/metrics/metrics.controller.ts');
let m = fs.readFileSync(metricsPath, 'utf8');
if (!m.includes(confirm158)) {
  m = m.replace(
    `  ${confirm157},\n} from '../matches/bypass-contrast-board';`,
    `  ${confirm157},\n  ${confirm158},\n} from '../matches/bypass-contrast-board';`,
  );
  m = m.replace(
    `  ${audit157},\n} from '../workbench/anomaly-contrast-batch-rerun';`,
    `  ${audit157},\n  ${audit158},\n} from '../workbench/anomaly-contrast-batch-rerun';`,
  );
  m = m.replace(
    `  ${soft157},\n} from '../workbench/anomaly-chain-job';`,
    `  ${soft157},\n  ${soft158},\n} from '../workbench/anomaly-chain-job';`,
  );
  fs.writeFileSync(metricsPath, m);
  console.log('updated metrics imports');
} else {
  console.log('metrics imports already have M158');
}

m = fs.readFileSync(metricsPath, 'utf8');
if (!m.includes('ConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158Get')) {
  const routes = `

  /** M158：确认卡角色审计回跳台账 · 吊销关帧跨会话只读分享 */
  @Get('${pathConfirm158}')
  ConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${confirm158}(tenantId, {
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true, shortClipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M158吊销关帧', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true,
      crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m158-clip', targetSessionId: targetSessionId || 'session-peer-m158-clip',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
      pinpointAnnotate: true, annotateFields: ['org', 'person'], noteZh: '演示·M158确认卡角色审计回跳',
      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', dryRun: true,
    });
  }

  @Post('${pathConfirm158}')
  ConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${confirm158}(tenantId, body || {});
  }

  /** M158：软取消过期台账角色审计一页纸 */
  @Get('${pathSoft158}')
  SoftCancelExpiryLedgerRoleAuditOnepagerM158Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${soft158}(tenantId, {
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158软取消关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m158-soft-cancel', targetSessionId: targetSessionId || 'session-peer-m158-soft-cancel',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true, dryRun: true,
    });
  }

  @Post('${pathSoft158}')
  SoftCancelExpiryLedgerRoleAuditOnepagerM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${soft158}(tenantId, { ...(body || {}), softCancel: body?.softCancel !== false, roleAuditOnePager: body?.roleAuditOnePager !== false, roleFilteredAudit: body?.roleFilteredAudit !== false });
  }

  /** M158：审计回跳多选短片scrubber */
  @Get('${pathAudit158}')
  AuditSeekMultiselectClipScrubberM158Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${audit158}(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158审计回跳',
      crossSessionShare: true, crossSessionShareBookmarks: true, readOnlyShare: true, shareFfReplayBookmarks: true,
      sessionId: sessionId || 'session-demo-m158-audit-kf', targetSessionId: targetSessionId || 'session-peer-m158-audit-kf',
      exportClipFrames: true, clipFrames: true, shortClipFrames: true, inAppClipFrames: true,
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, dryRun: true,
    });
  }

  @Post('${pathAudit158}')
  AuditSeekMultiselectClipScrubberM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${audit158}(tenantId, body || {});
  }

`;
  const idx = m.lastIndexOf('\n}\n');
  m = m.slice(0, idx) + routes + m.slice(idx);
  fs.writeFileSync(metricsPath, m);
  console.log('added metrics routes');
} else {
  console.log('metrics routes already M158');
}

const icPath = path.join(root, 'apps/api/src/imports/imports.controller.ts');
let ic = fs.readFileSync(icPath, 'utf8');
if (!ic.includes('FailAttrClipKeyframeBookmarksM158Get')) {
  const routes = `

  /** M158：失败归因短片关帧书签 */
  @Get('${pathFail158}')
  FailAttrClipKeyframeBookmarksM158Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${fail158}(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158失败归因短片关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m158-fail-attr', targetSessionId: targetSessionId || 'session-peer-m158-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('${pathFail158}')
  FailAttrClipKeyframeBookmarksM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${fail158}(tenantId, body || {});
  }

  /** M158：A/B 失败归因过期吊销角色审计一页纸 */
  @Get('${pathAb158}')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM158Get(
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
    return this.imports.${ab158}(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m158',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M158 A/B失败归因过期吊销',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M158 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m158-summary', targetSessionId: targetSessionId || 'session-peer-m158-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('${pathAb158}')
  AbFailAttrExpiryRevokeRoleAuditOnepagerM158Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${ab158}(tenantId, body || {});
  }

`;
  const idx = ic.lastIndexOf('\n}\n');
  ic = ic.slice(0, idx) + routes + ic.slice(idx);
  fs.writeFileSync(icPath, ic);
  console.log('added imports.controller routes');
} else {
  console.log('imports.controller already M158');
}

const adminPath = path.join(root, 'apps/api/src/admin/admin.controller.ts');
let a = fs.readFileSync(adminPath, 'utf8');
a = a.replace(
  /maturityWave: 'M157-[^']+'/,
  `maturityWave: '${WAVE}'`,
);
if (!a.includes('matchConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareSoftCancelExpiryLedgerRoleAuditAuditSeekMsClipM158')) {
  a = a.replace(
    'conflictUiFailAttrSeekMsClipScrubberAbMsKfBmXsessionExpiryRevokeM157: true,',
    `conflictUiFailAttrSeekMsClipScrubberAbMsKfBmXsessionExpiryRevokeM157: true,
      matchConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareSoftCancelExpiryLedgerRoleAuditAuditSeekMsClipM158: true,
      conflictUiFailAttrClipKfBmAbExpiryRevokeRoleAuditOnepagerM158: true,`,
  );
}
fs.writeFileSync(adminPath, a);
console.log('updated admin.controller');

console.log('done controllers');
