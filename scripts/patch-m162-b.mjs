#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FN161 = {
  fail: 'resyncForceIncludePinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareDiffPreviewAdoptSoftUndoBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerM142MultiSelectContrastClipScrubberM143KeyframeBookmarksM144XsessionRoShareM145ExpiryRevokeLedgerM146RoleAuditOnepagerM147SeekLedgerM148MultiSelectContrastM149ClipScrubberM150KeyframeBookmarksM151XsessionRoShareM152ExpiryRevokeLedgerM153RoleAuditOnepagerM154SeekLedgerM155MultiselectContrastM156ClipScrubberM157KeyframeBookmarksM158XsessionRoShareM159ExpiryRevokeLedgerM160RoleAuditOnepagerM161',
  ab: 'rememberAnchorSummaryFramePinpointSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrFieldFilterReplayScrubberBookmarksXSessionRoShareDiffPreviewAdoptOnesideSoftUndoScrubAbTimelineFramePinpointAnnotateSupplyRebypassBeforeAfterPinpointRebypassFailFoldAttrOneClickRetryFoldTaskCardPhasePauseGraceSoftCancelLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareExpiryRevokeLedgerRoleAuditOnepagerSeekLedgerMultiSelectContrastClipScrubberKeyframeBookmarksXSessionRoShareM142ExpiryRevokeLedgerM143RoleAuditOnepagerM144SeekLedgerM145MultiSelectContrastM146ClipScrubberM147KeyframeBookmarksM148XSessionRoShareM149ExpiryRevokeLedgerM150RoleAuditOnepagerM151SeekLedgerM152MultiSelectContrastM153ClipScrubberM154KeyframeBookmarksM155XsessionRoShareM156ExpiryRevokeLedgerM157RoleAuditOnepagerM158SeekLedgerM159MultiSelectContrastM160ClipScrubberM161',
};
const FN162 = {
  fail: FN161.fail + 'SeekLedgerM162',
  ab: FN161.ab + 'KeyframeBookmarksM162',
};
const PATH162 = {
  fail: '/api/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/m161/seek-ledger/m162',
  ab: '/api/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry/fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/expiry-revoke-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks',
};

const failFn = `
  /** M162：失败归因过期角色审计一页纸 → 回跳中文台账 */
  async ${FN162.fail}(
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
        wave: 'M162' as const,
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

    const base = await this.${FN161.fail}(tid, {
      ...body,
      softCancel: body.softCancel !== false ? (body.softCancel ?? true) : false,
      dryRun: body.dryRun !== false,
    });

    const audit = (base as any).failAttrExpiryLedgerRoleAuditOnepager || null;
    const lines: any[] = Array.isArray(audit?.lines) ? audit.lines : [
      { id: 'm162-fail-attr-audit-seek-0', auditLineZh: '演示·失败归因过期角色审计行#1', kindZh: '失败归因过期角色审计' },
      { id: 'm162-fail-attr-audit-seek-1', auditLineZh: '演示·失败归因过期角色审计行#2', kindZh: '失败归因过期角色审计' },
    ];
    const seekEntryIndex = Math.max(0, Math.min(lines.length - 1, Number(body.seekEntryIndex) || 0));
    const wantsSeek =
      body.seekLedgerRow !== false &&
      (body.seekLedgerRow === true ||
        body.seekBackToLedger === true ||
        body.highlightLedgerRow === true ||
        !!audit);
    const highlighted = lines[seekEntryIndex] || lines[0] || null;
    const failAttrExpiryRoleAuditSeekLedger = wantsSeek
      ? {
          wave: 'M162' as const,
          kind: 'fail-attr-expiry-role-audit-seek-ledger' as const,
          titleZh: '失败归因过期角色审计一页纸 · 回跳中文台账',
          bodyZh:
            \`失败归因过期角色审计一页纸可回跳中文台账 · \${lines.length}行 · 当前#\${seekEntryIndex + 1}\` +
            \` · 过滤「\${filterRoleZh}」· 角色「\${roleZh}」· 中文 busy/toast · 中页取消仍在 · 无外发\`,
          lines,
          lineCount: lines.length,
          seekEntryIndex,
          highlighted,
          fromAudit: audit
            ? { kind: audit.kind, lineCount: audit.lineCount, filterRole: audit.filterRole }
            : null,
          filterRole,
          filterRoleZh,
          seekLedgerRow: true as const,
          seekBackToLedger: true as const,
          highlightLedgerRow: true as const,
          chineseLedger: true as const,
          softCancelIntact: true as const,
          dryRun: true as const,
          noEgress: true as const,
        }
      : null;

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M162' as const,
      labelZh: failAttrExpiryRoleAuditSeekLedger
        ? \`失败归因过期角色审计回跳台账 · \${failAttrExpiryRoleAuditSeekLedger.lineCount}行\`
        : '失败归因过期角色审计回跳台账待命',
      tipZh:
        ((base as any).tipZh || '') +
        (failAttrExpiryRoleAuditSeekLedger ? \` · \${failAttrExpiryRoleAuditSeekLedger.bodyZh}\` : ''),
      toastZh: failAttrExpiryRoleAuditSeekLedger
        ? '失败归因过期角色审计回跳台账已开'
        : '失败归因过期角色审计回跳台账待命',
      busyZh: '失败归因过期角色审计回跳台账…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      failAttrExpiryLedgerRoleAuditOnepagerIntact: (base as any).failAttrExpiryLedgerRoleAuditOnepagerIntact === true,
      failAttrExpiryRoleAuditSeekLedgerIntact: !!failAttrExpiryRoleAuditSeekLedger,
      failAttrExpiryRoleAuditSeekLedger,
      ${FN162.fail}Path: '${PATH162.fail}',
    };
  }

  /** M162：A/B 失败归因角色审计回跳多选对照 → 关帧书签 */
  async ${FN162.ab}(
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
        wave: 'M162' as const,
        labelZh: 'A/B 失败归因角色审计回跳多选关帧书签 · 已软取消',
        tipZh: '用户软取消赢过 A/B 失败归因角色审计回跳多选关帧书签 · 无外发 · 中页取消仍在',
        toastZh: '已软取消',
        busyZh: 'A/B 失败归因角色审计回跳多选关帧书签…',
        dryRun: true as const,
        noEgress: true as const,
        softCancelIntact: true as const,
        midPageCancelIntact: true as const,
        softCancelWins: true as const,
        cancelled: true as const,
      };
    }

    const base = await this.${FN161.ab}(tid, {
      ...body,
      role,
    });

    const clip = (base as any).abFailAttrRoleAuditSeekMultiselectClipScrubber || null;
    const frames: any[] = Array.isArray(clip?.frames) ? clip.frames : [
      { frameIndex: 0, id: 'm162-ab-ms-0', lineZh: '演示·A/B失败归因多选帧#1', scrubIndex: 0 },
      { frameIndex: 1, id: 'm162-ab-ms-1', lineZh: '演示·A/B失败归因多选帧#2', scrubIndex: 1 },
    ];
    const wantsKf =
      body.keyframeBookmarks !== false &&
      (body.keyframeBookmarks === true ||
        body.scrubberBookmarks === true ||
        body.scrubberKeyframeBookmarks === true ||
        !!clip);
    const bookmarkNameZh = String(body.bookmarkNameZh || '演示·M162 A/B失败归因关帧').trim();
    const bookmarks = frames.map((f: any, i: number) => ({
      id: \`m162-ab-ms-kf-\${f.id || i}\`.slice(0, 96),
      nameZh: \`\${bookmarkNameZh}#\${i + 1}\`,
      scrubIndex: f.scrubIndex ?? i,
      frameIndex: f.frameIndex ?? i,
      lineZh: f.lineZh || \`A/B失败归因多选帧#\${i + 1}\`,
      wave: 'M162' as const,
    }));
    const abFailAttrRoleAuditSeekMultiselectKfBm = wantsKf
      ? {
          wave: 'M162' as const,
          kind: 'ab-fail-attr-role-audit-seek-multiselect-kf-bm' as const,
          titleZh: 'A/B 失败归因角色审计回跳多选对照 · 关帧书签',
          bodyZh:
            \`A/B 失败归因角色审计回跳多选对照支持关帧书签 · \${bookmarks.length}枚\` +
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
          keyframeBookmarks: true as const,
          scrubberBookmarks: true as const,
          scrubberKeyframeBookmarks: true as const,
          softCancelIntact: true as const,
          dryRun: true as const,
          noEgress: true as const,
        }
      : null;

    return {
      ...(base as any),
      ok: true as const,
      wave: 'M162' as const,
      labelZh: abFailAttrRoleAuditSeekMultiselectKfBm
        ? \`A/B 失败归因角色审计回跳多选关帧书签 · \${abFailAttrRoleAuditSeekMultiselectKfBm.bookmarkCount}枚\`
        : 'A/B 失败归因角色审计回跳多选关帧书签待命',
      tipZh:
        ((base as any).tipZh || '') +
        (abFailAttrRoleAuditSeekMultiselectKfBm ? \` · \${abFailAttrRoleAuditSeekMultiselectKfBm.bodyZh}\` : ''),
      toastZh: abFailAttrRoleAuditSeekMultiselectKfBm
        ? 'A/B 失败归因角色审计回跳多选关帧书签已开'
        : 'A/B 失败归因角色审计回跳多选关帧书签待命',
      busyZh: 'A/B 失败归因角色审计回跳多选关帧书签…',
      dryRun: true as const,
      noEgress: true as const,
      softCancelIntact: true as const,
      midPageCancelIntact: true as const,
      softCancelWins: true as const,
      abFailAttrRoleAuditSeekMultiselectClipScrubberIntact: (base as any).abFailAttrRoleAuditSeekMultiselectClipScrubberIntact === true,
      abFailAttrRoleAuditSeekMultiselectKfBmIntact: !!abFailAttrRoleAuditSeekMultiselectKfBm,
      abFailAttrRoleAuditSeekMultiselectKfBm,
      ${FN162.ab}Path: '${PATH162.ab}',
    };
  }

`;

const svc = path.join(root, 'apps/api/src/imports/imports.service.ts');
let s = fs.readFileSync(svc, 'utf8');
if (s.includes('SeekLedgerM162')) {
  console.log('skip imports.service already M162');
} else {
  const idx = s.lastIndexOf('\n}\n');
  s = s.slice(0, idx) + failFn + s.slice(idx);
  fs.writeFileSync(svc, s);
  console.log('patched imports.service.ts');
}
