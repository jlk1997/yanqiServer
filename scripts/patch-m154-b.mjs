#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN153 = {
  fail:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153',
  ab:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153',
};
const FN154 = {
  fail: FN153.fail + 'RoleAuditOnepagerM154',
  ab: FN153.ab + 'ClipScrubberM154',
};
const PATH154 = {
  fail:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
  ab:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber',
};

const failFn = `
  /** M154：失败归因过期吊销中文台账 → 角色过滤审计一页纸 */
  async ${FN154.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      roleFilteredAudit?: boolean;
      renderAuditOnePager?: boolean;
      roleAuditOnePager?: boolean;
      inAppOnePager?: boolean;
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
      body.roleFilteredAudit === false &&
      body.roleAuditOnePager === false &&
      body.renderAuditOnePager === false
    ) {
      return {
        ok: true as const,
        wave: 'M154' as const,
        labelZh: '失败归因过期台账角色审计一页纸 · 已软取消',
        tipZh: '用户软取消赢过失败归因过期台账角色审计一页纸 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因过期台账角色审计一页纸…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN153.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const expiry = (base as any).failAttrKfBmXsessionExpiryRevokeLedger || null;
    const ledgerEntry = expiry?.ledgerEntry || {
      id: 'm154-fail-attr-expiry-demo',
      auditLineZh: '演示·失败归因关帧跨会话过期吊销台账行',
      kindZh: '失败归因关帧跨会话分享过期吊销',
      role,
      roleZh,
    };
    const wantsAudit =
      body.roleFilteredAudit !== false &&
      (body.roleFilteredAudit === true ||
        body.renderAuditOnePager === true ||
        body.roleAuditOnePager === true ||
        body.inAppOnePager === true ||
        !!expiry);
    const lines = [
      {
        id: ledgerEntry.id || 'm154-fail-attr-audit-0',
        auditLineZh: ledgerEntry.auditLineZh || '失败归因过期吊销台账行#1',
        kindZh: ledgerEntry.kindZh || '失败归因关帧跨会话分享过期吊销',
        role: ledgerEntry.role || role,
        roleZh: ROLE_ZH[String(ledgerEntry.role || role).toLowerCase()] || roleZh,
        filterRole,
        filterRoleZh,
        wave: 'M154' as const,
      },
      {
        id: 'm154-fail-attr-audit-1',
        auditLineZh: '演示·失败归因过期吊销台账角色审计行#2',
        kindZh: '失败归因关帧跨会话分享过期吊销',
        role,
        roleZh,
        filterRole,
        filterRoleZh,
        wave: 'M154' as const,
      },
    ];
    const failAttrExpiryLedgerRoleAuditOnepager = wantsAudit
      ? {
          wave: 'M154' as const,
          kind: 'fail-attr-expiry-ledger-role-audit-onepager' as const,
          titleZh: '失败归因过期吊销中文台账 · 角色过滤审计一页纸',
          bodyZh:
            \`失败归因过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          lines,
          lineCount: lines.length,
          ledgerEntry,
          roleFilteredAudit: true as const,
          renderAuditOnePager: true as const,
          roleAuditOnePager: true as const,
          inAppOnePager: true as const,
          chineseOnePager: true as const,
          fromExpiry: expiry
            ? { kind: expiry.kind, bookmarkCount: expiry.bookmarkCount, expiresAt: expiry.expiresAt }
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
      wave: 'M154' as const,
      labelZh: failAttrExpiryLedgerRoleAuditOnepager
        ? \`失败归因过期台账角色审计一页纸 · \${failAttrExpiryLedgerRoleAuditOnepager.lineCount}行\`
        : '失败归因过期台账角色审计一页纸待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrExpiryLedgerRoleAuditOnepager ? \` · \${failAttrExpiryLedgerRoleAuditOnepager.bodyZh}\` : ''),
      toastZh: failAttrExpiryLedgerRoleAuditOnepager
        ? '失败归因过期台账角色审计一页纸已开'
        : '失败归因过期台账角色审计一页纸待命',
      busyZh: '失败归因过期台账角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrKfBmXsessionExpiryRevokeLedgerIntact: (base as any).failAttrKfBmXsessionExpiryRevokeLedgerIntact === true,
      failAttrExpiryLedgerRoleAuditOnepagerIntact: !!failAttrExpiryLedgerRoleAuditOnepager,
      failAttrExpiryLedgerRoleAuditOnepager,
      ${FN154.fail}Path: '${PATH154.fail}',
    };
  }

  /** M154：A/B 失败归因角色审计回跳多选对照 → 短片 scrubber */
  async ${FN154.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      clipFrameScrubber?: boolean;
      scrubber?: boolean;
      scrubIndex?: number | null;
      exportClipFrames?: boolean;
      clipFrames?: boolean;
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
        wave: 'M154' as const,
        labelZh: 'A/B 失败归因角色审计回跳多选短片scrubber · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因角色审计回跳多选短片 scrubber · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因角色审计回跳多选短片scrubber…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN153.ab}(tid, {
      ...body,
      role,
    });

    const ms = (base as any).abFailAttrRoleAuditSeekMultiselectContrast || null;
    const selected: any[] = Array.isArray(ms?.selectedRows) ? ms.selectedRows : [
      { index: 0, id: 'm154-ab-ms-0', lineZh: 'A/B失败归因角色审计回跳多选行#1', contrastSide: 'A' },
      { index: 1, id: 'm154-ab-ms-1', lineZh: 'A/B失败归因角色审计回跳多选行#2', contrastSide: 'B' },
    ];
    const scrubIndex = Math.max(0, Math.min(Math.max(selected.length - 1, 0), Number(body.scrubIndex) || 0));
    const wantsScrub =
      body.clipFrameScrubber !== false &&
      (body.clipFrameScrubber === true ||
        body.scrubber === true ||
        body.exportClipFrames === true ||
        body.clipFrames === true ||
        !!ms);
    const frames = selected.map((row: any, i: number) => ({
      index: i,
      scrubIndex: i,
      id: row.id || \`m154-ab-ms-\${i}\`,
      lineZh: row.lineZh || \`对照行#\${i + 1}\`,
      contrastSide: row.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      role: row.role || role,
      roleZh: ROLE_ZH[String(row.role || role).toLowerCase()] || roleZh,
      isCurrent: i === scrubIndex,
      wave: 'M154' as const,
    }));
    const abFailAttrRoleAuditSeekMultiselectClipScrubber = wantsScrub
      ? {
          wave: 'M154' as const,
          kind: 'ab-fail-attr-role-audit-seek-multiselect-clip-scrubber' as const,
          titleZh: 'A/B 失败归因角色审计回跳多选中文对照 · 短片 scrubber',
          bodyZh:
            \`A/B 失败归因角色审计回跳多选中文对照支持短片 scrubber · \${frames.length}帧\` +
            \` · 当前 scrub #\${scrubIndex + 1} · 过滤「\${filterRoleZh}」\` +
            \` · 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          frames,
          frameCount: frames.length,
          scrubIndex,
          currentFrame: frames[scrubIndex] || frames[0] || null,
          filterRole,
          filterRoleZh,
          fromMultiselect: ms ? { kind: ms.kind, selectedCount: ms.selectedCount } : null,
          softCancelIntact: true as const,
          dryRun: true as const,
          noEgress: true as const,
        }
      : null;

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M154' as const,
      labelZh: abFailAttrRoleAuditSeekMultiselectClipScrubber
        ? \`A/B 失败归因角色审计回跳多选短片scrubber · \${abFailAttrRoleAuditSeekMultiselectClipScrubber.frameCount}帧\`
        : 'A/B 失败归因角色审计回跳多选短片scrubber待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrRoleAuditSeekMultiselectClipScrubber ? \` · \${abFailAttrRoleAuditSeekMultiselectClipScrubber.bodyZh}\` : ''),
      toastZh: abFailAttrRoleAuditSeekMultiselectClipScrubber
        ? 'A/B 失败归因角色审计回跳多选短片scrubber已开'
        : 'A/B 失败归因角色审计回跳多选短片scrubber待命',
      busyZh: 'A/B 失败归因角色审计回跳多选短片scrubber…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrRoleAuditSeekMultiselectContrastIntact: (base as any).abFailAttrRoleAuditSeekMultiselectContrastIntact === true,
      abFailAttrRoleAuditSeekMultiselectClipScrubberIntact: !!abFailAttrRoleAuditSeekMultiselectClipScrubber,
      abFailAttrRoleAuditSeekMultiselectClipScrubber,
      ${FN154.ab}Path: '${PATH154.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('RoleAuditOnepagerM154')) {
  console.log('skip imports.service already M154');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
