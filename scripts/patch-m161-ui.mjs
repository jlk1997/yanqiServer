#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const pathConfirm161 = '/metrics/recall-pool-hit-rate/drill/rerun/contrast-board/history/diff/rollback-to-a/contrast-card/supply-detail/re-bypass/annotate/contrast-strip/clip-frames/scrubber/bookmarks/share-link/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger-adopt-oneside/multi-select-contrast-before-after/clip-frames-pinpoint-annotate/scrubber-bookmarks-pinpoint-rebypass/cross-session-readonly-share-fail-fold-attr/share-expiry-revoke-fail-attr-field-filter-replay/role-audit-onepager-ff-replay-scrubber-bookmarks/seek-ledger-ff-replay-bm-xsession-share/multi-select-contrast-xsession-bm-diff-preview-adopt/clip-scrubber-xsession-bm-adopt-soft-undo-ba/kf-bm-xsession-ro-share-soft-undo-ba-pinpoint-rebypass/share-expiry-revoke-ledger-soft-undo-pinpoint-fail-fold-attr/role-audit-onepager-retry-fold-task-card/seek-ledger-phase-pause-grace/multi-select-contrast-grace-soft-cancel-ledger/clip-frame-scrubber-grace-soft-cancel-ledger-role-audit-onepager/clip-frame-scrubber-keyframe-bookmarks-role-audit-onepager-seek-ledger-multiselect/kf-bm-xsession-ro-share-ledger-multiselect-clip-frames/diff-preview-adopt-confirm/ledger-clip-scrubber-kf-bm/confirm-adopt-soft-undo-ba/clip-scrubber-kf-bm-xsession-ro-share/soft-undo-ba-pinpoint-rebypass/clip-kf-bm-xsession-share-expiry-revoke-ledger/pinpoint-rebypass-fail-fold-attr/share-revoke-ledger-role-audit-onepager/fail-attr-one-click-retry-fold-task-card/seek-ledger/phase-pause-grace/multi-select-contrast/soft-cancel-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/xsession-ro-share/multiselect-contrast/expiry-revoke-ledger/clip-scrubber/role-audit-onepager/keyframe-bookmarks/seek-ledger/m140/xsession-ro-share/multiselect-contrast/m141/expiry-revoke-ledger/clip-scrubber/m142/role-audit-onepager/keyframe-bookmarks/m143/seek-ledger/xsession-ro-share/m144/multiselect-contrast/expiry-revoke-ledger/m145/clip-scrubber/role-audit-onepager/m146/keyframe-bookmarks/seek-ledger/m147/xsession-ro-share/multiselect-contrast/m148/expiry-revoke-ledger/clip-scrubber/m149/role-audit-onepager/keyframe-bookmarks/m150/seek-ledger/xsession-ro-share/m151/multiselect-contrast/expiry-revoke-ledger/m152/clip-scrubber/role-audit-onepager/m153/keyframe-bookmarks/seek-ledger/m154/xsession-ro-share/multiselect-contrast/m155/expiry-revoke-ledger/clip-scrubber/m156/role-audit-onepager/keyframe-bookmarks/m157/seek-ledger/xsession-ro-share/m158/multiselect-contrast/expiry-revoke-ledger/m159/clip-scrubber/role-audit-onepager/m160/keyframe-bookmarks/seek-ledger/m161';
const pathSoft161 = '/metrics/ann-bp-hysteresis/write-shard-cooldown/bp-pctile-sparkline/day-drill/suggest-bust-chain/failure-attribution/retry-failed-phase/fold-chain-task-card/phase-reorder/dry-run/skip-completed/why-skipped/force-rerun/fold-task-card/clip-scrubber-replay/keyframe-bookmarks/in-app-clip-chapters/chapter-scrubber-jump/cross-session-bookmarks/by-role/cross-tenant-readonly-inherit/bookmark-subset/diff-preview-confirm/oneside-adopt/before-after-card/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber';
const pathAudit161 = '/metrics/inbox-delta-cache/curve/alerts/shell-health/weekly-sparkline/day-drill/trend-anomaly/chain-bust-reprobe/itemized-contrast/batch-rerun/phase/resume-alarm/auto-resume/grace/role-policy/ab-compare/apply-winner/soft-undo/before-after-grace-contrast/re-apply-restored/soft-undo-back-to-contrast/drill-supply/one-click-rebypass/failure-attribution/one-click-retry/fold-chain-task-card/phase-pause/grace-alarm/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-filtered-audit/in-app-onepager/seek-ledger/multi-select-contrast/clip-frames/scrubber-kf-bm/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/m161';
const pathFail161 = '/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161';
const pathAb161 = '/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber';

const ops = path.join(root, 'apps/web/public/ops.html');
let o = fs.readFileSync(ops, 'utf8');
if (!o.includes('btnBypassLedgerConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM161')) {
  o = o.replace(
    'id="btnBypassLedgerConfirmMsClipShareRevokeExpiryRoleAuditM160" class="ghost m160-confirm-ms-clip-expiry-audit">确认卡多选短片scrubber·吊销过期台账角色审计一页纸</button>',
    'id="btnBypassLedgerConfirmMsClipShareRevokeExpiryRoleAuditM160" class="ghost m160-confirm-ms-clip-expiry-audit m161-confirm-clip-kf-seek">确认卡多选短片scrubber·吊销过期台账角色审计一页纸</button>\n          <button type="button" id="btnBypassLedgerConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM161" class="ghost m161-confirm-clip-kf-seek">确认卡短片关帧书签·吊销过期角色审计回跳台账</button>',
  );
  o = o.replace(
    'id="btnDataChainSoftCancelSeekMultiselectContrastM160" class="ghost m160-soft-cancel-seek-ms">软取消回跳台账多选对照</button>',
    'id="btnDataChainSoftCancelSeekMultiselectContrastM160" class="ghost m160-soft-cancel-seek-ms m161-soft-cancel-ms-clip">软取消回跳台账多选对照</button>\n          <button type="button" id="btnDataChainSoftCancelMultiselectClipScrubberM161" class="ghost m161-soft-cancel-ms-clip">软取消多选短片scrubber</button>',
  );
  o = o.replace(
    'id="btnBatchRerunAuditKfBmXsessionRoShareM160" class="ghost m160-audit-kf-bm-xshare">审计关帧跨会话只读分享</button>',
    'id="btnBatchRerunAuditKfBmXsessionRoShareM160" class="ghost m160-audit-kf-bm-xshare m161-audit-kf-bm-expiry">审计关帧跨会话只读分享</button>\n          <button type="button" id="btnBatchRerunAuditKfBmXsessionExpiryRevokeM161" class="ghost m161-audit-kf-bm-expiry">审计关帧跨会话过期吊销</button>',
  );
  o = o.replace(
    'id="btnExceptDraftFailAttrKfBmXsessionExpiryRevokeM160" class="ghost m160-fail-attr-kf-bm-expiry">失败归因关帧跨会话过期吊销</button>',
    'id="btnExceptDraftFailAttrKfBmXsessionExpiryRevokeM160" class="ghost m160-fail-attr-kf-bm-expiry m161-fail-attr-expiry-audit">失败归因关帧跨会话过期吊销</button>\n          <button type="button" id="btnExceptDraftFailAttrExpiryLedgerRoleAuditOnepagerM161" class="ghost m161-fail-attr-expiry-audit">失败归因过期台账角色审计一页纸</button>',
  );
  o = o.replace(
    'id="btnUndoSidebarAbFailAttrRoleAuditSeekMultiselectContrastM160" class="ghost m160-ab-fail-attr-role-audit-seek-ms">A/B失败归因角色审计回跳多选对照</button>',
    'id="btnUndoSidebarAbFailAttrRoleAuditSeekMultiselectContrastM160" class="ghost m160-ab-fail-attr-role-audit-seek-ms m161-ab-fail-attr-role-audit-seek-ms-clip">A/B失败归因角色审计回跳多选对照</button>\n          <button type="button" id="btnUndoSidebarAbFailAttrRoleAuditSeekMultiselectClipScrubberM161" class="ghost m161-ab-fail-attr-role-audit-seek-ms-clip">A/B失败归因角色审计回跳多选短片scrubber</button>',
  );
  fs.writeFileSync(ops, o);
  console.log('ops.html updated');
} else {
  console.log('ops.html already M161');
}

const css = path.join(root, 'apps/web/public/styles.css');
let c = fs.readFileSync(css, 'utf8');
if (!c.includes('m161-confirm-clip-kf-seek')) {
  c += `
/* M161 */
.m161-confirm-clip-kf-seek,
.m161-soft-cancel-ms-clip,
.m161-audit-kf-bm-expiry,
.m161-fail-attr-expiry-audit,
.m161-ab-fail-attr-role-audit-seek-ms-clip { border-color: #0f766e; }
`;
  fs.writeFileSync(css, c);
  console.log('styles.css updated');
}

const app = path.join(root, 'apps/web/public/app.js');
let j = fs.readFileSync(app, 'utf8');
if (!j.includes('btnBypassLedgerConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM161')) {
  j += `

document.getElementById('btnBypassLedgerConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM161') &&
  (document.getElementById('btnBypassLedgerConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM161').onclick = async () => {
    const btn = document.getElementById('btnBypassLedgerConfirmClipKfBmShareRevokeExpiryRoleAuditSeekM161');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '确认卡短片关帧书签 / 吊销过期角色审计回跳台账…');
      const created = await api('${pathConfirm161}', {
        method: 'POST',
        body: JSON.stringify({
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true, shortClipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
          bookmarkNameZh: '演示·M161确认卡短片关帧', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true,
          crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m161-clip', targetSessionId: 'session-peer-m161-clip',
          chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
          softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
          pinpointAnnotate: true, annotateFields: ['org', 'person'], noteZh: '演示·M161确认卡短片关帧',
          pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          role: 'broker', filterRole: 'broker', dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(created.toastZh || '确认卡短片关帧书签·吊销过期角色审计回跳台账', 'ok', 2600);
      showDlg((created.labelZh || '确认卡短片关帧书签') + '\\n' + (created.tipZh || '') + '\\nkf=' + String(!!created.confirmClipKfBmIntact) + ' seek=' + String(!!created.shareRevokeExpiryRoleAuditSeekLedgerIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '确认卡短片关帧书签失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnDataChainSoftCancelMultiselectClipScrubberM161') &&
  (document.getElementById('btnDataChainSoftCancelMultiselectClipScrubberM161').onclick = async () => {
    const btn = document.getElementById('btnDataChainSoftCancelMultiselectClipScrubberM161');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软取消多选短片scrubber…');
      const folded = await api('${pathSoft161}', {
        method: 'POST',
        body: JSON.stringify({
          role: 'broker', filterRole: 'broker',
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M161软取消多选短片',
          shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m161-soft-cancel', targetSessionId: 'session-peer-m161-soft-cancel',
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true, dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(folded.toastZh || '软取消多选短片scrubber', 'ok', 2400);
      showDlg((folded.labelZh || '软取消多选短片scrubber') + '\\n' + (folded.tipZh || '') + '\\nclip=' + String(!!folded.softCancelMultiselectClipScrubberIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '软取消多选短片scrubber失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnBatchRerunAuditKfBmXsessionExpiryRevokeM161') &&
  (document.getElementById('btnBatchRerunAuditKfBmXsessionExpiryRevokeM161').onclick = async () => {
    const btn = document.getElementById('btnBatchRerunAuditKfBmXsessionExpiryRevokeM161');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '审计关帧跨会话过期吊销…');
      const page = await api('${pathAudit161}', {
        method: 'POST',
        body: JSON.stringify({
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M161审计关帧',
          crossSessionShare: true, crossSessionShareBookmarks: true, readOnlyShare: true, shareFfReplayBookmarks: true,
          sessionId: 'session-demo-m161-audit-kf', targetSessionId: 'session-peer-m161-audit-kf',
          exportClipFrames: true, clipFrames: true, shortClipFrames: true, inAppClipFrames: true,
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '审计关帧跨会话过期吊销', 'ok', 2400);
      showDlg((page.labelZh || '审计关帧跨会话过期吊销') + '\\n' + (page.tipZh || '') + '\\nexpiry=' + String(!!page.auditKfBmXsessionExpiryRevokeLedgerIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '审计关帧跨会话过期吊销失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnExceptDraftFailAttrExpiryLedgerRoleAuditOnepagerM161') &&
  (document.getElementById('btnExceptDraftFailAttrExpiryLedgerRoleAuditOnepagerM161').onclick = async () => {
    const btn = document.getElementById('btnExceptDraftFailAttrExpiryLedgerRoleAuditOnepagerM161');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '失败归因过期台账角色审计一页纸…');
      const page = await api('${pathFail161}', {
        method: 'POST',
        body: JSON.stringify({
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          role: 'broker', filterRole: 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true, bookmarkNameZh: '演示·M161失败归因关帧',
          shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m161-fail-attr', targetSessionId: 'session-peer-m161-fail-attr',
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '失败归因过期台账角色审计一页纸', 'ok', 2400);
      showDlg((page.labelZh || '失败归因过期台账角色审计一页纸') + '\\n' + (page.tipZh || '') + '\\naudit=' + String(!!page.failAttrExpiryLedgerRoleAuditOnepagerIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '失败归因过期台账角色审计一页纸失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });

document.getElementById('btnUndoSidebarAbFailAttrRoleAuditSeekMultiselectClipScrubberM161') &&
  (document.getElementById('btnUndoSidebarAbFailAttrRoleAuditSeekMultiselectClipScrubberM161').onclick = async () => {
    const btn = document.getElementById('btnUndoSidebarAbFailAttrRoleAuditSeekMultiselectClipScrubberM161');
    if (btn) btn.disabled = true;
    try {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 失败归因角色审计回跳多选短片scrubber…');
      const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
      const seq = Number(abTl?.abTimelineScrubber?.currentSeq || abTl?.abTimelineScrubber?.maxSeq || 1);
      const adopted = await api('${pathAb161}', {
        method: 'POST',
        body: JSON.stringify({
          seq, role: 'broker', filterRole: 'broker', matchId: 'demo-match-m161', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
          softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
          pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M161 A/B失败归因角色审计回跳多选短片',
          chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
          bookmarkNameZh: '演示·M161 A/B失败归因关帧', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
          sessionId: 'session-demo-m161-summary', targetSessionId: 'session-peer-m161-summary',
          shareLinkExpiry: true, expiryRevokeLedger: true, expiresInMs: 3600000, revokeShare: true,
          softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true,
          roleFilteredAudit: true, renderAuditOnePager: true, roleAuditOnePager: true, inAppOnePager: true,
          seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0,
          multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
          clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true,
          keyframeBookmarks: true, scrubberBookmarks: true, scrubberKeyframeBookmarks: true,
        }),
      });
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || 'A/B失败归因角色审计回跳多选短片scrubber', 'ok', 2400);
      showDlg((adopted.labelZh || 'A/B失败归因角色审计回跳多选短片scrubber') + '\\n' + (adopted.tipZh || '') + '\\nclip=' + String(!!adopted.abFailAttrRoleAuditSeekMultiselectClipScrubberIntact));
    } catch (e) {
      if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B失败归因角色审计回跳多选短片scrubber失败', 'err');
    } finally {
      if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
      if (btn) btn.disabled = false;
    }
  });
`;
  fs.writeFileSync(app, j);
  console.log('app.js updated');
} else {
  console.log('app.js already M161');
}

console.log('UI done');
