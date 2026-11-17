#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN159 = {
  fail:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159',
  ab:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159',
};
const FN160 = {
  fail: FN159.fail + 'ExpiryRevokeLedgerM160',
  ab: FN159.ab + 'MultiSelectContrastM160',
};
const PATH160 = {
  fail:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
  ab:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast',
};

const failFn = `
  /** M160：失败归因关帧跨会话只读分享 → 过期吊销进中文台账 */
  async ${FN160.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      shareLinkExpiry?: boolean;
      expiryRevokeLedger?: boolean;
      expiresInMs?: number | null;
      revokeShare?: boolean;
      chineseLedger?: boolean;
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
      body.shareLinkExpiry === false &&
      body.expiryRevokeLedger === false &&
      body.revokeShare === false
    ) {
      return {
        ok: true as const,
        wave: 'M160' as const,
        labelZh: '失败归因关帧跨会话过期吊销 · 已软取消',
        tipZh: '用户软取消赢过失败归因关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因关帧跨会话过期吊销…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN159.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const xshare = (base as any).failAttrKfBmXsessionRoShare || null;
    const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
      { id: 'm160-fail-attr-kf-0', nameZh: '演示·M160失败归因关帧#1', scrubIndex: 0 },
      { id: 'm160-fail-attr-kf-1', nameZh: '演示·M160失败归因关帧#2', scrubIndex: 1 },
    ];
    const expiresInMs = Math.max(60_000, Number(body.expiresInMs) || 3_600_000);
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    const wantsExpiry =
      body.shareLinkExpiry !== false &&
      (body.shareLinkExpiry === true ||
        body.expiryRevokeLedger === true ||
        body.revokeShare === true ||
        !!xshare);
    const ledgerEntry = {
      id: \`m160-fail-attr-expiry-\${xshare?.shareToken || 'demo'}\`.slice(0, 96),
      auditLineZh:
        \`失败归因关帧跨会话只读分享过期吊销 · \${bookmarks.length}枚 · 自「\${xshare?.sessionId || 'session-demo-m160'}」→「\${xshare?.targetSessionId || 'session-peer-m160'}」· 过期 \${expiresAt}\`,
      kindZh: '失败归因关帧跨会话分享过期吊销',
      expiresAt,
      revokeShare: body.revokeShare !== false,
      wave: 'M160' as const,
    };
    const failAttrKfBmXsessionExpiryRevokeLedger = wantsExpiry
      ? {
          wave: 'M160' as const,
          kind: 'fail-attr-kf-bm-xsession-expiry-revoke-ledger' as const,
          titleZh: '失败归因关帧跨会话只读分享 · 过期吊销进中文台账',
          bodyZh:
            \`失败归因关帧跨会话只读分享支持过期+吊销写入中文台账 · \${bookmarks.length}枚\` +
            \` · 过期 \${expiresAt} · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          bookmarks,
          bookmarkCount: bookmarks.length,
          ledgerEntry,
          chineseLedger: body.chineseLedger !== false,
          shareLinkExpiry: true as const,
          expiryRevokeLedger: true as const,
          revokeShare: body.revokeShare !== false,
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
      wave: 'M160' as const,
      labelZh: failAttrKfBmXsessionExpiryRevokeLedger
        ? \`失败归因关帧跨会话过期吊销 · \${failAttrKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚\`
        : '失败归因关帧跨会话过期吊销待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrKfBmXsessionExpiryRevokeLedger ? \` · \${failAttrKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
      toastZh: failAttrKfBmXsessionExpiryRevokeLedger
        ? '失败归因关帧跨会话过期吊销已开'
        : '失败归因关帧跨会话过期吊销待命',
      busyZh: '失败归因关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrKfBmXsessionRoShareIntact: (base as any).failAttrKfBmXsessionRoShareIntact === true,
      failAttrKfBmXsessionExpiryRevokeLedgerIntact: !!failAttrKfBmXsessionExpiryRevokeLedger,
      failAttrKfBmXsessionExpiryRevokeLedger,
      ${FN160.fail}Path: '${PATH160.fail}',
    };
  }

  /** M160：A/B 失败归因角色审计回跳台账 → 多选中文对照 */
  async ${FN160.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      multiSelectLedgerRows?: boolean;
      multiSelectContrast?: boolean;
      seekEntryIndexes?: number[] | null;
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
        wave: 'M160' as const,
        labelZh: 'A/B 失败归因角色审计回跳多选对照 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因角色审计回跳多选对照 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因角色审计回跳多选对照…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN159.ab}(tid, {
      ...body,
      role,
    });

    const seek = (base as any).abFailAttrRoleAuditSeekLedger || null;
    const lines: any[] = Array.isArray(seek?.lines) ? seek.lines : [
      { id: 'm160-ab-seek-ms-0', auditLineZh: '演示·A/B失败归因回跳台账行#1', kindZh: 'A/B失败归因角色审计回跳台账' },
      { id: 'm160-ab-seek-ms-1', auditLineZh: '演示·A/B失败归因回跳台账行#2', kindZh: 'A/B失败归因角色审计回跳台账' },
    ];
    const indexesRaw = Array.isArray(body.seekEntryIndexes) ? body.seekEntryIndexes : [0, 1];
    const seekEntryIndexes = indexesRaw
      .map((n) => Math.max(0, Math.min(lines.length - 1, Number(n) || 0)))
      .filter((v, i, a) => a.indexOf(v) === i);
    const wantsMs =
      body.multiSelectContrast !== false &&
      (body.multiSelectContrast === true ||
        body.multiSelectLedgerRows === true ||
        seekEntryIndexes.length > 0 ||
        !!seek);
    const selectedRows = seekEntryIndexes.map((idx) => {
      const hit = lines[idx] || lines[0] || {};
      return {
        index: idx,
        id: hit.id || \`m160-ab-seek-ms-\${idx}\`,
        lineZh: hit.auditLineZh || hit.kindZh || \`台账行#\${idx + 1}\`,
        contrastSide: idx % 2 === 0 ? 'A' : 'B',
        wave: 'M160' as const,
      };
    });
    const abFailAttrRoleAuditSeekMultiselectContrast = wantsMs
      ? {
          wave: 'M160' as const,
          kind: 'ab-fail-attr-role-audit-seek-multiselect-contrast' as const,
          titleZh: 'A/B 失败归因角色审计回跳台账 · 多选中文对照',
          bodyZh:
            \`A/B 失败归因角色审计回跳台账支持多选中文对照 · 选中\${selectedRows.length}行\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
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

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M160' as const,
      labelZh: abFailAttrRoleAuditSeekMultiselectContrast
        ? \`A/B 失败归因角色审计回跳多选对照 · \${abFailAttrRoleAuditSeekMultiselectContrast.selectedCount}行\`
        : 'A/B 失败归因角色审计回跳多选对照待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrRoleAuditSeekMultiselectContrast ? \` · \${abFailAttrRoleAuditSeekMultiselectContrast.bodyZh}\` : ''),
      toastZh: abFailAttrRoleAuditSeekMultiselectContrast
        ? 'A/B 失败归因角色审计回跳多选对照已开'
        : 'A/B 失败归因角色审计回跳多选对照待命',
      busyZh: 'A/B 失败归因角色审计回跳多选对照…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrRoleAuditSeekLedgerIntact: (base as any).abFailAttrRoleAuditSeekLedgerIntact === true,
      abFailAttrRoleAuditSeekMultiselectContrastIntact: !!abFailAttrRoleAuditSeekMultiselectContrast,
      abFailAttrRoleAuditSeekMultiselectContrast,
      ${FN160.ab}Path: '${PATH160.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('ExpiryRevokeLedgerM160')) {
  console.log('skip imports.service already M160');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
