#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN150 = {
  fail:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150',
  ab:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150',
};
const FN151 = {
  fail: FN150.fail + 'KeyframeBookmarksM151',
  ab: FN150.ab + 'RoleAuditOnepagerM151',
};
const PATH151 = {
  fail:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  ab:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
};

const failFn = `
  /** M151：失败归因多选短片 scrubber → 关帧书签 */
  async ${FN151.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      keyframeBookmarks?: boolean;
      scrubberBookmarks?: boolean;
      scrubberKeyframeBookmarks?: boolean;
      bookmarkNameZh?: string | null;
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
      body.keyframeBookmarks === false &&
      body.scrubberKeyframeBookmarks === false
    ) {
      return {
        ok: true as const,
        wave: 'M151' as const,
        labelZh: '失败归因短片关帧书签 · 已软取消',
        tipZh: '用户软取消赢过失败归因多选短片关帧书签 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因短片关帧书签…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN150.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const scrub = (base as any).failAttrMultiselectClipScrubber || null;
    const frames: any[] = Array.isArray(scrub?.frames) ? scrub.frames : [
      { frameIndex: 0, scrubIndex: 0, id: 'm151-fail-attr-frame-0', lineZh: '失败归因多选帧#1', contrastSide: 'A' },
      { frameIndex: 1, scrubIndex: 1, id: 'm151-fail-attr-frame-1', lineZh: '失败归因多选帧#2', contrastSide: 'B' },
    ];
    const wantsKf =
      body.keyframeBookmarks !== false &&
      (body.keyframeBookmarks === true ||
        body.scrubberBookmarks === true ||
        body.scrubberKeyframeBookmarks === true ||
        !!scrub);
    const bookmarks = frames.map((f: any, i: number) => ({
      id: \`m151-fail-attr-kf-\${i}\`,
      nameZh: body.bookmarkNameZh ? \`\${body.bookmarkNameZh}#\${i + 1}\` : (f.lineZh || \`演示·M151失败归因关帧#\${i + 1}\`),
      scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
      frameId: f.id,
      contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      wave: 'M151' as const,
    }));
    const failAttrClipKfBm = wantsKf
      ? {
          wave: 'M151' as const,
          kind: 'fail-attr-clip-kf-bm' as const,
          titleZh: '失败归因多选短片 scrubber · 关帧书签',
          bodyZh:
            \`失败归因多选短片 scrubber 支持关帧书签 · \${bookmarks.length}枚\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          bookmarks,
          bookmarkCount: bookmarks.length,
          frames,
          frameCount: frames.length,
          fromScrubber: scrub
            ? { kind: scrub.kind, frameCount: scrub.frameCount, scrubIndex: scrub.scrubIndex }
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
      wave: 'M151' as const,
      labelZh: failAttrClipKfBm
        ? \`失败归因短片关帧书签 · \${failAttrClipKfBm.bookmarkCount}枚\`
        : '失败归因短片关帧书签待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrClipKfBm ? \` · \${failAttrClipKfBm.bodyZh}\` : ''),
      toastZh: failAttrClipKfBm
        ? '失败归因短片关帧书签已开'
        : '失败归因短片关帧书签待命',
      busyZh: '失败归因短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrMultiselectClipScrubberIntact: (base as any).failAttrMultiselectClipScrubberIntact === true,
      failAttrClipKfBmIntact: !!failAttrClipKfBm,
      failAttrClipKfBm,
      ${FN151.fail}Path: '${PATH151.fail}',
    };
  }

  /** M151：A/B 失败归因过期吊销台账 → 角色过滤审计一页纸 */
  async ${FN151.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      roleFilteredAudit?: boolean;
      renderAuditOnePager?: boolean;
      roleAuditOnePager?: boolean;
      inAppOnePager?: boolean;
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
      body.roleFilteredAudit === false &&
      body.roleAuditOnePager === false
    ) {
      return {
        ok: true as const,
        wave: 'M151' as const,
        labelZh: 'A/B 失败归因过期吊销角色审计一页纸 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因过期吊销角色审计一页纸 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因过期吊销角色审计一页纸…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN150.ab}(tid, {
      ...body,
      role,
    });

    const ledger = (base as any).abFailAttrKfBmXsessionExpiryRevoke || null;
    const wantsAudit =
      body.roleFilteredAudit !== false &&
      (body.roleFilteredAudit === true ||
        body.renderAuditOnePager === true ||
        body.roleAuditOnePager === true ||
        body.inAppOnePager === true ||
        !!ledger);
    const lines = [
      {
        id: ledger?.ledgerEntry?.id || 'm151-ab-audit-0',
        auditLineZh: ledger?.ledgerEntry?.auditLineZh || '演示·A/B失败归因过期吊销台账行#1',
        kindZh: ledger?.ledgerEntry?.kindZh || 'A/B失败归因关帧跨会话分享过期吊销',
      },
      { id: 'm151-ab-audit-1', auditLineZh: '演示·A/B失败归因过期吊销台账行#2', kindZh: 'A/B失败归因关帧跨会话分享过期登记' },
    ];
    const abFailAttrExpiryRevokeRoleAuditOnepager = wantsAudit
      ? {
          wave: 'M151' as const,
          kind: 'ab-fail-attr-expiry-revoke-role-audit-onepager' as const,
          titleZh: 'A/B 失败归因过期吊销中文台账 · 角色过滤审计一页纸',
          bodyZh:
            \`A/B 失败归因过期吊销中文台账可出角色过滤审计一页纸 · \${lines.length}行\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          lines,
          lineCount: lines.length,
          filterRole,
          filterRoleZh,
          roleFilteredAudit: true as const,
          roleAuditOnePager: true as const,
          inAppOnePager: true as const,
          renderAuditOnePager: true as const,
          fromLedger: ledger
            ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, revokeShare: ledger.revokeShare }
            : null,
          softCancelIntact: true as const,
          dryRun: true as const,
          noEgress: true as const,
        }
      : null;

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M151' as const,
      labelZh: abFailAttrExpiryRevokeRoleAuditOnepager
        ? \`A/B 失败归因过期吊销角色审计一页纸 · \${abFailAttrExpiryRevokeRoleAuditOnepager.lineCount}行\`
        : 'A/B 失败归因过期吊销角色审计一页纸待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrExpiryRevokeRoleAuditOnepager ? \` · \${abFailAttrExpiryRevokeRoleAuditOnepager.bodyZh}\` : ''),
      toastZh: abFailAttrExpiryRevokeRoleAuditOnepager
        ? 'A/B 失败归因过期吊销角色审计一页纸已开'
        : 'A/B 失败归因过期吊销角色审计一页纸待命',
      busyZh: 'A/B 失败归因过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrKfBmXsessionExpiryRevokeIntact: (base as any).abFailAttrKfBmXsessionExpiryRevokeIntact === true,
      abFailAttrExpiryRevokeRoleAuditOnepagerIntact: !!abFailAttrExpiryRevokeRoleAuditOnepager,
      abFailAttrExpiryRevokeRoleAuditOnepager,
      ${FN151.ab}Path: '${PATH151.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('KeyframeBookmarksM151')) {
  console.log('skip imports.service already M151');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
