#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN169 = {
  fail: "resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168SeekLedgerM169",
  ab: "rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168KeyframeBookmarksM169",
};
const FN170 = {
  fail: FN169.fail + 'MultiselectContrastM170',
  ab: FN169.ab + 'XsessionRoShareM170',
};
const PATH170 = {
  fail: "/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168/seek-ledger/m169/multi-select-contrast/m170",
  ab: "/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169/xsession-ro-share/m170",
};

const failFn = `
  /** M170：失败归因回跳中文台账 → 多选中文对照 */
  async ${FN170.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      multiSelectContrast?: boolean;
      multiSelectLedgerRows?: boolean;
      seekEntryIndexes?: number[] | null;
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
      body.multiSelectContrast === false &&
      body.multiSelectLedgerRows === false
    ) {
      return {
        ok: true as const,
        wave: 'M170' as const,
        labelZh: '失败归因回跳多选对照 · 已软取消',
        tipZh: '用户软取消赢过失败归因回跳多选中文对照 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因回跳多选对照…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN169.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const seek = (base as any).failAttrRoleAuditSeekLedger || null;
    const lines: any[] = Array.isArray(seek?.lines)
      ? seek.lines
      : [
          { id: seek?.highlighted?.id || seek?.ledgerRowId || 'm170-fail-attr-seek-0', auditLineZh: seek?.highlighted?.auditLineZh || seek?.lineZh || '演示·失败归因回跳行#1', contrastSide: 'A' },
          { id: 'm170-fail-attr-seek-1', auditLineZh: '演示·失败归因回跳行#2', contrastSide: 'B' },
        ];
    const indexes = Array.isArray(body.seekEntryIndexes) && body.seekEntryIndexes.length
      ? body.seekEntryIndexes.map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
      : [0, Math.min(1, Math.max(lines.length - 1, 0))];
    const uniqueIdx = [...new Set(indexes)];
    const wantsMs =
      body.multiSelectContrast !== false &&
      (body.multiSelectContrast === true ||
        body.multiSelectLedgerRows === true ||
        !!seek);
    const selectedRows = uniqueIdx.map((i, ord) => {
      const row = lines[i] || lines[0] || {};
      return {
        index: i,
        id: row.id || \`m170-fail-attr-seek-\${i}\`,
        lineZh: row.auditLineZh || row.kindZh || \`失败归因回跳行#\${i + 1}\`,
        contrastSide: row.contrastSide || (ord % 2 === 0 ? 'A' : 'B'),
        role,
        roleZh,
        wave: 'M170' as const,
      };
    });
    const failAttrSeekMultiselectContrast = wantsMs
      ? {
          wave: 'M170' as const,
          kind: 'fail-attr-seek-multiselect-contrast' as const,
          titleZh: '失败归因回跳中文台账 · 多选中文对照',
          bodyZh:
            \`失败归因回跳中文台账支持多选中文对照 · \${selectedRows.length}行\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          selectedRows,
          selectedCount: selectedRows.length,
          seekEntryIndexes: uniqueIdx,
          fromSeek: seek ? { kind: seek.kind, lineCount: seek.lineCount, seekEntryIndex: seek.seekEntryIndex } : null,
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
      wave: 'M170' as const,
      labelZh: failAttrSeekMultiselectContrast
        ? \`失败归因回跳多选对照 · \${failAttrSeekMultiselectContrast.selectedCount}行\`
        : '失败归因回跳多选对照待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrSeekMultiselectContrast ? \` · \${failAttrSeekMultiselectContrast.bodyZh}\` : ''),
      toastZh: failAttrSeekMultiselectContrast
        ? '失败归因回跳多选对照已开'
        : '失败归因回跳多选对照待命',
      busyZh: '失败归因回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrRoleAuditSeekLedgerIntact: (base as any).failAttrRoleAuditSeekLedgerIntact === true,
      failAttrSeekMultiselectContrastIntact: !!failAttrSeekMultiselectContrast,
      failAttrSeekMultiselectContrast,
      ${FN170.fail}Path: '${PATH170.fail}',
    };
  }

  /** M170：A/B 失败归因多选关帧书签 → 跨会话只读分享 */
  async ${FN170.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      crossSessionShare?: boolean;
      readOnlyShare?: boolean;
      crossSessionShareBookmarks?: boolean;
      shareFfReplayBookmarks?: boolean;
      sessionId?: string | null;
      targetSessionId?: string | null;
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
        wave: 'M170' as const,
        labelZh: 'A/B 失败归因多选关帧跨会话只读分享 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因多选关帧跨会话只读分享 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因多选关帧跨会话只读分享…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN169.ab}(tid, {
      ...body,
      role,
    });

    const kf = (base as any).abFailAttrMultiselectClipKeyframeBookmarks || null;
    const bookmarks: any[] = Array.isArray(kf?.bookmarks) ? kf.bookmarks : [
      { id: 'm170-ab-fail-kf-0', nameZh: '演示·M170 A/B失败归因多选关帧#1', scrubIndex: 0 },
      { id: 'm170-ab-fail-kf-1', nameZh: '演示·M170 A/B失败归因多选关帧#2', scrubIndex: 1 },
    ];
    const sessionId = String(body.sessionId || 'session-demo-m170-ab').trim();
    const targetSessionId = String(body.targetSessionId || 'session-peer-m170-ab').trim();
    const wantsXshare =
      body.crossSessionShare !== false &&
      (body.crossSessionShare === true ||
        body.crossSessionShareBookmarks === true ||
        body.readOnlyShare === true ||
        body.shareFfReplayBookmarks === true ||
        !!kf);
    const shareToken = \`ro-m170-ab-\${tid}-\${sessionId}-\${targetSessionId}-\${bookmarks.length}\`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const abFailAttrMultiselectKfBmXsessionRoShare = wantsXshare
      ? {
          wave: 'M170' as const,
          kind: 'ab-fail-attr-multiselect-kf-bm-xsession-ro-share' as const,
          titleZh: 'A/B 失败归因多选关帧书签 · 跨会话只读分享',
          bodyZh:
            \`A/B 失败归因多选关帧书签支持跨会话只读分享 · \${bookmarks.length}枚\` +
            \` · 自「\${sessionId}」→「\${targetSessionId}」· 令牌「\${shareToken}」\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          bookmarks,
          bookmarkCount: bookmarks.length,
          sessionId,
          targetSessionId,
          shareToken,
          readOnlyShare: true as const,
          crossSessionShare: true as const,
          crossSessionShareBookmarks: true as const,
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
      wave: 'M170' as const,
      labelZh: abFailAttrMultiselectKfBmXsessionRoShare
        ? \`A/B 失败归因多选关帧跨会话只读分享 · \${abFailAttrMultiselectKfBmXsessionRoShare.bookmarkCount}枚\`
        : 'A/B 失败归因多选关帧跨会话只读分享待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrMultiselectKfBmXsessionRoShare ? \` · \${abFailAttrMultiselectKfBmXsessionRoShare.bodyZh}\` : ''),
      toastZh: abFailAttrMultiselectKfBmXsessionRoShare
        ? 'A/B 失败归因多选关帧跨会话只读分享已开'
        : 'A/B 失败归因多选关帧跨会话只读分享待命',
      busyZh: 'A/B 失败归因多选关帧跨会话只读分享…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrMultiselectClipKeyframeBookmarksIntact: (base as any).abFailAttrMultiselectClipKeyframeBookmarksIntact === true,
      abFailAttrMultiselectKfBmXsessionRoShareIntact: !!abFailAttrMultiselectKfBmXsessionRoShare,
      abFailAttrMultiselectKfBmXsessionRoShare,
      ${FN170.ab}Path: '${PATH170.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('MultiselectContrastM170')) {
  console.log('skip imports.service already M170');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
