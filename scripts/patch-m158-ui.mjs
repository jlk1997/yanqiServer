#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const pathConfirm158 = '/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158';
const pathSoft158 = '/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager';
const pathAudit158 = '/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber';
const pathFail158 = '/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks';
const pathAb158 = '/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager';

const ops = path.join(root, 'apps/web/public/ops.html');
let o = fs.readFileSync(ops, 'utf8');
if (!o.includes('btnBypassLedgerConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158')) {
  o = o.replace(
    'id="btnBypassLedgerConfirmExpiryLedgerRoleAuditShareRevokeMsClipKfBmM157" class="ghost m157-confirm-expiry-audit-ms-kf">确认卡过期吊销台账角色审计·吊销过期回跳多选短片关帧书签</button>',
    'id="btnBypassLedgerConfirmExpiryLedgerRoleAuditShareRevokeMsClipKfBmM157" class="ghost m157-confirm-expiry-audit-ms-kf m158-confirm-role-audit-seek-xshare">确认卡过期吊销台账角色审计·吊销过期回跳多选短片关帧书签</button>\n          <button type="button" id="btnBypassLedgerConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158" class="ghost m158-confirm-role-audit-seek-xshare">确认卡角色审计回跳台账·吊销关帧跨会话只读分享</button>',
  );
  o = o.replace(
    'id="btnDataChainSoftCancelKfBmXsessionExpiryRevokeLedgerM157" class="ghost m157-soft-cancel-kf-xsession-expiry">软取消关帧跨会话过期吊销</button>',
    'id="btnDataChainSoftCancelKfBmXsessionExpiryRevokeLedgerM157" class="ghost m157-soft-cancel-kf-xsession-expiry m158-soft-cancel-expiry-role-audit">软取消关帧跨会话过期吊销</button>\n          <button type="button" id="btnDataChainSoftCancelExpiryLedgerRoleAuditOnepagerM158" class="ghost m158-soft-cancel-expiry-role-audit">软取消过期台账角色审计一页纸</button>',
  );
  o = o.replace(
    'id="btnBatchRerunAuditSeekMultiselectContrastM157" class="ghost m157-audit-seek-ms">审计回跳多选对照</button>',
    'id="btnBatchRerunAuditSeekMultiselectContrastM157" class="ghost m157-audit-seek-ms m158-audit-seek-ms-clip">审计回跳多选对照</button>\n          <button type="button" id="btnBatchRerunAuditSeekMultiselectClipScrubberM158" class="ghost m158-audit-seek-ms-clip">审计回跳多选短片scrubber</button>',
  );
  o = o.replace(
    'id="btnExceptDraftFailAttrSeekMultiselectClipScrubberM157" class="ghost m157-fail-attr-seek-ms-clip">失败归因回跳多选短片scrubber</button>',
    'id="btnExceptDraftFailAttrSeekMultiselectClipScrubberM157" class="ghost m157-fail-attr-seek-ms-clip m158-fail-attr-clip-kf">失败归因回跳多选短片scrubber</button>\n          <button type="button" id="btnExceptDraftFailAttrClipKeyframeBookmarksM158" class="ghost m158-fail-attr-clip-kf">失败归因短片关帧书签</button>',
  );
  o = o.replace(
    'id="btnUndoSidebarAbFailAttrMultiselectKfBmXsessionExpiryRevokeM157" class="ghost m157-ab-fail-attr-ms-kf-expiry">A/B失败归因多选关帧跨会话过期吊销</button>',
    'id="btnUndoSidebarAbFailAttrMultiselectKfBmXsessionExpiryRevokeM157" class="ghost m157-ab-fail-attr-ms-kf-expiry m158-ab-fail-attr-expiry-role-audit">A/B失败归因多选关帧跨会话过期吊销</button>\n          <button type="button" id="btnUndoSidebarAbFailAttrExpiryRevokeRoleAuditOnepagerM158" class="ghost m158-ab-fail-attr-expiry-role-audit">A/B失败归因过期吊销角色审计一页纸</button>',
  );
  fs.writeFileSync(ops, o);
  console.log('ops.html updated');
} else {
  console.log('ops.html already M158');
}

const css = path.join(root, 'apps/web/public/styles.css');
let c = fs.readFileSync(css, 'utf8');
if (!c.includes('m158-confirm-role-audit-seek-xshare')) {
  c += `
/* M158 */
.m158-confirm-role-audit-seek-xshare,
.m158-soft-cancel-expiry-role-audit,
.m158-audit-seek-ms-clip,
.m158-fail-attr-clip-kf,
.m158-ab-fail-attr-expiry-role-audit { border-color: #0f766e; }
`;
  fs.writeFileSync(css, c);
  console.log('styles.css updated');
}

const app = path.join(root, 'apps/web/public/app.js');
let j = fs.readFileSync(app, 'utf8');
if (!j.includes('btnBypassLedgerConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158')) {
  j += `

document.getElementById('btnBypassLedgerConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158') &&
  (document.getElementById('btnBypassLedgerConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158').onclick = async () => {
    const btn = document.getElementById('btnBypassLedgerConfirmRoleAuditSeekShareRevokeKfBmXsessionRoShareM158');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '确认卡角色审计回跳台账 / 吊销关帧跨会话只读分享…');
      const created = await api('${pathConfirm158}', {
        method: 'POST',
        body: JSON.stringify({
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true, shortClipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
          bookmarkNameZh: '演示·M158吊销关帧', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true,
          crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m158-clip', targetSessionId: 'session-peer-m158-clip',
          chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
          softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
          pinpointAnnotate: true, annotateFields: ['org', 'person'], noteZh: '演示·M158确认卡角色审计回跳',
          pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          role: 'broker', filterRole: 'broker', dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(created.toastZh || '确认卡角色审计回跳台账·吊销关帧跨会话只读分享', 'ok', 2600);
      showDlg((created.labelZh || '确认卡角色审计回跳台账') + '\\n' + (created.tipZh || '') + '\\nseek=' + String(!!created.confirmRoleAuditSeekLedgerIntact) + ' xshare=' + String(!!created.shareRevokeKfBmXsessionRoShareIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '确认卡角色审计回跳台账失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnDataChainSoftCancelExpiryLedgerRoleAuditOnepagerM158') &&
  (document.getElementById('btnDataChainSoftCancelExpiryLedgerRoleAuditOnepagerM158').onclick = async () => {
    const btn = document.getElementById('btnDataChainSoftCancelExpiryLedgerRoleAuditOnepagerM158');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软取消过期台账角色审计一页纸…');
      const folded = await api('${pathSoft158}', {
        method: 'POST',
        body: JSON.stringify({
          role: 'broker', filterRole: 'broker',
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158软取消关帧',
          shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m158-soft-cancel', targetSessionId: 'session-peer-m158-soft-cancel',
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true, dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(folded.toastZh || '软取消过期台账角色审计一页纸', 'ok', 2400);
      showDlg((folded.labelZh || '软取消过期台账角色审计一页纸') + '\\n' + (folded.tipZh || '') + '\\naudit=' + String(!!folded.softCancelExpiryLedgerRoleAuditOnepagerIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '软取消过期台账角色审计一页纸失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnBatchRerunAuditSeekMultiselectClipScrubberM158') &&
  (document.getElementById('btnBatchRerunAuditSeekMultiselectClipScrubberM158').onclick = async () => {
    const btn = document.getElementById('btnBatchRerunAuditSeekMultiselectClipScrubberM158');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '审计回跳多选短片scrubber…');
      const page = await api('${pathAudit158}', {
        method: 'POST',
        body: JSON.stringify({
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158审计回跳',
          crossSessionShare: true, crossSessionShareBookmarks: true, readOnlyShare: true, shareFfReplayBookmarks: true,
          sessionId: 'session-demo-m158-audit-kf', targetSessionId: 'session-peer-m158-audit-kf',
          exportClipFrames: true, clipFrames: true, shortClipFrames: true, inAppClipFrames: true,
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '审计回跳多选短片scrubber', 'ok', 2400);
      showDlg((page.labelZh || '审计回跳多选短片scrubber') + '\\n' + (page.tipZh || '') + '\\nclip=' + String(!!page.auditSeekMultiselectClipScrubberIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '审计回跳多选短片scrubber失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnExceptDraftFailAttrClipKeyframeBookmarksM158') &&
  (document.getElementById('btnExceptDraftFailAttrClipKeyframeBookmarksM158').onclick = async () => {
    const btn = document.getElementById('btnExceptDraftFailAttrClipKeyframeBookmarksM158');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '失败归因短片关帧书签…');
      const page = await api('${pathFail158}', {
        method: 'POST',
        body: JSON.stringify({
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          role: 'broker', filterRole: 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M158失败归因短片关帧',
          shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m158-fail-attr', targetSessionId: 'session-peer-m158-fail-attr',
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '失败归因短片关帧书签', 'ok', 2400);
      showDlg((page.labelZh || '失败归因短片关帧书签') + '\\n' + (page.tipZh || '') + '\\nkf=' + String(!!page.failAttrClipKeyframeBookmarksIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '失败归因短片关帧书签失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnUndoSidebarAbFailAttrExpiryRevokeRoleAuditOnepagerM158') &&
  (document.getElementById('btnUndoSidebarAbFailAttrExpiryRevokeRoleAuditOnepagerM158').onclick = async () => {
    const btn = document.getElementById('btnUndoSidebarAbFailAttrExpiryRevokeRoleAuditOnepagerM158');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 失败归因过期吊销角色审计一页纸…');
      const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
      const seq = Number(abTl?.abTimelineScrubber?.currentSeq || abTl?.abTimelineScrubber?.maxSeq || 1);
      const adopted = await api('${pathAb158}', {
        method: 'POST',
        body: JSON.stringify({
          seq, role: 'broker', filterRole: 'broker', matchId: 'demo-match-m158', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
          softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
          pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M158 A/B失败归因过期吊销',
          chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
          bookmarkNameZh: '演示·M158 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m158-summary', targetSessionId: 'session-peer-m158-summary',
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || 'A/B失败归因过期吊销角色审计一页纸', 'ok', 2400);
      showDlg((adopted.labelZh || 'A/B失败归因过期吊销角色审计一页纸') + '\\n' + (adopted.tipZh || '') + '\\naudit=' + String(!!adopted.abFailAttrExpiryRevokeLedgerRoleAuditOnepagerIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B失败归因过期吊销角色审计一页纸失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });
`;
  fs.writeFileSync(app, j);
  console.log('app.js updated');
} else {
  console.log('app.js already M158');
}

console.log('UI done');
