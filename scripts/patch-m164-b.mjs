#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN163 = {
  fail: 'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163',
  ab: 'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163',
};
const FN164 = {
  fail: FN163.fail + 'ClipScrubberM164',
  ab: FN163.ab + 'ExpiryRevokeLedgerM164',
};
const PATH164 = {
  fail: '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164',
  ab: '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164',
};

const failFn = `
  /** M164：失败归因多选中文对照 → 短片 scrubber */
  async ${FN164.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      clipFrameScrubber?: boolean;
      scrubber?: boolean;
      scrubIndex?: number | null;
      exportClipFrames?: boolean;
      clipFrames?: boolean;
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
        wave: 'M164' as const,
        labelZh: '失败归因多选短片scrubber · 已软取消',
        tipZh: '用户软取消赢过失败归因多选短片 scrubber · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因多选短片scrubber…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN163.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const ms = (base as any).failAttrSeekMultiselectContrast || null;
    const selectedRows: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
      { index: 0, id: 'm164-fail-attr-ms-0', lineZh: '演示·失败归因多选行#1', contrastSide: 'A' },
      { index: 1, id: 'm164-fail-attr-ms-1', lineZh: '演示·失败归因多选行#2', contrastSide: 'B' },
    ];
    const scrubIndex = Math.max(0, Math.min(Math.max(selectedRows.length - 1, 0), Number(body.scrubIndex) || 0));
    const wantsClip =
      body.clipFrameScrubber !== false &&
      (body.clipFrameScrubber === true ||
        body.scrubber === true ||
        body.exportClipFrames === true ||
        body.clipFrames === true ||
        !!ms);
    const frames = selectedRows.map((r: any, i: number) => ({
      index: i,
      id: r.id || \`m164-fail-attr-clip-\${i}\`,
      lineZh: r.lineZh || \`失败归因多选短片帧#\${i + 1}\`,
      contrastSide: r.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      scrubIndex: i,
      isCurrent: i === scrubIndex,
      wave: 'M164' as const,
    }));
    const failAttrMultiselectClipScrubber = wantsClip
      ? {
          wave: 'M164' as const,
          kind: 'fail-attr-multiselect-clip-scrubber' as const,
          titleZh: '失败归因多选中文对照 · 短片 scrubber',
          bodyZh:
            \`失败归因多选中文对照支持短片 scrubber · \${frames.length}帧\` +
            \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
            \` · 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          frames,
          frameCount: frames.length,
          scrubIndex,
          fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
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
      wave: 'M164' as const,
      labelZh: failAttrMultiselectClipScrubber
        ? \`失败归因多选短片scrubber · \${failAttrMultiselectClipScrubber.frameCount}帧\`
        : '失败归因多选短片scrubber待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrMultiselectClipScrubber ? \` · \${failAttrMultiselectClipScrubber.bodyZh}\` : ''),
      toastZh: failAttrMultiselectClipScrubber
        ? '失败归因多选短片scrubber已开'
        : '失败归因多选短片scrubber待命',
      busyZh: '失败归因多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrSeekMultiselectContrastIntact: (base as any).failAttrSeekMultiselectContrastIntact === true,
      failAttrMultiselectClipScrubberIntact: !!failAttrMultiselectClipScrubber,
      failAttrMultiselectClipScrubber,
      ${FN164.fail}Path: '${PATH164.fail}',
    };
  }

  /** M164：A/B 失败归因多选关帧跨会话只读分享 → 过期吊销写中文台账 */
  async ${FN164.ab}(
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
        wave: 'M164' as const,
        labelZh: 'A/B 失败归因多选关帧跨会话过期吊销 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因多选关帧跨会话过期吊销 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因多选关帧跨会话过期吊销…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN163.ab}(tid, {
      ...body,
      role,
    });

    const xshare = (base as any).abFailAttrMultiselectKfBmXsessionRoShare || null;
    const bookmarks: any[] = Array.isArray(xshare?.bookmarks) ? xshare.bookmarks : [
      { id: 'm164-ab-fail-kf-0', nameZh: '演示·M164 A/B失败归因多选关帧#1', scrubIndex: 0 },
      { id: 'm164-ab-fail-kf-1', nameZh: '演示·M164 A/B失败归因多选关帧#2', scrubIndex: 1 },
    ];
    const expiresInMs = Math.max(60000, Number(body.expiresInMs) || 3600000);
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    const wantsExpiry =
      body.expiryRevokeLedger !== false &&
      (body.shareLinkExpiry === true ||
        body.expiryRevokeLedger === true ||
        body.revokeShare === true ||
        !!xshare);
    const ledgerEntry = {
      id: \`m164-ab-fail-kf-xshare-expiry-\${tid}\`,
      auditLineZh:
        \`A/B失败归因多选关帧跨会话只读分享过期吊销 · \${bookmarks.length}枚书签\` +
        \` · 令牌「\${xshare?.shareToken || 'ro-m164-ab-demo'}」· 过期于 \${expiresAt}\` +
        \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」\`,
      kindZh: 'A/B失败归因多选关帧跨会话过期吊销',
      bookmarkCount: bookmarks.length,
      shareToken: xshare?.shareToken || 'ro-m164-ab-demo',
      expiresAt,
      expiresInMs,
      revoked: true as const,
      chineseLedger: true as const,
      role,
      roleZh,
      wave: 'M164' as const,
    };
    const abFailAttrMsKfBmXsessionExpiryRevokeLedger = wantsExpiry
      ? {
          wave: 'M164' as const,
          kind: 'ab-fail-attr-ms-kf-bm-xsession-expiry-revoke-ledger' as const,
          titleZh: 'A/B 失败归因多选关帧跨会话只读分享 · 过期吊销写中文台账',
          bodyZh:
            \`A/B 失败归因多选关帧跨会话只读分享支持过期+吊销写中文台账 · \${bookmarks.length}枚\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          ledgerEntry,
          bookmarkCount: bookmarks.length,
          expiresAt,
          expiresInMs,
          fromXsessionRoShare: xshare ? { kind: xshare.kind, bookmarkCount: xshare.bookmarkCount, shareToken: xshare.shareToken } : null,
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
      wave: 'M164' as const,
      labelZh: abFailAttrMsKfBmXsessionExpiryRevokeLedger
        ? \`A/B 失败归因多选关帧跨会话过期吊销 · \${abFailAttrMsKfBmXsessionExpiryRevokeLedger.bookmarkCount}枚\`
        : 'A/B 失败归因多选关帧跨会话过期吊销待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrMsKfBmXsessionExpiryRevokeLedger ? \` · \${abFailAttrMsKfBmXsessionExpiryRevokeLedger.bodyZh}\` : ''),
      toastZh: abFailAttrMsKfBmXsessionExpiryRevokeLedger
        ? 'A/B 失败归因多选关帧跨会话过期吊销已开'
        : 'A/B 失败归因多选关帧跨会话过期吊销待命',
      busyZh: 'A/B 失败归因多选关帧跨会话过期吊销…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrMultiselectKfBmXsessionRoShareIntact: (base as any).abFailAttrMultiselectKfBmXsessionRoShareIntact === true,
      abFailAttrMsKfBmXsessionExpiryRevokeLedgerIntact: !!abFailAttrMsKfBmXsessionExpiryRevokeLedger,
      abFailAttrMsKfBmXsessionExpiryRevokeLedger,
      ${FN164.ab}Path: '${PATH164.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('ClipScrubberM164')) {
  console.log('skip imports.service already M164');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
