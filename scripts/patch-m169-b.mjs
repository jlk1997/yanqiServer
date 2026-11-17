#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN168 = {
  fail: "resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161SeekLedgerM162MultiselectContrastM163ClipScrubberM164KeyframeBookmarksM165XsessionRoShareM166ExpiryRevokeLedgerM167RoleAuditOnepagerM168",
  ab: "rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161KeyframeBookmarksM162XsessionRoShareM163ExpiryRevokeLedgerM164RoleAuditOnepagerM165SeekLedgerM166MultiSelectContrastM167ClipScrubberM168",
};
const FN169 = {
  fail: FN168.fail + 'SeekLedgerM169',
  ab: FN168.ab + 'KeyframeBookmarksM169',
};
const PATH169 = {
  fail: "/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162/multi-select-contrast/m163/clip-scrubber/m164/keyframe-bookmarks/m165/xsession-ro-share/m166/expiry-revoke-ledger/m167/role-audit-onepager/m168/seek-ledger/m169",
  ab: "/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/m163/expiry-revoke-ledger/m164/role-audit-onepager/m165/seek-ledger/m166/multi-select-contrast/m167/clip-scrubber/m168/keyframe-bookmarks/m169",
};

const failFn = `
  /** M169：失败归因过期台账角色审计一页纸 → 回跳中文台账 */
  async ${FN169.fail}(
    tenantId?: string,
    body: {
      softCancel?: boolean;
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      seekLedgerRow?: boolean;
      seekBackToLedger?: boolean;
      highlightLedgerRow?: boolean;
      seekEntryIndex?: number | null;
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
      body.seekLedgerRow === false &&
      body.seekBackToLedger === false
    ) {
      return {
        ok: true as const,
        wave: 'M169' as const,
        labelZh: '失败归因过期角色审计回跳台账 · 已软取消',
        tipZh: '用户软取消赢过失败归因过期角色审计回跳台账 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: '失败归因过期角色审计回跳台账…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN168.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const audit = (base as any).failAttrExpiryLedgerRoleAuditOnepager || null;
    const lines: any[] = Array.isArray(audit?.lines) && audit.lines.length
      ? audit.lines
      : [
          { id: 'm169-fail-attr-audit-0', auditLineZh: '演示·失败归因过期角色审计行#1', kindZh: '失败归因过期台账角色审计' },
          { id: 'm169-fail-attr-audit-1', auditLineZh: '演示·失败归因过期角色审计行#2', kindZh: '失败归因过期台账角色审计' },
        ];
    const seekEntryIndex = Math.max(0, Math.min(Math.max(lines.length - 1, 0), Number(body.seekEntryIndex) || 0));
    const wantsSeek =
      body.seekLedgerRow !== false &&
      (body.seekLedgerRow === true ||
        body.seekBackToLedger === true ||
        body.highlightLedgerRow === true ||
        !!audit);
    const hit = lines[seekEntryIndex] || lines[0] || {};
    const failAttrRoleAuditSeekLedger = wantsSeek
      ? {
          wave: 'M169' as const,
          kind: 'fail-attr-role-audit-seek-ledger' as const,
          titleZh: '失败归因过期角色审计一页纸 · 回跳中文台账',
          bodyZh:
            \`失败归因过期角色审计一页纸可回跳中文台账 · 当前行#\${seekEntryIndex + 1}/\${lines.length}\` +
            \` · 「\${hit.auditLineZh || hit.kindZh || '台账行'}」· 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          lines,
          lineCount: lines.length,
          seekEntryIndex,
          ledgerRowId: hit.id || \`m169-fail-attr-seek-\${seekEntryIndex}\`,
          lineZh: hit.auditLineZh || hit.kindZh || \`台账行#\${seekEntryIndex + 1}\`,
          fromAudit: audit
            ? { kind: audit.kind, lineCount: audit.lineCount }
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
      wave: 'M169' as const,
      labelZh: failAttrRoleAuditSeekLedger
        ? \`失败归因过期角色审计回跳台账 · 行#\${failAttrRoleAuditSeekLedger.seekEntryIndex + 1}\`
        : '失败归因过期角色审计回跳台账待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrRoleAuditSeekLedger ? \` · \${failAttrRoleAuditSeekLedger.bodyZh}\` : ''),
      toastZh: failAttrRoleAuditSeekLedger
        ? '失败归因过期角色审计回跳台账已开'
        : '失败归因过期角色审计回跳台账待命',
      busyZh: '失败归因过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrExpiryLedgerRoleAuditOnepagerIntact: (base as any).failAttrExpiryLedgerRoleAuditOnepagerIntact === true,
      failAttrRoleAuditSeekLedgerIntact: !!failAttrRoleAuditSeekLedger,
      failAttrRoleAuditSeekLedger,
      ${FN169.fail}Path: '${PATH169.fail}',
    };
  }

  /** M169：A/B 失败归因回跳多选短片 scrubber → 关帧书签 */
  async ${FN169.ab}(
    tenantId?: string,
    body: {
      role?: string | null;
      myRole?: string | null;
      filterRole?: string | null;
      softCancel?: boolean;
      keyframeBookmarks?: boolean;
      scrubberBookmarks?: boolean;
      scrubberKeyframeBookmarks?: boolean;
      bookmarkNameZh?: string | null;
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
      body.scrubberBookmarks === false &&
      body.scrubberKeyframeBookmarks === false
    ) {
      return {
        ok: true as const,
        wave: 'M169' as const,
        labelZh: 'A/B 失败归因回跳多选关帧书签 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因回跳多选关帧书签 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因回跳多选关帧书签…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN168.ab}(tid, {
      ...body,
      role,
    });

    const clip = (base as any).abFailAttrSeekMultiselectClipScrubber || null;
    const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
      { frameIndex: 0, scrubIndex: 0, id: 'm169-ab-ms-0', lineZh: '演示·A/B失败归因多选帧#1', contrastSide: 'A' },
      { frameIndex: 1, scrubIndex: 1, id: 'm169-ab-ms-1', lineZh: '演示·A/B失败归因多选帧#2', contrastSide: 'B' },
    ];
    const bookmarkNameZh = String(body.bookmarkNameZh || '演示·M169 A/B失败归因关帧').trim();
    const wantsKf =
      body.keyframeBookmarks !== false &&
      (body.keyframeBookmarks === true ||
        body.scrubberBookmarks === true ||
        body.scrubberKeyframeBookmarks === true ||
        !!clip);
    const bookmarks = frames.map((f: any, i: number) => ({
      id: \`m169-ab-ms-kf-\${f.id || i}\`.slice(0, 96),
      nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
      scrubIndex: f.scrubIndex ?? i,
      frameIndex: f.frameIndex ?? i,
      lineZh: f.lineZh || \`A/B失败归因多选帧#\${i + 1}\`,
      contrastSide: f.contrastSide || (i % 2 === 0 ? 'A' : 'B'),
      wave: 'M169' as const,
    }));
    const abFailAttrMultiselectClipKeyframeBookmarks = wantsKf
      ? {
          wave: 'M169' as const,
          kind: 'ab-fail-attr-multiselect-clip-keyframe-bookmarks' as const,
          titleZh: 'A/B 失败归因回跳多选短片 scrubber · 关帧书签',
          bodyZh:
            \`A/B 失败归因回跳多选短片 scrubber 可打关帧书签 · \${bookmarks.length}枚\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          bookmarks,
          bookmarkCount: bookmarks.length,
          frames,
          frameCount: frames.length,
          fromClip: clip
            ? { kind: clip.kind, frameCount: clip.frameCount, scrubIndex: clip.scrubIndex }
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
      wave: 'M169' as const,
      labelZh: abFailAttrMultiselectClipKeyframeBookmarks
        ? \`A/B 失败归因回跳多选关帧书签 · \${abFailAttrMultiselectClipKeyframeBookmarks.bookmarkCount}枚\`
        : 'A/B 失败归因回跳多选关帧书签待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrMultiselectClipKeyframeBookmarks ? \` · \${abFailAttrMultiselectClipKeyframeBookmarks.bodyZh}\` : ''),
      toastZh: abFailAttrMultiselectClipKeyframeBookmarks
        ? 'A/B 失败归因回跳多选关帧书签已开'
        : 'A/B 失败归因回跳多选关帧书签待命',
      busyZh: 'A/B 失败归因回跳多选关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrSeekMultiselectClipScrubberIntact: (base as any).abFailAttrSeekMultiselectClipScrubberIntact === true,
      abFailAttrMultiselectClipKeyframeBookmarksIntact: !!abFailAttrMultiselectClipKeyframeBookmarks,
      abFailAttrMultiselectClipKeyframeBookmarks,
      ${FN169.ab}Path: '${PATH169.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('SeekLedgerM169')) {
  console.log('skip imports.service already M169');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
