import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export const DEFAULT_WEIGHTS = {
  semantic: 0.32,
  keyword: 0.3,
  discipline: 0.22,
  region: 0.06,
  trlFit: 0.1,
};

@Injectable()
export class FeedbackService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async ensureWeights() {
    let row = await this.prisma.matchWeightState.findUnique({ where: { key: 'default' } });
    if (!row) {
      row = await this.prisma.matchWeightState.create({
        data: { key: 'default', weights: DEFAULT_WEIGHTS, note: '初始权重' },
      });
    }
    return row;
  }

  async getWeights() {
    const row = await this.ensureWeights();
    const w = { ...DEFAULT_WEIGHTS, ...((row.weights as any) || {}) };
    const delta: Record<string, number> = {};
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]) {
      delta[k] = Math.round(((w[k] as number) - DEFAULT_WEIGHTS[k]) * 1000) / 1000;
    }
    return {
      key: row.key,
      weights: w,
      defaults: DEFAULT_WEIGHTS,
      deltaFromDefault: delta,
      usefulN: row.usefulN,
      notUsefulN: row.notUsefulN,
      note: row.note,
      updatedAt: row.updatedAt,
      learningNoteZh:
        '运营点「有用/通过」会略抬关键词与学科权重；「不准/驳回」会略抬语义。幅度很小并归一，解释面板会展示当前权重与相对默认的差值。',
    };
  }

  private nudge(w: Record<string, number>, useful: boolean, kind: string) {
    // accept 比 thumbs 稍强；reject 同理
    const boost = kind === 'accept' || kind === 'reject' ? 1.6 : 1;
    if (useful) {
      w.keyword = Math.min(0.42, (w.keyword || 0.3) + 0.005 * boost);
      w.discipline = Math.min(0.32, (w.discipline || 0.22) + 0.003 * boost);
      w.semantic = Math.max(0.22, (w.semantic || 0.32) - 0.004 * boost);
      w.trlFit = Math.min(0.14, (w.trlFit || 0.1) + 0.001 * boost);
    } else {
      w.semantic = Math.min(0.42, (w.semantic || 0.32) + 0.006 * boost);
      w.keyword = Math.max(0.2, (w.keyword || 0.3) - 0.003 * boost);
      w.region = Math.min(0.1, (w.region || 0.06) + 0.001 * boost);
    }
    const sum = w.semantic + w.keyword + w.discipline + w.region + w.trlFit;
    for (const k of Object.keys(w)) w[k] = Math.round((w[k] / sum) * 1000) / 1000;
    return w;
  }

  /** 有用/通过则略抬 keyword/discipline；无用/驳回则略抬 semantic。 */
  async submit(opts: {
    matchId: string;
    useful: boolean;
    comment?: string;
    userId?: string;
    kind?: string;
    source?: string;
    skipNotify?: boolean;
  }) {
    const match = await this.prisma.matchResult.findUniqueOrThrow({
      where: { id: opts.matchId },
      include: { demand: { include: { org: true } } },
    });
    const state = await this.ensureWeights();
    const kind = opts.kind || 'thumbs';
    const source = opts.source || 'ops';
    const w = this.nudge({ ...DEFAULT_WEIGHTS, ...((state.weights as any) || {}) }, opts.useful, kind);

    const fb = await this.prisma.matchFeedback.create({
      data: {
        matchId: opts.matchId,
        userId: opts.userId,
        useful: opts.useful,
        kind,
        source,
        comment: opts.comment,
        weightsSnapshot: w,
      },
    });

    await this.prisma.matchWeightState.update({
      where: { id: state.id },
      data: {
        weights: w,
        usefulN: opts.useful ? { increment: 1 } : undefined,
        notUsefulN: !opts.useful ? { increment: 1 } : undefined,
        note: `最近：${kind}/${opts.useful ? '正' : '负'} · match ${opts.matchId.slice(0, 8)} · ${source}`,
      },
    });

    if (!opts.skipNotify && match.demand?.orgId) {
      const users = await this.prisma.user.findMany({ where: { orgId: match.demand.orgId, active: true } });
      for (const u of users) {
        await this.notifications.create(
          u.id,
          opts.useful ? '匹配被标记为「有用/通过」' : '匹配被标记为「不太准/驳回」',
          `需求「${match.demand.title}」的一条匹配收到反馈${opts.comment ? '：' + opts.comment : ''}。权重已微调。`,
          '/portal.html#workspace',
        );
      }
    }

    return { ok: true, feedback: fb, weights: w, kind, source };
  }

  /** 状态变更联动学习：通过→accept，驳回→reject */
  async fromStatusChange(matchId: string, status: string, userId?: string) {
    if (status === 'APPROVED') {
      return this.submit({
        matchId,
        useful: true,
        kind: 'accept',
        source: 'status_change',
        comment: '运营通过，计入学习',
        userId,
        skipNotify: true,
      });
    }
    if (status === 'REJECTED') {
      return this.submit({
        matchId,
        useful: false,
        kind: 'reject',
        source: 'status_change',
        comment: '运营驳回，计入学习',
        userId,
        skipNotify: true,
      });
    }
    return null;
  }

  list(take = 50) {
    return this.prisma.matchFeedback.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { match: { include: { demand: true } } },
    });
  }

  async forMatch(matchId: string, take = 20) {
    return this.prisma.matchFeedback.findMany({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** 用当前学习权重对历史 breakdown 做软重算（不改库，仅预览） */
  softRescore(breakdown: any, totalScore?: number) {
    const bd = breakdown || {};
    const weights = { ...DEFAULT_WEIGHTS, ...((bd.weights as any) || {}) };
    return this.ensureWeights().then((row) => {
      const learned = { ...DEFAULT_WEIGHTS, ...((row.weights as any) || {}) };
      const keys = ['semantic', 'keyword', 'discipline', 'region', 'trlFit'] as const;
      let stored = 0;
      let rescored = 0;
      const features = keys.map((k) => {
        const score = Number(bd[k] ?? 0);
        const c0 = score * (weights[k] || 0);
        const c1 = score * (learned[k] || 0);
        stored += c0;
        rescored += c1;
        return {
          key: k,
          score,
          weightStored: weights[k],
          weightLearned: learned[k],
          contributionStored: Math.round(c0 * 1000) / 1000,
          contributionLearned: Math.round(c1 * 1000) / 1000,
        };
      });
      return {
        totalStored: Math.round((totalScore ?? stored) * 1000) / 1000,
        totalLearned: Math.round(rescored * 1000) / 1000,
        delta: Math.round((rescored - (totalScore ?? stored)) * 1000) / 1000,
        features,
        learnedWeights: learned,
        noteZh: '软重算只预览，不会改库里的总分；下次「重新匹配」会用学习权重写新结果。',
      };
    });
  }

  async rescoreMatch(matchId: string) {
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match) return { ok: false, message: '匹配不存在' };
    const preview = await this.softRescore(match.scoreBreakdown, match.totalScore);
    return { ok: true, matchId, ...preview };
  }
}
