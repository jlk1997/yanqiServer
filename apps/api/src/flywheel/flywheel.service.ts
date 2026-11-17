import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QualityService } from '../quality/quality.service';
import { ReportsService } from '../reports/reports.service';
import { JobsService } from '../jobs/jobs.service';
import { IngestService } from '../ingest/ingest.service';
import { MatchesService } from '../matches/matches.service';
import { spawn } from 'child_process';
import { join } from 'path';

/** 粗映射：中文/英文概念 → taxonomy code */
const TAX_HINTS: Array<{ re: RegExp; code: string }> = [
  { re: /vision|视觉|缺陷检测|defect/i, code: 'mfg.vision' },
  { re: /robot|机器人|cobot|装配/i, code: 'mfg.robot' },
  { re: /twin|孪生|仿真/i, code: 'mfg.twin' },
  { re: /MES|工控|工业软件/i, code: 'mfg.mes' },
  { re: /thermal|热管理|散热|冷却/i, code: 'energy.thermal' },
  { re: /battery|锂电|储能/i, code: 'mat.battery' },
  { re: /coat|涂层|镀膜/i, code: 'mat.coat' },
  { re: /agri|农业|遥感|植保/i, code: 'agri.sense' },
  { re: /medical|医疗|超声|器械/i, code: 'bio.device' },
  { re: /AI|人工智能|深度学习|machine learning/i, code: 'ict.ai' },
];

/** 进程内可取消的本周批量匹配 */
const bulkMatchJobs = new Map<
  string,
  {
    cancel: boolean;
    status: 'running' | 'done' | 'cancelled' | 'error';
    progress: any[];
    total: number;
    done: number;
    totalMatches: number;
    summaryZh?: string;
    startedAt: string;
    finishedAt?: string;
  }
>();

@Injectable()
export class FlywheelService {
  constructor(
    private prisma: PrismaService,
    private quality: QualityService,
    private reports: ReportsService,
    private jobs: JobsService,
    private matches: MatchesService,
    private ingest: IngestService,
  ) {}

  private root() {
    return join(__dirname, '..', '..', '..', '..');
  }

  /** 堆量仪表盘：双边真实库存 */
  async dashboard() {
    const [
      uniOrgs,
      labOrgs,
      entOrgs,
      govOrgs,
      outcomesUni,
      capsUni,
      demandsEnt,
      demandsGov,
      openIssues,
      jobs,
      lastCrawl,
      lastClean,
      lastAnalyze,
    ] = await Promise.all([
      this.prisma.organization.count({ where: { type: 'UNIVERSITY' } }),
      this.prisma.organization.count({ where: { type: 'LAB_INSTITUTE' } }),
      this.prisma.organization.count({ where: { type: 'ENTERPRISE' } }),
      this.prisma.organization.count({ where: { type: 'GOVERNMENT' } }),
      this.prisma.outcome.count({
        where: { org: { type: { in: ['UNIVERSITY', 'LAB_INSTITUTE'] } } },
      }),
      this.prisma.capability.count({
        where: { org: { type: { in: ['UNIVERSITY', 'LAB_INSTITUTE'] } } },
      }),
      this.prisma.demand.count({ where: { org: { type: 'ENTERPRISE' } } }),
      this.prisma.demand.count({ where: { org: { type: 'GOVERNMENT' } } }),
      this.prisma.dataQualityIssue.count({ where: { resolvedAt: null } }),
      this.prisma.jobLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.jobLog.findFirst({
        where: { queue: 'crawl', status: 'done' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.jobLog.findFirst({
        where: { jobName: { in: ['clean', 'quality_scan'] }, status: 'done' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.analysisReport.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    const crawlFails = jobs.filter((j) => j.queue === 'crawl' && j.status === 'failed').length;
    const crawlDone = jobs.filter((j) => j.queue === 'crawl' && j.status === 'done').length;
    const failRate = crawlDone + crawlFails ? Math.round((crawlFails / (crawlDone + crawlFails)) * 1000) / 10 : 0;

    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400_000);
    const [newOutcomes, newDemands, newCaps, prevOutcomes, prevDemands, prevCaps, quarantinedOut] =
      await Promise.all([
        this.prisma.outcome.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.demand.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.capability.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.outcome.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
        this.prisma.demand.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
        this.prisma.capability.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
        this.prisma.outcome.count({ where: { extensions: { path: ['quarantine'], equals: true } } }).catch(() => 0),
      ]);

    const totalCards = outcomesUni + capsUni + demandsEnt + demandsGov;
    const resolved = await this.prisma.dataQualityIssue.count({
      where: { resolvedAt: { not: null } },
    });
    const allIssues = openIssues + resolved;
    const cleanPassRate = allIssues ? Math.round((resolved / allIssues) * 1000) / 10 : null;

    return {
      ok: true,
      wave: 'M23-import-netnew',
      pathZh: '采数据 → 清洗 → 匹配 → 找人发信',
      sides: {
        university: {
          labelZh: '高校/科研侧',
          orgs: uniOrgs + labOrgs,
          outcomes: outcomesUni,
          capabilities: capsUni,
        },
        enterprise: {
          labelZh: '企业/政府侧',
          orgs: entOrgs + govOrgs,
          demands: demandsEnt + demandsGov,
          enterpriseDemands: demandsEnt,
          govDemands: demandsGov,
        },
      },
      growth7d: { outcomes: newOutcomes, capabilities: newCaps, demands: newDemands },
      growthPrev7d: { outcomes: prevOutcomes, capabilities: prevCaps, demands: prevDemands },
      netNewStrip: [
        {
          key: 'demands',
          labelZh: '净增需求（本周）',
          thisWeek: newDemands,
          lastWeek: prevDemands,
          delta: newDemands - prevDemands,
        },
        {
          key: 'outcomes',
          labelZh: '净增成果（本周）',
          thisWeek: newOutcomes,
          lastWeek: prevOutcomes,
          delta: newOutcomes - prevOutcomes,
        },
        {
          key: 'capabilities',
          labelZh: '净增能力（本周）',
          thisWeek: newCaps,
          lastWeek: prevCaps,
          delta: newCaps - prevCaps,
        },
      ],
      quarantine: { outcomesMarked: quarantinedOut },

      quality: {
        openIssues,
        cleanPassRate,
        noteZh: cleanPassRate == null ? '还没跑过质检闭环' : `已处理占历史问题 ${cleanPassRate}%`,
      },
      crawl: {
        lastAt: lastCrawl?.createdAt || null,
        lastMessage: lastCrawl?.message || null,
        recentFailRatePct: failRate,
      },
      clean: { lastAt: lastClean?.createdAt || null, lastMessage: lastClean?.message || null },
      analyze: {
        lastAt: lastAnalyze?.createdAt || null,
        lastTitle: lastAnalyze?.title || null,
        lastId: lastAnalyze?.id || null,
      },
      totalCards,
      recentJobs: jobs.slice(0, 12).map((j) => ({
        id: j.id,
        queue: j.queue,
        jobName: j.jobName,
        status: j.status,
        message: j.message,
        at: j.createdAt,
      })),
      todayGuide: [
        { step: 1, title: '采', action: '高校 OpenAlex 批量采集 或 导入企业需求夹具/授权 CSV', tab: 'flywheel' },
        { step: 2, title: '洗', action: '跑清洗质检，批量处理重复/缺字段', tab: 'quality' },
        { step: 3, title: '配', action: '跑一轮匹配，复核高分对', tab: 'match' },
        { step: 4, title: '联', action: '套跟进话术，草稿发信找人', tab: 'leads' },
      ],
      complianceZh:
        '只用 OpenAlex 公开接口与授权/演示夹具。禁止 CNKI、未授权企查查等灰爬。',
    };
  }

  /** 清洗增强：扫描 + taxonomy 建议 + 垃圾标记 */
  async cleanPipeline(opts: { applyTaxonomy?: boolean; enrichHeuristics?: boolean } = {}) {
    const scan = await this.quality.scanAll();
    let taxApplied = 0;
    let enriched = 0;

    if (opts.applyTaxonomy !== false) {
      const caps = await this.prisma.capability.findMany({
        where: { taxonomyCodes: { equals: [] } },
        take: 200,
      });
      for (const c of caps) {
        const blob = [c.title, c.summary, ...(c.keywords || []), ...(c.disciplines || [])].join(' ');
        const codes = TAX_HINTS.filter((h) => h.re.test(blob)).map((h) => h.code);
        if (codes.length) {
          await this.prisma.capability.update({
            where: { id: c.id },
            data: { taxonomyCodes: [...new Set(codes)] },
          });
          taxApplied++;
        }
      }
      const outs = await this.prisma.outcome.findMany({
        where: { taxonomyCodes: { equals: [] } },
        take: 300,
      });
      for (const o of outs) {
        const blob = [o.title, o.abstract, ...(o.ipcOrDisc || [])].join(' ');
        const codes = TAX_HINTS.filter((h) => h.re.test(blob)).map((h) => h.code);
        if (codes.length) {
          await this.prisma.outcome.update({
            where: { id: o.id },
            data: { taxonomyCodes: [...new Set(codes)] },
          });
          taxApplied++;
        }
      }
      const dems = await this.prisma.demand.findMany({
        where: { taxonomyCodes: { equals: [] } },
        take: 200,
      });
      for (const d of dems) {
        const blob = [d.title, d.problem, ...(d.industry || [])].join(' ');
        const codes = TAX_HINTS.filter((h) => h.re.test(blob)).map((h) => h.code);
        if (codes.length) {
          await this.prisma.demand.update({
            where: { id: d.id },
            data: { taxonomyCodes: [...new Set(codes)] },
          });
          taxApplied++;
        }
      }
    }

    if (opts.enrichHeuristics !== false) {
      // 缺 TRL 的论文成果填 3；缺许可的标 unclear
      const thin = await this.prisma.outcome.findMany({
        where: { OR: [{ trl: null }, { licenseOpenness: null }] },
        take: 400,
      });
      for (const o of thin) {
        await this.prisma.outcome.update({
          where: { id: o.id },
          data: {
            trl: o.trl ?? 3,
            licenseOpenness: o.licenseOpenness || 'unclear',
            ipOwnership: o.ipOwnership || 'university',
            readinessBand: o.readinessBand || 'lab',
          },
        });
        enriched++;
      }
    }

    let pipeline: any = null;
    try {
      pipeline = await this.ingest.runPending();
    } catch (err: any) {
      pipeline = { ok: false, message: err?.message || String(err) };
    }

    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: 'clean',
        status: 'done',
        message: `清洗完成 问题${scan.total} · 打标${taxApplied} · 补全${enriched}`,
        payload: { scanTotal: scan.total, taxApplied, enriched, qualityScore: scan.qualityScore, pipeline },
      },
    });

    return {
      ok: true,
      scan,
      taxApplied,
      enriched,
      pipeline,
      summaryZh: `质检发现 ${scan.total} 条问题（分 ${scan.qualityScore}）；自动行业打标 ${taxApplied} 张卡；启发式补全 ${enriched} 条。`,
    };
  }

  async bulkResolve(ids: string[], reject = false) {
    const list = (ids || []).filter(Boolean).slice(0, 200);
    let n = 0;
    for (const id of list) {
      try {
        await this.prisma.dataQualityIssue.update({
          where: { id },
          data: {
            resolvedAt: new Date(),
            meta: reject ? { resolution: 'rejected_as_junk' } : { resolution: 'accepted' },
          },
        });
        n++;
      } catch (_) {}
    }
    return { ok: true, resolved: n, mode: reject ? 'reject' : 'accept' };
  }

  /** 入库批次中文洞察 */
  async analyzeIngest(authorId?: string) {
    const dash = await this.dashboard();
    const report = await this.reports.generate({
      scope: 'platform',
      authorId,
      provider: process.env.AI_REPORT_PROVIDER || 'local',
    });
    // 覆盖标题与正文前缀，保证是「采洗」视角
    const title = `入库洞察 · ${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    const preface = [
      '【研企通 · 采—洗数据飞轮】',
      `高校/科研：组织 ${dash.sides.university.orgs} · 成果 ${dash.sides.university.outcomes} · 能力 ${dash.sides.university.capabilities}`,
      `企业/政府：组织 ${dash.sides.enterprise.orgs} · 需求 ${dash.sides.enterprise.demands}`,
      `近 7 日新增：成果 ${dash.growth7d.outcomes} · 能力 ${dash.growth7d.capabilities} · 需求 ${dash.growth7d.demands}`,
      `质检待处理 ${dash.quality.openIssues}；最近采集：${dash.crawl.lastMessage || '尚无'}`,
      '',
      '下面是模型/模板生成的补充观察：',
      '',
    ].join('\n');
    const body = preface + ((report as any).contentMd || (report as any).summary || '');
    const updated = await this.prisma.analysisReport.update({
      where: { id: report.id },
      data: { title, contentMd: body, summary: `双边库存洞察 · 待处理质检 ${dash.quality.openIssues}` },
    }).catch(() => report);
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: 'analyze',
        status: 'done',
        message: title,
        payload: { reportId: report.id },
      },
    });
    return { ok: true, report: updated, dashboard: dash, summaryZh: `已生成洞察报告：${title}` };
  }

  enqueueOpenAlex(batch = true, limit?: number, fillEmpty = false) {
    return this.jobs.enqueueCrawl('openalex', {
      batch,
      limit,
      fillEmpty: Boolean(fillEmpty),
      envHint: {
        ...(limit ? { OPENALEX_LIMIT: String(limit) } : {}),
        ...(fillEmpty ? { OPENALEX_FILL_EMPTY: '1' } : {}),
      },
    });
  }

  enqueueCsv(csvPath?: string) {
    return this.jobs.enqueueCrawl('csv', {
      csvPath: csvPath || join(this.root(), 'data/imports/enterprises.sample.csv'),
    });
  }

  /** 同步跑演示需求夹具（快，适合演示） */
  async importDemandFixtures() {
    const script = join(this.root(), 'workers/crawl/src/import-demand-fixtures.ts');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npx', ['tsx', script], {
        cwd: this.root(),
        env: process.env,
        stdio: 'inherit',
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('fixture exit ' + code))));
    });
    return { ok: true, message: '演示需求夹具已入库' };
  }

  async runMiniPipeline() {
    const fixture = await this.importDemandFixtures();
    const clean = await this.cleanPipeline({});
    const analyze = await this.analyzeIngest();
    return {
      ok: true,
      steps: { fixture, clean: { summaryZh: clean.summaryZh }, analyze: { summaryZh: analyze.summaryZh, reportId: analyze.report?.id } },
      summaryZh: '迷你流水线完成：演示需求入库 → 清洗打标 → 生成洞察报告。高校侧请再点「采集高校」。',
    };
  }

  /** 粘贴一段需求原文 → 结构化草稿；太薄时给出中文补全提示 */
  parseDemandPaste(text: string) {
    const raw = String(text || '').trim();
    const hints: string[] = [];
    if (raw.length < 8) {
      return {
        ok: false,
        message: '字太少了，至少写清「谁、卡在哪」',
        hints: ['写单位或公司名', '写要解决啥（痛点）', '有预算就带上大概区间'],
        thin: true,
      };
    }
    const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    let title = lines[0].replace(/^【?需求】?[:：\s]*/, '').slice(0, 80);
    const problem = lines.slice(1).join('\n') || lines[0];
    const budget =
      (raw.match(/(\d+\s*[-~～到至]\s*\d+\s*万)/) || raw.match(/预算[:：]?\s*([^\n，。]+)/) || [])[1] || null;
    const regionHit = raw.match(/(北京|上海|广东|深圳|江苏|浙江|安徽|山东|四川|湖北|湖南|福建|天津|重庆|陕西|辽宁|河南|云南|海南|甘肃|黑龙江)/);
    const industry: string[] = [];
    const taxonomyCodes: string[] = [];
    for (const h of TAX_HINTS) {
      if (h.re.test(raw)) {
        taxonomyCodes.push(h.code);
        const label = h.code.split('.').pop() || h.code;
        industry.push(label);
      }
    }
    let licenseNeed: string | null = null;
    if (/独占|排他/.test(raw)) licenseNeed = 'exclusive';
    else if (/开放|开源|非独占/.test(raw)) licenseNeed = 'open';
    else if (/许可|授权|可协商/.test(raw)) licenseNeed = 'negotiable';
    let minTrl: number | null = null;
    const trlM = raw.match(/TRL\s*([1-9])/i) || raw.match(/成熟度\s*([1-9])/);
    if (trlM) minTrl = Number(trlM[1]);
    let urgency = '中';
    if (/紧急|尽快|马上|高优先/.test(raw)) urgency = '高';
    if (/不急|长期|低优先/.test(raw)) urgency = '低';
    const orgGuess =
      (raw.match(/(?:单位|公司|企业|局|园区|管委会)[:：]\s*([^\n]+)/) || [])[1] ||
      (raw.match(/我们是([^，。\n]{2,30}(?:公司|厂|集团|科技|有限))/) || [])[1] ||
      null;
    if (!orgGuess) hints.push('缺单位：写「单位：某某公司」或「我们是某某厂」');
    if (!budget) hints.push('缺预算：写大概区间，比如「预算 30-80 万」');
    if (!problem || problem.length < 12) hints.push('「要解决啥」说太短：补两句痛点/现象');
    if (!industry.length) hints.push('缺行业词：加「视觉 / 机器人 / 热管理」这类词更好匹配');
    const thin = hints.length >= 2 || raw.length < 24;
    if (thin && !hints.length) hints.push('再多写两句，方便匹配');
    const confidence =
      !thin && orgGuess && budget && problem.length >= 12 && industry.length
        ? 'high'
        : thin
          ? 'low'
          : 'medium';
    return {
      ok: !thin || (orgGuess && problem.length >= 12),
      thin,
      hints,
      confidence,
      message: thin ? '信息有点薄，按下面提示补两句再发' : undefined,
      draft: {
        title,
        problem: problem.slice(0, 2000),
        expectedOut: (raw.match(/(?:期望|产出|交付)[:：]\s*([^\n]+)/) || [])[1] || null,
        budgetBand: budget,
        industry: [...new Set(industry)].slice(0, 6),
        taxonomyCodes: [...new Set(taxonomyCodes)],
        licenseNeed,
        minTrl,
        urgency,
        regionPref: regionHit ? regionHit[1] : null,
        orgName: orgGuess,
        demoLabel: '粘贴解析草稿',
      },
      noteZh: thin
        ? '草稿能看，但建议先按提示补全再发布。'
        : '这是草稿，发布前请人再瞄一眼。没有外呼大模型时也靠规则解析。',
    };
  }

  async createDemandFromPaste(opts: {
    text: string;
    orgId?: string;
    orgName?: string;
    orgType?: string;
    commit?: boolean;
  }) {
    const parsed = this.parseDemandPaste(opts.text);
    if (!parsed.ok || !parsed.draft) return parsed;
    if (!opts.commit) return { ...parsed, preview: true };
    const d = parsed.draft;
    let orgId = opts.orgId;
    if (!orgId) {
      const name = opts.orgName || d.orgName || '粘贴导入·未命名单位';
      let org = await this.prisma.organization.findFirst({ where: { name } });
      if (!org) {
        org = await this.prisma.organization.create({
          data: {
            name,
            type: (opts.orgType as any) || 'ENTERPRISE',
            region: d.regionPref,
            summary: '由粘贴需求自动建档（请运营核对）',
            extensions: { source: 'paste_parse' },
          },
        });
      }
      orgId = org.id;
    }
    const shared = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));
    const emb = await shared.embedText([d.title, d.problem, ...(d.industry || [])].join(' '));
    const row = await this.saveGatedDemand(shared, {
      orgId: orgId!,
      title: d.title,
      problem: d.problem,
      expectedOut: d.expectedOut,
      budgetBand: d.budgetBand,
      industry: d.industry || [],
      taxonomyCodes: d.taxonomyCodes || [],
      licenseNeed: d.licenseNeed,
      minTrl: d.minTrl,
      urgency: d.urgency,
      regionPref: d.regionPref,
      embedding: emb,
      extensions: { source: 'paste_parse', label: '粘贴解析' },
    }, 'paste_parse');
    return {
      ok: true,
      preview: false,
      demand: row,
      draft: d,
      noteZh: row.publishStatus === 'published' ? '已发布，可以参与匹配。' : '已入库，但还不能公开展示：' + (row.publishBlockers || []).join('、'),
    };
  }

  private async saveGatedDemand(shared: any, payload: any, sourceCode: string) {
    const existing = await this.prisma.demand.findFirst({ where: { orgId: payload.orgId, title: payload.title } });
    const merged = shared.mergeLocked(existing || {}, payload, existing?.lockedFields || []);
    const demandKind = shared.inferDemandKind(merged.demandKind, `${merged.title || ''} ${merged.problem || ''}`);
    const decision = shared.publishDecision('demand', { ...merged, demandKind, orgId: payload.orgId, sourceCode });
    const gated = {
      ...payload,
      demandKind,
      publishStatus: decision.status,
      publishBlockers: decision.blockers,
      summaryPublic: shared.summaryPublic(merged.problem || ''),
      embeddingModel: shared.embeddingMeta?.().mode || 'hash',
      reviewedAt: new Date(),
      sourceUpdatedAt: new Date(),
    };
    const writable = shared.stripLocked(gated, existing?.lockedFields || []);
    if (existing) {
      return this.prisma.demand.update({ where: { id: existing.id }, data: writable });
    }
    return this.prisma.demand.create({ data: gated });
  }

  /** 合并建议：同单位同标题 */
  async mergeSuggestions(take = 40) {
    const suggestions: any[] = [];
    for (const kind of ['Outcome', 'Capability', 'Demand'] as const) {
      const rows =
        kind === 'Outcome'
          ? await this.prisma.outcome.findMany({ select: { id: true, title: true, orgId: true }, take: 2000 })
          : kind === 'Capability'
            ? await this.prisma.capability.findMany({ select: { id: true, title: true, orgId: true }, take: 2000 })
            : await this.prisma.demand.findMany({ select: { id: true, title: true, orgId: true }, take: 2000 });
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const k = `${r.orgId}::${(r.title || '').trim().toLowerCase()}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(r);
      }
      for (const [, group] of map) {
        if (group.length < 2) continue;
        suggestions.push({
          kind,
          title: group[0].title,
          orgId: group[0].orgId,
          ids: group.map((g) => g.id),
          count: group.length,
          actionZh: '建议保留最新一条，其余归档/删',
        });
        if (suggestions.length >= take) break;
      }
      if (suggestions.length >= take) break;
    }
    return { ok: true, count: suggestions.length, suggestions, noteZh: '只提示，不自动删。点「执行合并」才动库。' };
  }

  async applyMerge(kind: string, keepId: string, dropIds: string[]) {
    const drops = (dropIds || []).filter((id) => id && id !== keepId);
    if (!['Outcome', 'Capability', 'Demand'].includes(kind)) throw new Error('kind 不对');
    let n = 0;
    let moved = 0;
    for (const id of drops) {
      moved += await this.retargetMatches(kind, keepId, id);
      if (kind === 'Outcome') await this.retargetAuthorships(keepId, id);
      await this.fillKeepFromDrop(kind, keepId, id);
      if (kind === 'Outcome') await this.prisma.outcome.delete({ where: { id } }).catch(() => null);
      else if (kind === 'Capability') await this.prisma.capability.delete({ where: { id } }).catch(() => null);
      else await this.prisma.demand.delete({ where: { id } }).catch(() => null);
      n++;
      await this.prisma.dataQualityIssue.updateMany({
        where: { entityId: id, resolvedAt: null },
        data: { resolvedAt: new Date(), meta: { resolution: 'merged_away', keepId } },
      });
    }
    await this.auditSafe('data_merge', keepId, { kind, dropped: drops, moved });
    return { ok: true, kept: keepId, dropped: n, moved, noteZh: `已去掉 ${n} 条重复，${moved} 条匹配改挂到留下的那条` };
  }

  private async retargetMatches(kind: string, keepId: string, dropId: string) {
    const where = kind === 'Outcome' ? { outcomeId: dropId } : kind === 'Capability' ? { capabilityId: dropId } : { demandId: dropId };
    const matches = await this.prisma.matchResult.findMany({ where });
    let moved = 0;
    for (const match of matches) {
      if (kind === 'Demand') {
        const clash = match.supplyKey
          ? await this.prisma.matchResult.findFirst({ where: { demandId: keepId, supplyKey: match.supplyKey } })
          : null;
        if (clash) await this.prisma.matchResult.delete({ where: { id: match.id } });
        else {
          await this.prisma.matchResult.update({ where: { id: match.id }, data: { demandId: keepId } });
          moved++;
        }
        continue;
      }
      const supplyKey = kind === 'Outcome' ? `o:${keepId}` : `c:${keepId}`;
      const clash = await this.prisma.matchResult.findFirst({ where: { demandId: match.demandId, supplyKey } });
      if (clash) await this.prisma.matchResult.delete({ where: { id: match.id } });
      else {
        await this.prisma.matchResult.update({
          where: { id: match.id },
          data: kind === 'Outcome' ? { outcomeId: keepId, supplyKey } : { capabilityId: keepId, supplyKey },
        });
        moved++;
      }
    }
    return moved;
  }

  private async retargetAuthorships(keepId: string, dropId: string) {
    const rows = await this.prisma.authorship.findMany({ where: { outcomeId: dropId } });
    for (const row of rows) {
      const exists = await this.prisma.authorship.findFirst({ where: { personId: row.personId, outcomeId: keepId } });
      if (exists) await this.prisma.authorship.delete({ where: { id: row.id } });
      else await this.prisma.authorship.update({ where: { id: row.id }, data: { outcomeId: keepId } });
    }
  }

  private async fillKeepFromDrop(kind: string, keepId: string, dropId: string) {
    const model = kind === 'Outcome' ? this.prisma.outcome : kind === 'Capability' ? this.prisma.capability : this.prisma.demand;
    const keep = await (model as any).findUnique({ where: { id: keepId } });
    const drop = await (model as any).findUnique({ where: { id: dropId } });
    if (!keep || !drop) return;
    const locks = new Set<string>(keep.lockedFields || []);
    const keys = kind === 'Outcome'
      ? ['abstract', 'summaryPublic', 'doi', 'patentNo', 'year', 'trl']
      : kind === 'Capability'
        ? ['summary', 'summaryPublic', 'trl']
        : ['problem', 'summaryPublic', 'expectedOut', 'budgetBand', 'demandKind'];
    const data: Record<string, unknown> = {};
    for (const key of keys) {
      if (locks.has(key)) continue;
      const empty = keep[key] == null || keep[key] === '';
      if (empty && drop[key] != null && drop[key] !== '') data[key] = drop[key];
    }
    if (Object.keys(data).length) await (model as any).update({ where: { id: keepId }, data });
  }

  private async auditSafe(action: string, targetId: string, meta: any) {
    try {
      await this.prisma.auditLog.create({
        data: { action, actor: 'ops', targetType: 'Flywheel', targetId, meta },
      });
    } catch (_) {}
  }

  /** 垃圾标题隔离：公开列表和自动重判都不会再把它放出来。 */
  async quarantineJunk() {
    const shared = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));
    let n = 0;
    const mark = async (model: 'outcome' | 'demand' | 'capability', rows: Array<{ id: string; title: string; extensions: any }>) => {
      for (const row of rows) {
        const title = (row.title || '').trim();
        if (!shared.isJunkTitle(title) && !/^test\d*$/i.test(title)) continue;
        const ext = { ...(row.extensions || {}), quarantine: true, quarantineReason: 'junk_title' };
        await (this.prisma[model] as any).update({
          where: { id: row.id },
          data: { extensions: ext, publishStatus: 'quarantine', publishBlockers: ['junk'], reviewedAt: new Date() },
        });
        n++;
      }
    };
    await mark('outcome', await this.prisma.outcome.findMany({ take: 3000, select: { id: true, title: true, extensions: true } }));
    await mark('demand', await this.prisma.demand.findMany({ take: 3000, select: { id: true, title: true, extensions: true } }));
    await mark('capability', await this.prisma.capability.findMany({ take: 3000, select: { id: true, title: true, extensions: true } }));
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: 'quarantine',
        status: 'done',
        message: `隔离疑似垃圾成果 ${n} 条`,
        payload: { n },
      },
    });
    return { ok: true, quarantined: n, noteZh: `已隔离 ${n} 条垃圾标题。它们不会出现在门户，也不会被自动重判重新发布。` };
  }

  async reembedAfterClean(limit = 80) {
    const shared = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));
    let n = 0;
    const dems = await this.prisma.demand.findMany({ orderBy: { updatedAt: 'desc' }, take: limit * 3 });
    for (const d of dems) {
      const embVal = d.embedding as any;
      if (Array.isArray(embVal) && embVal.length > 8) continue;
      const emb = await shared.embedText([d.title, d.problem, ...(d.industry || [])].join(' '));
      await this.prisma.demand.update({
        where: { id: d.id },
        data: { embedding: emb, embeddingModel: shared.embeddingMeta().mode },
      });
      n++;
      if (n >= limit) break;
    }
    const caps = await this.prisma.capability.findMany({ orderBy: { updatedAt: 'desc' }, take: limit * 2 });
    for (const c of caps) {
      const embVal = c.embedding as any;
      if (Array.isArray(embVal) && embVal.length > 8) continue;
      const emb = await shared.embedText([c.title, c.summary || '', ...(c.keywords || [])].join(' '));
      await this.prisma.capability.update({
        where: { id: c.id },
        data: { embedding: emb, embeddingModel: shared.embeddingMeta().mode },
      });
      n++;
      if (n >= limit * 2) break;
    }
    return { ok: true, reembedded: n, noteZh: `已重算向量 ${n} 条（缺向量的优先）` };
  }

  completenessWizard(take = 30) {
    return this.prisma.dataQualityIssue.findMany({
      where: { resolvedAt: null, code: { in: ['missing_field', 'thin_summary'] } },
      orderBy: { createdAt: 'desc' },
      take,
    }).then((items) => ({
      ok: true,
      items,
      noteZh: '按缺字段一条条补。补完在质检台勾「已处理」。',
    }));
  }


  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  private parseCsvText(text: string): Record<string, string>[] {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const headers = this.splitCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cols = this.splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = (cols[i] ?? '').trim()));
      return row;
    });
  }


  private readonly IMPORT_FIELDS = [
    { key: 'orgName', labelZh: '单位名称', aliases: ['orgName', 'name', '单位', '公司', '企业名称', 'org'] },
    { key: 'title', labelZh: '需求标题', aliases: ['title', 'demand_title', '需求标题', '标题'] },
    { key: 'problem', labelZh: '问题描述', aliases: ['problem', 'demand_problem', '问题', '痛点', '描述'] },
    { key: 'budgetBand', labelZh: '预算', aliases: ['budgetBand', 'demand_budget', '预算'] },
    { key: 'industry', labelZh: '行业标签', aliases: ['industry', 'demand_tags', '行业', '标签'] },
    { key: 'region', labelZh: '地区', aliases: ['region', '地区', '省市'] },
    { key: 'orgType', labelZh: '单位类型', aliases: ['orgType', 'type', '类型'] },
    { key: 'taxonomyCodes', labelZh: '分类码', aliases: ['taxonomyCodes', 'taxonomy', '分类'] },
    { key: 'expectedOut', labelZh: '期望产出', aliases: ['expectedOut', 'demand_expected', '期望'] },
    { key: 'licenseNeed', labelZh: '许可诉求', aliases: ['licenseNeed', '许可'] },
    { key: 'minTrl', labelZh: '最低TRL', aliases: ['minTrl', 'trl'] },
    { key: 'urgency', labelZh: '紧急度', aliases: ['urgency', '紧急'] },
  ];

  private guessColumnMapping(headers: string[]) {
    const mapping: Record<string, string> = {};
    const unmatchedHeaders: string[] = [];
    const used = new Set<string>();
    for (const h of headers) {
      const hl = h.trim();
      let hit: string | null = null;
      for (const f of this.IMPORT_FIELDS) {
        if (used.has(f.key)) continue;
        if (f.aliases.some((a) => a.toLowerCase() === hl.toLowerCase() || a === hl)) {
          hit = f.key;
          break;
        }
      }
      if (hit) {
        mapping[hit] = hl;
        used.add(hit);
      } else unmatchedHeaders.push(hl);
    }
    const missingRequired = ['orgName', 'title', 'problem'].filter((k) => !mapping[k]);
    const needsMapping = missingRequired.length > 0 || unmatchedHeaders.length > 0;
    return {
      mapping,
      unmatchedHeaders,
      missingRequired,
      needsMapping,
      fields: this.IMPORT_FIELDS.map((f) => ({ key: f.key, labelZh: f.labelZh })),
    };
  }


  private headerSignature(headers: string[]) {
    return [...headers].map((h) => h.trim()).filter(Boolean).sort().join('|');
  }

  private safeTenant(tenantId?: string | null) {
    const raw = String(tenantId || 'default').trim() || 'default';
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  }

  private mapsFile(tenantId?: string | null) {
    const tid = this.safeTenant(tenantId);
    return join(this.root(), '.data', 'tenants', tid, 'import-column-maps.json');
  }

  private legacyMapsFile() {
    return join(this.root(), '.data', 'import-column-maps.json');
  }

  private loadSavedMaps(tenantId?: string | null): Record<
    string,
    { mapping: Record<string, string>; updatedAt: string; hits?: number; headers?: string[]; tenantId?: string }
  > {
    try {
      const fs = require('fs');
      const f = this.mapsFile(tenantId);
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8') || '{}');
      // 兼容 M25 全局文件：仅 default 租户可读一次旧位置
      if (this.safeTenant(tenantId) === 'default' && fs.existsSync(this.legacyMapsFile())) {
        return JSON.parse(fs.readFileSync(this.legacyMapsFile(), 'utf8') || '{}');
      }
      return {};
    } catch {
      return {};
    }
  }

  private saveColumnMap(headers: string[], mapping: Record<string, string>, tenantId?: string | null) {
    if (!headers?.length || !mapping || !Object.keys(mapping).length) return;
    const fs = require('fs');
    const path = require('path');
    const tid = this.safeTenant(tenantId);
    const file = this.mapsFile(tid);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const all = this.loadSavedMaps(tid);
    const sig = this.headerSignature(headers);
    const prev = all[sig] || { hits: 0 };
    all[sig] = {
      mapping,
      updatedAt: new Date().toISOString(),
      hits: (prev.hits || 0) + 1,
      headers,
      tenantId: tid,
    };
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
    return { signature: sig, tenantId: tid, file };
  }

  private recallColumnMap(headers: string[], tenantId?: string | null) {
    const sig = this.headerSignature(headers);
    const tid = this.safeTenant(tenantId);
    const row = this.loadSavedMaps(tid)[sig];
    if (!row?.mapping) return null;
    return {
      signature: sig,
      mapping: row.mapping,
      updatedAt: row.updatedAt,
      hits: row.hits || 1,
      tenantId: tid,
    };
  }

  private applyColumnMapping(row: Record<string, any>, mapping?: Record<string, string>) {
    if (!mapping || !Object.keys(mapping).length) return row;
    const out: Record<string, any> = { ...row };
    for (const [canon, src] of Object.entries(mapping)) {
      if (src && row[src] != null && row[src] !== '') out[canon] = row[src];
    }
    return out;
  }

  private badRowsToCsv(rows: Array<{ rowIndex: number; errors: string[]; sampleFix: any; raw?: any }>) {
    const headers = ['row', 'errors', 'orgName', 'title', 'problem', 'budgetBand', 'industry', 'region'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const s = r.sampleFix || {};
      const cells = [
        r.rowIndex,
        (r.errors || []).join('；').replace(/"/g, '""'),
        s.orgName || '',
        s.title || '',
        s.problem || '',
        s.budgetBand || '',
        Array.isArray(s.industry) ? s.industry.join('|') : s.industry || '',
        s.region || '',
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  private normalizeImportRow(row: Record<string, any>, fileName: string, rowIndex: number) {
    const orgName = String(row.orgName || row.name || row.单位 || '').trim();
    const title = String(row.title || row.demand_title || row.需求标题 || '').trim();
    const problem = String(row.problem || row.demand_problem || row.问题 || title).trim();
    const errors: string[] = [];
    if (!orgName) errors.push('缺单位名称（orgName）');
    if (!title || title.length < 2) errors.push('缺需求标题（title）或太短');
    if (!problem || problem.length < 4) errors.push('问题描述太短');
    const industryRaw = row.industry || row.demand_tags || '';
    const industry = Array.isArray(industryRaw)
      ? industryRaw.map(String)
      : String(industryRaw)
          .split(/[,，|;、]/)
          .map((s) => s.trim())
          .filter(Boolean);
    const taxRaw = row.taxonomyCodes || '';
    const taxonomyCodes = Array.isArray(taxRaw)
      ? taxRaw.map(String)
      : String(taxRaw)
          .split(/[,;|]/)
          .map((s) => s.trim())
          .filter(Boolean);
    const sampleFix = {
      orgName: orgName || '某某科技有限公司',
      orgType: row.orgType || row.type || 'ENTERPRISE',
      region: row.region || '上海',
      title: title || '一句话写清卡点',
      problem: problem || '把现象、影响、期望说清楚',
      budgetBand: row.budgetBand || row.demand_budget || '20-60万',
      industry: industry.length ? industry : ['先进制造'],
      taxonomyCodes,
      licenseNeed: row.licenseNeed || 'negotiable',
      minTrl: row.minTrl != null && row.minTrl !== '' ? Number(row.minTrl) : null,
      urgency: row.urgency || '中',
    };
    return {
      ok: errors.length === 0,
      errors,
      rowIndex,
      fileName,
      data: {
        orgName,
        orgType: String(row.orgType || row.type || 'ENTERPRISE'),
        region: row.region || null,
        creditCode: row.creditCode || null,
        website: row.website || null,
        title,
        problem,
        expectedOut: row.expectedOut || row.demand_expected || null,
        budgetBand: row.budgetBand || row.demand_budget || null,
        industry,
        taxonomyCodes,
        licenseNeed: row.licenseNeed || null,
        minTrl: row.minTrl != null && row.minTrl !== '' ? Number(row.minTrl) : null,
        urgency: row.urgency || '中',
        demoLabel: row.demoLabel || '授权导入',
      },
      sampleFix,
    };
  }

  /**
   * 多文件授权导入：先校验出人话报告，commit=true 才写入好行
   * files: [{ name, content, format?: 'csv'|'json' }]
   */
  async importAuthorizedFiles(
    files: Array<{ name: string; content: string; format?: string }>,
    opts: { commit?: boolean; mapping?: Record<string, string>; tenantId?: string | null } = {},
  ) {
    const tenantId = this.safeTenant(opts.tenantId);
    const list = (files || []).slice(0, 20);
    if (!list.length) return { ok: false, message: '先选至少一个 CSV/JSON 文件' };
    const fileReports: any[] = [];
    const goodRows: any[] = [];
    const allBad: any[] = [];
    let bad = 0;
    let good = 0;
    let mappingSuggest: any = null;
    for (const f of list) {
      const name = f.name || 'unnamed.csv';
      const raw = String(f.content || '');
      const fmt = (f.format || (name.endsWith('.json') ? 'json' : 'csv')).toLowerCase();
      let rows: Record<string, any>[] = [];
      const fileErrors: string[] = [];
      let headers: string[] = [];
      try {
        if (fmt === 'json') {
          const parsed = JSON.parse(raw);
          rows = Array.isArray(parsed) ? parsed : parsed.demands || parsed.rows || [];
          if (!Array.isArray(rows)) {
            fileErrors.push('JSON 需要是数组，或带 demands/rows 字段');
            rows = [];
          }
          headers = rows[0] ? Object.keys(rows[0]) : [];
        } else {
          const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
          headers = lines.length ? this.splitCsvLine(lines[0]).map((h) => h.trim()) : [];
          rows = this.parseCsvText(raw);
          if (!rows.length) fileErrors.push('CSV 空的或只有表头');
        }
      } catch (e: any) {
        fileErrors.push('解析失败：' + (e?.message || e));
      }
      const guess = this.guessColumnMapping(headers);
      const remembered = this.recallColumnMap(headers, tenantId);
      if (remembered?.mapping) {
        guess.mapping = { ...guess.mapping, ...remembered.mapping };
        guess.needsMapping = false;
        (guess as any).remembered = remembered;
      }
      if (!mappingSuggest) mappingSuggest = { ...guess, remembered };
      const mapping =
        opts.mapping && Object.keys(opts.mapping).length
          ? opts.mapping
          : remembered?.mapping || guess.mapping;
      const mappedRows = rows.map((r) => this.applyColumnMapping(r, mapping));
      const rowResults = mappedRows.map((r, i) => this.normalizeImportRow(r, name, i + 2));
      const g = rowResults.filter((r) => r.ok);
      const b = rowResults.filter((r) => !r.ok);
      good += g.length;
      bad += b.length;
      goodRows.push(...g.map((x) => x.data));
      allBad.push(...b);
      fileReports.push({
        name,
        format: fmt,
        headers,
        mapping,
        mappingSuggest: guess,
        total: rows.length,
        good: g.length,
        bad: b.length,
        fileErrors,
        rowErrors: b.slice(0, 30).map((x) => ({
          row: x.rowIndex,
          errors: x.errors,
          sampleFix: x.sampleFix,
        })),
        previewGood: g.slice(0, 3).map((x) => x.data),
      });
    }
    const badRowsCsv = this.badRowsToCsv(
      allBad.slice(0, 200).map((x) => ({
        rowIndex: x.rowIndex,
        errors: x.errors,
        sampleFix: x.sampleFix,
      })),
    );
    const reportZh = [
      `共 ${list.length} 个文件：可入库 ${good} 行，有问题 ${bad} 行。`,
      mappingSuggest?.needsMapping && !opts.mapping
        ? '表头对不上模板时，先在页面映射列再预览。'
        : '',
      bad ? '可下载坏行改正包（CSV）对着改。' : '看起来都能进，确认入库即可。',
    ]
      .filter(Boolean)
      .join('');

    if (!opts.commit) {
      return {
        ok: true,
        preview: true,
        good,
        bad,
        reportZh,
        files: fileReports,
        mappingSuggest,
        badRowsCsv,
        noteZh: `这是预览，还没写库。列映射按租户「${tenantId}」记忆。没问题再点「确认入库」。`,
        tenantId,
      };
    }

    const shared = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));
    let inserted = 0;
    for (const d of goodRows) {
      let org = await this.prisma.organization.findFirst({ where: { name: d.orgName } });
      if (!org) {
        org = await this.prisma.organization.create({
          data: {
            name: d.orgName,
            type: (d.orgType as any) || 'ENTERPRISE',
            region: d.region,
            website: d.website,
            creditCode: d.creditCode,
            summary: `${d.demoLabel || '授权导入'}（非爬取）`,
            extensions: { source: 'authorized_import', label: d.demoLabel || '授权导入' },
          },
        });
      }
      const emb = await shared.embedText([d.title, d.problem, ...(d.industry || [])].join(' '));
      await this.saveGatedDemand(shared, {
        orgId: org.id,
        title: d.title,
        problem: d.problem,
        expectedOut: d.expectedOut,
        budgetBand: d.budgetBand,
        industry: d.industry || [],
        taxonomyCodes: d.taxonomyCodes || [],
        licenseNeed: d.licenseNeed,
        minTrl: d.minTrl,
        urgency: d.urgency,
        regionPref: d.region,
        embedding: emb,
        extensions: { source: 'authorized_import', label: d.demoLabel || '授权导入' },
      }, 'authorized_import');
      inserted++;
    }
    for (const fr of fileReports) {
      if (fr.headers?.length && fr.mapping && Object.keys(fr.mapping).length) {
        this.saveColumnMap(fr.headers, fr.mapping, tenantId);
      }
    }
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: 'authorized_import',
        status: 'done',
        message: `授权导入入库 ${inserted} 行（校验失败 ${bad}）`,
        payload: { inserted, bad, files: fileReports.map((f) => ({ name: f.name, good: f.good, bad: f.bad })) },
      },
    });
    return {
      ok: true,
      preview: false,
      good,
      bad,
      inserted,
      reportZh: reportZh + ` 已写入 ${inserted} 条需求。`,
      files: fileReports,
      mappingSuggest,
      badRowsCsv,
      tenantId,
      noteZh: '入库完成。建议再跑清洗打标。列映射已按本租户记住。',
    };
  }


  /** 本周新入库、未隔离、可拿去跑匹配的卡片 */
  async weekMatchReady(take = 40) {
    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const [demands, outcomes, capabilities] = await Promise.all([
      this.prisma.demand.findMany({
        where: { createdAt: { gte: weekAgo } },
        include: { org: true },
        orderBy: { createdAt: 'desc' },
        take: take * 2,
      }),
      this.prisma.outcome.findMany({
        where: { createdAt: { gte: weekAgo } },
        include: { org: true },
        orderBy: { createdAt: 'desc' },
        take: take * 2,
      }),
      this.prisma.capability.findMany({
        where: { createdAt: { gte: weekAgo } },
        include: { org: true },
        orderBy: { createdAt: 'desc' },
        take: take,
      }),
    ]);
    const notQ = (ext: any) => !(ext && (ext as any).quarantine);
    const published = (row: { publishStatus?: string | null }) => !row.publishStatus || row.publishStatus === 'published';
    const dem = demands
      .filter((d) => notQ(d.extensions) && published(d))
      .slice(0, take)
      .map((d) => ({
        kind: 'demand' as const,
        id: d.id,
        title: d.title,
        orgName: d.org?.name,
        createdAt: d.createdAt,
        industry: d.industry,
        source: (d.extensions as any)?.source || null,
      }));
    const outs = outcomes
      .filter((o) => notQ(o.extensions) && published(o))
      .slice(0, take)
      .map((o) => ({
        kind: 'outcome' as const,
        id: o.id,
        title: o.title,
        orgName: o.org?.name,
        createdAt: o.createdAt,
        openAlexId: o.openAlexId,
        source: (o.extensions as any)?.source || null,
      }));
    const caps = capabilities
      .filter((c) => notQ(c.extensions) && published(c))
      .slice(0, Math.min(take, 20))
      .map((c) => ({
        kind: 'capability' as const,
        id: c.id,
        title: c.title,
        orgName: c.org?.name,
        createdAt: c.createdAt,
        source: (c.extensions as any)?.source || null,
      }));
    return {
      ok: true,
      wave: 'M24-dedupe-map',
      counts: { demands: dem.length, outcomes: outs.length, capabilities: caps.length },
      items: [...dem, ...outs, ...caps],
      noteZh: '本周新建、已发布、未隔离的卡，才适合拿去跑匹配。未发布的留在发布台。',
    };
  }



  /** 对本周清单勾选的需求跑匹配（可取消） */
  async bulkMatchWeekReady(opts: {
    demandIds?: string[];
    topN?: number;
    minScore?: number;
    enqueue?: boolean;
  } = {}) {
    const ids = [...new Set((opts.demandIds || []).filter(Boolean))].slice(0, 40);
    if (!ids.length) return { ok: false, message: '先勾几条本周需求再跑匹配' };
    const rows = await this.prisma.demand.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((d) => [d.id, d]));

    if (opts.enqueue) {
      const progress: any[] = [];
      for (const id of ids) {
        const dem = byId.get(id);
        try {
          await this.jobs.enqueueMatch({
            demandId: id,
            topN: opts.topN || 5,
            minScore: opts.minScore ?? 0.25,
          });
          progress.push({ demandId: id, title: dem?.title, status: 'queued', message: '已入队' });
        } catch (e: any) {
          progress.push({
            demandId: id,
            title: dem?.title,
            status: 'error',
            message: String(e?.message || e).slice(0, 200),
          });
        }
      }
      const n = progress.filter((p) => p.status === 'queued').length;
      await this.prisma.jobLog.create({
        data: {
          queue: 'match',
          jobName: 'week_bulk_enqueue',
          status: 'done',
          message: `本周清单入队匹配 ${n}/${ids.length}`,
          payload: { ids, progress },
        },
      });
      return {
        ok: true,
        mode: 'enqueue',
        total: ids.length,
        done: n,
        progress,
        summaryZh: `已排进队列 ${n} 条，打开「任务」页看进度（大白话：排队跑，不卡页面）。入队后单条任务不在这里取消。`,
      };
    }

    const log = await this.prisma.jobLog.create({
      data: {
        queue: 'match',
        jobName: 'week_bulk_run',
        status: 'running',
        message: `本周清单同步匹配开始 ${ids.length} 条`,
        payload: { ids, topN: opts.topN || 5 },
      },
    });
    const jobId = log.id;
    bulkMatchJobs.set(jobId, {
      cancel: false,
      status: 'running',
      progress: [],
      total: ids.length,
      done: 0,
      totalMatches: 0,
      startedAt: new Date().toISOString(),
    });

    // 后台跑，接口先返回 jobId，方便取消
    setImmediate(() => {
      this.runBulkMatchJob(jobId, ids, byId, opts.topN || 5, opts.minScore ?? 0.25).catch(async (e) => {
        const st = bulkMatchJobs.get(jobId);
        if (st) {
          st.status = 'error';
          st.summaryZh = String(e?.message || e);
          st.finishedAt = new Date().toISOString();
        }
        await this.prisma.jobLog
          .update({
            where: { id: jobId },
            data: { status: 'failed', message: String(e?.message || e).slice(0, 400) },
          })
          .catch(() => null);
      });
    });

    return {
      ok: true,
      mode: 'async',
      jobId,
      total: ids.length,
      status: 'running',
      summaryZh: `已开始匹配 ${ids.length} 条。可点「取消」停掉还没跑的；已完成的配对会留下，不会乱删。`,
    };
  }

  private async runBulkMatchJob(
    jobId: string,
    ids: string[],
    byId: Map<string, any>,
    topN: number,
    minScore: number,
  ) {
    const st = bulkMatchJobs.get(jobId)!;
    let totalMatches = 0;
    for (let i = 0; i < ids.length; i++) {
      if (st.cancel) {
        for (let j = i; j < ids.length; j++) {
          const dem = byId.get(ids[j]);
          st.progress.push({
            demandId: ids[j],
            title: dem?.title,
            status: 'cancelled',
            message: '已取消，未跑',
          });
        }
        st.status = 'cancelled';
        st.finishedAt = new Date().toISOString();
        st.summaryZh = `已取消：完成 ${st.done}/${st.total}，产出 ${totalMatches} 对；其余没跑。已生成的配对保留。`;
        await this.prisma.jobLog.update({
          where: { id: jobId },
          data: {
            status: 'cancelled',
            message: st.summaryZh,
            payload: { progress: st.progress, totalMatches, cancelled: true },
          },
        });
        return;
      }
      const id = ids[i];
      const dem = byId.get(id);
      try {
        const r = await this.matches.runMatch({ demandId: id, topN, minScore });
        totalMatches += r.count || 0;
        st.done += 1;
        st.totalMatches = totalMatches;
        st.progress.push({
          demandId: id,
          title: dem?.title,
          status: 'done',
          count: r.count,
          message: `第 ${i + 1}/${ids.length} 条完成，生成 ${r.count} 对`,
        });
      } catch (e: any) {
        st.progress.push({
          demandId: id,
          title: dem?.title,
          status: 'error',
          message: String(e?.message || e).slice(0, 200),
        });
      }
      await this.prisma.jobLog
        .update({
          where: { id: jobId },
          data: {
            message: `本周清单匹配中 ${st.done}/${st.total}`,
            payload: { progress: st.progress, totalMatches },
          },
        })
        .catch(() => null);
    }
    st.status = 'done';
    st.finishedAt = new Date().toISOString();
    st.summaryZh = `勾选的 ${ids.length} 条里，成功 ${st.done} 条，一共产出 ${totalMatches} 对匹配。`;
    await this.prisma.jobLog.update({
      where: { id: jobId },
      data: {
        status: 'done',
        message: st.summaryZh,
        payload: { progress: st.progress, totalMatches },
      },
    });
  }

  async getBulkMatchJob(jobId: string) {
    const st = bulkMatchJobs.get(jobId);
    if (!st) {
      const log = await this.prisma.jobLog.findUnique({ where: { id: jobId } });
      if (!log) return { ok: false, message: '找不到这个批量任务' };
      return {
        ok: true,
        jobId,
        status: log.status,
        summaryZh: log.message,
        progress: (log.payload as any)?.progress || [],
        fromDb: true,
      };
    }
    return {
      ok: true,
      jobId,
      status: st.status,
      total: st.total,
      done: st.done,
      totalMatches: st.totalMatches,
      progress: st.progress,
      summaryZh: st.summaryZh,
      startedAt: st.startedAt,
      finishedAt: st.finishedAt,
      cancelRequested: st.cancel,
    };
  }

  cancelBulkMatchJob(jobId: string) {
    const st = bulkMatchJobs.get(jobId);
    if (!st) return { ok: false, message: '任务不在本进程或已结束' };
    if (st.status !== 'running') {
      return { ok: true, jobId, status: st.status, summaryZh: '已经不在跑了，不用取消' };
    }
    st.cancel = true;
    return {
      ok: true,
      jobId,
      status: 'cancelling',
      summaryZh: '已请求取消：当前这条跑完就停，后面的不跑。已生成的配对不删。',
    };
  }

  private fillPreviewPath(tenantId?: string | null) {
    return join(this.root(), '.data', 'tenants', this.safeTenant(tenantId), 'fill-empty-preview.json');
  }

  /** 仅补空：先出字段级 old→new 预览，不写库 */
  async previewFillEmpty(opts: { limit?: number; tenantId?: string | null } = {}) {
    const tenantId = this.safeTenant(opts.tenantId);
    const previewOut = this.fillPreviewPath(tenantId);
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(previewOut);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 同步跑 worker 预览（演示用 limit 小）
    const env = {
      ...process.env,
      OPENALEX_BATCH: '1',
      OPENALEX_LIMIT: String(opts.limit || 1),
      OPENALEX_FILL_EMPTY: '1',
      OPENALEX_FILL_EMPTY_PREVIEW: '1',
      OPENALEX_PREVIEW_OUT: previewOut,
    };
    const script = join(this.root(), 'workers/crawl/src/openalex.ts');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npx', ['tsx', script], { cwd: this.root(), env, stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('preview exit ' + code))));
    });
    let report: any = { diffs: [], count: 0 };
    if (fs.existsSync(previewOut)) {
      report = JSON.parse(fs.readFileSync(previewOut, 'utf8'));
    }
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: 'fill_empty_preview',
        status: 'done',
        message: `仅补空预览 ${report.count || 0} 条（租户 ${tenantId}）`,
        payload: { tenantId, previewOut, count: report.count || 0 },
      },
    });
    return {
      ok: true,
      preview: true,
      tenantId,
      count: report.count || 0,
      diffs: (report.diffs || []).slice(0, 80),
      previewOut,
      noteZh:
        (report.count || 0)
          ? '下面是将要补的字段（旧→新）。确认后才会写库；不确认就当没发生。'
          : '没有可补的空字段（可能都满了，或夹具里对不上）。',
    };
  }

  /** 确认应用仅补空预览（可只选一部分 outcomeId） */
  async confirmFillEmpty(opts: {
    tenantId?: string | null;
    outcomeIds?: string[];
    applyAll?: boolean;
  } = {}) {
    const tenantId = this.safeTenant(opts.tenantId);
    const fs = require('fs');
    const previewOut = this.fillPreviewPath(tenantId);
    if (!fs.existsSync(previewOut)) {
      return { ok: false, message: '还没有预览。先点「预览仅补空」。' };
    }
    const report = JSON.parse(fs.readFileSync(previewOut, 'utf8'));
    let diffs: any[] = report.diffs || [];
    if (!opts.applyAll && opts.outcomeIds?.length) {
      const allow = new Set(opts.outcomeIds);
      diffs = diffs.filter((d) => allow.has(d.outcomeId));
    }
    let applied = 0;
    for (const d of diffs) {
      if (!d?.outcomeId || !d?.patch) continue;
      const cur = await this.prisma.outcome.findUnique({ where: { id: d.outcomeId } });
      if (!cur) continue;
      // 再校验仍为空，避免覆盖期间人工改过的
      const patch: any = {};
      for (const [k, v] of Object.entries(d.patch)) {
        if (k === 'extensions') {
          const ext = { ...((cur.extensions as any) || {}), ...((v as any) || {}) };
          patch.extensions = ext;
          continue;
        }
        const curV = (cur as any)[k];
        const empty =
          curV == null ||
          curV === '' ||
          (Array.isArray(curV) && curV.length === 0);
        if (empty) patch[k] = v;
      }
      if (!Object.keys(patch).length) continue;
      await this.prisma.outcome.update({ where: { id: d.outcomeId }, data: patch });
      applied++;
    }
    await this.prisma.jobLog.create({
      data: {
        queue: 'crawl',
        jobName: 'fill_empty_confirm',
        status: 'done',
        message: `仅补空已确认写入 ${applied} 条（租户 ${tenantId}）`,
        payload: { tenantId, applied, selected: diffs.length },
      },
    });
    return {
      ok: true,
      applied,
      selected: diffs.length,
      tenantId,
      noteZh: `已按预览写入 ${applied} 条。只补当时仍为空的字段。`,
    };
  }

}
