// @ts-nocheck
/**
 * matches.service.ts — recovered from dist after truncation; M88 write-shard cooldown sparkline wired.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as path from 'path';
const join = path.join;
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { VectorService } from '../common/vector.service';
import { FeedbackService, DEFAULT_WEIGHTS } from '../feedback/feedback.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { QualityBadgesService } from '../quality-badges/quality-badges.service';
import { AsyncMutex } from '../common/async-mutex';
import {
  createAdaptiveBackpressure,
  readAdaptiveBpKnobs,
  adaptiveBpKnobsDocZh,
} from './adaptive-backpressure';
import { recordRecallPoolHitSample } from './recall-pool-hit-stats';
import {
  buildWriteSnapshotPersist,
  hashWriteSnapshotRows,
  resolvePersistedWriteSnapshot,
} from './write-snapshot-codec';
import {
  compareWriteSnapshotAgainstBaseFrame,
  persistWriteSnapshotBaseFrame,
} from './write-snapshot-base-frame';
import {
  createHysteresisAdaptState,
  noteBpFlipAndAdapt,
  linkHysteresisAdaptToWriteShard,
  createWriteShardLinkDebounce,
  linkHysteresisAdaptToWriteShardDebounced,
  computeBpLatencyPercentiles,
  adaptWriteShardCooldownByBpPercentile,
  recordWriteShardCooldownSparkPoint,
} from './bp-hysteresis-adapt';
import * as inboxDelta from '../workbench/inbox-delta-cache';
import * as leadDrafts from './lead-drafts';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));
const { scorePair, buildOutreachDraft, embedText, embeddingMeta, detectRightsConflicts, buildMatchDossier, summarizeSlices } = shared;

@Injectable()
export class MatchesService {
    static ONE_PAGER_TTL_MS = Number(process.env.ONE_PAGER_CACHE_TTL_MS || 8000);
    static EXPLAIN_TTL_MS = Number(process.env.EXPLAIN_CACHE_TTL_MS || 6000);
    static TIER_META = {
        full: { key: "full", labelZh: "全量（内部）", blurbZh: "含完整组织名、匹配分与权利细节。仅登录方可见，勿外传。", needsAuth: true },
        partner: { key: "partner", labelZh: "合作方", blurbZh: "保留匹配理由与分数，组织名略脱敏，隐去过细权利表述。适合转给合作对接人。", needsAuth: false },
        public: { key: "public", labelZh: "对外脱敏", blurbZh: "仅公开口径：别名、分档、通用下一步。适合园区公示或对外转发。", needsAuth: false },
    };

    prisma: PrismaService;
    audit: AuditService;
    vectors: VectorService;
    feedback: FeedbackService;
    webhooks: WebhooksService;
    trust: QualityBadgesService;
    matchInFlight: boolean;
    matchInFlightSince: number | null;
    onePagerCache: Map<any, any>;
    explainCache: Map<any, any>;

    constructor(
        prisma: PrismaService,
        audit: AuditService,
        vectors: VectorService,
        feedback: FeedbackService,
        webhooks: WebhooksService,
        trust: QualityBadgesService,
    ) {
        this.prisma = prisma;
        this.audit = audit;
        this.vectors = vectors;
        this.feedback = feedback;
        this.webhooks = webhooks;
        this.trust = trust;
        this.matchInFlight = false;
        this.matchInFlightSince = null;
        this.onePagerCache = new Map();
        this.explainCache = new Map();
    }
    async list(opts = {}) {
        const where = {};
        if (opts.status)
            where.status = opts.status;
        if (typeof opts.minScore === 'number' && !Number.isNaN(opts.minScore)) {
            where.totalScore = { gte: opts.minScore };
        }
        if (opts.brokerId)
            where.brokerId = opts.brokerId;
        if (opts.orgId) {
            where.OR = [
                { demand: { orgId: opts.orgId } },
                { capability: { orgId: opts.orgId } },
                { outcome: { orgId: opts.orgId } },
            ];
        }
        const rows = await this.prisma.matchResult.findMany({
            where: Object.keys(where).length ? where : undefined,
            include: {
                demand: { include: { org: true } },
                capability: { include: { org: true, person: { select: { id: true, name: true } } } },
                outcome: { include: { org: true, person: { select: { id: true, name: true } } } },
                leads: true,
                primaryPerson: { select: { id: true, name: true, role: true } },
                broker: { select: { id: true, name: true, email: true } },
            },
            orderBy: { totalScore: 'desc' },
        });
        if (opts.audience === 'org' || opts.audience === 'broker') {
            return rows.filter((row) => !this.externalFace(row)).map((row) => this.presentExternal(row));
        }
        return rows;
    }
    presentExternal(m) {
        const bd = m?.scoreBreakdown || {};
        const orgBrief = (org) => (org ? { id: org.id, name: org.name, region: org.region || null, type: org.type || null } : null);
        return {
            id: m.id,
            totalScore: m.totalScore,
            status: m.status,
            reason: m.reason,
            followUpStatus: m.followUpStatus || null,
            demand: m.demand ? { id: m.demand.id, title: m.demand.title, org: orgBrief(m.demand.org) } : null,
            capability: m.capability ? { id: m.capability.id, title: m.capability.title, org: orgBrief(m.capability.org) } : null,
            outcome: m.outcome ? { id: m.outcome.id, title: m.outcome.title, org: orgBrief(m.outcome.org) } : null,
            broker: m.broker ? { id: m.broker.id, name: m.broker.name } : null,
            teacherName: m.primaryPerson?.name || m.outcome?.person?.name || m.capability?.person?.name || null,
            scoreBreakdown: {
                action: bd.action || null,
                actionZh: shared.ACTION_ZH?.[bd.action] || null,
                collabMode: bd.collabMode || null,
                collabModeLabel: bd.collabModeLabel || null,
                confidence: bd.confidence ?? null,
            },
        };
    }
    async visibleToViewer(id, viewer) {
        const row = await this.get(id);
        if (!viewer || viewer.kind === 'ops')
            return row;
        const owns = viewer.kind === 'broker'
            ? row.brokerId === viewer.brokerId
            : row.demand?.orgId === viewer.orgId || row.capability?.orgId === viewer.orgId || row.outcome?.orgId === viewer.orgId;
        if (!owns || this.externalFace(row)) {
            const { NotFoundException } = require('@nestjs/common');
            throw new NotFoundException('匹配不存在');
        }
        return row;
    }
    dossierView(m) {
        const bd = m?.scoreBreakdown || {};
        const person = m?.primaryPerson || m?.outcome?.person || m?.capability?.person || null;
        return {
            action: bd.action || null,
            actionZh: shared.ACTION_ZH?.[bd.action] || (bd.action ? bd.action : '还没有卷宗'),
            collabMode: bd.collabMode || null,
            collabModeLabel: bd.collabModeLabel || shared.COLLAB_LABEL?.[bd.collabMode] || null,
            confidence: bd.confidence ?? null,
            evidence: Array.isArray(bd.evidence) ? bd.evidence : [],
            blockers: Array.isArray(bd.blockers) ? bd.blockers : [],
            blockerZh: (bd.blockers || []).map((code) => shared.BLOCKER_ZH?.[code] || code),
            sliceKey: bd.sliceKey || null,
            sliceStage: bd.sliceStage || null,
            sliceStageZh: shared.STAGE_ZH?.[bd.sliceStage] || null,
            teacher: person ? { id: person.id, name: person.name, role: person.role || null } : null,
        };
    }
    get(id) {
        return this.prisma.matchResult.findUniqueOrThrow({
            where: { id },
            include: {
                demand: { include: { org: true } },
                capability: { include: { org: true, person: { select: { id: true, name: true, role: true } } } },
                outcome: { include: { org: true, person: { select: { id: true, name: true, role: true } } } },
                primaryPerson: { select: { id: true, name: true, role: true } },
                leads: { include: { person: true } },
                broker: { select: { id: true, name: true, email: true } },
            },
        });
    }
    async updateStatus(id, status, operatorNote, actorUid) {
        const row = await this.prisma.matchResult.update({
            where: { id },
            data: { status: status, operatorNote },
        });
        try {
            this.bustOnePagerCache(id);
        }
        catch (_) { }
        try {
            this.bustExplainCache(id);
        }
        catch (_) { }
        await this.audit.log({
            action: 'match.status',
            actor: 'ops',
            targetType: 'MatchResult',
            targetId: id,
            meta: { status, operatorNote },
        });
        try {
            await this.feedback.fromStatusChange(id, status, actorUid);
        }
        catch (_) { }
        if (String(status).toUpperCase() === 'APPROVED') {
            try {
                await this.webhooks.emit('match.approved', {
                    matchId: id,
                    status: row.status,
                    totalScore: row.totalScore,
                    demandId: row.demandId,
                    operatorNote: operatorNote || null,
                }, row.tenantId || 'default');
            }
            catch (_) { }
        }
        return row;
    }
    async regenerateDraft(matchId) {
        const m = await this.get(matchId);
        const action = m.scoreBreakdown?.action;
        if (action === 'SHADOW' || action === 'HOLD') {
            return { ok: false, code: 'not_ready', message: '这条还在内部观察，先不写对外草稿' };
        }
        const supplyTitle = m.capability?.title || m.outcome?.title || '';
        const supplyOrg = m.capability?.org?.name || m.outcome?.org?.name || '';
        const person = m.primaryPerson || m.outcome?.person || m.capability?.person || m.leads?.[0]?.person || null;
        const baseUrl = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 3100}`;
        const draft = buildOutreachDraft({
            demandTitle: m.demand.title,
            demandOrg: m.demand.org.name,
            supplyTitle,
            supplyOrg,
            reason: m.reason || '',
            personName: person?.name,
            collabModeLabel: m.scoreBreakdown?.collabModeLabel,
            inviteUrl: `${baseUrl}/invite.html?org=${encodeURIComponent(supplyOrg)}`,
        });
        const existing = m.leads?.[0];
        if (existing && ['approved', 'sent', 'dry_run'].includes(existing.status)) {
            const { BadRequestException } = require('@nestjs/common');
            throw new BadRequestException('这条草稿已经人审或发过，不再按匹配覆盖');
        }
        if (existing) {
            return this.prisma.lead.update({
                where: { id: existing.id },
                data: { draftSubject: draft.subject, draftBody: draft.body, status: 'draft' },
            });
        }
        return this.prisma.lead.create({
            data: {
                matchId: m.id,
                personId: person?.id,
                channel: 'email_draft',
                status: 'draft',
                draftSubject: draft.subject,
                draftBody: draft.body,
            },
        });
    }
    async runMatch(opts = {}) {
        if (this.matchInFlight) {
            const waited = this.matchInFlightSince ? Date.now() - this.matchInFlightSince : 0;
            const { BadRequestException } = require('@nestjs/common');
            throw new BadRequestException({
                ok: false,
                code: 'MATCH_BUSY',
                message: '匹配正在跑，请稍候再试',
                hintZh: '同一进程同时只跑一轮匹配，避免重复写库。可到「任务」看进度，或等当前轮结束后再点。',
                inFlightMs: waited,
                retryAfterSec: 3,
            });
        }
        this.matchInFlight = true;
        this.matchInFlightSince = Date.now();
        try {
            return await this.runMatchInner(opts);
        }
        finally {
            this.matchInFlight = false;
            this.matchInFlightSince = null;
        }
    }
    async runMatchInner(opts = {}) {
        const { cancelCheck: _cc, onProgress: _op, ...payloadOpts } = opts;
        const topN = opts.topN ?? 5;
        const minScore = opts.minScore ?? 0.25;
        const meta = embeddingMeta();
        const weightRow = await this.prisma.matchWeightState.findUnique({ where: { key: 'default' } });
        const learnedWeights = weightRow?.weights || undefined;
        const idFilter = opts.demandIds?.length
            ? { id: { in: opts.demandIds } }
            : opts.demandId
                ? { id: opts.demandId }
                : undefined;
        const demands = await this.prisma.demand.findMany({
            where: idFilter,
            include: { org: true },
        });
        const caps = await this.prisma.capability.findMany({ include: { org: true } });
        const outs = await this.prisma.outcome.findMany({ include: { org: true } });
        const coveragePeople = await this.prisma.person.findMany({
            select: { id: true, email: true, publishStatus: true, taxonomyCodes: true, sourceUpdatedAt: true, updatedAt: true },
        });
        const coverageContacts = await this.prisma.contactPoint.findMany({
            select: { personId: true, confidence: true },
        });
        const coverageSummary = summarizeSlices({
            people: coveragePeople,
            demands,
            outcomes: outs,
            capabilities: caps,
            contacts: coverageContacts,
        });
        const coverageBySlice = new Map(coverageSummary.slices.map((s) => [s.taxonomyCode, s]));
        const created = [];
        const cancelCheck = typeof opts.cancelCheck === 'function' ? opts.cancelCheck : () => false;
        const reportProgress = async (p) => {
            try {
                if (opts.onProgress)
                    await opts.onProgress(p);
            }
            catch (_) { }
        };
        await this.prisma.jobLog.create({
            data: {
                queue: 'match',
                jobName: 'run',
                payload: { ...payloadOpts, embedding: meta, jobLogId: opts.jobLogId || null },
                status: 'running',
                message: `开始匹配（向量模式 ${meta.mode}${meta.jieba ? ' · jieba' : ''}）`,
                tenantId: 'default',
            },
        });
        let skippedQuarantine = 0;
        let skippedSupplyQuarantine = 0;
        const skippedDemandSamples = [];
        const skippedSupplySamples = [];
        const demandTotal = demands.length || 1;
        await reportProgress({
            percent: 5,
            phase: 'prepare',
            step: 'prepare',
            bannerZh: `准备匹配 ${demands.length} 条需求…`,
            hintZh: '可点取消：候选块级停下；已写入的结果保留，未写入需求可续跑。',
            demandIndex: 0,
            demandTotal,
        });
        let cancelled = false;
        let di = 0;
        const matchedOrgIds = new Set();
        const softCancelToken = {
            latched: false,
            stopEmbed: false,
            stopScore: false,
            reason: null,
            annCleared: 0,
            supplyStopped: 0,
            scoreStopped: 0,
            wave: 'M77',
            tipZh: '统一软取消令牌：全停仍同停；分项可仅停供给嵌入或仅停打分；取消后游标按阶段切分',
        };
        const readCancelScopes = () => {
            try {
                if (typeof opts.cancelScopes === 'function') {
                    const sc = opts.cancelScopes() || {};
                    return {
                        all: Boolean(sc.all),
                        embed: Boolean(sc.embed),
                        score: Boolean(sc.score),
                    };
                }
            }
            catch (_) { }
            return { all: false, embed: false, score: false };
        };
        const softCancelCheck = (scope = 'all') => {
            if (softCancelToken.latched)
                return true;
            const scopes = readCancelScopes();
            if (scopes.all || cancelCheck()) {
                softCancelToken.latched = true;
                softCancelToken.stopEmbed = true;
                softCancelToken.stopScore = true;
                softCancelToken.reason = softCancelToken.reason || 'user_cancel';
                return true;
            }
            if (scope === 'embed' || scope === 'all') {
                if (scopes.embed || softCancelToken.stopEmbed) {
                    softCancelToken.stopEmbed = true;
                    softCancelToken.reason = softCancelToken.reason || 'cancel_embed';
                    return scope === 'embed' ? true : softCancelToken.latched;
                }
            }
            if (scope === 'score' || scope === 'all') {
                if (scopes.score || softCancelToken.stopScore) {
                    softCancelToken.stopScore = true;
                    softCancelToken.reason = softCancelToken.reason || 'cancel_score';
                    return scope === 'score' ? true : softCancelToken.latched;
                }
            }
            return false;
        };
        const embedCancelCheck = () => softCancelCheck('embed') || softCancelToken.stopEmbed || softCancelToken.latched;
        const scoreCancelCheck = () => softCancelCheck('score') || softCancelToken.stopScore || softCancelToken.latched;
        const buildItemizedPhases = (active, detail = {}) => {
            const order = [
                { id: 'supply-embed', labelZh: '供给嵌入', cancelScope: 'embed' },
                { id: 'ann-pool', labelZh: 'ANN 预热池', cancelScope: 'embed' },
                { id: 'score', labelZh: '打分写库', cancelScope: 'score' },
            ];
            const idx = order.findIndex((x) => x.id === active);
            return order.map((ph, i) => {
                let status = 'pending';
                if (softCancelToken.latched && i >= Math.max(0, idx))
                    status = 'cancelled';
                else if (ph.id === 'supply-embed' && softCancelToken.stopEmbed && active !== 'supply-embed')
                    status = i < idx ? 'done' : 'cancelled';
                else if (ph.id === 'score' && softCancelToken.stopScore && active !== 'score')
                    status = 'cancelled';
                else if (i < idx)
                    status = 'done';
                else if (i === idx)
                    status = 'running';
                const statusZhMap = {
                    running: '进行中',
                    done: '已完成',
                    cancelled: '已取消',
                    skipped: '已跳过',
                    pending: '等待中',
                };
                const statusZh = statusZhMap[status] || '等待中';
                return {
                    id: ph.id,
                    labelZh: ph.labelZh,
                    status,
                    statusZh,
                    detailZh: detail[ph.id] || undefined,
                    cancelScope: ph.cancelScope,
                };
            });
        };
        const supplyOverlapOn = String(process.env.MATCH_SUPPLY_SCORE_OVERLAP ?? '1') !== '0';
        await reportProgress({
            percent: 6,
            phase: 'prepare',
            step: 'supply-embed',
            bannerZh: `预热供给向量（能力 ${caps.length} · 成果 ${outs.length}）…`,
            hintZh: supplyOverlapOn
                ? '已有向量先装载；缺失嵌入将与打分重叠；可分项取消「供给嵌入」或全停。'
                : '本轮只算一次供给向量，避免每条需求重复写库。可分项取消供给嵌入。',
            demandIndex: 0,
            demandTotal,
            itemizedPhases: buildItemizedPhases('supply-embed', {
                'supply-embed': `能力 ${caps.length} · 成果 ${outs.length}`,
            }),
            cancelScopesAvailable: ['embed', 'score', 'all'],
        });
        const supplyPack = await this.prewarmSupplyEmbeddings(caps, outs, embedCancelCheck, {
            deferMissing: supplyOverlapOn,
        });
        if (embedCancelCheck() && !softCancelToken.latched) {
            softCancelToken.stopEmbed = true;
            softCancelToken.supplyStopped += 1;
        }
        let supplyRefreshPromise = null;
        const supplyRefreshMeta = {
            overlap: supplyOverlapOn,
            deferredMissing: Boolean(supplyPack.deferredMissing),
            refreshedCaps: supplyPack.refreshedCaps,
            refreshedOuts: supplyPack.refreshedOuts,
            wave: 'M72',
            tipZh: '',
            unifiedCancelToken: true,
        };
        if (supplyOverlapOn && supplyPack.deferredMissing && !softCancelCheck()) {
            await reportProgress({
                percent: 7,
                phase: 'prepare',
                step: 'supply-score-overlap',
                bannerZh: `供给预热×打分重叠：缺失向量后台补齐（能力待补 ${supplyPack.pendingCapIds?.length || 0} · 成果待补 ${supplyPack.pendingOutIds?.length || 0}）…`,
                hintZh: '打分已可开跑；可仅停供给嵌入，或软取消全停。',
                demandIndex: 0,
                demandTotal,
                itemizedPhases: buildItemizedPhases('ann-pool', {
                    'supply-embed': '重叠补齐中',
                    'ann-pool': '准备预热',
                }),
                cancelScopesAvailable: ['embed', 'score', 'all'],
            });
            supplyRefreshPromise = this.refreshDeferredSupplyEmbeddings(supplyPack, () => {
                const hit = embedCancelCheck();
                if (hit)
                    softCancelToken.supplyStopped += 1;
                return hit;
            }).then((r) => {
                supplyRefreshMeta.refreshedCaps += r.refreshedCaps;
                supplyRefreshMeta.refreshedOuts += r.refreshedOuts;
                supplyRefreshMeta.tipZh = r.tipZh;
                return r;
            });
        }
        if (cancelCheck()) {
            cancelled = true;
            await reportProgress({
                percent: 6,
                phase: 'cancelled',
                step: 'cancel-before-demands',
                bannerZh: '已取消：供给预热后未开始需求匹配',
                hintZh: '尚未写入匹配结果。',
                demandIndex: 0,
                demandTotal,
                cancelled: true,
            });
        }
        const bpKnobs = readAdaptiveBpKnobs();
        const bp = createAdaptiveBackpressure(bpKnobs);
        let liveParallel = bp.state.parallel;
        let liveWriteShard = bp.state.writeShard;
        const PARALLEL_MAX = bpKnobs.parallelMax;
        const SCORE_CHUNK = Math.max(25, Math.min(200, Number(process.env.MATCH_SCORE_CHUNK || 80)));
        const demandLookaheadOn = String(process.env.MATCH_DEMAND_EMBED_LOOKAHEAD ?? '1') !== '0';
        const demandLookaheadN = Math.max(1, Math.min(4, Number(process.env.MATCH_DEMAND_EMBED_LOOKAHEAD_N || 2) || 2));
        const demandEmbedCache = new Map();
        const demandEmbedInflight = new Map();
        const demandEmbedLookaheadMeta = {
            enabled: demandLookaheadOn,
            lookaheadN: demandLookaheadN,
            prefetched: 0,
            reused: 0,
            cancelled: 0,
            wave: 'M72',
            tipZh: demandLookaheadOn
                ? `需求嵌入 lookahead×${demandLookaheadN}：打分同时预取下一批嵌入；统一取消令牌两边同停`
                : '需求嵌入 lookahead 关闭',
        };
        const annPrewarmOn = String(process.env.MATCH_ANN_PREWARM_POOL ?? '1') !== '0';
        const annPrewarmNBase = Math.max(1, Math.min(4, Number(process.env.MATCH_ANN_PREWARM_N || demandLookaheadN) || 2));
        let liveAnnPrewarmN = annPrewarmNBase;
        const annCapAdaptOn = String(process.env.MATCH_ANN_POOL_CAP_ADAPT ?? '1') !== '0';
        const annCapAdaptCooldownMs = Math.max(0, Number(process.env.MATCH_ANN_POOL_CAP_ADAPT_COOLDOWN_MS || 12_000) || 12_000);
        let lastAnnCapAdaptAt = 0;
        const annBpCooldownLinkOn = String(process.env.MATCH_ANN_BP_COOLDOWN_LINK ?? '1') !== '0';
        let liveAnnCapAdaptCooldownMs = annCapAdaptCooldownMs;
        const annCapAdaptMeta = {
            enabled: annCapAdaptOn && annPrewarmOn,
            baseN: annPrewarmNBase,
            liveN: liveAnnPrewarmN,
            adaptedUp: 0,
            adaptedDown: 0,
            cooldownSkipped: 0,
            cooldownMs: liveAnnCapAdaptCooldownMs,
            baseCooldownMs: annCapAdaptCooldownMs,
            lastAdaptAt: null,
            recentMiss: 0,
            recentHit: 0,
            recentRecallMs: [],
            tipZh: annCapAdaptOn
                ? `ANN 暖池容量自适应：基准×${annPrewarmNBase}，按 miss/延迟动态调 1..4；冷却 ${Math.round(annCapAdaptCooldownMs / 1000)}s 防抖` +
                    (annBpCooldownLinkOn ? ' · 背压联动' : '')
                : 'ANN 暖池容量自适应关闭',
            wave: 'M84',
            labelZh: 'ANN 暖池容量自适应（冷却×背压联动·滞回自适应）',
            bpCooldownLink: annBpCooldownLinkOn,
            bpLinkShrinks: 0,
            bpLinkExpands: 0,
            bpLinkTipZh: annBpCooldownLinkOn
                ? '背压收缩加长 ANN 冷却、扩张缩短冷却（有下限）· M84 滞回自适应防 flip-flop'
                : 'ANN×背压冷却联动关闭',
        };
        const annBpHysteresisOn = String(process.env.MATCH_ANN_BP_HYSTERESIS ?? '1') !== '0';
        const annBpHysteresisBandMs = Math.max(500, Number(process.env.MATCH_ANN_BP_HYSTERESIS_BAND_MS || 2500) || 2500);
        const annBpHysteresisAdaptOn = String(process.env.MATCH_ANN_BP_HYSTERESIS_ADAPT ?? '1') !== '0';
        const hystAdapt = createHysteresisAdaptState(annBpHysteresisBandMs, annBpHysteresisOn && annBpHysteresisAdaptOn);
        let lastBpLinkDir = null;
        let lastBpLinkCooldownMs = liveAnnCapAdaptCooldownMs;
        let bpHysteresisHolds = 0;
        const writeShardLinkDebounce = createWriteShardLinkDebounce();
        const bpLatencySamples = { writeMs: [], scoreMs: [], recallMs: [] };
        let hystWriteShardLinkMeta = {
            enabled: String(process.env.MATCH_ANN_BP_HYSTERESIS_WRITE_SHARD_LINK ?? '1') !== '0',
            links: 0,
            suppressed: 0,
            last: null,
            tipZh: '滞回自适应×写库分片联动待命（冷却防抖×BP分位）',
            wave: 'M88',
            labelZh: '滞回自适应×写库分片联动（冷却×BP分位·火花图）',
            debounce: writeShardLinkDebounce,
            linkCooldownMs: writeShardLinkDebounce.cooldownMs,
            bpPercentileLink: null,
        };
        const refreshWriteShardCooldownByBpPctile = () => {
            try {
                const pct = computeBpLatencyPercentiles(bpLatencySamples);
                const adapted = adaptWriteShardCooldownByBpPercentile(writeShardLinkDebounce, pct);
                hystWriteShardLinkMeta.debounce = adapted;
                hystWriteShardLinkMeta.linkCooldownMs = adapted.cooldownMs;
                hystWriteShardLinkMeta.bpPercentileLink = adapted.bpPercentileLink;
                hystWriteShardLinkMeta.tipZh = adapted.bpPercentileLink?.tipZh || adapted.tipZh;
                hystWriteShardLinkMeta.wave = 'M88';
                hystWriteShardLinkMeta.labelZh = '滞回自适应×写库分片联动（冷却×BP分位·火花图）';
                annCapAdaptMeta.hysteresisWriteShardLink = hystWriteShardLinkMeta;
                const n = (bpLatencySamples.writeMs.length + bpLatencySamples.scoreMs.length) || 0;
                if (n > 0 && n % 3 === 0) {
                    try {
                        recordWriteShardCooldownSparkPoint((opts && opts.tenantId) || (demands[0] && demands[0].org && demands[0].org.tenantId) || 'default', {
                            cooldownMs: adapted.cooldownMs,
                            percentiles: pct,
                            reasonZh: (adapted.bpPercentileLink && adapted.bpPercentileLink.reasonZh) || adapted.tipZh,
                        });
                    }
                    catch (_) { }
                }
            }
            catch (_) { }
        };
        const _bpNoteShard = bp.noteShardLatency.bind(bp);
        const _bpNoteScore = bp.noteScoreLatency.bind(bp);
        const _bpNoteRecall = bp.noteRecallLatency.bind(bp);
        bp.noteShardLatency = (ms) => {
            bpLatencySamples.writeMs.push(Math.max(0, Number(ms) || 0));
            while (bpLatencySamples.writeMs.length > 24)
                bpLatencySamples.writeMs.shift();
            const s = _bpNoteShard(ms);
            refreshWriteShardCooldownByBpPctile();
            return s;
        };
        bp.noteScoreLatency = (ms) => {
            bpLatencySamples.scoreMs.push(Math.max(0, Number(ms) || 0));
            while (bpLatencySamples.scoreMs.length > 24)
                bpLatencySamples.scoreMs.shift();
            const s = _bpNoteScore(ms);
            refreshWriteShardCooldownByBpPctile();
            return s;
        };
        bp.noteRecallLatency = (ms) => {
            bpLatencySamples.recallMs.push(Math.max(0, Number(ms) || 0));
            while (bpLatencySamples.recallMs.length > 24)
                bpLatencySamples.recallMs.shift();
            const s = _bpNoteRecall(ms);
            refreshWriteShardCooldownByBpPctile();
            return s;
        };
        annCapAdaptMeta.bpHysteresis = annBpHysteresisOn;
        annCapAdaptMeta.bpHysteresisBandMs = annBpHysteresisBandMs;
        annCapAdaptMeta.bpHysteresisAdapt = annBpHysteresisAdaptOn;
        annCapAdaptMeta.bpHysteresisLiveBandMs = hystAdapt.liveBandMs;
        annCapAdaptMeta.bpHysteresisHolds = 0;
        annCapAdaptMeta.bpHysteresisFlipRatePerMin = 0;
        annCapAdaptMeta.hysteresisWriteShardLink = hystWriteShardLinkMeta;
        if (annBpCooldownLinkOn) {
            bp.onAdjust((adj) => {
                if (adj.direction !== 'shrink' && adj.direction !== 'expand')
                    return;
                let proposed = liveAnnCapAdaptCooldownMs;
                if (adj.direction === 'shrink') {
                    proposed = Math.min(Math.max(annCapAdaptCooldownMs * 2, liveAnnCapAdaptCooldownMs + 4000), Math.max(annCapAdaptCooldownMs * 4, 60_000));
                }
                else {
                    proposed = Math.max(Math.round(annCapAdaptCooldownMs * 0.75), Math.round(liveAnnCapAdaptCooldownMs * 0.85));
                }
                const liveBand = hystAdapt.liveBandMs || annBpHysteresisBandMs;
                if (annBpHysteresisOn &&
                    lastBpLinkDir &&
                    lastBpLinkDir !== adj.direction &&
                    Math.abs(proposed - lastBpLinkCooldownMs) < liveBand) {
                    bpHysteresisHolds += 1;
                    annCapAdaptMeta.bpHysteresisHolds = bpHysteresisHolds;
                    noteBpFlipAndAdapt(hystAdapt);
                    annCapAdaptMeta.bpHysteresisLiveBandMs = hystAdapt.liveBandMs;
                    annCapAdaptMeta.bpHysteresisFlipRatePerMin = hystAdapt.flipRatePerMin;
                    {
                        const linked = linkHysteresisAdaptToWriteShardDebounced(hystAdapt, bp.state.writeShard, writeShardLinkDebounce);
                        hystWriteShardLinkMeta.debounce = linked.debounce;
                        hystWriteShardLinkMeta.suppressed = linked.debounce.suppressed;
                        if (linked.link.debounced) {
                            hystWriteShardLinkMeta.last = linked.link;
                            hystWriteShardLinkMeta.tipZh = linked.link.tipZh;
                        }
                        else if (linked.link.delta) {
                            bp.state.writeShard = linked.writeShard;
                            liveWriteShard = linked.writeShard;
                            hystWriteShardLinkMeta.links += 1;
                            hystWriteShardLinkMeta.last = linked.link;
                            hystWriteShardLinkMeta.tipZh = linked.link.tipZh;
                        }
                        annCapAdaptMeta.hysteresisWriteShardLink = hystWriteShardLinkMeta;
                    }
                    annCapAdaptMeta.bpLinkTipZh =
                        `背压${adj.direction === 'shrink' ? '收缩' : '扩张'}但滞回带内（Δ${Math.abs(proposed - lastBpLinkCooldownMs)}ms < ${liveBand}ms）→ 冷却保持 ${Math.round(liveAnnCapAdaptCooldownMs / 1000)}s · 防 flip-flop` +
                            (annBpHysteresisAdaptOn ? ` · 滞回自适应 ${hystAdapt.liveBandMs}ms · 翻转 ${hystAdapt.flipRatePerMin}/min` : '') +
                            (hystWriteShardLinkMeta.last ? ` · 写片联动 ${hystWriteShardLinkMeta.last.writeShardBefore}→${hystWriteShardLinkMeta.last.writeShardAfter}` : '');
                    annCapAdaptMeta.tipZh =
                        `ANN 暖池×${liveAnnPrewarmN} · ${annCapAdaptMeta.bpLinkTipZh} · 滞回持守 ${bpHysteresisHolds} 次`;
                    return;
                }
                if (annBpHysteresisOn && lastBpLinkDir && lastBpLinkDir !== adj.direction) {
                    noteBpFlipAndAdapt(hystAdapt);
                    annCapAdaptMeta.bpHysteresisLiveBandMs = hystAdapt.liveBandMs;
                    annCapAdaptMeta.bpHysteresisFlipRatePerMin = hystAdapt.flipRatePerMin;
                    {
                        const linked = linkHysteresisAdaptToWriteShardDebounced(hystAdapt, bp.state.writeShard, writeShardLinkDebounce);
                        hystWriteShardLinkMeta.debounce = linked.debounce;
                        hystWriteShardLinkMeta.suppressed = linked.debounce.suppressed;
                        if (linked.link.debounced) {
                            hystWriteShardLinkMeta.last = linked.link;
                            hystWriteShardLinkMeta.tipZh = linked.link.tipZh;
                        }
                        else if (linked.link.delta) {
                            bp.state.writeShard = linked.writeShard;
                            liveWriteShard = linked.writeShard;
                            hystWriteShardLinkMeta.links += 1;
                            hystWriteShardLinkMeta.last = linked.link;
                            hystWriteShardLinkMeta.tipZh = linked.link.tipZh;
                        }
                        annCapAdaptMeta.hysteresisWriteShardLink = hystWriteShardLinkMeta;
                    }
                }
                liveAnnCapAdaptCooldownMs = proposed;
                lastBpLinkDir = adj.direction;
                lastBpLinkCooldownMs = proposed;
                annCapAdaptMeta.cooldownMs = liveAnnCapAdaptCooldownMs;
                if (adj.direction === 'shrink') {
                    annCapAdaptMeta.bpLinkShrinks += 1;
                    annCapAdaptMeta.bpLinkTipZh =
                        `背压收缩→ANN 冷却加长至 ${Math.round(liveAnnCapAdaptCooldownMs / 1000)}s（基准 ${Math.round(annCapAdaptCooldownMs / 1000)}s）` +
                            (annBpHysteresisOn ? ` · 滞回带 ${annBpHysteresisBandMs}ms` : '') +
                            ' · 防 thrash';
                    annCapAdaptMeta.tipZh =
                        `ANN 暖池×${liveAnnPrewarmN} · ${annCapAdaptMeta.bpLinkTipZh} · 已联动收缩 ${annCapAdaptMeta.bpLinkShrinks} 次`;
                }
                else {
                    annCapAdaptMeta.bpLinkExpands += 1;
                    annCapAdaptMeta.bpLinkTipZh =
                        `背压扩张→ANN 冷却缩短至 ${Math.round(liveAnnCapAdaptCooldownMs / 1000)}s（不低于基准 75%）` +
                            (annBpHysteresisOn ? ` · 滞回带 ${annBpHysteresisBandMs}ms` : '') +
                            ' · 防 thrash';
                    annCapAdaptMeta.tipZh =
                        `ANN 暖池×${liveAnnPrewarmN} · ${annCapAdaptMeta.bpLinkTipZh} · 已联动扩张 ${annCapAdaptMeta.bpLinkExpands} 次`;
                }
            });
        }
        const demandRecallContrib = new Map();
        const noteAnnPoolOutcome = (hit, recallMs, demandId, title) => {
            if (hit)
                annCapAdaptMeta.recentHit += 1;
            else
                annCapAdaptMeta.recentMiss += 1;
            if (demandId) {
                const prev = demandRecallContrib.get(String(demandId)) || {
                    demandId: String(demandId),
                    hit: 0,
                    miss: 0,
                    hitRatePct: null,
                    title: title || null,
                };
                if (hit)
                    prev.hit += 1;
                else
                    prev.miss += 1;
                if (title)
                    prev.title = String(title).slice(0, 80);
                const den = prev.hit + prev.miss;
                prev.hitRatePct = den > 0 ? Math.round((prev.hit / den) * 1000) / 10 : null;
                demandRecallContrib.set(String(demandId), prev);
            }
            if (recallMs != null && Number.isFinite(recallMs)) {
                annCapAdaptMeta.recentRecallMs.push(Number(recallMs));
                if (annCapAdaptMeta.recentRecallMs.length > 24)
                    annCapAdaptMeta.recentRecallMs.shift();
            }
            if (!annCapAdaptMeta.enabled)
                return;
            const window = annCapAdaptMeta.recentHit + annCapAdaptMeta.recentMiss;
            if (window < 4)
                return;
            const missRate = annCapAdaptMeta.recentMiss / Math.max(1, window);
            const avgMs = annCapAdaptMeta.recentRecallMs.length
                ? annCapAdaptMeta.recentRecallMs.reduce((a, b) => a + b, 0) /
                    annCapAdaptMeta.recentRecallMs.length
                : 0;
            let next = liveAnnPrewarmN;
            if (missRate >= 0.35 || avgMs >= 80)
                next = Math.min(4, liveAnnPrewarmN + 1);
            else if (missRate <= 0.1 && avgMs > 0 && avgMs < 25 && liveAnnPrewarmN > annPrewarmNBase)
                next = Math.max(1, liveAnnPrewarmN - 1);
            else if (missRate <= 0.08 && liveAnnPrewarmN > 1 && avgMs < 40)
                next = Math.max(annPrewarmNBase, liveAnnPrewarmN - 1);
            if (next !== liveAnnPrewarmN) {
                const since = Date.now() - lastAnnCapAdaptAt;
                const coolMs = liveAnnCapAdaptCooldownMs;
                if (coolMs > 0 && lastAnnCapAdaptAt > 0 && since < coolMs) {
                    annCapAdaptMeta.cooldownSkipped += 1;
                    annCapAdaptMeta.cooldownMs = coolMs;
                    annCapAdaptMeta.tipZh =
                        `ANN 暖池容量×${liveAnnPrewarmN}（冷却中，跳过调至×${next}）· 余 ${Math.max(0, Math.ceil((coolMs - since) / 1000))}s · 已跳过 ${annCapAdaptMeta.cooldownSkipped} 次防抖` +
                            (annCapAdaptMeta.bpCooldownLink ? ` · 背压联动冷却 ${Math.round(coolMs / 1000)}s` : '');
                    return;
                }
                if (next > liveAnnPrewarmN) {
                    annCapAdaptMeta.adaptedUp += 1;
                    liveAnnPrewarmN = next;
                }
                else {
                    annCapAdaptMeta.adaptedDown += 1;
                    liveAnnPrewarmN = next;
                }
                lastAnnCapAdaptAt = Date.now();
                annCapAdaptMeta.lastAdaptAt = new Date().toISOString();
                syncAnnPrewarmN();
            }
            annCapAdaptMeta.cooldownMs = liveAnnCapAdaptCooldownMs;
            annCapAdaptMeta.tipZh =
                `ANN 暖池容量×${liveAnnPrewarmN}（基准 ${annPrewarmNBase}）· miss率 ${Math.round(missRate * 100)}% · 召回均 ${Math.round(avgMs)}ms · ↑${annCapAdaptMeta.adaptedUp}/↓${annCapAdaptMeta.adaptedDown}` +
                    (annCapAdaptMeta.cooldownSkipped ? ` · 冷却跳过 ${annCapAdaptMeta.cooldownSkipped}` : '') +
                    ` · 冷却 ${Math.round(liveAnnCapAdaptCooldownMs / 1000)}s` +
                    (annCapAdaptMeta.bpLinkShrinks || annCapAdaptMeta.bpLinkExpands
                        ? ` · 背压联动↑${annCapAdaptMeta.bpLinkExpands}/↓${annCapAdaptMeta.bpLinkShrinks}`
                        : '');
            annRecallPrewarmMeta.tipZh =
                `ANN 召回预热池×${liveAnnPrewarmN}（自适应·冷却×背压联动）` +
                    (annCapAdaptMeta.adaptedUp || annCapAdaptMeta.adaptedDown
                        ? ` · 已调↑${annCapAdaptMeta.adaptedUp}/↓${annCapAdaptMeta.adaptedDown}`
                        : '') +
                    '：预取后续需求候选；写库快照压缩/增量；打分前去重；统一取消令牌清池；命中样入分位数看板';
        };
        let annPrewarmN = liveAnnPrewarmN;
        const syncAnnPrewarmN = () => {
            annPrewarmN = liveAnnPrewarmN;
            annCapAdaptMeta.liveN = liveAnnPrewarmN;
            annRecallPrewarmMeta.poolN = liveAnnPrewarmN;
        };
        const annPool = new Map();
        const annPoolInflight = new Map();
        const lightExpandOn = String(process.env.MATCH_RECALL_LIGHT_EXPAND ?? '1') !== '0';
        const lightExpandMin = Math.max(topN, Math.min(80, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_MIN || topN * 2) || topN * 2));
        const lightExpandFactor = Math.max(1.5, Math.min(3, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_FACTOR || 2) || 2));
        const lightExpandMaxLim = Math.max(80, Math.min(200, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_MAX || 120) || 120));
        const lightExpandQualityGateOn = String(process.env.MATCH_RECALL_LIGHT_EXPAND_QUALITY_GATE ?? '1') !== '0';
        const lightExpandMaxRounds = Math.max(1, Math.min(3, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_MAX_ROUNDS || 2) || 2));
        const lightExpandMinGain = Math.max(0, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_MIN_GAIN || 1) || 1);
        const lightExpandMinDiversity = Math.max(1, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_MIN_DIVERSITY || 2) || 2);
        const lightExpandGateMinScore = Math.max(0, Math.min(1, Number(process.env.MATCH_RECALL_LIGHT_EXPAND_GATE_MIN_SCORE || minScore) || minScore));
        const topNDiversityRerankOn = String(process.env.MATCH_TOPN_DIVERSITY_RERANK ?? '1') !== '0';
        const topNDiversityPoolFactor = Math.max(1.5, Math.min(8, Number(process.env.MATCH_TOPN_DIVERSITY_POOL_FACTOR || 3) || 3));
        const topNDiversityOrgPenalty = Math.max(0, Math.min(0.5, Number(process.env.MATCH_TOPN_DIVERSITY_ORG_PENALTY || 0.08) || 0.08));
        const topNDiversityKindPenalty = Math.max(0, Math.min(0.5, Number(process.env.MATCH_TOPN_DIVERSITY_KIND_PENALTY || 0.04) || 0.04));
        const annRecallPrewarmMeta = {
            enabled: annPrewarmOn,
            poolN: annPrewarmN,
            prewarmed: 0,
            reused: 0,
            missed: 0,
            cancelled: 0,
            deduped: 0,
            lightExpanded: 0,
            lightExpandAdds: 0,
            qualityGateEarlyStops: 0,
            qualityGatePasses: 0,
            qualityGateRounds: 0,
            diversityReranked: 0,
            diversityOrgUnique: 0,
            diversityKindUnique: 0,
            diversityDemoted: 0,
            diversityExplainSamples: [],
            diversityContrastSamples: [],
            wave: 'M74',
            tipZh: annPrewarmOn
                ? `ANN 召回预热池×${annPrewarmN}（可自适应）：预取后续需求候选；按 phase 检查点续跑；打分前按 kind:id 去重；统一取消令牌清池；召回不足轻量扩窗+质量闸早停`
                : 'ANN 召回预热池关闭',
            mode: 'pending',
            unifiedCancelToken: true,
            lightExpand: lightExpandOn,
            qualityGate: lightExpandQualityGateOn,
            diversityRerank: topNDiversityRerankOn,
        };
        const clearAnnPool = (reason) => {
            annPool.clear();
            annPoolInflight.clear();
            if (reason === 'cancel')
                annRecallPrewarmMeta.cancelled += 1;
        };
        const writeMutex = new AsyncMutex();
        const completedDemandIds = [];
        const completedSet = new Set();
        let finishedCount = 0;
        const hashWriteSnapshot = (rows) => hashWriteSnapshotRows(rows);
        const buildWriteSnapshotMeta = (rows) => {
            const pack = buildWriteSnapshotPersist(rows, null);
            return pack.writeSnapshotMeta;
        };
        const verifyWriteSnapshotAgainstPhase = (prev) => {
            const snap = resolvePersistedWriteSnapshot(prev) ||
                (Array.isArray(prev?.writeSnapshot) ? prev.writeSnapshot : null);
            if (!snap || !snap.length) {
                return { ok: false, reasonZh: '写库快照为空，无法直入写库，将回退重打分/写库' };
            }
            if (prev?.phase !== 'write') {
                return {
                    ok: false,
                    reasonZh: `phase 对照失败：检查点 phase=${prev?.phase || '—'}，期望 write，将回退重打分/写库`,
                    count: snap.length,
                };
            }
            for (const row of snap) {
                if (!row || !row.id || !row.kind) {
                    return { ok: false, reasonZh: '写库快照行缺 id/kind，完整性失败，将回退重打分/写库', count: snap.length };
                }
            }
            const checksum = hashWriteSnapshot(snap);
            const meta = prev?.writeSnapshotMeta || null;
            if (meta) {
                if (Number(meta.count) !== snap.length) {
                    return {
                        ok: false,
                        reasonZh: `写库快照条数与元信息不一致（${snap.length}≠${meta.count}），将回退重打分/写库`,
                        checksum,
                        expected: meta.checksum || null,
                        count: snap.length,
                        metaCount: Number(meta.count),
                    };
                }
                if (meta.checksum && meta.checksum !== checksum) {
                    return {
                        ok: false,
                        reasonZh: `写库快照校验和不一致（期望 ${String(meta.checksum).slice(0, 8)}… / 实得 ${checksum.slice(0, 8)}…），将回退重打分/写库`,
                        checksum,
                        expected: meta.checksum,
                        count: snap.length,
                        metaCount: Number(meta.count),
                    };
                }
                if (meta.phase && meta.phase !== 'write') {
                    return {
                        ok: false,
                        reasonZh: `写库快照元信息 phase=${meta.phase}，与检查点对拍失败，将回退重打分/写库`,
                        checksum,
                        expected: meta.checksum || null,
                        count: snap.length,
                    };
                }
            }
            return {
                ok: true,
                reasonZh: `写库快照校验通过×${snap.length} · ${checksum.slice(0, 8)}… · phase=write`,
                checksum,
                expected: meta?.checksum || checksum,
                count: snap.length,
                metaCount: meta ? Number(meta.count) : snap.length,
                rows: snap,
            };
        };
        const demandCheckpoints = new Map();
        const phaseResumeMeta = {
            enabled: String(process.env.MATCH_CHECKPOINT_PHASE_RESUME ?? '1') !== '0',
            resumedByPhase: { recall: 0, score: 0, write: 0 },
            skippedRecall: 0,
            skippedScore: 0,
            writeFromSnapshot: 0,
            writeSnapshotVerified: 0,
            writeSnapshotMismatchFallback: 0,
            writeSnapshotCompressed: 0,
            writeSnapshotIncremental: 0,
            writeSnapshotBytesSaved: 0,
            lastVerifyTipZh: null,
            tipZh: '检查点按 phase（召回/打分/写库）细粒度续跑；写库快照压缩/增量 + 完整性校验；召回命中入分位看板',
            wave: 'M83',
            labelZh: '按 phase 细粒度续跑（写库快照压缩/增量·滞回）',
        };
        const ckTenantId = this.safeTenantId(opts?.tenantId ||
            demands[0]?.org?.tenantId ||
            demands[0]?.tenantId ||
            'default');
        const checkpointPersistMeta = {
            enabled: String(process.env.MATCH_CHECKPOINT_PERSIST ?? '1') !== '0',
            loaded: false,
            resumedDone: 0,
            annWarmResumed: 0,
            path: this.demandCheckpointPersistPath(ckTenantId),
            annPath: this.annPoolWarmPersistPath(ckTenantId),
            tipZh: '',
            wave: 'M83',
            labelZh: '检查点按 phase 续跑 + 写库快照压缩/增量 + ANN 冷却×背压联动·滞回落盘',
            phaseResume: true,
            capacityAdapt: true,
            writeSnapshotVerify: true,
            annAdaptCooldown: true,
            writeSnapshotCompress: true,
            annBpCooldownLink: annBpCooldownLinkOn,
        };
        const annWarmByDemand = {};
        const diskCk = checkpointPersistMeta.enabled ? this.readDemandCheckpointPersist(ckTenantId) : null;
        const diskAnn = checkpointPersistMeta.enabled ? this.readAnnPoolWarmPersist(ckTenantId) : null;
        if (diskCk?.byDemandId && typeof diskCk.byDemandId === 'object') {
            checkpointPersistMeta.loaded = true;
            for (const [id, row] of Object.entries(diskCk.byDemandId)) {
                if (!row || typeof row !== 'object')
                    continue;
                demandCheckpoints.set(id, {
                    demandId: id,
                    title: row.title,
                    phase: row.phase || 'pending',
                    recallMs: row.recallMs ?? null,
                    scoreMs: row.scoreMs ?? null,
                    at: row.at || new Date().toISOString(),
                    labelZh: row.labelZh || String(row.phase || 'pending'),
                    writeSnapshot: Array.isArray(row.writeSnapshot) ? row.writeSnapshot : null,
                    writeSnapshotMeta: row.writeSnapshotMeta && typeof row.writeSnapshotMeta === 'object' ? row.writeSnapshotMeta : null,
                    writeSnapshotIncremental: row.writeSnapshotIncremental || null,
                    writeSnapshotPrev: Array.isArray(row.writeSnapshotPrev) ? row.writeSnapshotPrev : null,
                    resumeFromPhase: row.resumeFromPhase || row.phase || null,
                });
            }
        }
        if (diskAnn && typeof diskAnn === 'object' && diskAnn.adaptedPoolN != null) {
            const n = Math.max(1, Math.min(4, Number(diskAnn.adaptedPoolN) || annPrewarmNBase));
            if (annCapAdaptOn && n !== liveAnnPrewarmN) {
                liveAnnPrewarmN = n;
                syncAnnPrewarmN();
                annCapAdaptMeta.tipZh = `ANN 暖池容量自磁盘恢复×${n}（基准 ${annPrewarmNBase}）`;
            }
        }
        if (diskAnn?.byDemandId && typeof diskAnn.byDemandId === 'object') {
            Object.assign(annWarmByDemand, diskAnn.byDemandId);
            for (const d0 of demands) {
                const w = annWarmByDemand[d0.id];
                if (!w)
                    continue;
                if (annPool.has(d0.id))
                    continue;
                const ttlMs = Math.max(60_000, Number(process.env.MATCH_ANN_WARM_TTL_MS || 30 * 60_000) || 30 * 60_000);
                const atMs = w.at ? (typeof w.at === 'number' ? w.at : Date.parse(String(w.at))) : NaN;
                if (Number.isFinite(atMs) && Date.now() - atMs > ttlMs)
                    continue;
                annPool.set(d0.id, {
                    demandId: d0.id,
                    capIds: Array.isArray(w.capIds) ? w.capIds : null,
                    outIds: Array.isArray(w.outIds) ? w.outIds : null,
                    mode: String(w.mode || 'disk-warm'),
                    at: Number.isFinite(atMs) ? atMs : Date.now(),
                });
                checkpointPersistMeta.annWarmResumed += 1;
                annRecallPrewarmMeta.reused += 1;
            }
        }
        if (opts.demandIds?.length && demandCheckpoints.size) {
            for (const d0 of demands) {
                const prev = demandCheckpoints.get(d0.id);
                if (prev && (prev.phase === 'done' || prev.phase === 'skipped')) {
                    completedSet.add(d0.id);
                    completedDemandIds.push(d0.id);
                    finishedCount += 1;
                    checkpointPersistMeta.resumedDone += 1;
                }
            }
        }
        checkpointPersistMeta.tipZh = checkpointPersistMeta.loaded
            ? `检查点已从磁盘加载 · 续热 ANN ${checkpointPersistMeta.annWarmResumed} · 跳过已完成 ${checkpointPersistMeta.resumedDone} · 池容量×${liveAnnPrewarmN}（租户 ${ckTenantId}）`
            : `检查点落盘就绪（租户 ${ckTenantId}）；ANN 续热 ${checkpointPersistMeta.annWarmResumed} · 池容量×${liveAnnPrewarmN}`;
        let ckPersistTimer = null;
        const flushCheckpointPersist = (force = false) => {
            if (!checkpointPersistMeta.enabled)
                return;
            const snap = {
                byDemandId: Object.fromEntries(demandCheckpoints.entries()),
                remainingDemandIds: demands.filter((d) => !completedSet.has(d.id)).map((d) => d.id),
                unfinishedDemandIds: [...demandCheckpoints.values()]
                    .filter((r) => r.phase !== 'done' && r.phase !== 'skipped')
                    .map((r) => r.demandId),
                tipZh: checkpointPersistMeta.tipZh,
            };
            this.writeDemandCheckpointPersist(ckTenantId, {
                ...snap,
                phaseResume: true,
                wave: 'M82',
            });
            this.writeAnnPoolWarmPersist(ckTenantId, annWarmByDemand, {
                adaptedPoolN: liveAnnPrewarmN,
                capacityAdapt: annCapAdaptMeta,
            });
            if (force && ckPersistTimer) {
                clearTimeout(ckPersistTimer);
                ckPersistTimer = null;
            }
        };
        const scheduleCheckpointPersist = () => {
            if (!checkpointPersistMeta.enabled)
                return;
            if (ckPersistTimer)
                return;
            ckPersistTimer = setTimeout(() => {
                ckPersistTimer = null;
                flushCheckpointPersist();
            }, 120);
        };
        const markDemandCheckpoint = (demandId, phase, extra = {}) => {
            const phaseZh = {
                pending: '待处理',
                recall: '召回中',
                score: '打分中',
                write: '写库中',
                done: '已完成',
                skipped: '已跳过',
            };
            const prev = demandCheckpoints.get(demandId);
            let writeSnapshot = extra.clearWriteSnapshot
                ? null
                : extra.writeSnapshot !== undefined
                    ? extra.writeSnapshot
                    : prev?.writeSnapshot ?? null;
            let writeSnapshotMeta = null;
            let writeSnapshotIncremental = null;
            let writeSnapshotPrev = null;
            if (extra.clearWriteSnapshot) {
                writeSnapshotMeta = null;
                writeSnapshotIncremental = null;
                writeSnapshotPrev = null;
            }
            else if (extra.writeSnapshotMeta !== undefined) {
                writeSnapshotMeta = extra.writeSnapshotMeta;
                writeSnapshotIncremental =
                    extra.writeSnapshotIncremental !== undefined
                        ? extra.writeSnapshotIncremental
                        : prev?.writeSnapshotIncremental ?? null;
                writeSnapshotPrev =
                    extra.writeSnapshotPrev !== undefined
                        ? extra.writeSnapshotPrev
                        : prev?.writeSnapshotPrev ?? null;
            }
            else if (extra.writeSnapshot !== undefined && Array.isArray(extra.writeSnapshot)) {
                const pack = buildWriteSnapshotPersist(extra.writeSnapshot, {
                    rows: prev?.writeSnapshot || null,
                    meta: prev?.writeSnapshotMeta || null,
                });
                writeSnapshot = pack.writeSnapshot;
                writeSnapshotMeta = pack.writeSnapshotMeta;
                writeSnapshotIncremental = pack.writeSnapshotIncremental;
                writeSnapshotPrev = prev?.writeSnapshot ?? null;
                if (pack.writeSnapshotMeta.compressed)
                    phaseResumeMeta.writeSnapshotCompressed += 1;
                if (pack.writeSnapshotMeta.incremental)
                    phaseResumeMeta.writeSnapshotIncremental += 1;
                const saved = Math.max(0, Number(pack.writeSnapshotMeta.bytesBefore || 0) - Number(pack.writeSnapshotMeta.bytesAfter || 0));
                phaseResumeMeta.writeSnapshotBytesSaved += saved;
            }
            else {
                writeSnapshotMeta = prev?.writeSnapshotMeta ?? null;
                writeSnapshotIncremental = prev?.writeSnapshotIncremental ?? null;
                writeSnapshotPrev = prev?.writeSnapshotPrev ?? null;
            }
            const row = {
                demandId,
                title: extra.title ?? prev?.title,
                phase,
                recallMs: extra.recallMs !== undefined ? extra.recallMs : prev?.recallMs ?? null,
                scoreMs: extra.scoreMs !== undefined ? extra.scoreMs : prev?.scoreMs ?? null,
                at: new Date().toISOString(),
                labelZh: phaseZh[phase] || phase,
                writeSnapshot,
                writeSnapshotMeta,
                writeSnapshotIncremental,
                writeSnapshotPrev,
                resumeFromPhase: phase,
            };
            demandCheckpoints.set(demandId, row);
            scheduleCheckpointPersist();
            return row;
        };
        const snapshotDemandCheckpoints = () => {
            const rows = [...demandCheckpoints.values()];
            const unfinished = rows.filter((r) => r.phase !== 'done' && r.phase !== 'skipped');
            const lastUnfinished = unfinished.length ? unfinished[unfinished.length - 1] : null;
            flushCheckpointPersist(true);
            return {
                byDemandId: Object.fromEntries(rows.map((r) => [r.demandId, r])),
                rows: rows.slice(-80),
                doneCount: rows.filter((r) => r.phase === 'done' || r.phase === 'skipped').length,
                unfinishedCount: unfinished.length,
                lastUnfinishedDemandId: lastUnfinished?.demandId || null,
                lastUnfinishedPhase: lastUnfinished?.phase || null,
                lastUnfinishedLabelZh: lastUnfinished
                    ? `${lastUnfinished.labelZh} · ${String(lastUnfinished.title || lastUnfinished.demandId).slice(0, 28)}`
                    : null,
                tipZh: lastUnfinished
                    ? `demandId 检查点：已完成 ${rows.filter((r) => r.phase === 'done' || r.phase === 'skipped').length} · 未完成 ${unfinished.length} · 续跑自「${String(lastUnfinished.title || lastUnfinished.demandId).slice(0, 24)}」phase=${lastUnfinished.phase}（${lastUnfinished.labelZh}）· 不重做已完成 phase。跨进程落盘已写。`
                    : `demandId 检查点：已完成 ${rows.filter((r) => r.phase === 'done' || r.phase === 'skipped').length} · 无未完成需求。跨进程落盘已写。`,
                labelZh: '按 demandId×phase 召回/打分/写库检查点（跨进程落盘）',
                persistAcrossProcess: true,
                persistPath: checkpointPersistMeta.path,
                annWarmPath: checkpointPersistMeta.annPath,
                annWarmResumed: checkpointPersistMeta.annWarmResumed,
                resumedDoneFromDisk: checkpointPersistMeta.resumedDone,
                persistTipZh: checkpointPersistMeta.tipZh,
                phaseResume: phaseResumeMeta,
                annPoolCapacityAdapt: annCapAdaptMeta,
                wave: 'M82',
            };
        };
        let nextDemandIdx = 0;
        let cancelLatched = cancelled;
        const overlapPrewarmQueue = [];
        let overlapPrewarmBusy = false;
        let overlapPrewarmDrain = null;
        let lastWriteCompletedAt = null;
        let firstOverlapPrewarmAt = null;
        let overlapPrewarmFinishedAt = null;
        const overlapSeenIds = new Set();
        const overlapPrewarmAgg = {
            requested: 0,
            warmed: 0,
            warmedExplainCore: 0,
            skippedCancel: 0,
            errors: 0,
            remainingIds: [],
            resumeAvailable: false,
            queueId: null,
            wave: 'M72',
            pipelineOverlap: true,
            tipZh: '',
        };
        const latchCancel = () => {
            if (softCancelCheck('all') || cancelCheck()) {
                softCancelToken.latched = true;
                softCancelToken.stopEmbed = true;
                softCancelToken.stopScore = true;
                softCancelToken.reason = softCancelToken.reason || 'user_cancel';
                if (!cancelLatched) {
                    clearAnnPool('cancel');
                    softCancelToken.annCleared += 1;
                }
                cancelLatched = true;
                return true;
            }
            if (scoreCancelCheck()) {
                if (!softCancelToken.stopScore)
                    softCancelToken.scoreStopped += 1;
                softCancelToken.stopScore = true;
                softCancelToken.reason = softCancelToken.reason || 'cancel_score';
                cancelLatched = true;
                return true;
            }
            if (embedCancelCheck()) {
                softCancelToken.stopEmbed = true;
                softCancelToken.reason = softCancelToken.reason || 'cancel_embed';
                return false;
            }
            return cancelLatched;
        };
        const ensureDemandEmbed = async (d) => {
            if (latchCancel()) {
                demandEmbedLookaheadMeta.cancelled += 1;
                return null;
            }
            if (Array.isArray(d.embedding) && d.embedding.length) {
                const emb = d.embedding;
                demandEmbedCache.set(d.id, emb);
                return emb;
            }
            const cached = demandEmbedCache.get(d.id);
            if (cached) {
                demandEmbedLookaheadMeta.reused += 1;
                return cached;
            }
            const inflight = demandEmbedInflight.get(d.id);
            if (inflight) {
                demandEmbedLookaheadMeta.reused += 1;
                return inflight;
            }
            const p = (async () => {
                if (latchCancel()) {
                    demandEmbedLookaheadMeta.cancelled += 1;
                    return null;
                }
                const demb = await embedText([d.title, d.problem, d.expectedOut, ...(d.industry || [])].join(' '));
                if (latchCancel()) {
                    demandEmbedLookaheadMeta.cancelled += 1;
                    return null;
                }
                await this.prisma.demand.update({ where: { id: d.id }, data: { embedding: demb } });
                await this.vectors.syncRowVec('Demand', d.id, demb);
                d.embedding = demb;
                demandEmbedCache.set(d.id, demb);
                return demb;
            })().finally(() => {
                demandEmbedInflight.delete(d.id);
            });
            demandEmbedInflight.set(d.id, p);
            return p;
        };
        const kickDemandEmbedLookahead = (fromOrdinal) => {
            if (!demandLookaheadOn || latchCancel())
                return;
            for (let j = fromOrdinal + 1; j <= fromOrdinal + demandLookaheadN && j < demands.length; j++) {
                const nd = demands[j];
                if (!nd)
                    continue;
                if (demandEmbedCache.has(nd.id) || demandEmbedInflight.has(nd.id))
                    continue;
                if (Array.isArray(nd.embedding) && nd.embedding.length) {
                    demandEmbedCache.set(nd.id, nd.embedding);
                    continue;
                }
                demandEmbedLookaheadMeta.prefetched += 1;
                void ensureDemandEmbed(nd);
            }
        };
        const fillAnnPoolEntry = async (d, demb) => {
            if (latchCancel()) {
                annRecallPrewarmMeta.cancelled += 1;
                return null;
            }
            const existing = annPool.get(d.id);
            if (existing)
                return existing;
            const inflight = annPoolInflight.get(d.id);
            if (inflight)
                return inflight;
            const p = (async () => {
                if (latchCancel()) {
                    annRecallPrewarmMeta.cancelled += 1;
                    return null;
                }
                const vecStatus = this.vectors.status();
                annRecallPrewarmMeta.mode = vecStatus.mode;
                let capIds = null;
                let outIds = null;
                if (vecStatus.mode === 'pgvector_hot') {
                    const lim = Math.max(topN * 8, 40);
                    const [nc, no] = await Promise.all([
                        this.vectors.nearestCapabilities(demb, { limit: lim, excludeOrgId: d.orgId }),
                        this.vectors.nearestOutcomes(demb, { limit: lim, excludeOrgId: d.orgId }),
                    ]);
                    if (latchCancel()) {
                        annRecallPrewarmMeta.cancelled += 1;
                        return null;
                    }
                    if (nc)
                        capIds = nc.map((x) => x.id);
                    if (no)
                        outIds = no.map((x) => x.id);
                }
                const entry = {
                    demandId: d.id,
                    capIds,
                    outIds,
                    mode: vecStatus.mode,
                    at: Date.now(),
                };
                annPool.set(d.id, entry);
                annWarmByDemand[d.id] = {
                    demandId: d.id,
                    capIds,
                    outIds,
                    mode: vecStatus.mode,
                    at: entry.at,
                    title: String(d.title || '').slice(0, 48),
                };
                scheduleCheckpointPersist();
                annRecallPrewarmMeta.prewarmed += 1;
                return entry;
            })().finally(() => {
                annPoolInflight.delete(d.id);
            });
            annPoolInflight.set(d.id, p);
            return p;
        };
        const kickAnnRecallPrewarm = (fromOrdinal) => {
            if (!annPrewarmOn || softCancelToken.latched || softCancelToken.stopEmbed || latchCancel())
                return;
            for (let j = fromOrdinal + 1; j <= fromOrdinal + annPrewarmN && j < demands.length; j++) {
                const nd = demands[j];
                if (!nd || annPool.has(nd.id) || annPoolInflight.has(nd.id))
                    continue;
                const emb = demandEmbedCache.get(nd.id) ||
                    (Array.isArray(nd.embedding) && nd.embedding.length
                        ? nd.embedding
                        : null);
                if (!emb) {
                    void ensureDemandEmbed(nd).then((got) => {
                        if (got && !latchCancel())
                            void fillAnnPoolEntry(nd, got);
                    });
                    continue;
                }
                void fillAnnPoolEntry(nd, emb);
            }
        };
        const takeAnnFromPool = async (d, demb) => {
            const baseLimit = Math.max(topN * 8, 40);
            if (annPrewarmOn) {
                let entry = annPool.get(d.id) || null;
                if (!entry) {
                    const inflight = annPoolInflight.get(d.id);
                    if (inflight)
                        entry = await inflight;
                }
                if (entry) {
                    annPool.delete(d.id);
                    annRecallPrewarmMeta.reused += 1;
                    return {
                        nnCapIds: entry.capIds ? new Set(entry.capIds) : null,
                        nnOutIds: entry.outIds ? new Set(entry.outIds) : null,
                        fromPool: true,
                        baseLimit,
                        expanded: false,
                    };
                }
                annRecallPrewarmMeta.missed += 1;
            }
            if (latchCancel()) {
                return { nnCapIds: null, nnOutIds: null, fromPool: false, baseLimit, expanded: false };
            }
            const vecStatus = this.vectors.status();
            annRecallPrewarmMeta.mode = vecStatus.mode;
            let nnCapIds = null;
            let nnOutIds = null;
            if (vecStatus.mode === 'pgvector_hot') {
                const [nc, no] = await Promise.all([
                    this.vectors.nearestCapabilities(demb, { limit: baseLimit, excludeOrgId: d.orgId }),
                    this.vectors.nearestOutcomes(demb, { limit: baseLimit, excludeOrgId: d.orgId }),
                ]);
                if (latchCancel()) {
                    return { nnCapIds: null, nnOutIds: null, fromPool: false, baseLimit, expanded: false };
                }
                if (nc)
                    nnCapIds = new Set(nc.map((x) => x.id));
                if (no)
                    nnOutIds = new Set(no.map((x) => x.id));
            }
            return { nnCapIds, nnOutIds, fromPool: false, baseLimit, expanded: false };
        };
        const lightExpandAnnIds = async (d, demb, cur, candidateCount, candOrgs) => {
            const empty = {
                nnCapIds: cur.nnCapIds,
                nnOutIds: cur.nnOutIds,
                expanded: false,
                added: 0,
                earlyStop: false,
                rounds: 0,
                gateZh: '',
                reasonZh: '',
            };
            if (!lightExpandOn || latchCancel())
                return empty;
            const vecStatus = this.vectors.status();
            if (vecStatus.mode !== 'pgvector_hot')
                return empty;
            let nnCapIds = cur.nnCapIds;
            let nnOutIds = cur.nnOutIds;
            let baseLimit = cur.baseLimit;
            let candCount = candidateCount;
            let orgSet = candOrgs ? new Set(candOrgs) : new Set();
            let totalAdded = 0;
            let rounds = 0;
            let expandedAny = false;
            let earlyStop = false;
            let gateZh = '';
            let reasonZh = '';
            while (rounds < lightExpandMaxRounds) {
                if (latchCancel())
                    break;
                const low = candCount < lightExpandMin ||
                    ((nnCapIds == null || nnCapIds.size === 0) && (nnOutIds == null || nnOutIds.size === 0));
                if (!low) {
                    gateZh = `质量闸通过：候选 ${candCount} ≥ ${lightExpandMin}，无需再扩`;
                    annRecallPrewarmMeta.qualityGatePasses += 1;
                    break;
                }
                const expandLim = Math.min(lightExpandMaxLim, Math.max(baseLimit + 1, Math.ceil(baseLimit * lightExpandFactor)));
                if (expandLim <= baseLimit) {
                    earlyStop = true;
                    reasonZh = `扩窗上限已触顶（base=${baseLimit} max=${lightExpandMaxLim}），早停`;
                    annRecallPrewarmMeta.qualityGateEarlyStops += 1;
                    break;
                }
                rounds += 1;
                annRecallPrewarmMeta.qualityGateRounds += 1;
                await reportProgress({
                    percent: Math.min(96, Math.round((finishedCount / demandTotal) * 100) + 4),
                    phase: 'score',
                    step: 'recall-light-expand',
                    bannerZh: `召回偏少（候选 ${candCount} < ${lightExpandMin}）：轻量扩窗第 ${rounds}/${lightExpandMaxRounds} 轮 ${baseLimit}→${expandLim}…`,
                    hintZh: lightExpandQualityGateOn
                        ? '有界扩窗+质量闸（增益/多样性/仍偏少早停）；统一取消令牌可中断。'
                        : '有界二次召回，不无限扩窗；统一取消令牌可中断。',
                    demandIndex: finishedCount,
                    demandTotal,
                });
                const [nc, no] = await Promise.all([
                    this.vectors.nearestCapabilities(demb, { limit: expandLim, excludeOrgId: d.orgId }),
                    this.vectors.nearestOutcomes(demb, { limit: expandLim, excludeOrgId: d.orgId }),
                ]);
                if (latchCancel())
                    break;
                const nextCap = nnCapIds ? new Set(nnCapIds) : new Set();
                const nextOut = nnOutIds ? new Set(nnOutIds) : new Set();
                const before = nextCap.size + nextOut.size;
                const newOrgIds = new Set();
                if (nc) {
                    for (const x of nc) {
                        const was = nextCap.has(x.id);
                        nextCap.add(x.id);
                        if (!was && x.orgId)
                            newOrgIds.add(String(x.orgId));
                    }
                }
                if (no) {
                    for (const x of no) {
                        const was = nextOut.has(x.id);
                        nextOut.add(x.id);
                        if (!was && x.orgId)
                            newOrgIds.add(String(x.orgId));
                    }
                }
                const added = nextCap.size + nextOut.size - before;
                totalAdded += added;
                expandedAny = true;
                annRecallPrewarmMeta.lightExpanded += 1;
                annRecallPrewarmMeta.lightExpandAdds += added;
                nnCapIds = nextCap.size ? nextCap : nnCapIds;
                nnOutIds = nextOut.size ? nextOut : nnOutIds;
                baseLimit = expandLim;
                for (const o of newOrgIds)
                    orgSet.add(o);
                candCount = Math.max(candCount, (nnCapIds?.size || 0) + (nnOutIds?.size || 0));
                if (!lightExpandQualityGateOn) {
                    gateZh = `质量闸关闭：已扩 ${rounds} 轮 +${totalAdded}`;
                    break;
                }
                const diversity = orgSet.size || newOrgIds.size;
                const stillTooFew = candCount < lightExpandMin;
                const lowGain = added < lightExpandMinGain;
                const lowDiversity = diversity < lightExpandMinDiversity && stillTooFew;
                if (lowGain || lowDiversity) {
                    earlyStop = true;
                    reasonZh = lowGain
                        ? `质量闸早停：本轮增益 ${added} < ${lightExpandMinGain}（候选仍 ${candCount}）`
                        : `质量闸早停：机构多样性 ${diversity} < ${lightExpandMinDiversity} 且仍偏少`;
                    gateZh = reasonZh + ` · 闸值 minScore≈${lightExpandGateMinScore}`;
                    annRecallPrewarmMeta.qualityGateEarlyStops += 1;
                    await reportProgress({
                        percent: Math.min(96, Math.round((finishedCount / demandTotal) * 100) + 4),
                        phase: 'score',
                        step: 'recall-light-expand-early-stop',
                        bannerZh: reasonZh,
                        hintZh: '不再继续扩窗；软取消令牌仍有效。',
                        demandIndex: finishedCount,
                        demandTotal,
                    });
                    break;
                }
                if (!stillTooFew) {
                    gateZh = `质量闸通过：扩后候选 ${candCount} ≥ ${lightExpandMin} · 多样性 ${diversity}`;
                    annRecallPrewarmMeta.qualityGatePasses += 1;
                    break;
                }
                if (rounds >= lightExpandMaxRounds) {
                    earlyStop = true;
                    reasonZh = `质量闸：已达最大扩窗轮次 ${lightExpandMaxRounds}，仍偏少（候选 ${candCount}），早停`;
                    gateZh = reasonZh;
                    annRecallPrewarmMeta.qualityGateEarlyStops += 1;
                    break;
                }
                gateZh = `质量闸续扩：候选 ${candCount} 仍 < ${lightExpandMin}，增益 ${added}、多样性 ${diversity} 可接受`;
            }
            return {
                nnCapIds,
                nnOutIds,
                expanded: expandedAny,
                added: totalAdded,
                earlyStop,
                rounds,
                gateZh,
                reasonZh,
            };
        };
        const dedupeCandidates = (list) => {
            const seen = new Set();
            const out = [];
            for (const c of list) {
                const k = `${c.kind}:${c.id}`;
                if (seen.has(k)) {
                    annRecallPrewarmMeta.deduped += 1;
                    continue;
                }
                seen.add(k);
                out.push(c);
            }
            return out;
        };
        const kickOverlapPrewarm = () => {
            if (overlapPrewarmBusy)
                return;
            if (!overlapPrewarmQueue.length && !overlapPrewarmBusy)
                return;
            overlapPrewarmBusy = true;
            overlapPrewarmDrain = (async () => {
                try {
                    while (true) {
                        if (latchCancel()) {
                            while (overlapPrewarmQueue.length) {
                                const id = overlapPrewarmQueue.shift();
                                if (id)
                                    overlapPrewarmAgg.remainingIds.push(id);
                            }
                            overlapPrewarmAgg.resumeAvailable = overlapPrewarmAgg.remainingIds.length > 0;
                            overlapPrewarmAgg.skippedCancel += 1;
                            break;
                        }
                        const batch = overlapPrewarmQueue.splice(0, Math.min(overlapPrewarmQueue.length, 40));
                        if (!batch.length)
                            break;
                        if (!firstOverlapPrewarmAt)
                            firstOverlapPrewarmAt = Date.now();
                        await reportProgress({
                            percent: Math.min(97, Math.round((finishedCount / Math.max(demandTotal, 1)) * 100) + 2),
                            phase: 'prewarm',
                            step: 'pipeline-overlap-prewarm',
                            bannerZh: `流水线重叠预热：写库尾并行一页纸/解释（本批 ${batch.length} · 队列余 ${overlapPrewarmQueue.length}）…`,
                            hintZh: '软取消同时停写库与预热；已预热保留，剩余进可续跑队列。',
                            demandIndex: finishedCount,
                            demandTotal,
                            matchedOrgIds: [...matchedOrgIds],
                        });
                        const r = await this.prewarmTopNOnePagers(batch, {
                            cancelCheck: latchCancel,
                            tier: 'partner',
                            tenantId: 'default',
                            alsoExplainCore: true,
                            queueId: overlapPrewarmAgg.queueId || undefined,
                        });
                        overlapPrewarmAgg.requested += r.requested;
                        overlapPrewarmAgg.warmed += r.warmed;
                        overlapPrewarmAgg.warmedExplainCore += r.warmedExplainCore;
                        overlapPrewarmAgg.skippedCancel += r.skippedCancel;
                        overlapPrewarmAgg.errors += r.errors;
                        if (r.remainingIds?.length)
                            overlapPrewarmAgg.remainingIds.push(...r.remainingIds);
                        overlapPrewarmAgg.resumeAvailable = overlapPrewarmAgg.remainingIds.length > 0;
                        overlapPrewarmAgg.queueId = r.queueId || overlapPrewarmAgg.queueId;
                        overlapPrewarmAgg.tipZh = r.tipZh;
                        overlapPrewarmAgg.wave = 'M69';
                    }
                }
                finally {
                    overlapPrewarmBusy = false;
                    overlapPrewarmFinishedAt = Date.now();
                    overlapPrewarmDrain = null;
                    if (overlapPrewarmQueue.length && !latchCancel())
                        kickOverlapPrewarm();
                }
            })();
        };
        const enqueueOverlapPrewarm = (matchIds) => {
            if (!matchIds.length || latchCancel())
                return;
            for (const id of matchIds) {
                if (!id || overlapSeenIds.has(id))
                    continue;
                overlapSeenIds.add(id);
                overlapPrewarmQueue.push(id);
            }
            kickOverlapPrewarm();
        };
        const scoreDemandCandidates = (d, demb, candidates) => {
            const scoredAll = [];
            for (let i = 0; i < candidates.length; i += SCORE_CHUNK) {
                if (latchCancel()) {
                    return { scored: [], cancelledMid: true };
                }
                const slice = candidates.slice(i, i + SCORE_CHUNK);
                for (const c of slice) {
                    const r = scorePair({
                        demandText: [d.title, d.problem, d.expectedOut].join(' '),
                        demandKeywords: d.industry,
                        demandIndustry: d.industry,
                        demandRegion: d.regionPref,
                        supplyText: c.text,
                        supplyKeywords: c.keywords,
                        supplyDisciplines: c.disciplines,
                        supplyRegion: c.region,
                        trl: c.trl,
                        rights: c.rights,
                        ipOwnership: c.ipOwnership,
                        licenseOpenness: c.licenseOpenness,
                        readinessBand: c.readinessBand,
                        trustBadges: c.trustBadges,
                        qualityScore: c.qualityScore,
                        licenseNeed: d.licenseNeed,
                        minTrl: d.minTrl,
                        demandExpectedOut: d.expectedOut,
                        demandProblem: d.problem,
                        demandTitle: d.title,
                        supplyTitle: c.title,
                        demandTaxonomy: d.taxonomyCodes || [],
                        supplyTaxonomy: c.taxonomyCodes || [],
                        demandEmb: demb,
                        supplyEmb: c.emb,
                        weights: learnedWeights,
                    });
                    const sliceKey = (d.taxonomyCodes && d.taxonomyCodes[0]) || (d.industry && d.industry[0]) || 'unspecified';
                    const slice = coverageBySlice.get(sliceKey);
                    const dossier = buildMatchDossier({
                        breakdown: r.breakdown,
                        total: r.total,
                        demandKind: d.demandKind,
                        demandTitle: d.title,
                        demandProblem: d.problem,
                        trl: c.trl,
                        licenseOpenness: c.licenseOpenness,
                        supplyPublished: true,
                        supplyId: c.id,
                        supplyTitle: c.title,
                        supplyKind: c.kind,
                        overlap: r.breakdown?.taxonomyOverlap,
                        sliceKey,
                        sliceStage: slice?.stage || 'accumulating',
                        primaryPersonId: c.personId || null,
                        demandThin: !d.problem || String(d.problem).length < 40,
                        embeddingMode: r.breakdown?.embeddingMode,
                        modelMismatch: Boolean(d.embeddingModel && c.embeddingModel && d.embeddingModel !== c.embeddingModel),
                        fresh: Boolean(c.sourceUpdatedAt) && (Date.now() - new Date(c.sourceUpdatedAt).getTime()) <= 45 * 86400000,
                        hasContact: false,
                    });
                    r.breakdown = Object.assign({}, r.breakdown, {
                        action: dossier.action,
                        collabMode: dossier.collabMode,
                        collabModeLabel: dossier.collabModeLabel,
                        evidence: dossier.evidence,
                        confidence: dossier.confidence,
                        blockers: dossier.blockers,
                        sliceKey: dossier.sliceKey,
                        sliceStage: dossier.sliceStage,
                        demandKind: dossier.demandKind,
                        ruleVersion: dossier.ruleVersion,
                    });
                    if (dossier.reasonSuffix && !String(r.reason || '').includes('证据：')) {
                        r.reason = `${r.reason || ''}${dossier.reasonSuffix}`;
                    }
                    scoredAll.push({ c, ...r, primaryPersonId: dossier.primaryPersonId });
                }
            }
            const filtered = scoredAll
                .filter((x) => x.breakdown.hardPass && x.total >= minScore)
                .sort((a, b) => b.total - a.total);
            if (latchCancel()) {
                return { scored: [], cancelledMid: true };
            }
            let scored = filtered.slice(0, topN);
            if (topNDiversityRerankOn && filtered.length > topN) {
                const poolSize = Math.min(filtered.length, Math.max(topN + 1, Math.ceil(topN * topNDiversityPoolFactor)));
                const pool = filtered.slice(0, poolSize);
                const naiveTop = filtered.slice(0, topN);
                const picked = [];
                const usedOrg = new Map();
                const usedKind = new Map();
                const remaining = pool.map((x, i) => ({ x, i }));
                const pickExplain = [];
                while (picked.length < topN && remaining.length) {
                    if (latchCancel()) {
                        return { scored: [], cancelledMid: true };
                    }
                    let bestIdx = 0;
                    let bestAdj = -Infinity;
                    for (let ri = 0; ri < remaining.length; ri++) {
                        const cand = remaining[ri].x;
                        const orgKey = String(cand.c.orgId || cand.c.orgName || '');
                        const kindKey = String(cand.c.kind || '');
                        const orgPen = (usedOrg.get(orgKey) || 0) * topNDiversityOrgPenalty;
                        const kindPen = (usedKind.get(kindKey) || 0) * topNDiversityKindPenalty;
                        const adj = cand.total - orgPen - kindPen;
                        if (adj > bestAdj) {
                            bestAdj = adj;
                            bestIdx = ri;
                        }
                    }
                    const chosen = remaining.splice(bestIdx, 1)[0].x;
                    picked.push(chosen);
                    const orgKey = String(chosen.c.orgId || chosen.c.orgName || '');
                    const kindKey = String(chosen.c.kind || '');
                    if (orgKey)
                        usedOrg.set(orgKey, (usedOrg.get(orgKey) || 0) + 1);
                    if (kindKey)
                        usedKind.set(kindKey, (usedKind.get(kindKey) || 0) + 1);
                }
                const pickedKeys = new Set(picked.map((p) => String(p.c.id) + ':' + String(p.c.kind || '')));
                const naiveKeys = new Set(naiveTop.map((p) => String(p.c.id) + ':' + String(p.c.kind || '')));
                const demoted = naiveTop.filter((p) => !pickedKeys.has(String(p.c.id) + ':' + String(p.c.kind || '')));
                const promoted = picked.filter((p) => !naiveKeys.has(String(p.c.id) + ':' + String(p.c.kind || '')));
                for (let di = 0; di < demoted.length; di++) {
                    const dem = demoted[di];
                    const demOrg = String(dem.c.orgName || dem.c.orgId || '同机构');
                    const demOrgKey = String(dem.c.orgId || dem.c.orgName || '');
                    const sameOrgPromoted = promoted.find((p) => String(p.c.orgId || p.c.orgName || '') === demOrgKey && demOrgKey) || promoted[di] || promoted[0];
                    const orgCountInPicked = demOrgKey
                        ? picked.filter((p) => String(p.c.orgId || p.c.orgName || '') === demOrgKey).length
                        : 0;
                    const orgPenApplied = Math.max(1, orgCountInPicked) * topNDiversityOrgPenalty;
                    const kindPenApplied = (usedKind.get(String(dem.c.kind || '')) || 0) * topNDiversityKindPenalty;
                    const replacedTitle = sameOrgPromoted
                        ? String(sameOrgPromoted.c.title || '').slice(0, 40)
                        : '其它机构候选';
                    const replacedOrg = sameOrgPromoted
                        ? String(sameOrgPromoted.c.orgName || sameOrgPromoted.c.orgId || '')
                        : '';
                    const reasonZh = demOrgKey
                        ? `为何替下同机构：朴素 TopN 中的「${String(dem.c.title || '').slice(0, 36)}」（${demOrg}）因同机构已入选 ${orgCountInPicked} 条、机构罚 ${topNDiversityOrgPenalty}×≈${Math.round(orgPenApplied * 1000) / 1000}，被「${replacedTitle}」${replacedOrg ? '（' + replacedOrg + '）' : ''}替下，以拉开机构多样性。`
                        : `为何替下：朴素 TopN 中的「${String(dem.c.title || '').slice(0, 36)}」经机构/类型惩罚后未进最终 TopN，由「${replacedTitle}」替入。`;
                    pickExplain.push({
                        demotedTitle: String(dem.c.title || '').slice(0, 80),
                        demotedOrg: demOrg,
                        replacedByTitle: replacedTitle,
                        replacedByOrg: replacedOrg,
                        reasonZh,
                        orgPenaltyApplied: Math.round(orgPenApplied * 1000) / 1000,
                        kindPenaltyApplied: Math.round(kindPenApplied * 1000) / 1000,
                    });
                }
                for (const p of picked) {
                    const key = String(p.c.id) + ':' + String(p.c.kind || '');
                    const related = pickExplain.filter((e) => e.replacedByTitle === String(p.c.title || '').slice(0, 40) ||
                        (String(p.c.orgId || p.c.orgName || '') &&
                            e.demotedOrg === String(p.c.orgName || p.c.orgId || '')));
                    const keptSameOrgCount = picked.filter((x) => String(x.c.orgId || x.c.orgName || '') ===
                        String(p.c.orgId || p.c.orgName || '')).length;
                    const snippetZh = related[0]?.reasonZh ||
                        (keptSameOrgCount > 1
                            ? `多样性保留：同机构「${String(p.c.orgName || p.c.orgId || '')}」已占 ${keptSameOrgCount}/${topN}，后续同机构将被罚分。`
                            : `多样性入选：机构「${String(p.c.orgName || p.c.orgId || '—')}」在 TopN 中首现，未触发同机构罚分。`);
                    const bd = { ...(p.breakdown || {}) };
                    bd.diversityExplain = {
                        wave: 'M74',
                        demotedSameOrg: pickExplain.filter((e) => e.demotedOrg === String(p.c.orgName || p.c.orgId || '') ||
                            e.replacedByTitle === String(p.c.title || '').slice(0, 40)),
                        reasonSnippetsZh: related.length
                            ? related.map((e) => e.reasonZh)
                            : [snippetZh],
                        tipZh: snippetZh,
                        orgPenalty: topNDiversityOrgPenalty,
                        kindPenalty: topNDiversityKindPenalty,
                    };
                    p.breakdown = bd;
                }
                scored = picked;
                annRecallPrewarmMeta.diversityReranked += 1;
                annRecallPrewarmMeta.diversityOrgUnique += usedOrg.size;
                annRecallPrewarmMeta.diversityKindUnique += usedKind.size;
                annRecallPrewarmMeta.diversityDemoted += demoted.length;
                for (const e of pickExplain.slice(0, 6)) {
                    if (annRecallPrewarmMeta.diversityExplainSamples.length < 24) {
                        annRecallPrewarmMeta.diversityExplainSamples.push(e);
                    }
                }
                if (annRecallPrewarmMeta.diversityContrastSamples.length < 12) {
                    const mapRow = (p) => ({
                        id: String(p.c.id || ''),
                        title: String(p.c.title || '').slice(0, 48),
                        org: String(p.c.orgName || p.c.orgId || ''),
                        kind: String(p.c.kind || ''),
                        score: Math.round(Number(p.total) * 1000) / 1000,
                    });
                    const naiveRows = naiveTop.map(mapRow);
                    const divRows = picked.map(mapRow);
                    const demotedIds = demoted.map((p) => String(p.c.id || ''));
                    const promotedIds = promoted.map((p) => String(p.c.id || ''));
                    const tipZh = demotedIds.length || promotedIds.length
                        ? `旁路对照：朴素 TopN ${naiveRows.length} 条 vs 多样性 TopN ${divRows.length} 条 · 替下 ${demotedIds.length} · 替入 ${promotedIds.length}`
                        : `旁路对照：朴素与多样性 TopN 一致（${divRows.length} 条，无替下）`;
                    const maxN = Math.max(naiveRows.length, divRows.length);
                    const foldableRows = [];
                    for (let i = 0; i < maxN; i++) {
                        const n = naiveRows[i] || null;
                        const d = divRows[i] || null;
                        let changedZh = '一致';
                        if (!n && d)
                            changedZh = '多样性替入';
                        else if (n && !d)
                            changedZh = '朴素独有';
                        else if (n && d && n.id !== d.id)
                            changedZh = '已替换';
                        foldableRows.push({ rank: i + 1, naive: n, diversity: d, changedZh });
                    }
                    const foldableTable = {
                        foldable: true,
                        defaultOpen: false,
                        summaryZh: tipZh,
                        labelZh: '旁路对照表（可折叠）',
                        columnsZh: {
                            rank: '名次',
                            naive: '朴素 TopN',
                            diversity: '多样性 TopN',
                            changed: '变化',
                        },
                        rows: foldableRows,
                        tipZh: '点击展开并排对照朴素 TopN 与多样性 TopN；软取消仍可中断打分/重排。',
                    };
                    annRecallPrewarmMeta.diversityContrastSamples.push({
                        naiveTopN: naiveRows,
                        diversityTopN: divRows,
                        demotedIds,
                        promotedIds,
                        tipZh,
                        foldableTable,
                    });
                    for (const p of picked) {
                        const bd = { ...(p.breakdown || {}) };
                        const prev = bd.diversityExplain || {};
                        bd.diversityExplain = {
                            ...prev,
                            wave: 'M75',
                            bypassContrast: {
                                labelZh: '朴素 TopN vs 多样性 TopN 旁路对照',
                                naiveTopN: naiveRows,
                                diversityTopN: divRows,
                                demotedIds,
                                promotedIds,
                                tipZh,
                                foldableTable,
                                foldableTableLabelZh: '旁路对照表（可折叠）',
                            },
                        };
                        p.breakdown = bd;
                    }
                }
            }
            return { scored, cancelledMid: false };
        };
        const processOneDemand = async (d, ordinal) => {
            if (latchCancel())
                return;
            if (completedSet.has(d.id)) {
                const prev = demandCheckpoints.get(d.id);
                if (prev && (prev.phase === 'done' || prev.phase === 'skipped')) {
                    return;
                }
                markDemandCheckpoint(d.id, prev?.phase === 'skipped' ? 'skipped' : 'done', {
                    title: String(d.title || prev?.title || ''),
                    clearWriteSnapshot: true,
                });
                return;
            }
            const prevCk = demandCheckpoints.get(d.id);
            const unfinishedPhase = phaseResumeMeta.enabled &&
                prevCk &&
                prevCk.phase !== 'done' &&
                prevCk.phase !== 'skipped' &&
                prevCk.phase !== 'pending'
                ? prevCk.phase
                : null;
            let phaseResumeMode = 'none';
            let scoredFromSnapshot = null;
            const resolvedSnapForWrite = resolvePersistedWriteSnapshot(prevCk);
            if (unfinishedPhase === 'write' && Array.isArray(resolvedSnapForWrite) && resolvedSnapForWrite.length) {
                const verify = verifyWriteSnapshotAgainstPhase(prevCk);
                phaseResumeMeta.lastVerifyTipZh = verify.reasonZh;
                if (verify.ok) {
                    try {
                        const vsBase = compareWriteSnapshotAgainstBaseFrame(ckTenantId, {
                            rows: verify.rows || resolvedSnapForWrite,
                            checksum: verify.checksum || null,
                            phase: 'write',
                            count: resolvedSnapForWrite.length,
                            demandId: d.id,
                        });
                        phaseResumeMeta.writeSnapshotBaseFrame = {
                            matched: vsBase.matched,
                            hasBaseFrame: vsBase.hasBaseFrame,
                            tipZh: vsBase.tipZh,
                            reasonZh: vsBase.reasonZh,
                            wave: 'M84',
                        };
                        if (vsBase.hasBaseFrame) {
                            phaseResumeMeta.lastVerifyTipZh =
                                (verify.reasonZh || '') + (vsBase.matched ? ' · 基帧对照通过' : ' · ' + vsBase.reasonZh);
                        }
                    }
                    catch (_) { }
                    phaseResumeMode = 'write';
                    phaseResumeMeta.resumedByPhase.write += 1;
                    phaseResumeMeta.writeFromSnapshot += 1;
                    phaseResumeMeta.writeSnapshotVerified += 1;
                    phaseResumeMeta.skippedRecall += 1;
                    phaseResumeMeta.skippedScore += 1;
                    scoredFromSnapshot = resolvedSnapForWrite.map((row) => ({
                        c: {
                            kind: (row.kind === 'outcome' ? 'outcome' : 'capability'),
                            id: row.id,
                            title: row.title || '',
                            orgName: row.orgName || '',
                            orgId: row.orgId || '',
                            region: null,
                            keywords: [],
                            disciplines: [],
                            text: '',
                            emb: null,
                            trl: null,
                            rights: null,
                            ipOwnership: null,
                            licenseOpenness: null,
                            readinessBand: null,
                            trustBadges: [],
                            qualityScore: null,
                            taxonomyCodes: [],
                        },
                        total: Number(row.total) || 0,
                        breakdown: row.breakdown || {},
                        reason: String(row.reason || ''),
                    }));
                    phaseResumeMeta.tipZh = `按 phase 续跑：写库快照已校验 ${scoredFromSnapshot.length} 条 · 跳过召回/打分 · ${verify.checksum?.slice(0, 8) || ''}…`;
                }
                else {
                    phaseResumeMeta.writeSnapshotMismatchFallback += 1;
                    phaseResumeMode = 'score';
                    phaseResumeMeta.resumedByPhase.score += 1;
                    phaseResumeMeta.tipZh = `写库快照校验失败，回退重打分/写库：${verify.reasonZh}`;
                    await reportProgress({
                        percent: Math.min(95, Math.round((finishedCount / demandTotal) * 100) + 2),
                        phase: 'score',
                        step: 'write-snapshot-verify-fallback',
                        bannerZh: `写库快照校验失败 · 需求「${String(d.title || '').slice(0, 28)}」回退重打分`,
                        hintZh: verify.reasonZh + '；软取消仍可用。',
                        demandIndex: finishedCount,
                        demandTotal,
                        matchedOrgIds: [...matchedOrgIds],
                    });
                }
            }
            else if (unfinishedPhase === 'score' || unfinishedPhase === 'write') {
                phaseResumeMode = 'score';
                phaseResumeMeta.resumedByPhase.score += 1;
                phaseResumeMeta.skippedRecall += unfinishedPhase === 'score' ? 0 : 0;
                phaseResumeMeta.tipZh = `按 phase 续跑：自打分阶段（跳过已完成召回标记，仍用 ANN 池）`;
            }
            else if (unfinishedPhase === 'recall') {
                phaseResumeMode = 'recall';
                phaseResumeMeta.resumedByPhase.recall += 1;
                phaseResumeMeta.tipZh = `按 phase 续跑：自召回阶段`;
            }
            if (!unfinishedPhase) {
                markDemandCheckpoint(d.id, 'pending', { title: String(d.title || '') });
            }
            const phaseBannerExtra = phaseResumeMode !== 'none'
                ? ` · 续跑自${phaseResumeMode === 'write' ? '写库' : phaseResumeMode === 'score' ? '打分' : '召回'}`
                : '';
            await reportProgress({
                percent: Math.min(95, Math.round((finishedCount / demandTotal) * 100) + 2),
                phase: phaseResumeMode === 'write' ? 'write' : phaseResumeMode === 'score' ? 'score' : 'demand',
                step: phaseResumeMode !== 'none' ? `phase-resume-${phaseResumeMode}` : 'demand',
                bannerZh: `并行匹配（${liveParallel}路自适应）· 需求 ${ordinal + 1}/${demands.length}：${String(d.title || '').slice(0, 36)}${phaseBannerExtra}`,
                hintZh: (phaseResumeMode !== 'none' ? phaseResumeMeta.tipZh + '；' : '') +
                    `打分按候选块（${SCORE_CHUNK}）可取消；${bp.progressZh()}；ANN池×${liveAnnPrewarmN}；可分项停嵌入或打分；全停仍同停。`,
                demandIndex: finishedCount,
                demandTotal,
                itemizedPhases: buildItemizedPhases(phaseResumeMode === 'write' ? 'write' : phaseResumeMode === 'score' ? 'score' : 'ann-pool', {
                    'ann-pool': phaseResumeMode === 'write' || phaseResumeMode === 'score'
                        ? 'phase续跑跳过/复用'
                        : `需求 ${ordinal + 1}/${demands.length}`,
                    score: softCancelToken.stopScore
                        ? '已分项停打分'
                        : phaseResumeMode === 'write'
                            ? '快照跳过'
                            : '等待',
                }),
                cancelScopesAvailable: ['embed', 'score', 'all'],
            });
            if ((d.publishStatus && d.publishStatus !== 'published') || d.extensions?.quarantine || shared.isDemoSource(d.extensions?.source)) {
                skippedQuarantine++;
                if (skippedDemandSamples.length < 8) {
                    skippedDemandSamples.push({
                        id: d.id,
                        title: d.title,
                        reason: String(d.extensions?.quarantineReason || 'quarantine'),
                    });
                }
                markDemandCheckpoint(d.id, 'skipped', { title: String(d.title || '') });
                completedDemandIds.push(d.id);
                completedSet.add(d.id);
                finishedCount += 1;
                return;
            }
            let scored = [];
            let recallMs = prevCk?.recallMs ?? null;
            let scoreMs = prevCk?.scoreMs ?? null;
            if (phaseResumeMode === 'write' && scoredFromSnapshot) {
                scored = scoredFromSnapshot;
                await reportProgress({
                    percent: Math.min(96, Math.round(((finishedCount + 0.65) / demandTotal) * 100)),
                    phase: 'write',
                    step: 'phase-resume-write-snapshot',
                    bannerZh: `续跑写库 ${ordinal + 1}/${demands.length} · 快照 TopN ${scored.length}`,
                    hintZh: phaseResumeMeta.tipZh + '；软取消仍可用。',
                    demandIndex: finishedCount + 1,
                    demandTotal,
                    matchedOrgIds: [...matchedOrgIds],
                });
            }
            else {
                kickDemandEmbedLookahead(ordinal);
                kickAnnRecallPrewarm(ordinal);
                if (demandLookaheadOn || annPrewarmOn) {
                    await reportProgress({
                        percent: Math.min(95, Math.round((finishedCount / demandTotal) * 100) + 3),
                        phase: 'demand',
                        step: 'demand-embed-lookahead-ann-prewarm',
                        bannerZh: (demandLookaheadOn ? `需求嵌入 lookahead×${demandLookaheadN}` : '嵌入即时') +
                            (annPrewarmOn ? ` · ANN 预热池×${annPrewarmN}` : ''),
                        hintZh: demandEmbedLookaheadMeta.tipZh +
                            '；' +
                            annRecallPrewarmMeta.tipZh +
                            '；' +
                            bp.progressZh(),
                        demandIndex: finishedCount,
                        demandTotal,
                    });
                }
                const dembGot = await ensureDemandEmbed(d);
                if (!dembGot || latchCancel())
                    return;
                const demb = dembGot;
                kickAnnRecallPrewarm(ordinal);
                if (latchCancel())
                    return;
                const recallStartedAt = Date.now();
                let candidates = [];
                const annTook = await takeAnnFromPool(d, demb);
                const nnCapIds = annTook.nnCapIds;
                const nnOutIds = annTook.nnOutIds;
                for (const c of caps) {
                    if (c.orgId === d.orgId)
                        continue;
                    if ((c.publishStatus && c.publishStatus !== 'published') || c.extensions?.quarantine || shared.isDemoSource(c.extensions?.source)) {
                        skippedSupplyQuarantine++;
                        if (skippedSupplySamples.length < 10) {
                            skippedSupplySamples.push({
                                kind: 'capability',
                                id: c.id,
                                title: c.title,
                                reason: c.publishStatus && c.publishStatus !== 'published'
                                    ? 'unpublished'
                                    : String(c.extensions?.quarantineReason || 'quarantine'),
                            });
                        }
                        continue;
                    }
                    if (nnCapIds && !nnCapIds.has(c.id) && caps.length > 60)
                        continue;
                    const packed = supplyPack.caps.get(c.id);
                    if (!packed)
                        continue;
                    candidates.push({
                        kind: 'capability',
                        id: c.id,
                        title: c.title,
                        orgName: c.org.name,
                        orgId: c.orgId,
                        region: c.org.region,
                        keywords: c.keywords,
                        disciplines: c.disciplines,
                        text: packed.text,
                        emb: packed.emb,
                        trl: c.trl,
                        rights: c.rights,
                        ipOwnership: c.ipOwnership,
                        licenseOpenness: c.licenseOpenness,
                        readinessBand: c.readinessBand,
                        trustBadges: packed.trustBadges,
                        qualityScore: c.org?.qualityScore ?? null,
                        taxonomyCodes: c.taxonomyCodes || [],
                        personId: c.personId || null,
                        sourceUpdatedAt: c.sourceUpdatedAt || null,
                    });
                }
                for (const o of outs) {
                    if (o.orgId === d.orgId)
                        continue;
                    if ((o.publishStatus && o.publishStatus !== 'published') || o.extensions?.quarantine || shared.isDemoSource(o.extensions?.source)) {
                        skippedSupplyQuarantine++;
                        if (skippedSupplySamples.length < 10) {
                            skippedSupplySamples.push({
                                kind: 'outcome',
                                id: o.id,
                                title: o.title,
                                reason: String(o.extensions?.quarantineReason || 'quarantine'),
                            });
                        }
                        continue;
                    }
                    if (nnOutIds && !nnOutIds.has(o.id) && outs.length > 60)
                        continue;
                    const packed = supplyPack.outs.get(o.id);
                    if (!packed)
                        continue;
                    candidates.push({
                        kind: 'outcome',
                        id: o.id,
                        title: o.title,
                        orgName: o.org.name,
                        orgId: o.orgId,
                        region: o.org.region,
                        keywords: o.ipcOrDisc,
                        disciplines: o.ipcOrDisc,
                        text: packed.text,
                        emb: packed.emb,
                        trl: o.trl,
                        rights: o.rights,
                        ipOwnership: o.ipOwnership,
                        licenseOpenness: o.licenseOpenness,
                        readinessBand: o.readinessBand,
                        trustBadges: packed.trustBadges,
                        qualityScore: o.org?.qualityScore ?? null,
                        taxonomyCodes: o.taxonomyCodes || [],
                        personId: o.personId || null,
                        sourceUpdatedAt: o.sourceUpdatedAt || null,
                    });
                }
                let annExpanded = false;
                let annExpandEarlyStop = false;
                let annExpandGateZh = '';
                if (lightExpandOn &&
                    !latchCancel() &&
                    (candidates.length < lightExpandMin ||
                        ((annTook.nnCapIds == null || annTook.nnCapIds.size === 0) &&
                            (annTook.nnOutIds == null || annTook.nnOutIds.size === 0)))) {
                    const candOrgs = new Set(candidates.map((c) => String(c.orgId || '')).filter(Boolean));
                    const expanded = await lightExpandAnnIds(d, demb, { nnCapIds: annTook.nnCapIds, nnOutIds: annTook.nnOutIds, baseLimit: annTook.baseLimit }, candidates.length, candOrgs);
                    annExpandEarlyStop = Boolean(expanded.earlyStop);
                    annExpandGateZh = expanded.gateZh || expanded.reasonZh || '';
                    if (expanded.expanded && !latchCancel()) {
                        annExpanded = true;
                        const nnCapIds2 = expanded.nnCapIds;
                        const nnOutIds2 = expanded.nnOutIds;
                        const haveIds = new Set(candidates.map((c) => `${c.kind}:${c.id}`));
                        for (const c of caps) {
                            if (c.orgId === d.orgId)
                                continue;
                            if ((c.publishStatus && c.publishStatus !== 'published') || c.extensions?.quarantine || shared.isDemoSource(c.extensions?.source))
                                continue;
                            if (nnCapIds2 && !nnCapIds2.has(c.id) && caps.length > 60)
                                continue;
                            const packed = supplyPack.caps.get(c.id);
                            if (!packed)
                                continue;
                            const key = `capability:${c.id}`;
                            if (haveIds.has(key))
                                continue;
                            haveIds.add(key);
                            candidates.push({
                                kind: 'capability',
                                id: c.id,
                                title: c.title,
                                orgName: c.org.name,
                                orgId: c.orgId,
                                region: c.org.region,
                                keywords: c.keywords,
                                disciplines: c.disciplines,
                                text: packed.text,
                                emb: packed.emb,
                                trl: c.trl,
                                rights: c.rights,
                                ipOwnership: c.ipOwnership,
                                licenseOpenness: c.licenseOpenness,
                                readinessBand: c.readinessBand,
                                trustBadges: packed.trustBadges,
                                qualityScore: c.org?.qualityScore ?? null,
                                taxonomyCodes: c.taxonomyCodes || [],
                                personId: c.personId || null,
                        sourceUpdatedAt: c.sourceUpdatedAt || null,
                                embeddingModel: c.embeddingModel || null,
                            });
                        }
                        for (const o of outs) {
                            if (o.orgId === d.orgId)
                                continue;
                            if ((o.publishStatus && o.publishStatus !== 'published') || o.extensions?.quarantine || shared.isDemoSource(o.extensions?.source))
                                continue;
                            if (nnOutIds2 && !nnOutIds2.has(o.id) && outs.length > 60)
                                continue;
                            const packed = supplyPack.outs.get(o.id);
                            if (!packed)
                                continue;
                            const key = `outcome:${o.id}`;
                            if (haveIds.has(key))
                                continue;
                            haveIds.add(key);
                            candidates.push({
                                kind: 'outcome',
                                id: o.id,
                                title: o.title,
                                orgName: o.org.name,
                                orgId: o.orgId,
                                region: o.org.region,
                                keywords: o.ipcOrDisc,
                                disciplines: o.ipcOrDisc,
                                text: packed.text,
                                emb: packed.emb,
                                trl: o.trl,
                                rights: o.rights,
                                ipOwnership: o.ipOwnership,
                                licenseOpenness: o.licenseOpenness,
                                readinessBand: o.readinessBand,
                                trustBadges: packed.trustBadges,
                                qualityScore: o.org?.qualityScore ?? null,
                                taxonomyCodes: o.taxonomyCodes || [],
                                personId: o.personId || null,
                        sourceUpdatedAt: o.sourceUpdatedAt || null,
                                embeddingModel: o.embeddingModel || null,
                            });
                        }
                    }
                }
                const beforeDedup = candidates.length;
                candidates = dedupeCandidates(candidates);
                recallMs = Date.now() - recallStartedAt;
                markDemandCheckpoint(d.id, 'recall', { title: String(d.title || ''), recallMs });
                noteAnnPoolOutcome(Boolean(annTook.fromPool), recallMs, d.id, String(d.title || ""));
                bp.noteRecallLatency(recallMs);
                liveParallel = bp.state.parallel;
                liveWriteShard = bp.state.writeShard;
                await reportProgress({
                    percent: Math.min(96, Math.round((finishedCount / demandTotal) * 100) + 4),
                    phase: 'score',
                    step: 'score-chunk',
                    bannerZh: `打分 ${ordinal + 1}/${demands.length} · 候选 ${candidates.length}` +
                        (beforeDedup !== candidates.length ? `（去重前 ${beforeDedup}）` : '') +
                        `（块 ${SCORE_CHUNK}）· 召回 ${recallMs}ms` +
                        (annTook.fromPool ? ' · ANN池命中' : '') +
                        (annExpanded ? ' · 轻量扩窗' : '') +
                        (annExpandEarlyStop ? ' · 质量闸早停' : ''),
                    hintZh: `块与块之间可取消；${bp.progressZh()}；可仅停打分或全停；中页取消仍可用。` +
                        (annExpandGateZh ? ' ' + annExpandGateZh : ''),
                    demandIndex: finishedCount,
                    demandTotal,
                    matchedOrgIds: [...matchedOrgIds],
                    itemizedPhases: buildItemizedPhases('score', {
                        'score': `候选 ${candidates.length} · 召回 ${recallMs}ms`,
                        'ann-pool': annTook.fromPool ? '池命中' : '即时召回',
                    }),
                    cancelScopesAvailable: ['embed', 'score', 'all'],
                });
                const scoreStartedAt = Date.now();
                const scoredPack = scoreDemandCandidates(d, demb, candidates);
                const cancelledMid = scoredPack.cancelledMid;
                scored = scoredPack.scored;
                scoreMs = Date.now() - scoreStartedAt;
                markDemandCheckpoint(d.id, 'score', { title: String(d.title || ''), recallMs, scoreMs });
                bp.noteScoreLatency(scoreMs);
                liveParallel = bp.state.parallel;
                liveWriteShard = bp.state.writeShard;
                if (cancelledMid || latchCancel()) {
                    cancelLatched = true;
                    await reportProgress({
                        percent: Math.min(99, Math.round((finishedCount / demandTotal) * 100)),
                        phase: 'cancelled',
                        step: 'cancel-score-chunk',
                        bannerZh: `已取消：需求「${String(d.title || '').slice(0, 28)}」打分块中停下（未写入）`,
                        hintZh: '本条未落库；已完成的需求保留，可按剩余 demandIds 续跑。',
                        demandIndex: finishedCount,
                        demandTotal,
                        cancelled: true,
                        matchedOrgIds: [...matchedOrgIds],
                    });
                    return;
                }
            }
            const writeSnapshotRaw = scored.map((s) => ({
                kind: String(s.c.kind),
                id: String(s.c.id),
                orgId: s.c.orgId || null,
                title: String(s.c.title || ''),
                orgName: String(s.c.orgName || ''),
                total: s.total,
                breakdown: s.breakdown,
                reason: s.reason || '',
            }));
            const snapPack = buildWriteSnapshotPersist(writeSnapshotRaw, {
                rows: demandCheckpoints.get(d.id)?.writeSnapshot || null,
                meta: demandCheckpoints.get(d.id)?.writeSnapshotMeta || null,
            });
            const writeSnapshot = snapPack.writeSnapshot;
            markDemandCheckpoint(d.id, 'write', {
                title: String(d.title || ''),
                recallMs,
                scoreMs,
                writeSnapshot: writeSnapshot,
                writeSnapshotMeta: snapPack.writeSnapshotMeta,
                writeSnapshotIncremental: snapPack.writeSnapshotIncremental,
                writeSnapshotPrev: demandCheckpoints.get(d.id)?.writeSnapshot ?? null,
            });
            if (snapPack.writeSnapshotMeta.compressed)
                phaseResumeMeta.writeSnapshotCompressed += 1;
            if (snapPack.writeSnapshotMeta.incremental)
                phaseResumeMeta.writeSnapshotIncremental += 1;
            phaseResumeMeta.writeSnapshotBytesSaved += Math.max(0, Number(snapPack.writeSnapshotMeta.bytesBefore || 0) - Number(snapPack.writeSnapshotMeta.bytesAfter || 0));
            try {
                const frame = persistWriteSnapshotBaseFrame(ckTenantId, {
                    demandId: d.id,
                    rows: writeSnapshot,
                    checksum: snapPack.writeSnapshotMeta.checksum,
                    count: writeSnapshot.length,
                    runId: String(opts?.runId || opts?.jobId || '') || null,
                });
                phaseResumeMeta.writeSnapshotBaseFramePersisted = {
                    checksum: frame.checksum,
                    count: frame.count,
                    tipZh: frame.tipZh,
                    wave: 'M84',
                };
            }
            catch (_) { }
            await reportProgress({
                percent: Math.min(96, Math.round(((finishedCount + 0.65) / demandTotal) * 100)),
                phase: 'write',
                step: 'write-matches',
                bannerZh: `写入匹配 ${ordinal + 1}/${demands.length}（TopN ${scored.length}` +
                    (topNDiversityRerankOn ? ' · 多样性重排' : '') +
                    (snapPack.writeSnapshotMeta.compressed || snapPack.writeSnapshotMeta.incremental
                        ? ' · 快照压缩/增量'
                        : '') +
                    `）`,
                hintZh: (snapPack.progressZh ? snapPack.progressZh + '；' : '') +
                    (topNDiversityRerankOn
                        ? '质量闸后已按机构/类型多样性重排进 TopN；正在落库…'
                        : '正在落库本条 TopN 结果…'),
                demandIndex: finishedCount + 1,
                demandTotal,
                matchedOrgIds: [...matchedOrgIds],
            });
            await writeMutex.run(async () => {
                if (latchCancel())
                    return;
                const WRITE_SHARD = liveWriteShard;
                const baseUrl = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 3100}`;
                for (const s of scored) {
                    if (s.c?.orgId)
                        matchedOrgIds.add(String(s.c.orgId));
                }
                const orgIds = [...new Set(scored.map((s) => s.c.orgId).filter(Boolean))];
                const personByOrg = new Map();
                if (orgIds.length) {
                    const people = await this.prisma.person.findMany({
                        where: { orgId: { in: orgIds } },
                        orderBy: { updatedAt: 'desc' },
                        select: { id: true, name: true, orgId: true },
                    });
                    for (const p of people) {
                        if (!p.orgId || personByOrg.has(p.orgId))
                            continue;
                        personByOrg.set(p.orgId, { id: p.id, name: p.name });
                    }
                }
                const tenantId = d.org?.tenantId || 'default';
                const supplyKeyOf = (s) => s.c.kind === 'capability' ? `c:${s.c.id}` : `o:${s.c.id}`;
                const newMatchId = () => 'm' + randomBytes(12).toString('hex');
                const existing = await this.prisma.matchResult.findMany({
                    where: { demandId: d.id },
                    select: {
                        id: true,
                        status: true,
                        capabilityId: true,
                        outcomeId: true,
                        supplyKey: true,
                        leads: { select: { id: true, matchId: true, status: true }, take: 8 },
                    },
                });
                const existingByKey = new Map();
                for (const m of existing) {
                    const k = m.supplyKey ||
                        (m.capabilityId ? `c:${m.capabilityId}` : m.outcomeId ? `o:${m.outcomeId}` : '');
                    if (k && !existingByKey.has(k))
                        existingByKey.set(k, m);
                }
                const keepIds = new Set();
                const shardTotal = Math.max(1, Math.ceil(Math.max(scored.length, 1) / WRITE_SHARD));
                let wroteMatches = 0;
                let upserted = 0;
                let inserted = 0;
                let softCancelMidWrite = false;
                let dbUniqueUpsert = true;
                const wroteIdsThisDemand = [];
                const humanMatchStatus = new Set(['APPROVED', 'REJECTED', 'CONTACTED', 'CLOSED']);
                const protectedLeadStatus = new Set(['approved', 'sent', 'dry_run']);
                const isProtectedMatch = (m) => humanMatchStatus.has(m.status) || (m.leads || []).some((l) => protectedLeadStatus.has(l.status));
                if (!scored.length) {
                    const removable = existing.filter((m) => !isProtectedMatch(m)).map((m) => m.id);
                    if (removable.length) {
                        await this.prisma.$transaction(async (tx) => {
                            await tx.lead.deleteMany({ where: { matchId: { in: removable }, status: 'draft' } });
                            await tx.matchResult.deleteMany({ where: { id: { in: removable } } });
                        });
                    }
                }
                else {
                    for (let si = 0; si < scored.length;) {
                        if (latchCancel()) {
                            softCancelMidWrite = true;
                            await reportProgress({
                                percent: Math.min(99, Math.round(((finishedCount + 0.65) / demandTotal) * 100)),
                                phase: 'cancelled',
                                step: 'cancel-write-shard',
                                bannerZh: `已取消：需求「${String(d.title || '').slice(0, 28)}」写库分片中停下`,
                                hintZh: `已落库 ${wroteMatches} 条本需求匹配（分片事务已提交的保留）；可按剩余需求续跑。`,
                                demandIndex: finishedCount,
                                demandTotal,
                                cancelled: true,
                                matchedOrgIds: [...matchedOrgIds],
                            });
                            break;
                        }
                        const slice = scored.slice(si, si + liveWriteShard);
                        const shardIdx = Math.floor(si / Math.max(liveWriteShard, 1)) + 1;
                        const shardTotalLive = Math.max(1, Math.ceil(Math.max(scored.length, 1) / liveWriteShard));
                        await reportProgress({
                            percent: Math.min(96, Math.round(((finishedCount + 0.65 + (si / Math.max(scored.length, 1)) * 0.3) / demandTotal) *
                                100)),
                            phase: 'write',
                            step: 'write-matches-shard',
                            bannerZh: `写入匹配 ${ordinal + 1}/${demands.length} · 分片 ${shardIdx}/${shardTotalLive}（本片 ${slice.length} · 自适应写片 ${liveWriteShard}）`,
                            hintZh: `Match+Lead 同批 VALUES · 片间可取消 · ${bp.progressZh()}`,
                            demandIndex: finishedCount + 1,
                            demandTotal,
                            matchedOrgIds: [...matchedOrgIds],
                        });
                        const leadChannels = leadDrafts.leadChannelsFromEnv();
                        const shardStartedAt = Date.now();
                        const shardInserted = await this.prisma.$transaction(async (tx) => {
                            const prepared = slice.map((s) => {
                                const key = supplyKeyOf(s);
                                const ex = existingByKey.get(key);
                                const matchId = ex?.id || newMatchId();
                                const isUpdate = Boolean(ex);
                                return {
                                    s,
                                    key,
                                    matchId,
                                    isUpdate,
                                    capabilityId: s.c.kind === 'capability' ? s.c.id : null,
                                    outcomeId: s.c.kind === 'outcome' ? s.c.id : null,
                                    totalScore: s.total,
                                    scoreBreakdown: s.breakdown,
                                    reason: s.reason || null,
                                };
                            });
                            const matchValueRows = prepared.map((row) => {
                                const breakdownJson = JSON.stringify(row.scoreBreakdown ?? {});
                                return Prisma.sql `(
                  ${row.matchId},
                  ${d.id},
                  ${row.capabilityId},
                  ${row.outcomeId},
                  ${row.key},
                  ${row.totalScore},
                  CAST(${breakdownJson} AS jsonb),
                  ${row.reason},
                  CAST(${'PENDING_REVIEW'} AS "MatchStatus"),
                  ${tenantId},
                  ${row.s.primaryPersonId || null},
                  NOW(),
                  NOW()
                )`;
                            });
                            const leadSrcRows = [];
                            const outMeta = [];
                            for (const row of prepared) {
                                const action = row.s?.breakdown?.action;
                                const allowLead = action === 'REVIEW' || action === 'FIND_PEOPLE';
                                const person = row.s?.primaryPersonId
                                    ? { id: row.s.primaryPersonId, name: personByOrg.get(row.s.c.orgId)?.name }
                                    : (row.s?.c?.orgId ? personByOrg.get(row.s.c.orgId) : undefined);
                                if (!allowLead) {
                                    outMeta.push({
                                        matchId: row.matchId,
                                        score: row.s.total,
                                        demand: d.title,
                                        supply: row.s.c.title,
                                        supplyKey: row.key,
                                        channels: [],
                                    });
                                    continue;
                                }
                                const drafts = leadDrafts.buildMultiChannelLeadDrafts({
                                    demandTitle: d.title,
                                    demandOrg: d.org.name,
                                    supplyTitle: row.s.c.title,
                                    supplyOrg: row.s.c.orgName,
                                    reason: row.s.reason,
                                    personName: person?.name,
                                    collabModeLabel: row.s.breakdown?.collabModeLabel,
                                    inviteUrl: `${baseUrl}/invite.html?org=${encodeURIComponent(row.s.c.orgName)}`,
                                }, leadChannels);
                                for (const draft of drafts) {
                                    const leadId = 'l' + randomBytes(12).toString('hex');
                                    leadSrcRows.push(Prisma.sql `(
                    ${leadId},
                    ${row.key},
                    ${person?.id || ''},
                    ${draft.channel},
                    ${'draft'},
                    ${draft.draftSubject || ''},
                    ${draft.draftBody || ''}
                  )`);
                                }
                                outMeta.push({
                                    matchId: row.matchId,
                                    score: row.s.total,
                                    demand: d.title,
                                    supply: row.s.c.title,
                                    supplyKey: row.key,
                                    channels: drafts.map((x) => x.channel),
                                });
                            }
                            const returned = leadSrcRows.length
                                ? await tx.$queryRaw `
                WITH upserted AS (
                  INSERT INTO "MatchResult" (
                    id, "demandId", "capabilityId", "outcomeId", "supplyKey",
                    "totalScore", "scoreBreakdown", reason, status, "tenantId",
                    "primaryPersonId", "createdAt", "updatedAt"
                  )
                  VALUES ${Prisma.join(matchValueRows)}
                  ON CONFLICT ("demandId", "supplyKey") DO UPDATE SET
                    "capabilityId" = EXCLUDED."capabilityId",
                    "outcomeId" = EXCLUDED."outcomeId",
                    "totalScore" = EXCLUDED."totalScore",
                    "scoreBreakdown" = EXCLUDED."scoreBreakdown",
                    reason = EXCLUDED.reason,
                    status = CASE
                      WHEN "MatchResult".status IN ('APPROVED', 'REJECTED', 'CONTACTED', 'CLOSED') THEN "MatchResult".status
                      ELSE EXCLUDED.status
                    END,
                    "tenantId" = EXCLUDED."tenantId",
                    "primaryPersonId" = COALESCE(EXCLUDED."primaryPersonId", "MatchResult"."primaryPersonId"),
                    "updatedAt" = NOW()
                  RETURNING id, "supplyKey"
                ),
                lead_src AS (
                  SELECT * FROM (VALUES ${Prisma.join(leadSrcRows)})
                    AS t(id, "supplyKey", "personId", channel, status, "draftSubject", "draftBody")
                ),
                lead_upsert AS (
                  INSERT INTO "Lead" (
                    id, "matchId", "personId", channel, status,
                    "draftSubject", "draftBody", "createdAt", "updatedAt"
                  )
                  SELECT
                    lead_src.id,
                    upserted.id,
                    NULLIF(lead_src."personId", ''),
                    lead_src.channel,
                    lead_src.status,
                    NULLIF(lead_src."draftSubject", ''),
                    NULLIF(lead_src."draftBody", ''),
                    NOW(),
                    NOW()
                  FROM lead_src
                  INNER JOIN upserted ON upserted."supplyKey" = lead_src."supplyKey"
                  ON CONFLICT ("matchId", channel) DO UPDATE SET
                    "personId" = CASE
                      WHEN "Lead".status IN ('approved', 'sent', 'failed', 'dry_run') THEN "Lead"."personId"
                      ELSE EXCLUDED."personId"
                    END,
                    "draftSubject" = CASE
                      WHEN "Lead".status IN ('approved', 'sent', 'failed', 'dry_run') THEN "Lead"."draftSubject"
                      ELSE EXCLUDED."draftSubject"
                    END,
                    "draftBody" = CASE
                      WHEN "Lead".status IN ('approved', 'sent', 'failed', 'dry_run') THEN "Lead"."draftBody"
                      ELSE EXCLUDED."draftBody"
                    END,
                    "updatedAt" = NOW(),
                    status = CASE
                      WHEN "Lead".status IN ('approved', 'sent', 'failed', 'dry_run') THEN "Lead".status
                      ELSE EXCLUDED.status
                    END
                  RETURNING id
                )
                SELECT id, "supplyKey" FROM upserted
              `
                                : await tx.$queryRaw `
                INSERT INTO "MatchResult" (
                  id, "demandId", "capabilityId", "outcomeId", "supplyKey",
                  "totalScore", "scoreBreakdown", reason, status, "tenantId",
                  "primaryPersonId", "createdAt", "updatedAt"
                )
                VALUES ${Prisma.join(matchValueRows)}
                ON CONFLICT ("demandId", "supplyKey") DO UPDATE SET
                  "capabilityId" = EXCLUDED."capabilityId",
                  "outcomeId" = EXCLUDED."outcomeId",
                  "totalScore" = EXCLUDED."totalScore",
                  "scoreBreakdown" = EXCLUDED."scoreBreakdown",
                  reason = EXCLUDED.reason,
                  status = CASE
                    WHEN "MatchResult".status IN ('APPROVED', 'REJECTED', 'CONTACTED', 'CLOSED') THEN "MatchResult".status
                    ELSE EXCLUDED.status
                  END,
                  "tenantId" = EXCLUDED."tenantId",
                  "primaryPersonId" = COALESCE(EXCLUDED."primaryPersonId", "MatchResult"."primaryPersonId"),
                  "updatedAt" = NOW()
                RETURNING id, "supplyKey"
              `;
                            const idByKey = new Map();
                            for (const r of returned)
                                idByKey.set(r.supplyKey, r.id);
                            const out = [];
                            for (const row of prepared) {
                                const matchId = idByKey.get(row.key) || row.matchId;
                                if (row.isUpdate || existingByKey.has(row.key))
                                    upserted += 1;
                                else
                                    inserted += 1;
                                existingByKey.set(row.key, {
                                    id: matchId,
                                    capabilityId: row.capabilityId,
                                    outcomeId: row.outcomeId,
                                    supplyKey: row.key,
                                    leads: [],
                                });
                                keepIds.add(matchId);
                                const meta = outMeta.find((m) => m.supplyKey === row.key);
                                out.push({
                                    matchId,
                                    score: row.s.total,
                                    demand: d.title,
                                    supply: row.s.c.title,
                                    lead: {
                                        matchId,
                                        channels: meta?.channels || leadChannels,
                                        multiChannel: true,
                                    },
                                });
                            }
                            return out;
                        });
                        const shardMs = Date.now() - shardStartedAt;
                        bp.noteShardLatency(shardMs);
                        liveWriteShard = bp.state.writeShard;
                        liveParallel = bp.state.parallel;
                        si += slice.length || liveWriteShard;
                        for (const row of shardInserted) {
                            created.push({
                                matchId: row.matchId,
                                score: row.score,
                                demand: row.demand,
                                supply: row.supply,
                            });
                            wroteMatches += 1;
                            wroteIdsThisDemand.push(row.matchId);
                        }
                    }
                    if (!softCancelMidWrite) {
                        const orphanIds = existing
                            .filter((m) => !keepIds.has(m.id) && !isProtectedMatch(m))
                            .map((m) => m.id);
                        if (orphanIds.length) {
                            await this.prisma.$transaction(async (tx) => {
                                await tx.lead.deleteMany({ where: { matchId: { in: orphanIds }, status: 'draft' } });
                                await tx.matchResult.deleteMany({ where: { id: { in: orphanIds } } });
                            });
                        }
                    }
                }
                if (softCancelMidWrite) {
                    cancelLatched = true;
                    return;
                }
                try {
                    inboxDelta.bustInboxDeltaCache({ tenantId });
                }
                catch (_) { }
                d.__m62Write = {
                    shardedTransactional: true,
                    conflictUpsert: true,
                    dbUniqueUpsert,
                    batchUpsertSql: true,
                    leadBatchUpsert: true,
                    sameBatchValues: true,
                    multiChannelLeadDrafts: true,
                    leadChannels: leadDrafts.leadChannelsFromEnv(),
                    leadConflictKey: 'matchId×channel',
                    shardSize: liveWriteShard,
                    shardTotal,
                    upserted,
                    inserted,
                    wroteMatches,
                    wave: 'M72',
                    pipelineOverlap: true,
                    adaptiveBackpressure: true,
                    adaptive: bp.snapshot(),
                };
                markDemandCheckpoint(d.id, 'done', {
                    title: String(d.title || ''),
                    recallMs,
                    scoreMs,
                    clearWriteSnapshot: true,
                });
                completedDemandIds.push(d.id);
                completedSet.add(d.id);
                finishedCount += 1;
                if (wroteIdsThisDemand.length) {
                    lastWriteCompletedAt = Date.now();
                    enqueueOverlapPrewarm(wroteIdsThisDemand);
                }
            });
        };
        if (!cancelLatched && demands.length) {
            await reportProgress({
                percent: 8,
                phase: 'demand',
                step: 'parallel-start',
                bannerZh: `开始并行匹配 ${demands.length} 条需求（基线并发 ${bpKnobs.parallelBase} · 上限 ${PARALLEL_MAX} · 打分块 ${SCORE_CHUNK}）`,
                hintZh: `${bp.progressZh()}；取消会在候选块/写库前生效；已写入结果保留。`,
                demandIndex: 0,
                demandTotal,
            });
            const workerN = Math.min(PARALLEL_MAX, demands.length);
            await Promise.all(Array.from({ length: workerN }, async (_unused, workerIdx) => {
                while (true) {
                    if (latchCancel())
                        return;
                    if (workerIdx >= liveParallel) {
                        await new Promise((r) => setTimeout(r, 25));
                        liveParallel = bp.state.parallel;
                        continue;
                    }
                    const i = nextDemandIdx++;
                    if (i >= demands.length)
                        return;
                    di = Math.max(di, i + 1);
                    try {
                        await processOneDemand(demands[i], i);
                    }
                    catch (err) {
                        cancelLatched = cancelLatched || cancelCheck();
                        await reportProgress({
                            percent: Math.min(99, Math.round((finishedCount / demandTotal) * 100)),
                            phase: 'demand',
                            step: 'demand-error',
                            bannerZh: `需求打分异常：${String(demands[i]?.title || '').slice(0, 28)}`,
                            hintZh: String(err?.message || err || 'error').slice(0, 120),
                            demandIndex: finishedCount,
                            demandTotal,
                        });
                    }
                    liveParallel = bp.state.parallel;
                    liveWriteShard = bp.state.writeShard;
                }
            }));
            if (supplyRefreshPromise) {
                await reportProgress({
                    percent: Math.min(97, Math.round((finishedCount / Math.max(demandTotal, 1)) * 100) + 1),
                    phase: 'prepare',
                    step: 'supply-score-overlap-drain',
                    bannerZh: latchCancel()
                        ? '软取消：等待供给补齐停稳…'
                        : '供给预热×打分重叠：收尾缺失向量补齐…',
                    hintZh: '软取消同时停补齐；已补入包的向量保留。',
                    demandIndex: finishedCount,
                    demandTotal,
                    matchedOrgIds: [...matchedOrgIds],
                });
                try {
                    await supplyRefreshPromise;
                }
                catch (_) { }
            }
        }
        cancelled = cancelLatched || cancelled;
        if (cancelled && !completedSet.size && demands.length) {
        }
        const processedDemandIds = cancelled
            ? demands.filter((d) => completedSet.has(d.id)).map((d) => d.id)
            : demands.map((d) => d.id);
        const processedCount = processedDemandIds.length;
        const remainingDemandIds = cancelled
            ? demands.filter((d) => !completedSet.has(d.id)).map((d) => d.id)
            : [];
        const scoreResumeAvailable = cancelled && remainingDemandIds.length > 0;
        const matchedOrgIdsArr = [...matchedOrgIds];
        let onePagerPrewarm = {
            requested: 0,
            warmed: 0,
            warmedExplainCore: 0,
            skippedCancel: 0,
            errors: 0,
            remainingIds: [],
            resumeAvailable: false,
            queueId: null,
            wave: 'M72',
            pipelineOverlap: true,
            tailLatencyMs: null,
            overlapLeadMs: null,
        };
        if (created.length) {
            const missing = created.map((c) => c.matchId).filter((id) => id && !overlapSeenIds.has(id));
            if (missing.length && !cancelCheck())
                enqueueOverlapPrewarm(missing);
            if (!cancelCheck()) {
                await reportProgress({
                    percent: cancelled ? Math.min(97, Math.round((processedCount / demandTotal) * 100)) : 97,
                    phase: 'prewarm',
                    step: firstOverlapPrewarmAt ? 'pipeline-overlap-drain' : 'one-pager-explain-prewarm',
                    bannerZh: firstOverlapPrewarmAt
                        ? `收尾重叠预热（已预热 ${overlapPrewarmAgg.warmed} · 队列 ${overlapPrewarmQueue.length}）…`
                        : `预热一页纸+解释核心 ${created.length} 条（并行队列）…`,
                    hintZh: firstOverlapPrewarmAt
                        ? '写库尾与预热已重叠；软取消仍会停下两边。'
                        : '可取消：已预热保留，剩余写入可恢复队列（不影响已写入匹配）。',
                    demandIndex: processedCount,
                    demandTotal,
                    cancelled,
                    matchedOrgIds: matchedOrgIdsArr,
                });
            }
            for (let i = 0; i < 60; i++) {
                if (overlapPrewarmDrain)
                    await overlapPrewarmDrain;
                if (!overlapPrewarmBusy && !overlapPrewarmQueue.length)
                    break;
                kickOverlapPrewarm();
                if (overlapPrewarmDrain)
                    await overlapPrewarmDrain;
                else
                    break;
            }
            if (latchCancel() && overlapPrewarmQueue.length) {
                while (overlapPrewarmQueue.length) {
                    const id = overlapPrewarmQueue.shift();
                    if (id)
                        overlapPrewarmAgg.remainingIds.push(id);
                }
                overlapPrewarmAgg.resumeAvailable = overlapPrewarmAgg.remainingIds.length > 0;
            }
            const tailLatencyMs = lastWriteCompletedAt && overlapPrewarmFinishedAt
                ? Math.max(0, overlapPrewarmFinishedAt - lastWriteCompletedAt)
                : lastWriteCompletedAt && !overlapPrewarmFinishedAt
                    ? null
                    : 0;
            const overlapLeadMs = firstOverlapPrewarmAt && lastWriteCompletedAt
                ? Math.max(0, lastWriteCompletedAt - firstOverlapPrewarmAt)
                : null;
            onePagerPrewarm = {
                ...overlapPrewarmAgg,
                remainingIds: [...new Set(overlapPrewarmAgg.remainingIds)],
                resumeAvailable: overlapPrewarmAgg.remainingIds.length > 0,
                pipelineOverlap: true,
                tailLatencyMs,
                overlapLeadMs,
                lastWriteCompletedAt,
                firstOverlapPrewarmAt,
                overlapPrewarmFinishedAt,
                tipZh: overlapPrewarmAgg.tipZh ||
                    (overlapPrewarmAgg.warmed
                        ? `流水线重叠预热完成：一页纸 ${overlapPrewarmAgg.warmed} · 解释 ${overlapPrewarmAgg.warmedExplainCore}` +
                            (tailLatencyMs != null ? ` · 写库尾延迟 ${tailLatencyMs}ms` : '') +
                            (overlapLeadMs != null ? ` · 重叠超前 ${overlapLeadMs}ms` : '')
                        : '本轮无预热或已取消。'),
                wave: 'M72',
            };
        }
        const prewarmResumeAvailable = Boolean(onePagerPrewarm?.resumeAvailable);
        const resumeAvailable = scoreResumeAvailable || prewarmResumeAvailable;
        const unifiedPhase = scoreResumeAvailable
            ? 'score'
            : prewarmResumeAvailable
                ? 'prewarm'
                : cancelled
                    ? 'cancelled'
                    : 'done';
        const demandCheckpointSnap = snapshotDemandCheckpoints();
        const resumeCursors = {
            scoreOnly: scoreResumeAvailable
                ? {
                    phase: 'score',
                    demandIds: remainingDemandIds,
                    count: remainingDemandIds.length,
                    labelZh: '仅打分续跑',
                    tipZh: `仅打分剩余：${remainingDemandIds.length} 条需求（不重做已完成供给嵌入/ANN）` +
                        (demandCheckpointSnap.lastUnfinishedDemandId
                            ? `；自检查点 demandId=${demandCheckpointSnap.lastUnfinishedDemandId}（${demandCheckpointSnap.lastUnfinishedLabelZh}）续`
                            : ''),
                    lastUnfinishedDemandId: demandCheckpointSnap.lastUnfinishedDemandId,
                    lastUnfinishedPhase: demandCheckpointSnap.lastUnfinishedPhase,
                }
                : null,
            prewarmOnly: prewarmResumeAvailable
                ? {
                    phase: 'prewarm',
                    queueId: onePagerPrewarm?.queueId || null,
                    remainingIds: onePagerPrewarm?.remainingIds || [],
                    count: (onePagerPrewarm?.remainingIds || []).length,
                    labelZh: '仅预热续跑',
                    tipZh: `仅预热剩余：队列 ${onePagerPrewarm?.queueId || '—'} · ${(onePagerPrewarm?.remainingIds || []).length} 条（不重跑打分）`,
                }
                : null,
            demandCheckpoints: demandCheckpointSnap,
            demandIdCheckpointResume: true,
            phaseResumeByDemandPhase: phaseResumeMeta,
            checkpointPersistAcrossProcess: checkpointPersistMeta,
            annPoolWarmResumeByDemandId: {
                enabled: true,
                resumed: checkpointPersistMeta.annWarmResumed,
                path: checkpointPersistMeta.annPath,
                labelZh: 'ANN 召回池按 demandId 续热',
                tipZh: checkpointPersistMeta.annWarmResumed > 0
                    ? `已按 demandId 续热 ANN 池 ${checkpointPersistMeta.annWarmResumed} 条（跨进程）。`
                    : '本轮无磁盘 ANN 续热条目（或已过期）；预热池仍会前瞻填充。',
                capacityAdapt: annCapAdaptMeta,
                livePoolN: liveAnnPrewarmN,
                wave: 'M81',
            },
            annPoolCapacityAdapt: annCapAdaptMeta,
            split: Boolean(scoreResumeAvailable || prewarmResumeAvailable),
            cancelScopeHint: softCancelToken.stopEmbed && !softCancelToken.latched
                ? 'embed'
                : softCancelToken.stopScore && !softCancelToken.latched
                    ? 'score'
                    : softCancelToken.latched
                        ? 'all'
                        : null,
            writeSnapshotVerify: {
                verified: phaseResumeMeta.writeSnapshotVerified,
                mismatchFallback: phaseResumeMeta.writeSnapshotMismatchFallback,
                compressed: phaseResumeMeta.writeSnapshotCompressed,
                incremental: phaseResumeMeta.writeSnapshotIncremental,
                bytesSaved: phaseResumeMeta.writeSnapshotBytesSaved,
                lastTipZh: phaseResumeMeta.lastVerifyTipZh,
                labelZh: '写库快照完整性校验（压缩/增量）',
                tipZh: phaseResumeMeta.lastVerifyTipZh ||
                    `写库续跑前校验快照与 phase 对拍；压缩 ${phaseResumeMeta.writeSnapshotCompressed} · 增量 ${phaseResumeMeta.writeSnapshotIncremental} · 省 ${phaseResumeMeta.writeSnapshotBytesSaved}B；失败回退重打分/写库`,
                wave: 'M82',
            },
            writeSnapshotCompress: {
                compressed: phaseResumeMeta.writeSnapshotCompressed,
                incremental: phaseResumeMeta.writeSnapshotIncremental,
                bytesSaved: phaseResumeMeta.writeSnapshotBytesSaved,
                labelZh: '写库快照压缩/增量',
                tipZh: `压缩 ${phaseResumeMeta.writeSnapshotCompressed} 次 · 增量 ${phaseResumeMeta.writeSnapshotIncremental} 次 · 约省 ${phaseResumeMeta.writeSnapshotBytesSaved}B`,
                wave: 'M82',
            },
            annBpCooldownLink: {
                enabled: annCapAdaptMeta.bpCooldownLink,
                shrinks: annCapAdaptMeta.bpLinkShrinks,
                expands: annCapAdaptMeta.bpLinkExpands,
                cooldownMs: annCapAdaptMeta.cooldownMs,
                tipZh: annCapAdaptMeta.bpLinkTipZh,
                labelZh: 'ANN 冷却×背压联动·滞回自适应×写片',
                hysteresis: Boolean(annCapAdaptMeta.bpHysteresis),
                hysteresisBandMs: annCapAdaptMeta.bpHysteresisBandMs || null,
                hysteresisLiveBandMs: annCapAdaptMeta.bpHysteresisLiveBandMs || null,
                hysteresisAdapt: Boolean(annCapAdaptMeta.bpHysteresisAdapt),
                hysteresisFlipRatePerMin: annCapAdaptMeta.bpHysteresisFlipRatePerMin || 0,
                hysteresisHolds: annCapAdaptMeta.bpHysteresisHolds || 0,
                hysteresisAdaptTipZh: hystAdapt?.tipZh || null,
                hysteresisWriteShardLink: annCapAdaptMeta.hysteresisWriteShardLink || hystWriteShardLinkMeta,
                wave: 'M87',
            },
            writeSnapshotBaseFrame: phaseResumeMeta.writeSnapshotBaseFrame ||
                phaseResumeMeta.writeSnapshotBaseFramePersisted || {
                wave: 'M84',
                labelZh: '写库快照跨进程基帧',
                tipZh: '本轮写库可落盘基帧；重启后对照 checksum×phase',
            },
            recallPoolHitRateBoard: (() => {
                try {
                    const hit = Number(annCapAdaptMeta.recentHit) || 0;
                    const miss = Number(annCapAdaptMeta.recentMiss) || 0;
                    const avg = annCapAdaptMeta.recentRecallMs && annCapAdaptMeta.recentRecallMs.length
                        ? annCapAdaptMeta.recentRecallMs.reduce((a, b) => a + b, 0) /
                            annCapAdaptMeta.recentRecallMs.length
                        : null;
                    if (hit + miss > 0) {
                        const contribs = [...demandRecallContrib.values()];
                        recordRecallPoolHitSample(ckTenantId, {
                            hit,
                            miss,
                            recallAvgMs: avg,
                            runId: String(opts?.runId || opts?.jobId || '') || null,
                            demandIds: contribs.map((c) => c.demandId),
                            demandContributions: contribs,
                        });
                    }
                }
                catch (_) { }
                return {
                    recorded: true,
                    hit: annCapAdaptMeta.recentHit,
                    miss: annCapAdaptMeta.recentMiss,
                    path: '/api/metrics/recall-pool-hit-rate',
                    labelZh: '召回池命中率分位数看板',
                    tipZh: '本轮命中样已写入分位数看板（含 demandId，可钻取）',
                    wave: 'M84',
                    drillPath: '/api/metrics/recall-pool-hit-rate/drill',
                };
            })(),
            tipZh: resumeAvailable
                ? scoreResumeAvailable && prewarmResumeAvailable
                    ? `续跑游标已切分：打分剩 ${remainingDemandIds.length} · 预热剩 ${(onePagerPrewarm?.remainingIds || []).length}；按 demandId×phase 检查点不重做已完成阶段。`
                    : scoreResumeAvailable
                        ? `续跑游标：仅打分剩 ${remainingDemandIds.length} 条` +
                            (demandCheckpointSnap.lastUnfinishedDemandId
                                ? ` · 检查点自 ${demandCheckpointSnap.lastUnfinishedDemandId}`
                                : '') +
                            '。'
                        : `续跑游标：仅预热队列 ${onePagerPrewarm?.queueId || '—'}。`
                : demandCheckpointSnap.tipZh || '无续跑游标可切分。',
            wave: 'M86',
        };
        await reportProgress({
            percent: cancelled ? Math.min(99, Math.round((processedCount / demandTotal) * 100)) : 100,
            phase: cancelled ? 'cancelled' : prewarmResumeAvailable ? 'prewarm' : 'done',
            step: cancelled ? 'cancelled' : prewarmResumeAvailable ? 'prewarm-paused' : 'done',
            bannerZh: cancelled
                ? `已取消：生成 ${created.length} 条匹配后停下` +
                    (scoreResumeAvailable ? `，剩 ${remainingDemandIds.length} 条需求可续跑` : '') +
                    (prewarmResumeAvailable ? ` · 预热可续 ${onePagerPrewarm.remainingIds?.length || 0}` : '')
                : `匹配完成：生成 ${created.length} 条` +
                    (onePagerPrewarm?.warmed ? ` · 一页纸预热 ${onePagerPrewarm.warmed}` : '') +
                    (prewarmResumeAvailable ? ` · 预热可续 ${onePagerPrewarm.remainingIds?.length || 0}` : ''),
            hintZh: cancelled
                ? resumeAvailable
                    ? scoreResumeAvailable
                        ? '已生成的匹配保留。统一任务卡可续跑剩余需求（含后续预热）。游标已按阶段切分；按 demandId 检查点不重做已完成。'
                        : '打分已落库；统一任务卡可续跑预热队列。游标已按阶段切分。'
                    : '已生成的匹配保留；没有剩余需求。'
                : prewarmResumeAvailable
                    ? `打分完成；预热暂停，统一任务卡可续跑队列 ${onePagerPrewarm.queueId}。`
                    : onePagerPrewarm?.tipZh || '可以去审匹配结果；收件箱 cursor 差分刷新。',
            demandIndex: processedCount,
            demandTotal,
            cancelled,
            matchedOrgIds: matchedOrgIdsArr,
            itemizedPhases: buildItemizedPhases(cancelled && softCancelToken.stopEmbed && !softCancelToken.stopScore ? 'ann-pool' : 'score', {
                'supply-embed': softCancelToken.stopEmbed ? '已停/可跳过重做' : '已完成',
                'ann-pool': softCancelToken.stopEmbed ? '已停' : '已完成',
                score: softCancelToken.stopScore || cancelled
                    ? scoreResumeAvailable
                        ? `可续 ${remainingDemandIds.length}`
                        : '已停'
                    : '已完成',
            }),
            cancelScopesAvailable: ['embed', 'score', 'all'],
        });
        await this.prisma.jobLog.create({
            data: {
                queue: 'match',
                jobName: 'run',
                status: cancelled ? 'cancelled' : 'done',
                message: cancelled
                    ? `已取消 · 已生成 ${created.length} 条匹配 · 已处理需求 ${processedCount}/${demands.length} · 剩余可续 ${remainingDemandIds.length}`
                    : `生成 ${created.length} 条匹配 · 一页纸预热 ${onePagerPrewarm?.warmed || 0}/${onePagerPrewarm?.requested || 0} · 跳过隔离需求 ${skippedQuarantine} · 跳过隔离供给 ${skippedSupplyQuarantine} · 向量 ${this.vectors.status().mode}`,
                payload: {
                    ...payloadOpts,
                    embedding: meta,
                    vector: this.vectors.status(),
                    skippedQuarantine,
                    skippedSupplyQuarantine,
                    skippedDemandSamples,
                    skippedSupplySamples,
                    cancelled,
                    processedDemands: processedCount,
                    demandTotal: demands.length,
                    processedDemandIds,
                    remainingDemandIds,
                    resumeAvailable,
                    scoreResumeAvailable,
                    prewarmResumeAvailable,
                    unifiedPhase,
                    resumeCursors,
                    demandCheckpoints: demandCheckpointSnap,
                    prewarmQueueId: onePagerPrewarm?.queueId || null,
                    matchedOrgIds: matchedOrgIdsArr,
                    onePagerPrewarm,
                    unifiedJobCard: true,
                    writeBatch: {
                        shardedTransactional: true,
                        conflictUpsert: true,
                        dbUniqueUpsert: true,
                        batchUpsertSql: true,
                        leadBatchUpsert: true,
                        leadConflictKey: 'matchId×channel',
                        wave: 'M72',
                        sameBatchValues: true,
                        multiChannelLeadDrafts: true,
                        leadChannels: leadDrafts.leadChannelsFromEnv(),
                        pipelineOverlap: true,
                        adaptiveBackpressure: true,
                        shardSize: liveWriteShard,
                        parallel: liveParallel,
                    },
                    pipelineOverlap: true,
                    tailLatencyMs: onePagerPrewarm?.tailLatencyMs ?? null,
                    overlapLeadMs: onePagerPrewarm?.overlapLeadMs ?? null,
                    adaptiveBackpressure: bp.snapshot(),
                    adaptiveBackpressureEnabled: bpKnobs.enabled,
                    adaptiveKnobsZh: adaptiveBpKnobsDocZh(),
                    wave: 'M74',
                },
            },
        });
        return {
            count: created.length,
            items: created,
            cancelled,
            processedDemandIds,
            remainingDemandIds,
            resumeAvailable,
            scoreResumeAvailable,
            prewarmResumeAvailable,
            unifiedPhase,
            resumeCursors,
            prewarmQueueId: onePagerPrewarm?.queueId || null,
            matchedOrgIds: matchedOrgIdsArr,
            processedDemands: processedCount,
            demandTotal: demands.length,
            bypassFullBatch: Boolean(opts.demandId ||
                (Array.isArray(opts.demandIds) && opts.demandIds.length === 1) ||
                demands.length === 1),
            singleDemandRerun: Boolean(opts.demandId || (Array.isArray(opts.demandIds) && opts.demandIds.length === 1)),
            singleDemandId: opts.demandId ||
                (Array.isArray(opts.demandIds) && opts.demandIds.length === 1 ? opts.demandIds[0] : null) ||
                (demands.length === 1 ? demands[0]?.id : null),
            singleDemandRerunLabelZh: '单需求重跑旁路',
            softCancelIntact: true,
            embedding: meta,
            vector: this.vectors.status(),
            skippedQuarantine,
            skippedSupplyQuarantine,
            skippedDemandSamples,
            skippedSupplySamples,
            onePagerPrewarm,
            unifiedJobCard: true,
            writeBatch: {
                shardedTransactional: true,
                conflictUpsert: true,
                dbUniqueUpsert: true,
                batchUpsertSql: true,
                leadBatchUpsert: true,
                sameBatchValues: true,
                multiChannelLeadDrafts: true,
                leadChannels: leadDrafts.leadChannelsFromEnv(),
                leadConflictKey: 'matchId×channel',
                shardSize: liveWriteShard,
                parallel: liveParallel,
                pipelineOverlap: true,
                adaptiveBackpressure: true,
                wave: 'M72',
            },
            pipelineOverlap: true,
            adaptiveBackpressure: bp.snapshot(),
            adaptiveBackpressureEnabled: bpKnobs.enabled,
            adaptiveKnobsZh: adaptiveBpKnobsDocZh(),
            adaptiveProgressZh: bp.progressZh(),
            scoreLatencyInBp: true,
            recallLatencyInBp: true,
            demandEmbedLookahead: demandEmbedLookaheadMeta,
            demandEmbedLookaheadZh: demandEmbedLookaheadMeta.tipZh +
                ` · 预取 ${demandEmbedLookaheadMeta.prefetched} · 复用 ${demandEmbedLookaheadMeta.reused}` +
                (demandEmbedLookaheadMeta.cancelled ? ` · 取消 ${demandEmbedLookaheadMeta.cancelled}` : ''),
            annRecallPrewarmPool: annRecallPrewarmMeta,
            annRecallPrewarmPoolZh: annRecallPrewarmMeta.tipZh +
                ` · 预热 ${annRecallPrewarmMeta.prewarmed} · 复用 ${annRecallPrewarmMeta.reused}` +
                ` · 未命中 ${annRecallPrewarmMeta.missed} · 去重 ${annRecallPrewarmMeta.deduped}` +
                (annRecallPrewarmMeta.lightExpanded
                    ? ` · 轻扩 ${annRecallPrewarmMeta.lightExpanded}次(+${annRecallPrewarmMeta.lightExpandAdds})`
                    : '') +
                (annRecallPrewarmMeta.cancelled ? ` · 取消清池 ${annRecallPrewarmMeta.cancelled}` : '') +
                ` · 模式 ${annRecallPrewarmMeta.mode}`,
            unifiedSoftCancelToken: {
                ...softCancelToken,
                latched: softCancelToken.latched || cancelLatched,
            },
            unifiedSoftCancelTokenZh: softCancelToken.tipZh +
                (softCancelToken.latched || cancelLatched
                    ? ` · 已全停（ANN清池 ${softCancelToken.annCleared} · 供给停 ${softCancelToken.supplyStopped} · 打分停 ${softCancelToken.scoreStopped}）`
                    : softCancelToken.stopEmbed || softCancelToken.stopScore
                        ? ` · 分项停（embed=${softCancelToken.stopEmbed} · score=${softCancelToken.stopScore} · ANN清池 ${softCancelToken.annCleared} · 供给停 ${softCancelToken.supplyStopped}）`
                        : ' · 未触发'),
            itemizedProgressLabelZh: '匹配分项进度',
            finerCancelScopes: ['embed', 'score', 'all'],
            finerCancelTipZh: '可仅停供给嵌入/ANN，或仅停打分；软取消仍全停；取消后游标按阶段切分；按 demandId 检查点跨进程落盘续跑',
            resumeCursorSplitLabelZh: '细取消后续跑游标切分',
            demandIdCheckpointResumeLabelZh: '按 demandId×phase 检查点续跑（跨进程落盘）',
            demandCheckpoints: demandCheckpointSnap,
            phaseResumeByDemandPhase: phaseResumeMeta,
            phaseResumeByDemandPhaseLabelZh: '按 recall/score/write phase 细粒度续跑（写库快照校验）',
            checkpointPersistAcrossProcess: checkpointPersistMeta,
            annPoolWarmResumeByDemandIdLabelZh: 'ANN 召回池按 demandId 续热',
            annPoolCapacityAdapt: annCapAdaptMeta,
            annPoolCapacityAdaptLabelZh: 'ANN 暖池容量自适应（冷却防抖）',
            checkpointPersistPath: checkpointPersistMeta.path,
            matchWave: 'M81',
            itemizedPhasesSse: true,
            recallLightExpand: {
                enabled: lightExpandOn,
                minCandidates: lightExpandMin,
                factor: lightExpandFactor,
                maxLimit: lightExpandMaxLim,
                maxRounds: lightExpandMaxRounds,
                qualityGate: lightExpandQualityGateOn,
                minGain: lightExpandMinGain,
                minDiversity: lightExpandMinDiversity,
                gateMinScore: lightExpandGateMinScore,
                expanded: annRecallPrewarmMeta.lightExpanded,
                added: annRecallPrewarmMeta.lightExpandAdds,
                earlyStops: annRecallPrewarmMeta.qualityGateEarlyStops,
                gatePasses: annRecallPrewarmMeta.qualityGatePasses,
                gateRounds: annRecallPrewarmMeta.qualityGateRounds,
                wave: 'M72',
            },
            recallLightExpandQualityGate: {
                enabled: lightExpandQualityGateOn,
                earlyStops: annRecallPrewarmMeta.qualityGateEarlyStops,
                passes: annRecallPrewarmMeta.qualityGatePasses,
                rounds: annRecallPrewarmMeta.qualityGateRounds,
                tipZh: lightExpandQualityGateOn
                    ? `轻扩质量闸：增益≥${lightExpandMinGain} · 多样性≥${lightExpandMinDiversity} · 最多 ${lightExpandMaxRounds} 轮；早停 ${annRecallPrewarmMeta.qualityGateEarlyStops} · 通过 ${annRecallPrewarmMeta.qualityGatePasses}`
                    : '轻扩质量闸关闭',
                wave: 'M72',
            },
            topNDiversityRerank: {
                enabled: topNDiversityRerankOn,
                poolFactor: topNDiversityPoolFactor,
                orgPenalty: topNDiversityOrgPenalty,
                kindPenalty: topNDiversityKindPenalty,
                reranked: annRecallPrewarmMeta.diversityReranked,
                orgUniqueSum: annRecallPrewarmMeta.diversityOrgUnique,
                kindUniqueSum: annRecallPrewarmMeta.diversityKindUnique,
                demoted: annRecallPrewarmMeta.diversityDemoted,
                tipZh: topNDiversityRerankOn
                    ? `TopN 多样性重排：池×${topNDiversityPoolFactor} · 机构罚 ${topNDiversityOrgPenalty} · 类型罚 ${topNDiversityKindPenalty} · 已重排 ${annRecallPrewarmMeta.diversityReranked} 次 · 替下 ${annRecallPrewarmMeta.diversityDemoted}`
                    : 'TopN 多样性重排关闭',
                wave: 'M74',
            },
            topNDiversityExplain: {
                demoted: annRecallPrewarmMeta.diversityDemoted,
                samples: annRecallPrewarmMeta.diversityExplainSamples,
                tipZh: annRecallPrewarmMeta.diversityExplainSamples.length
                    ? `为何替下同机构：本轮 ${annRecallPrewarmMeta.diversityDemoted} 条被替下，样例 ${annRecallPrewarmMeta.diversityExplainSamples.length} 条`
                    : topNDiversityRerankOn
                        ? '本轮无同机构替下样例（候选机构已足够分散或池不足）'
                        : '多样性重排关闭，无替下解释',
                labelZh: '为何替下同机构',
                wave: 'M74',
            },
            topNDiversityBypassContrast: {
                enabled: topNDiversityRerankOn,
                samples: annRecallPrewarmMeta.diversityContrastSamples,
                demoted: annRecallPrewarmMeta.diversityDemoted,
                labelZh: '朴素 TopN vs 多样性 TopN 旁路对照',
                foldableTableLabelZh: '旁路对照表（可折叠）',
                foldableTable: annRecallPrewarmMeta.diversityContrastSamples[0]?.foldableTable || null,
                tipZh: annRecallPrewarmMeta.diversityContrastSamples.length
                    ? `旁路对照：${annRecallPrewarmMeta.diversityContrastSamples.length} 组 · 替下合计 ${annRecallPrewarmMeta.diversityDemoted} · 可折叠对照表`
                    : topNDiversityRerankOn
                        ? '本轮无旁路对照样例（池不足或未触发重排）'
                        : '多样性重排关闭，无旁路对照',
                opsPeekZh: annRecallPrewarmMeta.diversityContrastSamples[0]
                    ? `【旁路对照】${annRecallPrewarmMeta.diversityContrastSamples[0].tipZh}`
                    : topNDiversityRerankOn
                        ? '【旁路对照】暂无样例'
                        : '【旁路对照】重排关闭',
                wave: 'M76',
            },
            topNDiversityRerankZh: topNDiversityRerankOn
                ? `TopN 多样性重排开 · 已重排 ${annRecallPrewarmMeta.diversityReranked} 次 · 替下 ${annRecallPrewarmMeta.diversityDemoted}（机构/类型去同）`
                : 'TopN 多样性重排关',
            topNDiversityExplainZh: annRecallPrewarmMeta.diversityExplainSamples.length
                ? `为何替下同机构 · ${annRecallPrewarmMeta.diversityExplainSamples[0].reasonZh.slice(0, 80)}`
                : topNDiversityRerankOn
                    ? '为何替下同机构：本轮无替下样例'
                    : '为何替下同机构：重排关闭',
            topNDiversityBypassContrastZh: annRecallPrewarmMeta.diversityContrastSamples.length
                ? `旁路对照 · ${annRecallPrewarmMeta.diversityContrastSamples[0].tipZh.slice(0, 80)}`
                : topNDiversityRerankOn
                    ? '旁路对照：本轮无样例'
                    : '旁路对照：重排关闭',
            recallLightExpandZh: lightExpandOn
                ? `召回轻量扩窗：候选<${lightExpandMin} 时扩至≤${lightExpandMaxLim}（×${lightExpandFactor}·最多${lightExpandMaxRounds}轮）` +
                    (lightExpandQualityGateOn
                        ? `；质量闸早停 ${annRecallPrewarmMeta.qualityGateEarlyStops} / 通过 ${annRecallPrewarmMeta.qualityGatePasses}`
                        : '') +
                    `；已扩 ${annRecallPrewarmMeta.lightExpanded} 次`
                : '召回轻量扩窗关闭',
            supplyScoreOverlap: supplyRefreshMeta,
            supplyScoreOverlapZh: supplyRefreshMeta.overlap
                ? `供给预热×打分重叠` +
                    (supplyRefreshMeta.deferredMissing
                        ? ` · 补齐能力 ${supplyRefreshMeta.refreshedCaps} / 成果 ${supplyRefreshMeta.refreshedOuts}`
                        : ' · 无需补齐') +
                    ' · 统一取消令牌'
                : '供给预热×打分重叠关闭',
            tailLatencyMs: onePagerPrewarm?.tailLatencyMs ?? null,
            overlapLeadMs: onePagerPrewarm?.overlapLeadMs ?? null,
            skipReasonsZh: skippedQuarantine + skippedSupplyQuarantine
                ? `跳过隔离需求 ${skippedQuarantine}、隔离供给 ${skippedSupplyQuarantine}（见 samples）`
                : '本轮没有隔离卡被跳过',
            noteZh: '已隔离（extensions.quarantine）的需求/能力/成果不参与本轮匹配',
            summaryZh: cancelled
                ? resumeAvailable
                    ? scoreResumeAvailable
                        ? `匹配已取消：完成 ${processedCount}/${demands.length} 条需求，剩 ${remainingDemandIds.length} 条可续跑（统一任务卡）`
                        : `匹配打分已落库；预热可续队列 ${onePagerPrewarm?.queueId}`
                    : `匹配已取消：完成 ${processedCount}/${demands.length} 条需求`
                : `匹配完成：生成 ${created.length} 条` +
                    (onePagerPrewarm?.warmed
                        ? ` · 一页纸已预热 ${onePagerPrewarm.warmed}`
                        : '') +
                    (onePagerPrewarm?.warmedExplainCore
                        ? ` · 解释核心 ${onePagerPrewarm.warmedExplainCore}`
                        : '') +
                    (prewarmResumeAvailable
                        ? ` · 预热可续队列 ${onePagerPrewarm.queueId}`
                        : ''),
            wave: 'M85',
            resumePathHint: resumeAvailable ? '/api/jobs/:id/resume' : null,
            prewarmResumePath: prewarmResumeAvailable
                ? '/api/matches/prewarm/resume'
                : null,
        };
    }
    async prewarmSupplyEmbeddings(caps, outs, cancelCheck, opts = {}) {
        const capMap = new Map();
        const outMap = new Map();
        const capUpdates = [];
        const outUpdates = [];
        const pendingCapMeta = [];
        const pendingOutMeta = [];
        const deferMissing = opts.deferMissing === true;
        const hasEmb = (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'number';
        for (const c of caps) {
            if (cancelCheck())
                break;
            if (c.extensions?.quarantine)
                continue;
            const text = [c.title, c.summary, ...(c.keywords || []), ...(c.disciplines || [])].join(' ');
            const trustBadges = [...new Set([...(c.trustBadges || []), ...(c.org?.trustBadges || [])])];
            let emb = hasEmb(c.embedding) ? c.embedding : null;
            if (!emb) {
                if (deferMissing) {
                    pendingCapMeta.push({ id: c.id, text, trustBadges });
                    continue;
                }
                emb = (await embedText(text));
                capUpdates.push({ id: c.id, emb });
            }
            capMap.set(c.id, { emb: emb, text, trustBadges });
        }
        for (const o of outs) {
            if (cancelCheck())
                break;
            if (o.extensions?.quarantine)
                continue;
            const text = [o.title, o.abstract, ...(o.ipcOrDisc || [])].join(' ');
            const trustBadges = [...new Set([...(o.trustBadges || []), ...(o.org?.trustBadges || [])])];
            let emb = hasEmb(o.embedding) ? o.embedding : null;
            if (!emb) {
                if (deferMissing) {
                    pendingOutMeta.push({ id: o.id, text, trustBadges });
                    continue;
                }
                emb = (await embedText(text));
                outUpdates.push({ id: o.id, emb });
            }
            outMap.set(o.id, { emb: emb, text, trustBadges });
        }
        const chunk = 12;
        for (let i = 0; i < capUpdates.length && !cancelCheck(); i += chunk) {
            const slice = capUpdates.slice(i, i + chunk);
            await Promise.all(slice.map(async (u) => {
                await this.prisma.capability.update({ where: { id: u.id }, data: { embedding: u.emb } });
                await this.vectors.syncRowVec('Capability', u.id, u.emb);
            }));
        }
        for (let i = 0; i < outUpdates.length && !cancelCheck(); i += chunk) {
            const slice = outUpdates.slice(i, i + chunk);
            await Promise.all(slice.map(async (u) => {
                await this.prisma.outcome.update({ where: { id: u.id }, data: { embedding: u.emb } });
                await this.vectors.syncRowVec('Outcome', u.id, u.emb);
            }));
        }
        return {
            caps: capMap,
            outs: outMap,
            refreshedCaps: capUpdates.length,
            refreshedOuts: outUpdates.length,
            deferredMissing: deferMissing && (pendingCapMeta.length > 0 || pendingOutMeta.length > 0),
            pendingCapIds: pendingCapMeta.map((x) => x.id),
            pendingOutIds: pendingOutMeta.map((x) => x.id),
            pendingCapMeta,
            pendingOutMeta,
        };
    }
    async refreshDeferredSupplyEmbeddings(pack, cancelCheck) {
        const capUpdates = [];
        const outUpdates = [];
        for (const meta of pack.pendingCapMeta || []) {
            if (cancelCheck())
                break;
            if (pack.caps.has(meta.id))
                continue;
            const emb = (await embedText(meta.text));
            pack.caps.set(meta.id, { emb, text: meta.text, trustBadges: meta.trustBadges });
            capUpdates.push({ id: meta.id, emb });
        }
        for (const meta of pack.pendingOutMeta || []) {
            if (cancelCheck())
                break;
            if (pack.outs.has(meta.id))
                continue;
            const emb = (await embedText(meta.text));
            pack.outs.set(meta.id, { emb, text: meta.text, trustBadges: meta.trustBadges });
            outUpdates.push({ id: meta.id, emb });
        }
        const chunk = 12;
        for (let i = 0; i < capUpdates.length && !cancelCheck(); i += chunk) {
            const slice = capUpdates.slice(i, i + chunk);
            await Promise.all(slice.map(async (u) => {
                await this.prisma.capability.update({ where: { id: u.id }, data: { embedding: u.emb } });
                await this.vectors.syncRowVec('Capability', u.id, u.emb);
            }));
        }
        for (let i = 0; i < outUpdates.length && !cancelCheck(); i += chunk) {
            const slice = outUpdates.slice(i, i + chunk);
            await Promise.all(slice.map(async (u) => {
                await this.prisma.outcome.update({ where: { id: u.id }, data: { embedding: u.emb } });
                await this.vectors.syncRowVec('Outcome', u.id, u.emb);
            }));
        }
        const tipZh = cancelCheck() && (capUpdates.length || outUpdates.length)
            ? `供给补齐中途取消：已补能力 ${capUpdates.length} · 成果 ${outUpdates.length}`
            : `供给补齐完成：能力 ${capUpdates.length} · 成果 ${outUpdates.length}`;
        return { refreshedCaps: capUpdates.length, refreshedOuts: outUpdates.length, tipZh };
    }
    async explainMatch(id, opts = {}) {
        const t0 = Date.now();
        const fieldsRaw = String(opts.fields || 'full').toLowerCase();
        const fields = fieldsRaw === 'core' || fieldsRaw === 'slim' ? 'core' : 'full';
        const cacheKey = `${id}|${fields}`;
        const ttl = MatchesService.EXPLAIN_TTL_MS;
        const now = Date.now();
        if (!opts.bypassCache) {
            const hit = this.explainCache.get(cacheKey);
            if (hit && now - hit.at < ttl) {
                return {
                    ...hit.body,
                    cache: 'HIT',
                    etag: hit.etag,
                    timingMs: Date.now() - t0,
                    fields,
                    wave: 'M59',
                };
            }
        }
        const m = await this.get(id);
        const bd = m.scoreBreakdown || {};
        const [weightInfo, recentFb, softRescore, trustSignals] = await Promise.all([
            this.feedback.getWeights(),
            fields === 'core' ? Promise.resolve([]) : this.feedback.forMatch(id, 8),
            fields === 'core' ? Promise.resolve(null) : this.feedback.softRescore(bd, m.totalScore),
            this.trust.signalsForMatch(m),
        ]);
        const weights = bd.weights || weightInfo.weights || { ...DEFAULT_WEIGHTS };
        const learningBlock = fields === 'core'
            ? null
            : {
                current: weightInfo.weights,
                defaults: weightInfo.defaults,
                deltaFromDefault: weightInfo.deltaFromDefault,
                usefulN: weightInfo.usefulN,
                notUsefulN: weightInfo.notUsefulN,
                note: weightInfo.note,
                noteZh: weightInfo.learningNoteZh,
            };
        const features = [
            { key: 'semantic', label: '语义相近', score: Number(bd.semantic ?? 0), weight: weights.semantic },
            { key: 'keyword', label: '关键词重合', score: Number(bd.keyword ?? 0), weight: weights.keyword },
            { key: 'discipline', label: '学科/行业', score: Number(bd.discipline ?? 0), weight: weights.discipline },
            { key: 'region', label: '地域契合', score: Number(bd.region ?? 0), weight: weights.region },
            { key: 'trlFit', label: '成熟度(TRL)', score: Number(bd.trlFit ?? 0), weight: weights.trlFit },
            { key: 'rightsFit', label: '知识产权契合', score: Number(bd.rightsFit ?? 0.5), weight: 0.05 },
            { key: 'trustBoost', label: '信任金标加成', score: Number(bd.trustBoost ?? 0), weight: 1 },
        ].map((f) => ({
            ...f,
            contribution: Math.round(f.score * f.weight * 1000) / 1000,
            pctOfTotal: m.totalScore ? Math.round(((f.score * f.weight) / m.totalScore) * 1000) / 10 : 0,
        }));
        for (const f of features) {
            if (f.key === 'trustBoost') {
                f.contribution = f.score;
                f.pctOfTotal = m.totalScore ? Math.round((f.score / m.totalScore) * 1000) / 10 : 0;
            }
            if (f.key === 'rightsFit') {
                const bonus = Number(bd.rightsBonus ?? 0);
                f.contribution = bonus;
                f.pctOfTotal = m.totalScore ? Math.round((bonus / m.totalScore) * 1000) / 10 : 0;
            }
        }
        features.sort((a, b) => b.contribution - a.contribution);
        const supplyTitle = m.capability?.title || m.outcome?.title || '';
        const supplyOrg = m.capability?.org?.name || m.outcome?.org?.name || '';
        const conflictPack = bd.conflicts ||
            detectRightsConflicts({
                licenseNeed: m.demand?.licenseNeed,
                minTrl: m.demand?.minTrl,
                expectedOut: m.demand?.expectedOut,
                problem: m.demand?.problem,
                title: m.demand?.title,
            }, {
                licenseOpenness: trustSignals.licenseOpenness,
                rights: trustSignals.rights,
                trl: trustSignals.trl,
                readinessBand: trustSignals.readinessBand,
                title: supplyTitle,
            });
        const conflicts = Array.isArray(conflictPack)
            ? conflictPack
            : conflictPack.conflicts || [];
        const conflictSummaryZh = conflicts.length
            ? `发现 ${conflicts.length} 项权利/成熟度提示：` + conflicts.map((c) => c.labelZh).join('、')
            : '未见明显权利/成熟度冲突。';
        const base = {
            id: m.id,
            totalScore: m.totalScore,
            status: m.status,
            reason: m.reason,
            whyThisPair: m.reason || '尚无自动说明，请看贡献分条。',
            hardPass: bd.hardPass !== false,
            embeddingMode: bd.embeddingMode || null,
            features,
            demand: {
                id: m.demandId,
                title: m.demand?.title,
                org: m.demand?.org?.name,
                industry: m.demand?.industry,
                region: m.demand?.regionPref,
            },
            supply: {
                kind: m.capabilityId ? 'capability' : 'outcome',
                id: m.capabilityId || m.outcomeId,
                title: supplyTitle,
                org: supplyOrg,
                trl: trustSignals.trl,
                rights: trustSignals.rights,
                ipOwnership: trustSignals.ipOwnership,
                licenseOpenness: trustSignals.licenseOpenness,
                readinessBand: trustSignals.readinessBand,
            },
            trust: trustSignals,
            conflicts,
            conflictSummaryZh,
            broker: m.broker || null,
            leads: fields === 'core' ? [] : m.leads || [],
            operatorNote: m.operatorNote,
            followUpStatus: m.followUpStatus || null,
            dossier: this.dossierView(m),
            learning: learningBlock,
            recentFeedback: recentFb,
            softRescore,
            diversityExplain: bd.diversityExplain || null,
            diversityExplainZh: bd.diversityExplain?.tipZh ||
                (bd.diversityExplain?.reasonSnippetsZh || [])[0] ||
                null,
            diversityBypassContrast: bd.diversityExplain?.bypassContrast || null,
            diversityBypassContrastZh: bd.diversityExplain?.bypassContrast?.tipZh || null,
        };
        const body = {
            ...base,
            onePager: this.buildOnePager(base),
            fields,
            wave: 'M75',
            cache: 'MISS',
            tipZh: fields === 'core'
                ? '解释页核心字段：贡献分 + 供需摘要；学习权重/反馈请用 ?fields=full。'
                : '完整解释（含学习权重与近期反馈）。' +
                    (base.diversityExplainZh ? ' · ' + String(base.diversityExplainZh).slice(0, 60) : ''),
            opsPeekZh: base.diversityBypassContrastZh
                ? `【旁路对照】${String(base.diversityBypassContrastZh).slice(0, 120)}`
                : base.diversityExplainZh
                    ? `【多样性】${String(base.diversityExplainZh).slice(0, 120)}`
                    : null,
        };
        const { createHash } = require('crypto');
        const etag = 'W/"ex-' + createHash('sha1').update(JSON.stringify({ id: body.id, score: body.totalScore, f: fields })).digest('hex').slice(0, 16) + '"';
        body.etag = etag;
        body.timingMs = Date.now() - t0;
        this.explainCache.set(cacheKey, {
            at: now,
            etag,
            body: { ...body, cache: undefined, timingMs: undefined },
        });
        if (this.explainCache.size > 240) {
            const oldest = [...this.explainCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (oldest)
                this.explainCache.delete(oldest[0]);
        }
        return body;
    }
    buildOnePager(x) {
        const scorePct = Math.round(Number(x.totalScore || 0) * 100);
        const topFeats = (x.features || []).slice(0, 3);
        const whyBullets = [];
        if (x.dossier?.teacher?.name)
            whyBullets.push(`建议对接：${x.dossier.teacher.name}。`);
        if (x.dossier?.collabModeLabel)
            whyBullets.push(`建议合作方式：${x.dossier.collabModeLabel}。`);
        if (x.dossier?.actionZh)
            whyBullets.push(`下一步：${x.dossier.actionZh}。`);
        if (x.whyThisPair) {
            const parts = String(x.whyThisPair)
                .split(/[。；;]/)
                .map((s) => s.trim())
                .filter(Boolean);
            for (const p of parts.slice(0, 4))
                whyBullets.push(p.endsWith('。') ? p : p + '。');
        }
        for (const f of topFeats) {
            if (f.contribution > 0.05) {
                whyBullets.push(`${f.label}贡献约 ${Math.round(f.pctOfTotal || 0)}%（权重已计入总分）。`);
            }
        }
        const divEx = x.diversityExplain || {};
        const divSnips = Array.isArray(divEx.reasonSnippetsZh)
            ? divEx.reasonSnippetsZh
            : divEx.tipZh
                ? [divEx.tipZh]
                : [];
        for (const s of divSnips.slice(0, 2)) {
            if (s)
                whyBullets.push(String(s));
        }
        const seen = new Set();
        const uniqWhy = whyBullets.filter((b) => {
            if (seen.has(b))
                return false;
            seen.add(b);
            return true;
        }).slice(0, 5);
        if (!uniqWhy.length)
            uniqWhy.push('系统按语义、关键词与学科综合打分后推荐这一对。');
        const riskCues = [];
        for (const c of x.conflicts || []) {
            riskCues.push({
                level: c.severity || c.level || 'warn',
                textZh: c.labelZh || c.message || String(c),
            });
        }
        if (x.hardPass === false) {
            riskCues.unshift({ level: 'warn', textZh: '硬门槛偏弱，建议人审后再推进。' });
        }
        if (!riskCues.length) {
            riskCues.push({ level: 'ok', textZh: '暂未见明显权利或成熟度冲突。' });
        }
        const rightsCues = [];
        const s = x.supply || {};
        if (s.rights)
            rightsCues.push(`权利概况：${s.rights}`);
        if (s.ipOwnership)
            rightsCues.push(`知识产权归属线索：${s.ipOwnership}`);
        if (s.licenseOpenness)
            rightsCues.push(`开放许可：${s.licenseOpenness === 'unclear' ? '尚不清晰，对接前请核实' : s.licenseOpenness}`);
        if (s.trl != null)
            rightsCues.push(`成熟度约 TRL ${s.trl}${s.readinessBand ? `（${s.readinessBand}）` : ''}`);
        if (!rightsCues.length)
            rightsCues.push('权利与成熟度信息较少，建议经纪人协助核实。');
        const follow = x.followUpStatus || x.status || '';
        let nextStep = {
            labelZh: '请求联系 / 确认意向',
            whyZh: '双方点头后，再让经纪人牵线。',
            forRole: {
                enterprise: '若对得上，点「确认有意向」或「请求联系」。',
                research: '若愿意谈，点「有意向」；不合适就婉拒，别晾着。',
                broker: '先打个招呼确认时间，再推进状态。',
            },
        };
        if (['interested', 'CONTACTED'].includes(follow)) {
            nextStep = {
                labelZh: '推进材料与会面',
                whyZh: '已有意向，补齐保密与样品范围即可往前。',
                forRole: {
                    enterprise: '准备现场卡点说明与可公开的工艺边界。',
                    research: '准备可对外的能力边界与合作方式。',
                    broker: '约三方短会，对齐预算与时间表。',
                },
            };
        }
        else if (['closed_won', 'CLOSED'].includes(follow)) {
            nextStep = {
                labelZh: '已收口，可沉淀案例',
                whyZh: '脱敏后可供园区观察台引用。',
                forRole: {
                    enterprise: '如需复盘，找运营导出对接摘要。',
                    research: '可把可公开摘要交给运营做案例。',
                    broker: '标记成交原因，便于佣金与复盘。',
                },
            };
        }
        else if (['REJECTED', 'closed_lost'].includes(follow)) {
            nextStep = {
                labelZh: '已关闭，换下一条',
                whyZh: '这条不对就别纠缠，把精力放在更高分的单。',
                forRole: {
                    enterprise: '看看收件箱里其他推荐。',
                    research: '继续完善能力卡，等下一波企业意向。',
                    broker: '记流失原因，避免同类空转。',
                },
            };
        }
        const demandTitle = x.demand?.title || '需求';
        const supplyTitle = x.supply?.title || '供给';
        const headlineZh = scorePct >= 70
            ? `比较对得上：${demandTitle}`
            : scorePct >= 45
                ? `值得一看：${demandTitle}`
                : `参考推荐：${demandTitle}`;
        return {
            version: 1,
            matchId: x.id,
            headlineZh,
            pairLineZh: `${x.demand?.org || '需求方'} 的「${demandTitle}」↔ ${x.supply?.org || '供给方'} 的「${supplyTitle}」`,
            scoreLabelZh: `匹配度 ${scorePct} 分`,
            scorePct,
            statusZh: follow || x.status || '',
            whyBullets: uniqWhy,
            topFeatures: topFeats.map((f) => ({
                label: f.label,
                pctOfTotal: f.pctOfTotal,
                contribution: f.contribution,
            })),
            riskCues,
            rightsCues,
            conflictSummaryZh: x.conflictSummaryZh,
            diversityExplain: x.diversityExplain || null,
            diversityExplainZh: x.diversityExplainZh || (x.diversityExplain && x.diversityExplain.tipZh) || null,
            diversityBypassContrast: x.diversityBypassContrast || x.diversityExplain?.bypassContrast || null,
            diversityBypassContrastZh: x.diversityBypassContrastZh ||
                x.diversityExplain?.bypassContrast?.tipZh ||
                null,
            opsPeekZh: (x.diversityBypassContrastZh || x.diversityExplain?.bypassContrast?.tipZh)
                ? `【旁路对照】${String(x.diversityBypassContrastZh || x.diversityExplain?.bypassContrast?.tipZh).slice(0, 100)}`
                : x.diversityExplainZh
                    ? `【为何替下同机构】${String(x.diversityExplainZh).slice(0, 100)}`
                    : x.diversityExplain?.tipZh
                        ? `【为何替下同机构】${String(x.diversityExplain.tipZh).slice(0, 100)}`
                        : null,
            nextStep,
            trustNoteZh: '说明来自匹配模型与权利检查，重要结论仍以人审与合同为准。',
            footerZh: '研企通 · 匹配一页纸（可转发内部讨论，勿对外泄露未脱敏信息）',
            wave: 'M75',
        };
    }
    normalizeTier(tier) {
        const t = String(tier || 'full').toLowerCase();
        if (t === 'partner' || t === 'public' || t === 'full')
            return t;
        if (t === 'public-desensitized' || t === 'desensitized' || t === '对外')
            return 'public';
        return 'full';
    }
    applyOnePagerTier(op, tierRaw) {
        const tier = this.normalizeTier(tierRaw);
        const meta = MatchesService.TIER_META[tier];
        if (!op)
            return { onePager: null, tier, tierMeta: meta };
        const clone = JSON.parse(JSON.stringify(op));
        clone.shareTier = tier;
        clone.shareTierZh = meta.labelZh;
        clone.shareBlurbZh = meta.blurbZh;
        if (tier === 'full') {
            clone.footerZh = '研企通 · 匹配一页纸（全量内部版，勿对外泄露未脱敏信息）';
            return { onePager: clone, tier, tierMeta: meta };
        }
        const soften = (s) => String(s || '')
            .replace(/([\u4e00-\u9fa5A-Za-z]{2,})(大学|学院|研究院|公司|集团|有限公司|股份)/g, '某$2')
            .replace(/\b[A-Z]{2,}[\w.-]*\b/g, '某机构');
        if (clone.pairLineZh)
            clone.pairLineZh = soften(clone.pairLineZh);
        if (Array.isArray(clone.whyBullets)) {
            clone.whyBullets = clone.whyBullets.map((b) => soften(b));
        }
        if (tier === 'partner') {
            clone.rightsCues = (clone.rightsCues || [])
                .map((t) => {
                if (/知识产权|归属|合同|金额|联系/.test(t))
                    return '权利与合同细节请线下对齐（合作方版已省略原文）。';
                return soften(t);
            })
                .slice(0, 3);
            if (!clone.rightsCues.length)
                clone.rightsCues = ['合作方版：权利细节请双方线下核实。'];
            clone.footerZh = '研企通 · 合作方一页纸（可转对接人，勿再公开扩散）';
            clone.trustNoteZh = '合作方可见版：重要结论仍以人审与合同为准。';
        }
        else {
            const band = clone.scorePct >= 70 ? '较高匹配' : clone.scorePct >= 45 ? '值得一看' : '参考推荐';
            clone.scoreLabelZh = band;
            clone.scorePct = clone.scorePct >= 70 ? 70 : clone.scorePct >= 45 ? 50 : 30;
            clone.topFeatures = [];
            clone.rightsCues = ['对外版不展示具体权利与成熟度原文，请以正式公示材料为准。'];
            clone.riskCues = [{ level: 'ok', textZh: '对外脱敏：不含组织真名与联系方式。' }];
            clone.whyBullets = (clone.whyBullets || [])
                .filter((b) => !/建议对接|对接人|老师|邮箱|电话|证据|把握/.test(String(b)))
                .slice(0, 2)
                .map((b) => soften(b).replace(/\d+(\.\d+)?%/g, '一定比例'));
            if (!clone.whyBullets.length)
                clone.whyBullets = ['双方在相关技术方向上具备对接基础（已脱敏）。'];
            clone.headlineZh = soften(clone.headlineZh || '对接案例');
            clone.pairLineZh = soften(clone.pairLineZh || '某需求方 ↔ 某供给方');
            clone.nextStep = {
                labelZh: '了解公开进展',
                whyZh: '对外版仅作参考，正式合作请走园区/平台流程。',
                forRole: {
                    enterprise: '若感兴趣，请登录企业工作台查看全量版或联系经纪人。',
                    research: '若愿意公开更多，请联系运营做正式案例。',
                    broker: '对外转发请用本分级；谈单仍用全量版。',
                },
            };
            clone.footerZh = '研企通 · 对外脱敏一页纸（可公示口径）';
            clone.trustNoteZh = '本页为公开脱敏版，不含真名、精确分与权利原文。';
            clone.conflictSummaryZh = null;
        }
        return { onePager: clone, tier, tierMeta: meta };
    }
    shareStorePath() {
        const path = require('path');
        return path.join(process.cwd(), '.data', 'one-pager-shares.json');
    }
    readShares() {
        const fs = require('fs');
        const p = this.shareStorePath();
        try {
            if (!fs.existsSync(p))
                return { version: 1, items: [] };
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!Array.isArray(raw.items))
                raw.items = [];
            return raw;
        }
        catch {
            return { version: 1, items: [] };
        }
    }
    writeShares(pack) {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(process.cwd(), '.data');
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        pack.version = 1;
        fs.writeFileSync(this.shareStorePath(), JSON.stringify(pack, null, 2), 'utf8');
    }
    listOnePagerTiers() {
        return {
            ok: true,
            wave: 'M34-receipt-pdf-parkdocs-billremind',
            noteZh: '一页纸分享分三级：全量内部 / 合作方 / 对外脱敏。链接带分级，接口按级裁剪字段。',
            tiers: Object.values(MatchesService.TIER_META),
        };
    }
    cardFace(card) {
        if (!card) return null;
        const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
        return {
            publishStatus: card.publishStatus,
            quarantine: Boolean(ext.quarantine),
            source: ext.source,
        };
    }
    externalFace(match) {
        return shared.externalShareBlock({
            action: match?.scoreBreakdown?.action,
            cards: [this.cardFace(match?.demand), this.cardFace(match?.capability), this.cardFace(match?.outcome)].filter(Boolean),
        });
    }
    withheldSheetHtml(message) {
        const text = String(message || '这条还不能对外展示');
        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>还不能对外展示</title></head><body style="font-family:sans-serif;padding:24px"><h1>还不能对外展示</h1><p>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p></body></html>`;
    }
    async createOnePagerShare(matchId, tierRaw, actor, opts = {}) {
        const match = await this.get(matchId);
        await this.onePager(matchId);
        const tier = this.normalizeTier(tierRaw || 'partner');
        const block = tier === 'full' ? null : this.externalFace(match);
        const { randomBytes } = require('crypto');
        const token = randomBytes(18).toString('hex');
        const now = new Date();
        const days = Math.min(90, Math.max(1, Number(opts.expiresDays || 14)));
        const expiresAt = new Date(now.getTime() + days * 86400_000).toISOString();
        const pack = this.readShares();
        const existing = pack.items.find((x) => x.matchId === matchId && x.tier === tier && x.expiresAt > now.toISOString() && !x.revoked);
        if (existing) {
            return {
                ok: true,
                idempotent: true,
                readable: !block,
                share: existing,
                urlPath: block ? null : `/match-sheet.html?share=${existing.token}`,
                apiPath: `/api/matches/one-pager/s/${existing.token}`,
                tierMeta: MatchesService.TIER_META[tier],
                noteZh: block ? block.message + '。这条链接打开时不会展示内容。' : '已有未过期同级分享链接，直接复用。',
            };
        }
        const row = {
            token,
            matchId,
            tier,
            actor,
            createdAt: now.toISOString(),
            expiresAt,
            revoked: false,
            withheld: Boolean(block),
        };
        pack.items.unshift(row);
        pack.items = pack.items.slice(0, 500);
        this.writeShares(pack);
        return {
            ok: true,
            idempotent: false,
            readable: !block,
            share: row,
            urlPath: block ? null : `/match-sheet.html?share=${token}`,
            apiPath: `/api/matches/one-pager/s/${token}`,
            tierMeta: MatchesService.TIER_META[tier],
            noteZh: block
                ? block.message + '。链接已记下，打开时不会展示内容。'
                : tier === 'full'
                    ? '全量链接仍建议仅内部打开；打开页会要求登录。'
                    : '可将链接转给对应受众；打开时按分级自动脱敏。',
        };
    }
    async getSharedOnePager(token) {
        const pack = this.readShares();
        const row = pack.items.find((x) => x.token === token);
        if (!row || row.revoked) {
            const { NotFoundException } = require('@nestjs/common');
            throw new NotFoundException('分享链接无效或已撤销');
        }
        if (row.expiresAt && row.expiresAt < new Date().toISOString()) {
            const { BadRequestException } = require('@nestjs/common');
            throw new BadRequestException('分享链接已过期，请让对方重新生成');
        }
        if (row.tier !== 'full') {
            const match = await this.get(row.matchId);
            const block = this.externalFace(match);
            if (block) {
                const { NotFoundException } = require('@nestjs/common');
                throw new NotFoundException(block.message);
            }
        }
        const data = await this.onePager(row.matchId, row.tier);
        return {
            ok: true,
            share: {
                token: row.token,
                tier: row.tier,
                tierZh: MatchesService.TIER_META[row.tier]?.labelZh,
                expiresAt: row.expiresAt,
                matchId: row.tier === 'public' ? undefined : row.matchId,
            },
            onePager: data.onePager,
            demand: row.tier === 'full' ? data.demand : undefined,
            supply: row.tier === 'full' ? data.supply : undefined,
            noteZh: MatchesService.TIER_META[row.tier]?.blurbZh,
        };
    }
    shareStatusZh(row) {
        if (row.revoked)
            return '已撤销';
        if (row.expiresAt && row.expiresAt < new Date().toISOString())
            return '已过期';
        return '有效';
    }
    listOnePagerShares(opts = {}) {
        const pack = this.readShares();
        const now = new Date().toISOString();
        let items = pack.items.slice();
        if (opts.matchId)
            items = items.filter((x) => x.matchId === opts.matchId);
        if (!opts.isOps && opts.actor) {
            items = items.filter((x) => x.actor === opts.actor);
        }
        if (!opts.includeDead) {
            items = items.filter((x) => !x.revoked && (!x.expiresAt || x.expiresAt >= now));
        }
        const enriched = items.map((x) => ({
            ...x,
            tierZh: MatchesService.TIER_META[x.tier]?.labelZh || x.tier,
            statusZh: this.shareStatusZh(x),
            alive: !x.revoked && (!x.expiresAt || x.expiresAt >= now),
            urlPath: `/match-sheet.html?share=${x.token}`,
            apiPath: `/api/matches/one-pager/s/${x.token}`,
        }));
        return {
            ok: true,
            wave: 'M34-receipt-pdf-parkdocs-billremind',
            noteZh: '我的分享台账：可撤销或改过期时间；公开令牌会拒绝已撤销/已过期链接。',
            counts: {
                total: enriched.length,
                alive: enriched.filter((x) => x.alive).length,
                revoked: enriched.filter((x) => x.revoked).length,
                expired: enriched.filter((x) => !x.revoked && x.expiresAt && x.expiresAt < now).length,
            },
            items: enriched,
        };
    }
    revokeOnePagerShare(token, actor, isOps = false) {
        const pack = this.readShares();
        const row = pack.items.find((x) => x.token === token);
        if (!row) {
            const { NotFoundException } = require('@nestjs/common');
            throw new NotFoundException('分享不存在');
        }
        if (!isOps && row.actor && actor && row.actor !== actor) {
            const { ForbiddenException } = require('@nestjs/common');
            throw new ForbiddenException('只能撤销自己创建的分享');
        }
        if (row.revoked) {
            return { ok: true, idempotent: true, share: row, noteZh: '该分享此前已撤销。' };
        }
        row.revoked = true;
        row.revokedAt = new Date().toISOString();
        row.revokedBy = actor;
        this.writeShares(pack);
        return {
            ok: true,
            idempotent: false,
            share: { ...row, statusZh: '已撤销', alive: false },
            noteZh: '已撤销。公开令牌立刻失效。',
        };
    }
    setOnePagerShareExpiry(token, actor, opts = {}, isOps = false) {
        const pack = this.readShares();
        const row = pack.items.find((x) => x.token === token);
        if (!row) {
            const { NotFoundException } = require('@nestjs/common');
            throw new NotFoundException('分享不存在');
        }
        if (!isOps && row.actor && actor && row.actor !== actor) {
            const { ForbiddenException } = require('@nestjs/common');
            throw new ForbiddenException('只能改自己创建的分享过期时间');
        }
        if (row.revoked) {
            const { BadRequestException } = require('@nestjs/common');
            throw new BadRequestException('已撤销的分享不能改过期；请重新生成链接');
        }
        let expiresAt;
        if (opts.expiresAt) {
            const d = new Date(opts.expiresAt);
            if (Number.isNaN(d.getTime())) {
                const { BadRequestException } = require('@nestjs/common');
                throw new BadRequestException('过期时间格式不对');
            }
            expiresAt = d.toISOString();
        }
        else {
            const days = Math.min(90, Math.max(1, Number(opts.expiresDays || 14)));
            expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
        }
        row.expiresAt = expiresAt;
        row.expiryUpdatedAt = new Date().toISOString();
        row.expiryUpdatedBy = actor;
        this.writeShares(pack);
        return {
            ok: true,
            share: { ...row, statusZh: this.shareStatusZh(row), alive: this.shareStatusZh(row) === '有效' },
            noteZh: `过期时间已更新为 ${expiresAt.slice(0, 19).replace('T', ' ')}（UTC）。`,
        };
    }
    async explainMatchForSheet(id) {
        const m = await this.get(id);
        const bd = m.scoreBreakdown || {};
        const weights = bd.weights || { ...DEFAULT_WEIGHTS };
        const features = [
            { key: 'semantic', label: '语义相近', score: Number(bd.semantic ?? 0), weight: weights.semantic },
            { key: 'keyword', label: '关键词重合', score: Number(bd.keyword ?? 0), weight: weights.keyword },
            { key: 'discipline', label: '学科/行业', score: Number(bd.discipline ?? 0), weight: weights.discipline },
            { key: 'region', label: '地域契合', score: Number(bd.region ?? 0), weight: weights.region },
            { key: 'trlFit', label: '成熟度(TRL)', score: Number(bd.trlFit ?? 0), weight: weights.trlFit },
            { key: 'rightsFit', label: '知识产权契合', score: Number(bd.rightsFit ?? 0.5), weight: 0.05 },
            { key: 'trustBoost', label: '信任金标加成', score: Number(bd.trustBoost ?? 0), weight: 1 },
        ].map((f) => ({
            ...f,
            contribution: Math.round(f.score * f.weight * 1000) / 1000,
            pctOfTotal: m.totalScore ? Math.round(((f.score * f.weight) / m.totalScore) * 1000) / 10 : 0,
        }));
        for (const f of features) {
            if (f.key === 'trustBoost') {
                f.contribution = f.score;
                f.pctOfTotal = m.totalScore ? Math.round((f.score / m.totalScore) * 1000) / 10 : 0;
            }
            if (f.key === 'rightsFit') {
                const bonus = Number(bd.rightsBonus ?? 0);
                f.contribution = bonus;
                f.pctOfTotal = m.totalScore ? Math.round((bonus / m.totalScore) * 1000) / 10 : 0;
            }
        }
        features.sort((a, b) => b.contribution - a.contribution);
        const supplyTitle = m.capability?.title || m.outcome?.title || '';
        const supplyOrg = m.capability?.org?.name || m.outcome?.org?.name || '';
        const trustSignals = await this.trust.signalsForMatch(m);
        const conflictPack = bd.conflicts ||
            detectRightsConflicts({
                licenseNeed: m.demand?.licenseNeed,
                minTrl: m.demand?.minTrl,
                expectedOut: m.demand?.expectedOut,
                problem: m.demand?.problem,
                title: m.demand?.title,
            }, {
                licenseOpenness: trustSignals.licenseOpenness,
                rights: trustSignals.rights,
                trl: trustSignals.trl,
                readinessBand: trustSignals.readinessBand,
                title: supplyTitle,
            });
        const conflicts = Array.isArray(conflictPack) ? conflictPack : conflictPack.conflicts || [];
        const conflictSummaryZh = conflicts.length
            ? `发现 ${conflicts.length} 项权利/成熟度提示：` + conflicts.map((c) => c.labelZh).join('、')
            : '未见明显权利/成熟度冲突。';
        const base = {
            id: m.id,
            totalScore: m.totalScore,
            status: m.status,
            reason: m.reason,
            whyThisPair: m.reason || '尚无自动说明，请看贡献分条。',
            hardPass: bd.hardPass !== false,
            embeddingMode: bd.embeddingMode || null,
            features,
            demand: {
                id: m.demandId,
                title: m.demand?.title,
                org: m.demand?.org?.name,
                industry: m.demand?.industry,
                region: m.demand?.regionPref,
            },
            supply: {
                kind: m.capabilityId ? 'capability' : 'outcome',
                id: m.capabilityId || m.outcomeId,
                title: supplyTitle,
                org: supplyOrg,
                trl: trustSignals.trl,
                rights: trustSignals.rights,
                ipOwnership: trustSignals.ipOwnership,
                licenseOpenness: trustSignals.licenseOpenness,
                readinessBand: trustSignals.readinessBand,
            },
            trust: trustSignals,
            conflicts,
            conflictSummaryZh,
            broker: m.broker || null,
            leads: [],
            operatorNote: m.operatorNote,
            followUpStatus: m.followUpStatus || null,
            dossier: this.dossierView(m),
            learning: null,
            recentFeedback: [],
            softRescore: null,
            sheetSlim: true,
        };
        return { ...base, onePager: this.buildOnePager(base) };
    }
    bustExplainCache(matchId) {
        if (!matchId) {
            this.explainCache.clear();
            return { cleared: 'all' };
        }
        let n = 0;
        for (const k of [...this.explainCache.keys()]) {
            if (k.startsWith(matchId + '|')) {
                this.explainCache.delete(k);
                n++;
            }
        }
        return { cleared: n };
    }
    bustOnePagerCache(matchId) {
        if (!matchId) {
            this.onePagerCache.clear();
            return { cleared: 'all' };
        }
        let n = 0;
        for (const k of [...this.onePagerCache.keys()]) {
            if (k.startsWith(matchId + '|')) {
                this.onePagerCache.delete(k);
                n++;
            }
        }
        return { cleared: n };
    }
    prewarmQueuePath(tenantId, queueId) {
        const path = require('path');
        const fs = require('fs');
        const dir = path.join(process.cwd(), '.data', 'tenants', this.safeTenantId(tenantId), 'prewarm-queues');
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, `${queueId}.json`);
    }
    safeTenantId(tenantId) {
        return String(tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
    }
    demandCheckpointPersistPath(tenantId) {
        const path = require('path');
        const fs = require('fs');
        const dir = path.join(process.cwd(), '.data', 'tenants', this.safeTenantId(tenantId));
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, 'match-demand-checkpoints.json');
    }
    readDemandCheckpointPersist(tenantId) {
        const fs = require('fs');
        const p = this.demandCheckpointPersistPath(tenantId);
        if (!fs.existsSync(p))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return null;
        }
    }
    writeDemandCheckpointPersist(tenantId, pack) {
        const fs = require('fs');
        const p = this.demandCheckpointPersistPath(tenantId);
        const body = {
            ...pack,
            tenantId: this.safeTenantId(tenantId),
            updatedAt: new Date().toISOString(),
            wave: 'M82',
            labelZh: 'demandId×phase 检查点跨进程落盘（写库快照压缩/增量）',
        };
        fs.writeFileSync(p, JSON.stringify(body, null, 0), 'utf8');
        return p;
    }
    annPoolWarmPersistPath(tenantId) {
        const path = require('path');
        const fs = require('fs');
        const dir = path.join(process.cwd(), '.data', 'tenants', this.safeTenantId(tenantId));
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, 'match-ann-pool-warm.json');
    }
    readAnnPoolWarmPersist(tenantId) {
        const fs = require('fs');
        const p = this.annPoolWarmPersistPath(tenantId);
        if (!fs.existsSync(p))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return null;
        }
    }
    writeAnnPoolWarmPersist(tenantId, byDemandId, extra = {}) {
        const fs = require('fs');
        const p = this.annPoolWarmPersistPath(tenantId);
        const entries = Object.entries(byDemandId || {}).slice(-200);
        const adaptedPoolN = extra.adaptedPoolN != null
            ? Math.max(1, Math.min(4, Number(extra.adaptedPoolN) || 2))
            : undefined;
        const body = {
            byDemandId: Object.fromEntries(entries),
            count: entries.length,
            adaptedPoolN: adaptedPoolN ?? null,
            capacityAdapt: extra.capacityAdapt || null,
            tenantId: this.safeTenantId(tenantId),
            updatedAt: new Date().toISOString(),
            wave: 'M82',
            labelZh: 'ANN 召回池按 demandId 续热落盘（冷却×背压联动）',
            tipZh: `ANN 预热池落盘 ${entries.length} 条 demandId` +
                (adaptedPoolN != null ? ` · 自适应容量×${adaptedPoolN}` : '') +
                '；进程重启可按 demandId 续热并恢复池容量。',
        };
        fs.writeFileSync(p, JSON.stringify(body, null, 0), 'utf8');
        return p;
    }
    writePrewarmQueue(tenantId, queue) {
        const fs = require('fs');
        const p = this.prewarmQueuePath(tenantId, queue.id);
        fs.writeFileSync(p, JSON.stringify(queue, null, 2), 'utf8');
        return p;
    }
    readPrewarmQueue(tenantId, queueId) {
        const fs = require('fs');
        const p = this.prewarmQueuePath(tenantId, queueId);
        if (!fs.existsSync(p))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return null;
        }
    }
    async prewarmTopNOnePagers(matchIds, opts = {}) {
        const tenantId = this.safeTenantId(opts.tenantId || 'default');
        const alsoExplainCore = opts.alsoExplainCore !== false;
        let ids = [...new Set((matchIds || []).filter(Boolean))];
        let queueId = opts.queueId || null;
        if (opts.resume && queueId) {
            const q = this.readPrewarmQueue(tenantId, queueId);
            if (q && Array.isArray(q.remainingIds)) {
                ids = q.remainingIds.filter(Boolean);
            }
        }
        if (!queueId) {
            queueId = `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        }
        const tier = this.normalizeTier(opts.tier || 'partner');
        const cancelCheck = typeof opts.cancelCheck === 'function' ? opts.cancelCheck : () => false;
        const concurrency = Math.max(1, Math.min(4, Number(opts.concurrency || process.env.ONE_PAGER_PREWARM_CONCURRENCY || 2)));
        let warmed = 0;
        let warmedExplainCore = 0;
        let skippedCancel = 0;
        let errors = 0;
        let cursor = 0;
        const remainingIds = [];
        let cancelLatched = false;
        const worker = async () => {
            while (true) {
                if (cancelCheck() || cancelLatched) {
                    cancelLatched = true;
                    skippedCancel++;
                    return;
                }
                const i = cursor++;
                if (i >= ids.length)
                    return;
                const id = ids[i];
                try {
                    const tasks = [
                        this.onePager(id, tier, { slim: true, fields: 'sheet' }),
                    ];
                    if (alsoExplainCore) {
                        tasks.push(this.explainMatch(id, { fields: 'core' }));
                    }
                    const results = await Promise.allSettled(tasks);
                    if (results[0].status === 'fulfilled')
                        warmed++;
                    else
                        errors++;
                    if (alsoExplainCore) {
                        if (results[1] && results[1].status === 'fulfilled')
                            warmedExplainCore++;
                        else if (results[1])
                            errors++;
                    }
                }
                catch (_) {
                    errors++;
                }
                if (cancelCheck()) {
                    cancelLatched = true;
                    for (let j = cursor; j < ids.length; j++)
                        remainingIds.push(ids[j]);
                    skippedCancel++;
                    return;
                }
            }
        };
        const n = Math.min(concurrency, Math.max(1, ids.length));
        if (ids.length)
            await Promise.all(Array.from({ length: n }, () => worker()));
        if (cancelLatched) {
            const seen = new Set(remainingIds);
            for (let j = cursor; j < ids.length; j++) {
                if (!seen.has(ids[j]))
                    remainingIds.push(ids[j]);
            }
        }
        const resumeAvailable = remainingIds.length > 0;
        this.writePrewarmQueue(tenantId, {
            id: queueId,
            tenantId,
            tier,
            alsoExplainCore,
            remainingIds,
            warmed,
            warmedExplainCore,
            requested: ids.length,
            status: resumeAvailable ? 'paused' : 'done',
            updatedAt: new Date().toISOString(),
            wave: 'M60',
        });
        return {
            requested: ids.length,
            warmed,
            warmedExplainCore,
            skippedCancel,
            errors,
            remainingIds,
            resumeAvailable,
            queueId,
            wave: 'M60',
            tipZh: resumeAvailable
                ? `预热已暂停：一页纸 ${warmed} · 解释核心 ${warmedExplainCore}；剩 ${remainingIds.length} 条可续跑队列 ${queueId}。`
                : warmed > 0
                    ? `已预热一页纸 ${warmed}/${ids.length}` +
                        (alsoExplainCore ? ` · 解释核心 ${warmedExplainCore}` : '') +
                        '；收件箱/解释页应近 0ms HIT。'
                    : ids.length
                        ? '预热未完成（取消或异常）；首次打开仍会回源。'
                        : '本轮无匹配可预热。',
        };
    }
    async resumePrewarmQueue(queueId, opts = {}) {
        const tenantId = this.safeTenantId(opts.tenantId || 'default');
        const q = this.readPrewarmQueue(tenantId, queueId);
        if (!q) {
            return {
                ok: false,
                wave: 'M60',
                messageZh: '找不到预热队列（可能已完成或租户不匹配）',
                tipZh: '请从统一任务卡续跑，或带 queueId 调用 prewarm/resume。',
            };
        }
        const remaining = Array.isArray(q.remainingIds) ? q.remainingIds : [];
        if (!remaining.length) {
            return {
                ok: true,
                wave: 'M59',
                queueId,
                resumed: false,
                tipZh: '该预热队列已无剩余。',
                onePagerPrewarm: {
                    requested: 0,
                    warmed: 0,
                    warmedExplainCore: 0,
                    remainingIds: [],
                    resumeAvailable: false,
                    queueId,
                    wave: 'M59',
                },
            };
        }
        const onePagerPrewarm = await this.prewarmTopNOnePagers(remaining, {
            cancelCheck: opts.cancelCheck,
            concurrency: opts.concurrency,
            tenantId,
            queueId,
            resume: true,
            tier: q.tier || 'partner',
            alsoExplainCore: q.alsoExplainCore !== false,
        });
        return {
            ok: true,
            wave: 'M59',
            queueId,
            resumed: true,
            tipZh: onePagerPrewarm.tipZh,
            onePagerPrewarm,
            busyClearZh: '预热续跑结束，可打开一页纸/解释页。',
        };
    }
    async onePager(id, tier = 'full', opts = {}) {
        const t0 = Date.now();
        const slim = opts.slim !== false;
        const fieldsRaw = String(opts.fields || (slim ? 'sheet' : 'full')).toLowerCase();
        const fields = fieldsRaw === 'full' || fieldsRaw === 'all' ? 'full' : 'sheet';
        const useSlimExplain = slim || fields === 'sheet';
        const cacheKey = `${id}|${this.normalizeTier(tier)}|${fields}|${useSlimExplain ? 'slim' : 'heavy'}`;
        const ttl = MatchesService.ONE_PAGER_TTL_MS;
        const now = Date.now();
        if (!opts.bypassCache) {
            const hit = this.onePagerCache.get(cacheKey);
            if (hit && now - hit.at < ttl) {
                return {
                    ...hit.body,
                    cache: 'HIT',
                    etag: hit.etag,
                    timingMs: Date.now() - t0,
                    payloadMode: useSlimExplain ? 'slim' : 'full',
                    fields,
                    wave: 'M58',
                };
            }
        }
        const full = useSlimExplain ? await this.explainMatchForSheet(id) : await this.explainMatch(id);
        const { onePager, tier: t, tierMeta } = this.applyOnePagerTier(full.onePager, tier);
        const body = {
            ok: true,
            tier: t,
            tierMeta,
            onePager,
            status: full.status,
            followUpStatus: full.followUpStatus,
            payloadMode: useSlimExplain ? 'slim' : 'full',
            fields,
            wave: 'M59',
            tipZh: fields === 'sheet'
                ? '首屏字段投影：仅一页纸正文（匹配后可服务端预热 ETag）。需要供需细项请加 ?fields=full。'
                : '完整附带供需摘要（对外 public 仍脱敏）。',
        };
        if (fields === 'full') {
            body.demand = t === 'public' ? undefined : full.demand;
            body.supply = t === 'public' ? undefined : full.supply;
            body.totalScore = t === 'public' ? undefined : full.totalScore;
        }
        const { createHash } = require('crypto');
        const etag = 'W/"op-' + createHash('sha1').update(JSON.stringify(body.onePager || {})).digest('hex').slice(0, 16) + '"';
        body.etag = etag;
        body.cache = 'MISS';
        body.timingMs = Date.now() - t0;
        this.onePagerCache.set(cacheKey, { at: now, etag, body: { ...body, cache: undefined, timingMs: undefined } });
        if (this.onePagerCache.size > 240) {
            const oldest = [...this.onePagerCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (oldest)
                this.onePagerCache.delete(oldest[0]);
        }
        return body;
    }
    async onePagerHtml(id, roleHint = '', tier = 'full') {
        const normalized = this.normalizeTier(tier);
        const matchRow = await this.get(id);
        const block = normalized === 'full' ? null : this.externalFace(matchRow);
        if (block) return { html: this.withheldSheetHtml(block.message), tier: normalized, withheld: true };
        const data = await this.onePager(id, normalized);
        const dossier = normalized === 'full' ? this.dossierView(matchRow) : null;
        const evidenceLine = ((dossier && dossier.evidence) || []).map((e) => e.title).filter(Boolean).join('、');
        const op = data.onePager || {};
        const esc = (s) => String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const why = (op.whyBullets || []).map((t) => `<li>${esc(t)}</li>`).join('');
        const risks = (op.riskCues || [])
            .map((r) => `<li class="${esc(r.level || 'warn')}">${esc(r.textZh || '')}</li>`)
            .join('');
        const rights = (op.rightsCues || []).map((t) => `<li>${esc(t)}</li>`).join('');
        const forRole = (op.nextStep && op.nextStep.forRole) || {};
        const roleLine = roleHint && forRole[roleHint] ? forRole[roleHint] : '';
        const feats = (op.topFeatures || [])
            .map((f) => `<tr><td>${esc(f.label)}</td><td style="text-align:right">${Math.round(f.pctOfTotal || 0)}%</td></tr>`)
            .join('');
        const bc = op.diversityBypassContrast || op.diversityExplain?.bypassContrast || null;
        const ft = bc?.foldableTable || null;
        const contrastRows = Array.isArray(ft?.rows) ? ft.rows : [];
        const contrastTableBody = contrastRows
            .map((r) => {
            const n = r.naive;
            const d = r.diversity;
            const nCell = n
                ? `${esc(n.title || '')}<br/><span style="color:#64748b;font-size:11px">${esc(n.org || '')} · ${esc(String(n.score ?? ''))}</span>`
                : '—';
            const dCell = d
                ? `${esc(d.title || '')}<br/><span style="color:#64748b;font-size:11px">${esc(d.org || '')} · ${esc(String(d.score ?? ''))}</span>`
                : '—';
            return `<tr><td style="width:40px">${esc(r.rank)}</td><td>${nCell}</td><td>${dCell}</td><td>${esc(r.changedZh || '')}</td></tr>`;
        })
            .join('');
        const contrastBlock = contrastTableBody
            ? `<details class="m75-bypass-fold" style="margin-top:12px">
  <summary style="cursor:pointer;font-weight:600">${esc(ft?.labelZh || '旁路对照表（可折叠）')} · ${esc(ft?.summaryZh || bc?.tipZh || '')}</summary>
  <p style="font-size:12px;color:#64748b;margin:6px 0">${esc(ft?.tipZh || '并排朴素 TopN vs 多样性 TopN')}</p>
  <table>
    <thead><tr><th>${esc(ft?.columnsZh?.rank || '名次')}</th><th>${esc(ft?.columnsZh?.naive || '朴素 TopN')}</th><th>${esc(ft?.columnsZh?.diversity || '多样性 TopN')}</th><th>${esc(ft?.columnsZh?.changed || '变化')}</th></tr></thead>
    <tbody>${contrastTableBody}</tbody>
  </table>
</details>`
            : bc?.tipZh
                ? `<p class="pair">【旁路对照】${esc(bc.tipZh)}</p>`
                : '';
        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${esc(op.headlineZh || '匹配一页纸')} · 研企通</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #0f172a; line-height: 1.55; margin: 0; padding: 24px; background: #fff; }
  .brand { font-size: 12px; color: #64748b; letter-spacing: .04em; margin-bottom: 6px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .pair { color: #475569; font-size: 13.5px; margin: 0 0 14px; }
  .score { display: inline-block; background: #eff6ff; color: #1d4ed8; font-weight: 700;
    padding: 4px 10px; border-radius: 999px; font-size: 13px; margin-right: 8px; }
  h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 0 0 6px; font-size: 13.5px; }
  li.ok { color: #065f46; } li.warn { color: #92400e; } li.danger { color: #991b1b; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  td { padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
  .next { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-top: 8px; }
  .next strong { display: block; margin-bottom: 4px; }
  .foot { margin-top: 22px; font-size: 11px; color: #94a3b8; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="brand">研企通 · 匹配一页纸 · ${esc(op.shareTierZh || '全量（内部）')}</div>
  <h1>${esc(op.headlineZh || '')}</h1>
  <div><span class="score">${esc(op.scoreLabelZh || '')}</span><span>${esc(op.statusZh || '')}</span></div>
  <p class="pair">${esc(op.pairLineZh || '')}</p>
  ${dossier ? `<h2>怎么对接</h2>
  <div class="next">
    <strong>${esc(dossier.actionZh || '下一步待定')}</strong>
    <div>对接：${esc(dossier.teacher?.name || '还没确定老师')}</div>
    <div>合作方式：${esc(dossier.collabModeLabel || '待定')}</div>
    <div>证据：${esc(evidenceLine || '暂无点名证据')}</div>
    <div>把握：${dossier.confidence != null ? Math.round(dossier.confidence * 100) + '%' : '—'}</div>
  </div>` : `<h2>怎么对接</h2>
  <div class="next">
    <strong>${esc(op.nextStep?.labelZh || '了解公开进展')}</strong>
    <div>${esc(op.nextStep?.whyZh || '对外版不点名老师，也不附联系方式。')}</div>
  </div>`}
  <h2>为什么推这一对</h2>
  <ul>${why || '<li>暂无说明</li>'}</ul>
  ${feats ? `<h2>贡献因子</h2><table>${feats}</table>` : ''}
  ${contrastBlock || ''}
  <h2>风险与提示</h2>
  <ul>${risks || '<li class="ok">暂无</li>'}</ul>
  <h2>权利与成熟度</h2>
  <ul>${rights || '<li>暂无</li>'}</ul>
  <h2>建议下一步</h2>
  <div class="next">
    <strong>${esc(op.nextStep?.labelZh || '')}</strong>
    <div>${esc(op.nextStep?.whyZh || '')}</div>
    ${roleLine ? `<div style="margin-top:6px;color:#334155">${esc(roleLine)}</div>` : ''}
  </div>
  <p class="foot">${esc(op.trustNoteZh || '')}<br/>${esc(op.footerZh || '')}<br/>导出时间 ${new Date().toISOString()}</p>
</body>
</html>`;
        return { ok: true, matchId: id, html, onePager: op };
    }
    async writeOnePagerHtmlFile(id, roleHint = '', tier = 'full') {
        const { html } = await this.onePagerHtml(id, roleHint, tier);
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const dir = path.join(process.cwd(), 'exports', 'one-pagers');
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${id}.html`);
        fs.writeFileSync(file, html, 'utf8');
        return { htmlPath: file, html };
    }
    async onePagerPdf(id, roleHint = '', tier = 'full') {
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const { htmlPath } = await this.writeOnePagerHtmlFile(id, roleHint, tier);
        const dir = path.join(process.cwd(), 'exports', 'one-pagers');
        const pdfPath = path.join(dir, `${id}.pdf`);
        const chrome = process.env.CHROME_PATH ||
            (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : 'google-chrome');
        const fileUrl = 'file://' + htmlPath;
        await new Promise((resolve, reject) => {
            const child = spawn(chrome, [
                '--headless=new',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                `--print-to-pdf=${pdfPath}`,
                '--no-pdf-header-footer',
                fileUrl,
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            let err = '';
            child.stderr.on('data', (d) => {
                err += String(d);
            });
            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0 && fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 500)
                    resolve();
                else
                    reject(new Error(err.slice(0, 400) || `chrome exit ${code}`));
            });
        });
        return {
            ok: true,
            matchId: id,
            pdfPath,
            htmlPath,
            bytes: fs.statSync(pdfPath).size,
            noteZh: '中文一页纸 PDF（Chrome 打印），可下载转发内部讨论。',
        };
    }
    async onePagerImage(id, roleHint = '', tier = 'full', format = 'png') {
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const { htmlPath } = await this.writeOnePagerHtmlFile(id, roleHint, tier);
        const dir = path.join(process.cwd(), 'exports', 'one-pagers');
        const pngPath = path.join(dir, `${id}.png`);
        const chrome = process.env.CHROME_PATH ||
            (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : 'google-chrome');
        const fileUrl = 'file://' + htmlPath;
        await new Promise((resolve, reject) => {
            const child = spawn(chrome, [
                '--headless=new',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                '--window-size=900,2400',
                `--screenshot=${pngPath}`,
                fileUrl,
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            let err = '';
            child.stderr.on('data', (d) => {
                err += String(d);
            });
            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0 && fs.existsSync(pngPath) && fs.statSync(pngPath).size > 800)
                    resolve();
                else
                    reject(new Error(err.slice(0, 400) || `chrome screenshot exit ${code}`));
            });
        });
        if (format === 'png') {
            return {
                ok: true,
                matchId: id,
                format: 'png',
                imagePath: pngPath,
                htmlPath,
                bytes: fs.statSync(pngPath).size,
                contentType: 'image/png',
                noteZh: '一页纸长图 PNG（Chrome 截屏），适合微信转发。',
            };
        }
        const jpegPath = path.join(dir, `${id}.jpg`);
        await new Promise((resolve, reject) => {
            const py = spawn('python3', [
                '-c',
                'from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert("RGB"); im.save(sys.argv[2],"JPEG",quality=88,optimize=True)',
                pngPath,
                jpegPath,
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            let err = '';
            py.stderr.on('data', (d) => {
                err += String(d);
            });
            py.on('error', reject);
            py.on('exit', (code) => {
                if (code === 0 && fs.existsSync(jpegPath) && fs.statSync(jpegPath).size > 500)
                    resolve();
                else
                    reject(new Error(err.slice(0, 300) || `pil jpeg exit ${code}`));
            });
        });
        return {
            ok: true,
            matchId: id,
            format: 'jpeg',
            imagePath: jpegPath,
            pngPath,
            htmlPath,
            bytes: fs.statSync(jpegPath).size,
            contentType: 'image/jpeg',
            noteZh: '一页纸长图 JPEG（PNG 转码），体积更小，适合微信。',
        };
    }
    async onePagerExportMeta(id) {
        return {
            ok: true,
            matchId: id,
            wave: 'M34-receipt-pdf-parkdocs-billremind',
            tiers: Object.values(MatchesService.TIER_META),
            endpoints: {
                json: `/api/matches/${id}/one-pager?tier=full`,
                html: `/api/matches/${id}/one-pager/html?tier=partner`,
                pdf: `/api/matches/${id}/one-pager/pdf?tier=public`,
                png: `/api/matches/${id}/one-pager/png?tier=public`,
                jpeg: `/api/matches/${id}/one-pager/jpeg?tier=public`,
                page: `/match-sheet.html?id=${encodeURIComponent(id)}`,
                share: `/api/matches/${id}/one-pager/share`,
                shares: `/api/matches/one-pager/shares?matchId=${encodeURIComponent(id)}`,
                tiers: `/api/matches/one-pager/tiers`,
            },
            noteZh: '导出支持 HTML/PDF/长图 PNG·JPEG；tier=full|partner|public；可分享/撤销/改过期。',
        };
    }
    async bulkUpdateStatus(ids, status, operatorNote) {
        const uniq = Array.from(new Set((ids || []).filter(Boolean)));
        if (!uniq.length)
            return { ok: false, count: 0, message: '没有选中任何匹配' };
        const allowed = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CONTACTED', 'CLOSED'];
        if (!allowed.includes(status))
            return { ok: false, count: 0, message: '状态不合法' };
        let count = 0;
        for (const id of uniq) {
            await this.updateStatus(id, status, operatorNote);
            count++;
        }
        return { ok: true, count, status };
    }
}
