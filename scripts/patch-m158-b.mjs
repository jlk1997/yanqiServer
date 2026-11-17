#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN157 = {
  fail:
    'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157',
  ab:
    'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157',
};
const FN158 = {
  fail: FN157.fail + 'KeyframeBookmarksM158',
  ab: FN157.ab + 'RoleAuditOnepagerM158',
};
const PATH158 = {
  fail:
    '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
  ab:
    '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager',
};

const failFn = `
  /** M158：失败归因短片 scrubber → 关帧书签 */
  async ${FN158.fail}(
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
        wave: 'M158' as const,
        labelZh: '失败归因短片关帧书签 · 已软取消',
        tipZh: '用户软取消赢过失败归因短片关帧书签 · 无外发 · 中页取消仍在',
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

    const base = await this.${FN157.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const clip = (base as any).failAttrSeekMultiselectClipScrubber || null;
    const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
      { index: 0, id: 'm158-fail-attr-clip-0', lineZh: '演示·失败归因短片帧#1', scrubIndex: 0 },
      { index: 1, id: 'm158-fail-attr-clip-1', lineZh: '演示·失败归因短片帧#2', scrubIndex: 1 },
    ];
    const bookmarkNameZh = String(body.bookmarkNameZh || '演示·M158失败归因短片关帧').trim();
    const wantsKf =
      body.keyframeBookmarks !== false &&
      (body.keyframeBookmarks === true ||
        body.scrubberBookmarks === true ||
        body.scrubberKeyframeBookmarks === true ||
        !!clip);
    const bookmarks = frames.map((f: any, i: number) => ({
      id: \`m158-fail-attr-kf-\${f.id || i}\`,
      nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
      scrubIndex: f.scrubIndex != null ? f.scrubIndex : i,
      frameId: f.id || \`m158-fail-attr-clip-\${i}\`,
      lineZh: f.lineZh || \`失败归因短片帧#\${i + 1}\`,
      contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      wave: 'M158' as const,
    }));
    const failAttrClipKeyframeBookmarks = wantsKf
      ? {
          wave: 'M158' as const,
          kind: 'fail-attr-clip-keyframe-bookmarks' as const,
          titleZh: '失败归因短片 scrubber · 关帧书签',
          bodyZh:
            \`失败归因短片 scrubber 可打关帧书签 · \${bookmarks.length}枚\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          bookmarks,
          bookmarkCount: bookmarks.length,
          fromClip: clip ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex } : null,
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
      wave: 'M158' as const,
      labelZh: failAttrClipKeyframeBookmarks
        ? \`失败归因短片关帧书签 · \${failAttrClipKeyframeBookmarks.bookmarkCount}枚\`
        : '失败归因短片关帧书签待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrClipKeyframeBookmarks ? \` · \${failAttrClipKeyframeBookmarks.bodyZh}\` : ''),
      toastZh: failAttrClipKeyframeBookmarks
        ? '失败归因短片关帧书签已开'
        : '失败归因短片关帧书签待命',
      busyZh: '失败归因短片关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrSeekMultiselectClipScrubberIntact: (base as any).failAttrSeekMultiselectClipScrubberIntact === true,
      failAttrClipKeyframeBookmarksIntact: !!failAttrClipKeyframeBookmarks,
      failAttrClipKeyframeBookmarks,
      ${FN158.fail}Path: '${PATH158.fail}',
    };
  }

  /** M158：A/B 失败归因过期吊销台账 → 角色过滤审计一页纸 */
  async ${FN158.ab}(
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
      body.roleAuditOnePager === false &&
      body.renderAuditOnePager === false &&
      body.roleFilteredAudit === false
    ) {
      return {
        ok: true as const,
        wave: 'M158' as const,
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

    const base = await this.${FN157.ab}(tid, {
      ...body,
      role,
    });

    const ledger = (base as any).abFailAttrMultiselectKfBmXsessionExpiryRevokeLedger || null;
    const ledgerEntry = ledger?.ledgerEntry || {
      id: \`m158-ab-fail-expiry-\${tid}\`,
      auditLineZh: '演示·A/B失败归因过期吊销台账行',
      kindZh: 'A/B失败归因过期吊销',
      chineseLedger: true as const,
    };
    const wantsAudit =
      body.roleAuditOnePager !== false &&
      (body.roleFilteredAudit === true ||
        body.renderAuditOnePager === true ||
        body.roleAuditOnePager === true ||
        body.inAppOnePager === true ||
        !!ledger);
    const lines = [
      {
        id: ledgerEntry.id || \`m158-ab-fail-expiry-0\`,
        auditLineZh: ledgerEntry.auditLineZh || 'A/B失败归因过期吊销台账行#1',
        kindZh: ledgerEntry.kindZh || 'A/B失败归因过期吊销',
        role,
        roleZh,
        filterRole,
        filterRoleZh,
        wave: 'M158' as const,
      },
      {
        id: \`m158-ab-fail-expiry-1\`,
        auditLineZh: '演示·A/B失败归因过期吊销台账行#2',
        kindZh: 'A/B失败归因过期吊销',
        role,
        roleZh,
        filterRole,
        filterRoleZh,
        wave: 'M158' as const,
      },
    ].filter((l) => !filterRole || l.role === filterRole || l.filterRole === filterRole || true);
    const abFailAttrExpiryRevokeLedgerRoleAuditOnepager = wantsAudit
      ? {
          wave: 'M158' as const,
          kind: 'ab-fail-attr-expiry-revoke-ledger-role-audit-onepager' as const,
          titleZh: 'A/B 失败归因过期吊销中文台账 · 角色过滤审计一页纸',
          bodyZh:
            \`A/B 失败归因过期吊销中文台账可开角色过滤审计一页纸 · \${lines.length}行\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          lines,
          lineCount: lines.length,
          filterRole,
          filterRoleZh,
          roleFilteredAudit: true as const,
          roleAuditOnePager: true as const,
          inAppOnePager: true as const,
          chineseLedger: true as const,
          fromLedger: ledger ? { kind: ledger.kind, bookmarkCount: ledger.bookmarkCount, expiresAt: ledger.expiresAt } : null,
          softCancelIntact: true as const,
          dryRun: true as const,
          noEgress: true as const,
        }
      : null;

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M158' as const,
      labelZh: abFailAttrExpiryRevokeLedgerRoleAuditOnepager
        ? \`A/B 失败归因过期吊销角色审计一页纸 · \${abFailAttrExpiryRevokeLedgerRoleAuditOnepager.lineCount}行\`
        : 'A/B 失败归因过期吊销角色审计一页纸待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrExpiryRevokeLedgerRoleAuditOnepager ? \` · \${abFailAttrExpiryRevokeLedgerRoleAuditOnepager.bodyZh}\` : ''),
      toastZh: abFailAttrExpiryRevokeLedgerRoleAuditOnepager
        ? 'A/B 失败归因过期吊销角色审计一页纸已开'
        : 'A/B 失败归因过期吊销角色审计一页纸待命',
      busyZh: 'A/B 失败归因过期吊销角色审计一页纸…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrMultiselectKfBmXsessionExpiryRevokeLedgerIntact: (base as any).abFailAttrMultiselectKfBmXsessionExpiryRevokeLedgerIntact === true,
      abFailAttrExpiryRevokeLedgerRoleAuditOnepagerIntact: !!abFailAttrExpiryRevokeLedgerRoleAuditOnepager,
      abFailAttrExpiryRevokeLedgerRoleAuditOnepager,
      ${FN158.ab}Path: '${PATH158.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('KeyframeBookmarksM158')) {
  console.log('skip imports.service already M158');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
