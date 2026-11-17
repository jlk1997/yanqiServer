#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const confirm167 = "shareLedgerKfBmShareExpiryRevokeLedgerSoftUndoPinpointFailFoldAttrRoleAuditOnepagerRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastGraceSoftCancelLedgerClipFrameScrubberGraceSoftCancelLedgerRoleAuditOnepagerClipFrameScrubberKeyframeBookmarksRoleAuditOnepagerSeekLedgerMultiselectKfBmXsessionRoShareLedgerMultiselectClipFramesDiffPreviewAdoptConfirmLedgerClipScrubberKfBmConfirmAdoptSoftUndoBaClipScrubberKfBmXsessionRoShareSoftUndoBaPinpointRebypassClipKfBmXsessionShareExpiryRevokeLedgerPinpointRebypassFailFoldAttrShareRevokeLedgerRoleAuditOnepagerFailAttrOneClickRetryFoldTaskCardSeekLedgerPhasePauseGraceMultiSelectContrastSoftCancelLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerXsessionRoShareMultiselectContrastExpiryRevokeLedgerClipScrubberRoleAuditOnepagerKeyframeBookmarksSeekLedgerM140XsessionRoShareMultiselectContrastM141ExpiryRevokeLedgerClipScrubberM142RoleAuditOnepagerKeyframeBookmarksM143SeekLedgerXsessionRoShareM144MultiselectContrastExpiryRevokeLedgerM145ClipScrubberRoleAuditOnepagerM146KeyframeBookmarksSeekLedgerM147XsessionRoShareMultiselectContrastM148ExpiryRevokeLedgerClipScrubberM149RoleAuditOnepagerKeyframeBookmarksM150SeekLedgerXsessionRoShareM151MultiselectContrastExpiryRevokeLedgerM152ClipScrubberRoleAuditOnepagerM153KeyframeBookmarksSeekLedgerM154XsessionRoShareMultiselectContrastM155ExpiryRevokeLedgerClipScrubberM156RoleAuditOnepagerKeyframeBookmarksM157SeekLedgerXsessionRoShareM158MultiselectContrastExpiryRevokeLedgerM159ClipScrubberRoleAuditOnepagerM160KeyframeBookmarksSeekLedgerM161XsessionRoShareMultiselectContrastM162ExpiryRevokeLedgerClipScrubberM163RoleAuditOnepagerKeyframeBookmarksM164SeekLedgerXsessionRoShareM165MultiselectContrastExpiryRevokeLedgerM166ClipScrubberRoleAuditOnepagerM167";
const confirm168 = confirm167 + 'KeyframeBookmarksSeekLedgerM168';
const soft167 = "forceRerunClipChapterOnesideBaPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XSessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XSessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167";
const soft168 = soft167 + 'ClipScrubberM168';
const audit167 = "softUndoContrastDrillFailAttrRetryPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleFilteredAuditInAppOnepagerSeekLedgerMultiSelectContrastClipFramesScrubberKfBmXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastM143ClipScrubberM144KeyframeBookmarksM145XSessionRoShareM146ExpiryRevokeLedgerM147RoleAuditOnepagerM148SeekLedgerM149MultiSelectContrastM150ClipScrubberM151KeyframeBookmarksM152XSessionRoShareM153ExpiryRevokeLedgerM154RoleAuditOnepagerM155SeekLedgerM156MultiSelectContrastM157ClipScrubberM158KeyframeBookmarksM159XSessionRoShareM160ExpiryRevokeLedgerM161RoleAuditOnepagerM162SeekLedgerM163MultiSelectContrastM164ClipScrubberM165KeyframeBookmarksM166XSessionRoShareM167";
const audit168 = audit167 + 'ExpiryRevokeLedgerM168';
const fail167 = "resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167";
const fail168 = fail167 + 'RoleAuditOnepagerM168';
const ab167 = "rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167";
const ab168 = ab167 + 'ClipScrubberM168';

const pathConfirm168 = "recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161/xsession-ro-share/multiselect-contrast/m162/expiry-revoke-ledger/clip-scrubber/m163/role-audit-onepager/keyframe-bookmarks/m164/seek-ledger/xsession-ro-share/m165/multiselect-contrast/expiry-revoke-ledger/m166/clip-scrubber/role-audit-onepager/m167/keyframe-bookmarks/seek-ledger/m168";
const pathSoft168 = "ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168";
const pathAudit168 = "inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161/role-audit-onepager/m162/seek-ledger/m163/multi-select-contrast/m164/clip-scrubber/m165/keyframe-bookmarks/m166/xsession-ro-share/m167/expiry-revoke-ledger/m168";
const pathFail168 = "enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168";
const pathAb168 = "enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168";

const WAVE = "M168-core-confirm-clip-kf-bm-share-revoke-expiry-role-audit-seek-ledger-soft-cancel-multiselect-clip-scrubber-audit-kf-bm-xsession-expiry-revoke-fail-attr-expiry-ledger-role-audit-onepager-ab-seek-multiselect-clip-scrubber";

const metricsPath = path.join(root, 'apps/api/src/metrics/metrics.controller.ts');
let m = fs.readFileSync(metricsPath, 'utf8');
if (!m.includes(confirm168)) {
  m = m.replace(
    `  ${confirm167},\n} from '../matches/bypass-contrast-board';`,
    `  ${confirm167},\n  ${confirm168},\n} from '../matches/bypass-contrast-board';`,
  );
  m = m.replace(
    `  ${audit167},\n} from '../workbench/anomaly-contrast-batch-rerun';`,
    `  ${audit167},\n  ${audit168},\n} from '../workbench/anomaly-contrast-batch-rerun';`,
  );
  m = m.replace(
    `  ${soft167},\n} from '../workbench/anomaly-chain-job';`,
    `  ${soft167},\n  ${soft168},\n} from '../workbench/anomaly-chain-job';`,
  );
  fs.writeFileSync(metricsPath, m);
  console.log('updated metrics imports');
} else {
  console.log('metrics imports already have M168');
}

m = fs.readFileSync(metricsPath, 'utf8');
if (!m.includes('ConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM168Get')) {
  const routes = `

  /** M168：确认卡短片关帧书签 · 吊销过期角色审计回跳台账 */
  @Get('${pathConfirm168}')
  ConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM168Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${confirm168}(tenantId, {
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0,
      exportClipFrames: true, clipFrames: true, shortClipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
      bookmarkNameZh: '演示·M168确认卡短片关帧', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true,
      crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m168-clip', targetSessionId: targetSessionId || 'session-peer-m168-clip',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
      pinpointAnnotate: true, annotateFields: ['org', 'person'], noteZh: '演示·M168确认卡短片关帧',
      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', dryRun: true,
    });
  }

  @Post('${pathConfirm168}')
  ConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${confirm168}(tenantId, body || {});
  }

  /** M168：软取消多选短片scrubber */
  @Get('${pathSoft168}')
  SoftCancelMultiselectClipScrubberM168Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${soft168}(tenantId, {
      role: role || 'broker', filterRole: filterRole || role || 'broker',
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M168软取消关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m168-soft-cancel', targetSessionId: targetSessionId || 'session-peer-m168-soft-cancel',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true, dryRun: true,
    });
  }

  @Post('${pathSoft168}')
  SoftCancelMultiselectClipScrubberM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${soft168}(tenantId, { ...(body || {}), softCancel: body?.softCancel !== false, clipFrameScrubber: body?.clipFrameScrubber !== false, scrubber: body?.scrubber !== false });
  }

  /** M168：审计关帧跨会话过期吊销 */
  @Get('${pathAudit168}')
  AuditKfBmXsessionExpiryRevokeM168Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
    @Query('scrubIndex') scrubIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${audit168}(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M168审计关帧',
      crossSessionShare: true, crossSessionShareBookmarks: true, readOnlyShare: true, shareFfReplayBookmarks: true,
      sessionId: sessionId || 'session-demo-m168-audit-kf', targetSessionId: targetSessionId || 'session-peer-m168-audit-kf',
      exportClipFrames: true, clipFrames: true, shortClipFrames: true, inAppClipFrames: true,
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, dryRun: true,
    });
  }

  @Post('${pathAudit168}')
  AuditKfBmXsessionExpiryRevokeM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return ${audit168}(tenantId, body || {});
  }

`;
  const idx = m.lastIndexOf('\n}\n');
  m = m.slice(0, idx) + routes + m.slice(idx);
  fs.writeFileSync(metricsPath, m);
  console.log('added metrics routes');
} else {
  console.log('metrics routes already M168');
}

const icPath = path.join(root, 'apps/api/src/imports/imports.controller.ts');
let ic = fs.readFileSync(icPath, 'utf8');
if (!ic.includes('FailAttrExpiryLedgerRoleAuditOnepagerM168Get')) {
  const routes = `

  /** M168：失败归因过期台账角色审计一页纸 */
  @Get('${pathFail168}')
  FailAttrExpiryLedgerRoleAuditOnepagerM168Get(
    @Req() req: any,
    @Query('role') role?: string,
    @Query('filterRole') filterRole?: string,
    @Query('sessionId') sessionId?: string,
    @Query('targetSessionId') targetSessionId?: string,
    @Query('scrubIndex') scrubIndex?: string,
    @Query('seekEntryIndex') seekEntryIndex?: string,
  ) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${fail168}(tenantId, {
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      role: role || 'broker', filterRole: filterRole || role || 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M168失败归因关帧',
      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m168-fail-attr', targetSessionId: targetSessionId || 'session-peer-m168-fail-attr',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0, dryRun: true,
    });
  }

  @Post('${pathFail168}')
  FailAttrExpiryLedgerRoleAuditOnepagerM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${fail168}(tenantId, body || {});
  }

  /** M168：A/B 失败归因回跳多选短片scrubber */
  @Get('${pathAb168}')
  AbFailAttrSeekMultiselectClipScrubberM168Get(
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
    return this.imports.${ab168}(tenantId, {
      seq: seq != null ? Number(seq) : 1, role: role || 'broker', filterRole: filterRole || role || 'broker', matchId: 'demo-match-m168',
      adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M168 A/B失败归因回跳多选短片',
      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
      bookmarkNameZh: '演示·M168 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
      sessionId: sessionId || 'session-demo-m168-summary', targetSessionId: targetSessionId || 'session-peer-m168-summary',
      shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
      softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
      roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
      seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: seekEntryIndex != null ? Number(seekEntryIndex) : 0,
      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
      clipFrameScrubber: true, scrubber: true, scrubIndex: scrubIndex != null ? Number(scrubIndex) : 0, exportClipFrames: true, clipFrames: true,
      keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
    });
  }

  @Post('${pathAb168}')
  AbFailAttrSeekMultiselectClipScrubberM168Post(@Req() req: any, @Body() body: Record<string, any> = {}) {
    const tenantId = req?.user?.tenantId || req?.tenantId || 'default';
    return this.imports.${ab168}(tenantId, body || {});
  }

`;
  const idx = ic.lastIndexOf('\n}\n');
  ic = ic.slice(0, idx) + routes + ic.slice(idx);
  fs.writeFileSync(icPath, ic);
  console.log('added imports.controller routes');
} else {
  console.log('imports.controller already M168');
}

const adminPath = path.join(root, 'apps/api/src/admin/admin.controller.ts');
let a = fs.readFileSync(adminPath, 'utf8');
a = a.replace(
  /maturityWave: 'M167-[^']+'/,
  `maturityWave: '${WAVE}'`,
);
if (!a.includes('matchConfirmClipKfBmShareRevokeSeekSoftCancelMsClipAuditKfExpiryM168')) {
  a = a.replace(
    'conflictUiFailAttrKfXsessionExpiryAbRoleAuditSeekMultiselectM167: true,',
    `conflictUiFailAttrKfXsessionExpiryAbRoleAuditSeekMultiselectM167: true,
      matchConfirmClipKfBmShareRevokeSeekSoftCancelMsClipAuditKfExpiryM168: true,
      conflictUiFailAttrExpiryRoleAuditAbSeekMsClipM168: true,`,
  );
}
fs.writeFileSync(adminPath, a);
console.log('updated admin.controller');

console.log('done controllers');
