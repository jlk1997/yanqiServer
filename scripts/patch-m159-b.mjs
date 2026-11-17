#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN158 = {
  fail:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158',
  ab:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158',
};
const FN159 = {
  fail: FN158.fail + 'XsessionRoShareM159',
  ab: FN158.ab + 'SeekLedgerM159',
};
const PATH159 = {
  fail:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share',
  ab:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger',
};

const failFn = `
  /** M159：失败归因短片关帧书签 → 跨会话只读分享 */
  async ${FN159.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      crossSessionShare?: boolean;
      readOnlyShare?: boolean;
      sessionId?: string | null;
      targetSessionId?: string | null;
      dryRun?: boolean;
      [k: string]: any;
    } = {},
  ) {
    const tid = this.safeTenantIdForPrefs(tenantId);
    const ROLE_ZH: Record<string, string> = {
      admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
    };
    const role = String(body.role || body.myRole || 'broker').trim().toLowerCase() || 'broker';
    const roleZh = ROLE_ZH[role] || role;
    const filterRole = String(body.filterRole || role).trim().toLowerCase() || role;
    const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

    if (
      body.softCancel === true &&
      body.crossSessionShare === false &&
      body.readOnlyShare === false
    ) {
      return {
        ok: true as const,
        wave: 'M159' as const,
        labelZh: '失败归因关帧跨会话只读分享 · 已软取消',
        tipZh: '用户软取消赢过失败归因关帧跨会话只读分享 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因关帧跨会话只读分享…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN158.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const kf = (base as any).failAttrClipKeyframeBookmarks || null;
    const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
      { id: 'm159-fail-attr-kf-0', nameZh: '演示·M159失败归因关帧#1', scrubIndex: 0 },
      { id: 'm159-fail-attr-kf-1', nameZh: '演示·M159失败归因关帧#2', scrubIndex: 1 },
    ];
    const sessionId = String(body.sessionId || 'session-demo-m159-fail-attr').trim();
    const targetSessionId = String(body.targetSessionId || 'session-peer-m159-fail-attr').trim();
    const wantsXshare =
      body.crossSessionShare !== false &&
      (body.crossSessionShare === true || body.readOnlyShare === true || !!kf);
    const shareToken = \`ro-m159-fail-attr-\${sessionId}-\${targetSessionId}-\${bookmarks.length}\`.slice(0, 96);
    const failAttrKfBmXsessionRoShare = wantsXshare
      ? {
          wave: 'M159' as const,
          kind: 'fail-attr-kf-bm-xsession-ro-share' as const,
          titleZh: '失败归因短片关帧书签 · 跨会话只读分享',
          bodyZh:
            \`失败归因短片关帧书签支持跨会话只读分享 · \${bookmarks.length}枚\` +
            \` · 自「\${sessionId}」→「\${targetSessionId}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
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
      wave: 'M159' as const,
      labelZh: failAttrKfBmXsessionRoShare
        ? \`失败归因关帧跨会话只读分享 · \${failAttrKfBmXsessionRoShare.bookmarkCount}枚\`
        : '失败归因关帧跨会话只读分享待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrKfBmXsessionRoShare ? \` · \${failAttrKfBmXsessionRoShare.bodyZh}\` : ''),
      toastZh: failAttrKfBmXsessionRoShare
        ? '失败归因关帧跨会话只读分享已开'
        : '失败归因关帧跨会话只读分享待命',
      busyZh: '失败归因关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrClipKeyframeBookmarksIntact: (base as any).failAttrClipKeyframeBookmarksIntact === true,
      failAttrKfBmXsessionRoShareIntact: !!failAttrKfBmXsessionRoShare,
      failAttrKfBmXsessionRoShare,
      ${FN159.fail}Path: '${PATH159.fail}',
    };
  }

  /** M159：A/B 失败归因角色审计一页纸 → 回跳中文台账 */
  async ${FN159.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      seekLedgerRow?: boolean;
      seekBackToLedger?: boolean;
      highlightLedgerRow?: boolean;
      seekEntryIndex?: number | null;
      [k: string]: any;
    } = {},
  ) {
    const tid = this.safeTenantIdForPrefs(tenantId);
    const ROLE_ZH: Record<string, string> = {
      admin: '运营', park: '园区', enterprise: '企业', uni: '高校/科研', broker: '经纪人',
    };
    const role = String(body.role || body.myRole || 'broker').trim().toLowerCase() || 'broker';
    const roleZh = ROLE_ZH[role] || role;
    const filterRole = String(body.filterRole || role).trim().toLowerCase() || role;
    const filterRoleZh = ROLE_ZH[filterRole] || filterRole;

    if (
      body.softCancel === true &&
      body.seekLedgerRow === false &&
      body.seekBackToLedger === false
    ) {
      return {
        ok: true as const,
        wave: 'M159' as const,
        labelZh: 'A/B 失败归因角色审计回跳台账 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因角色审计回跳台账 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因角色审计回跳台账…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN158.ab}(tid, {
      ...body,
      role,
    });

    const audit = (base as any).abFailAttrExpiryRevokeLedgerRoleAuditOnepager || null;
    const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
      { id: 'm159-ab-audit-seek-0', auditLineZh: '演示·A/B失败归因角色审计台账行#1', kindZh: 'A/B失败归因过期吊销角色审计' },
      { id: 'm159-ab-audit-seek-1', auditLineZh: '演示·A/B失败归因角色审计台账行#2', kindZh: 'A/B失败归因过期吊销角色审计' },
    ];
    const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(body.seekEntryIndex) || 0));
    const wantsSeek =
      body.seekLedgerRow !== false &&
      (body.seekLedgerRow === true ||
        body.seekBackToLedger === true ||
        body.highlightLedgerRow === true ||
        !!audit);
    const hit = lines[seekEntryIndex] || lines[0] || {};
    const abFailAttrRoleAuditSeekLedger = wantsSeek
      ? {
          wave: 'M159' as const,
          kind: 'ab-fail-attr-role-audit-seek-ledger' as const,
          titleZh: 'A/B 失败归因角色过滤审计一页纸 · 回跳中文台账',
          bodyZh:
            \`A/B 失败归因角色过滤审计可回跳中文台账 · 行#\${seekEntryIndex + 1}/\${lines.length}\` +
            \` · 「\${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          seekEntryIndex,
          ledgerRowId: hit.id || \`m159-ab-audit-seek-\${seekEntryIndex}\`,
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
      wave: 'M159' as const,
      labelZh: abFailAttrRoleAuditSeekLedger
        ? \`A/B 失败归因角色审计回跳台账 · 行#\${(abFailAttrRoleAuditSeekLedger.seekEntryIndex || 0) + 1}\`
        : 'A/B 失败归因角色审计回跳台账待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrRoleAuditSeekLedger ? \` · \${abFailAttrRoleAuditSeekLedger.bodyZh}\` : ''),
      toastZh: abFailAttrRoleAuditSeekLedger
        ? 'A/B 失败归因角色审计回跳台账已开'
        : 'A/B 失败归因角色审计回跳台账待命',
      busyZh: 'A/B 失败归因角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrExpiryRevokeLedgerRoleAuditOnepagerIntact: (base as any).abFailAttrExpiryRevokeLedgerRoleAuditOnepagerIntact === true,
      abFailAttrRoleAuditSeekLedgerIntact: !!abFailAttrRoleAuditSeekLedger,
      abFailAttrRoleAuditSeekLedger,
      ${FN159.ab}Path: '${PATH159.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('XsessionRoShareM159')) {
  console.log('skip imports.service already M159');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
