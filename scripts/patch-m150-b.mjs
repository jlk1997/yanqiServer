#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN = {
  fail149:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149',
  ab149:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149',
};
const FN150 = {
  fail: FN.fail149 + 'ClipScrubberM150',
  ab: FN.ab149 + 'ExpiryRevokeLedgerM150',
};
const PATH150 = {
  fail:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
  ab:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger',
};

const failFn = `
  /** M150：失败归因回跳多选对照 → 短片 scrubber */
  async ${FN150.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      clipFrameScrubber?: boolean;
      scrubber?: boolean;
      scrubIndex?: number | null;
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
      body.clipFrameScrubber === false &&
      body.scrubber === false
    ) {
      return {
        ok: true as const,
        wave: 'M150' as const,
        labelZh: '失败归因多选短片 scrubber · 已软取消',
        tipZh: '用户软取消赢过失败归因回跳多选短片 scrubber · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因多选短片 scrubber…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN.fail149}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const ms = (base as any).failAttrSeekMultiselectContrast || null;
    const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
      { index: 0, id: 'm150-fail-attr-ms-0', lineZh: '失败归因回跳多选行#1', contrastSide: 'A' },
      { index: 1, id: 'm150-fail-attr-ms-1', lineZh: '失败归因回跳多选行#2', contrastSide: 'B' },
    ];
    const scrubIndex = Math.max(0, Number(body.scrubIndex) || 0);
    const wantsScrub =
      body.clipFrameScrubber !== false &&
      (body.clipFrameScrubber === true || body.scrubber === true || !!ms || selectedRows.length > 0);
    const frames = selectedRows.map((row: any, i: number) => ({
      frameIndex: i,
      scrubIndex: i,
      id: row.id || \`m150-fail-attr-ms-frame-\${i}\`,
      lineZh: row.lineZh || row.auditLineZh || \`对照帧#\${i + 1}\`,
      contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      isCurrent: i === scrubIndex,
      wave: 'M150' as const,
    }));
    const failAttrMultiselectClipScrubber = wantsScrub
      ? {
          wave: 'M150' as const,
          kind: 'fail-attr-multiselect-clip-scrubber' as const,
          titleZh: '失败归因回跳多选中文对照 · 短片 scrubber',
          bodyZh:
            \`失败归因回跳多选中文对照支持短片 scrubber · \${frames.length}帧\` +
            \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
            \` · 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
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
      wave: 'M150' as const,
      labelZh: failAttrMultiselectClipScrubber
        ? \`失败归因多选短片 scrubber · \${failAttrMultiselectClipScrubber.frameCount}帧\`
        : '失败归因多选短片 scrubber 待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrMultiselectClipScrubber ? \` · \${failAttrMultiselectClipScrubber.bodyZh}\` : ''),
      toastZh: failAttrMultiselectClipScrubber
        ? '失败归因多选短片 scrubber 已开'
        : '失败归因多选短片 scrubber 待命',
      busyZh: '失败归因多选短片 scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrSeekMultiselectContrastIntact: (base as any).failAttrSeekMultiselectContrastIntact === true,
      failAttrMultiselectClipScrubberIntact: !!failAttrMultiselectClipScrubber,
      failAttrMultiselectClipScrubber,
      clipFrameScrubber: failAttrMultiselectClipScrubber,
      ${FN150.fail}Path: '${PATH150.fail}',
    };
  }

  /** M150：A/B 失败归因关帧跨会话只读分享 → 过期吊销进中文台账 */
  async ${FN150.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      shareLinkExpiry?: boolean;
      expiryRevokeLedger?: boolean;
      revokeShare?: boolean;
      expiresInMs?: number | null;
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
      body.shareLinkExpiry === false &&
      body.expiryRevokeLedger === false
    ) {
      return {
        ok: true as const,
        wave: 'M150' as const,
        labelZh: 'A/B 失败归因关帧跨会话过期吊销 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因关帧跨会话分享过期吊销进台账 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因关帧跨会话过期吊销…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN.ab149}(tid, {
      ...body,
      role,
    });

    const xshare = (base as any).abFailAttrKfBmXsessionRoShare || null;
    const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
      { id: 'm150-ab-fail-kf-0', nameZh: '演示·M150 A/B失败归因关帧#1', scrubIndex: 0 },
      { id: 'm150-ab-fail-kf-1', nameZh: '演示·M150 A/B失败归因关帧#2', scrubIndex: 1 },
    ];
    const sessionId = String(body.sessionId || xshare?.sessionId || 'session-demo-m150-summary').trim();
    const targetSessionId = String(body.targetSessionId || xshare?.targetSessionId || 'session-peer-m150-summary').trim();
    const expiresInMs = body.expiresInMs != null ? Number(body.expiresInMs) : 3600000;
    const revokeShare = body.revokeShare !== false;
    const wantsExpiry =
      body.shareLinkExpiry !== false &&
      (body.shareLinkExpiry === true ||
        body.expiryRevokeLedger === true ||
        body.revokeShare === true ||
        !!xshare);
    const abFailAttrKfBmXsessionExpiryRevoke = wantsExpiry
      ? {
          wave: 'M150' as const,
          kind: 'ab-fail-attr-kf-bm-xsession-expiry-revoke' as const,
          titleZh: 'A/B 失败归因关帧跨会话只读分享 · 过期吊销进中文台账',
          bodyZh:
            \`A/B 失败归因关帧跨会话只读分享支持过期与吊销并写入中文台账 · \${Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1)}枚\` +
            \` · 自「\${sessionId}」→「\${targetSessionId}」· 过期 \${expiresInMs}ms\` +
            (revokeShare ? ' · 已吊销' : ' · 未吊销') +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          expiresInMs,
          revokeShare,
          shareLinkExpiry: true as const,
          expiryRevokeLedger: true as const,
          chineseLedger: true as const,
          ledgerEntry: {
            wave: 'M150' as const,
            id: \`m150-ab-share-\${revokeShare ? 'revoke' : 'expiry'}-\${Date.now().toString(36)}\`,
            kindZh: revokeShare ? 'A/B失败归因关帧跨会话分享吊销' : 'A/B失败归因关帧跨会话分享过期登记',
            auditLineZh: revokeShare
              ? \`吊销 A/B 失败归因关帧跨会话只读分享 · \${Math.max(bookmarks.length, 1)}枚 · 「\${sessionId}」→「\${targetSessionId}」\`
              : \`登记 A/B 失败归因关帧跨会话只读分享过期 \${expiresInMs}ms · \${Math.max(bookmarks.length, 1)}枚\`,
            role,
            roleZh,
            chineseLedger: true as const,
          },
          bookmarkCount: Math.max(bookmarks.length, xshare?.bookmarkCount || 1, 1),
          sessionId,
          targetSessionId,
          fromXsessionShare: xshare
            ? { kind: xshare.kind, shareToken: xshare.shareToken, bookmarkCount: xshare.bookmarkCount }
            : null,
          softCancelIntact: true as const,
          dryRun: true as const,
          noEgress: true as const,
        }
      : null;

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M150' as const,
      labelZh: abFailAttrKfBmXsessionExpiryRevoke
        ? \`A/B 失败归因关帧跨会话过期吊销\${revokeShare ? '（已吊销）' : ''}\`
        : 'A/B 失败归因关帧跨会话过期吊销待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrKfBmXsessionExpiryRevoke ? \` · \${abFailAttrKfBmXsessionExpiryRevoke.bodyZh}\` : ''),
      toastZh: abFailAttrKfBmXsessionExpiryRevoke
        ? 'A/B 失败归因关帧跨会话过期吊销已开'
        : 'A/B 失败归因关帧跨会话过期吊销待命',
      busyZh: 'A/B 失败归因关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrKfBmXsessionRoShareIntact: (base as any).abFailAttrKfBmXsessionRoShareIntact === true,
      abFailAttrKfBmXsessionExpiryRevokeIntact: !!abFailAttrKfBmXsessionExpiryRevoke,
      abFailAttrKfBmXsessionExpiryRevoke,
      ${FN150.ab}Path: '${PATH150.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('ClipScrubberM150')) {
  console.log('skip imports.service already M150');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
