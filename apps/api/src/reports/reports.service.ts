import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../plans/quota.service';
import { FlagsService } from '../flags/flags.service';

type Provider = 'hash' | 'openai' | 'local';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private quota: QuotaService, private flags: FlagsService) {}

  list(take = 40) {
    return this.prisma.analysisReport.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  get(id: string) {
    return this.prisma.analysisReport.findUnique({ where: { id } });
  }

  async versions(familyKey: string) {
    return this.prisma.analysisReport.findMany({
      where: { familyKey },
      orderBy: { version: 'desc' },
    });
  }

  providers() {
    return {
      default: (process.env.AI_REPORT_PROVIDER || 'hash') as Provider,
      available: [
        {
          id: 'hash',
          name: '模板引擎（默认）',
          ready: true,
          note: '本地规则 + 库内统计，稳定可解释，无外呼',
        },
        {
          id: 'openai',
          name: 'OpenAI 兼容聊天',
          ready: Boolean(process.env.OPENAI_API_KEY),
          note: '需 OPENAI_API_KEY；未配置时回退模板并标注',
        },
        {
          id: 'local',
          name: '本地增强模板',
          ready: true,
          note: '在 hash 模板上加产业话术与风险提示，仍无外呼',
        },
      ],
    };
  }

  private familyKey(scope: string, targetId?: string) {
    return `${scope}:${targetId || 'all'}`;
  }

  private async nextVersion(familyKey: string) {
    const last = await this.prisma.analysisReport.findFirst({
      where: { familyKey },
      orderBy: { version: 'desc' },
    });
    return (last?.version || 0) + 1;
  }

  async generate(opts: {
    scope: string;
    targetId?: string;
    authorId?: string;
    provider?: string;
  }) {
    await this.flags.assertEnabled('ai_reports', 'default', '分析报告已关闭（ai_reports）。请到运维台打开功能开关。');
    if (opts.authorId) {
      const plan = await this.quota.planForUser(opts.authorId);
      const limit = Number((plan?.quotas as any)?.reports ?? 30);
      await this.quota.checkAndIncr(`user:${opts.authorId}`, 'reports', limit, 1);
    }

    const requested = (opts.provider || process.env.AI_REPORT_PROVIDER || 'hash') as Provider;
    if (!['hash', 'openai', 'local'].includes(requested)) {
      throw new BadRequestException('provider 仅支持 hash|openai|local');
    }

    const draft = await this.buildDraft(opts.scope, opts.targetId);
    let provider: Provider = requested;
    let contentMd = draft.contentMd;
    let summary = draft.summary;
    let modelMeta: any = { requested, used: 'hash', fallback: false };

    if (requested === 'local') {
      contentMd = this.enrichLocal(draft);
      provider = 'local';
      modelMeta = { requested, used: 'local', fallback: false };
    } else if (requested === 'openai') {
      const llm = await this.tryOpenAI(draft);
      if (llm.ok) {
        contentMd = llm.contentMd!;
        summary = llm.summary || summary;
        provider = 'openai';
        modelMeta = { requested, used: 'openai', model: llm.model, fallback: false };
      } else {
        contentMd = this.enrichLocal(draft) + `\n\n> ⚠ OpenAI 未就绪（${llm.error}），已回退本地增强模板。\n`;
        provider = 'local';
        modelMeta = { requested, used: 'local', fallback: true, error: llm.error };
      }
    }

    const familyKey = this.familyKey(opts.scope, opts.targetId);
    const version = await this.nextVersion(familyKey);

    return this.prisma.analysisReport.create({
      data: {
        title: `${draft.title} · v${version}`,
        scope: opts.scope,
        targetId: opts.targetId,
        contentMd,
        summary,
        scores: draft.scores,
        authorId: opts.authorId,
        provider,
        familyKey,
        version,
        modelMeta,
      },
    });
  }

  private enrichLocal(draft: {
    title: string;
    summary: string;
    contentMd: string;
    scores: any;
  }) {
    return [
      draft.contentMd,
      '',
      '## 四、本地增强（产业话术）',
      '- 建议运营按「披露 → 评估 → 匹配 → 触达」漏斗复盘本周通过率。',
      '- 高校侧优先补能力卡的可承接类型（横向 / 许可 / 联合攻关）。',
      '- 企业侧优先补预算带、紧急度与期望交付，减少空匹配。',
      '- 风险：邮件默认人审；涉密成果勿进公开广场。',
      '',
      `_本地模板增强 · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（Asia/Shanghai）_`,
    ].join('\n');
  }

  private async tryOpenAI(draft: {
    title: string;
    summary: string;
    contentMd: string;
  }): Promise<{ ok: boolean; contentMd?: string; summary?: string; model?: string; error?: string }> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, error: '缺少 OPENAI_API_KEY' };
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), Number(process.env.OPENAI_TIMEOUT_MS || 12000));
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content:
                '你是中国产教融合运营顾问。用大白话中文改写分析报告，保留数据事实，给出可执行建议，不要编造未给出的数字。',
            },
            {
              role: 'user',
              content: `请基于以下草稿输出完整 Markdown 报告：\n标题：${draft.title}\n摘要：${draft.summary}\n\n${draft.contentMd}`,
            },
          ],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const json: any = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (!text) return { ok: false, error: '空响应' };
      return { ok: true, contentMd: text, summary: draft.summary, model };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  private async buildDraft(scope: string, targetId?: string) {
    const scores: any = {};
    let title = '研企通分析报告';
    let summary = '';
    let contentMd = '';

    if (scope === 'platform') {
      const [orgs, outs, demands, matches, leads] = await Promise.all([
        this.prisma.organization.count(),
        this.prisma.outcome.count(),
        this.prisma.demand.count(),
        this.prisma.matchResult.count(),
        this.prisma.lead.count(),
      ]);
      const top = await this.prisma.matchResult.findMany({
        take: 5,
        orderBy: { totalScore: 'desc' },
        include: { demand: true, capability: true, outcome: true },
      });
      title = '平台冷启动运行分析';
      summary = `当前库内组织 ${orgs} 家，成果 ${outs} 条，需求 ${demands} 条，匹配 ${matches} 条，线索 ${leads} 条。`;
      scores.coverage = { orgs, outs, demands, matches, leads };
      contentMd = [
        `# ${title}`,
        '',
        `> ${summary}`,
        '',
        '## 一、数据家底',
        `- 组织：${orgs}`,
        `- 成果卡：${outs}`,
        `- 需求卡：${demands}`,
        `- 匹配结果：${matches}`,
        `- 触达线索：${leads}`,
        '',
        '## 二、Top 匹配（可解释）',
        ...top.map((m, i) => {
          const supply = m.capability?.title || m.outcome?.title || '（供给待补）';
          return `${i + 1}. **${(m.totalScore * 100).toFixed(0)}分**｜需求「${m.demand?.title}」↔ 供给「${supply}」\n   - 理由：${m.reason || '—'}`;
        }),
        '',
        '## 三、运营建议',
        '1. 继续定时拉高校 OpenAlex 与企业名单，把双边密度做起来。',
        '2. 对 60 分以上匹配做人审，通过后发邀请/邮件。',
        '3. 优先让已触达机构认领组织、补全能力卡与联系人。',
        '',
        `_生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（Asia/Shanghai）_`,
      ].join('\n');
    } else if (scope === 'org' && targetId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: targetId },
        include: {
          capabilities: true,
          outcomes: { take: 20, orderBy: { createdAt: 'desc' } },
          demands: true,
        },
      });
      if (!org) throw new NotFoundException('组织不存在');
      title = `组织画像分析 · ${org.name}`;
      summary = `${org.name}（${org.type}）现有能力 ${org.capabilities.length}、成果 ${org.outcomes.length}、需求 ${org.demands.length}。`;
      scores.cardCounts = {
        capabilities: org.capabilities.length,
        outcomes: org.outcomes.length,
        demands: org.demands.length,
      };
      contentMd = [
        `# ${title}`,
        '',
        `> ${summary}`,
        '',
        '## 简介',
        org.summary || '暂无简介',
        '',
        '## 能力标签',
        org.capabilities.map((c) => `- **${c.title}**：${(c.keywords || []).join('、') || '无关键词'}`).join('\n') ||
          '- 暂无能力卡',
        '',
        '## 近期成果',
        org.outcomes.map((o) => `- ${o.title}（${o.type}）`).join('\n') || '- 暂无成果',
        '',
        '## 需求',
        org.demands.map((d) => `- ${d.title}`).join('\n') || '- 暂无需求',
        '',
        '## 对接建议',
        org.type === 'ENTERPRISE'
          ? '建议补充更具体的技术痛点、预算档与期望交付，便于匹配高校成果。'
          : '建议把实验室可对外服务的能力写成能力卡，并标明可承接类型（横向/许可/联合攻关）。',
      ].join('\n');
    } else if (scope === 'demand' && targetId) {
      const demand = await this.prisma.demand.findUnique({
        where: { id: targetId },
        include: {
          org: true,
          matches: {
            take: 8,
            orderBy: { totalScore: 'desc' },
            include: { capability: true, outcome: true },
          },
        },
      });
      if (!demand) throw new NotFoundException('需求不存在');
      title = `需求匹配分析 · ${demand.title}`;
      summary = `为「${demand.org?.name}」的需求生成 Top 供给清单。`;
      scores.top = demand.matches.map((m) => ({ id: m.id, score: m.totalScore }));
      contentMd = [
        `# ${title}`,
        '',
        `> ${summary}`,
        '',
        '## 需求原文',
        demand.problem,
        '',
        `期望交付：${demand.expectedOut || '未填'}｜预算：${demand.budgetBand || '未填'}｜紧急度：${demand.urgency || '未填'}`,
        '',
        '## 推荐供给',
        ...demand.matches.map((m, i) => {
          const supply = m.capability?.title || m.outcome?.title || '—';
          return `${i + 1}. ${(m.totalScore * 100).toFixed(0)}分 · ${supply}\n   - ${m.reason || ''}`;
        }),
        demand.matches.length ? '' : '- 暂无匹配，请先跑匹配任务',
      ].join('\n');
    } else if (scope === 'match' && targetId) {
      const m = await this.prisma.matchResult.findUnique({
        where: { id: targetId },
        include: { demand: { include: { org: true } }, capability: true, outcome: true },
      });
      if (!m) throw new NotFoundException('匹配不存在');
      const supply = m.capability?.title || m.outcome?.title || '—';
      title = `配对解读 · ${(m.totalScore * 100).toFixed(0)}分`;
      summary = `需求「${m.demand?.title}」与供给「${supply}」的可解释分析。`;
      scores.breakdown = m.scoreBreakdown;
      contentMd = [
        `# ${title}`,
        '',
        `> ${summary}`,
        '',
        '## 为什么配对',
        m.reason || '（无理由）',
        '',
        '## 分项分',
        '```json',
        JSON.stringify(m.scoreBreakdown, null, 2),
        '```',
        '',
        '## 下一步',
        '1. 运营复核通过后生成邀约草稿。',
        '2. 邀请双方认领组织并补充联系人。',
        '3. 线下沟通许可/横向/联合申报等模式。',
      ].join('\n');
    } else {
      throw new BadRequestException('不支持的报告范围');
    }

    return { title, summary, contentMd, scores };
  }
}
