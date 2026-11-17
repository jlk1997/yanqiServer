/**
 * 卷宗规则与发布门闩。不连数据库。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossier = require(path.join(root, 'packages/shared/src/dossier.js'));

const fails = [];
function check(name, cond) {
  if (!cond) fails.push(name);
  else console.log('✓', name);
}

check('采购且成熟 → 许可', dossier.routeCollabMode({ demandKind: 'procurement', trl: 7, hardPass: true, licenseOpenness: 'negotiable' }) === 'license');
check('揭榜 → 联合攻关', dossier.routeCollabMode({ demandKind: 'challenge', trl: 5, hardPass: true }) === 'challenge');
check('早期联合研发 → 横向', dossier.routeCollabMode({ demandKind: 'joint_rd', trl: 3, hardPass: true }) === 'lateral');
check('未过硬门槛 → 只观察', dossier.routeCollabMode({ demandKind: 'tech_problem', trl: 6, hardPass: false }) === 'observe');
check('技术问题且成熟 → 横向', dossier.routeCollabMode({ demandKind: 'tech_problem', trl: 6, hardPass: true }) === 'lateral');

const thin = dossier.publishDecision('demand', { title: '短', problem: '太短', orgId: 'o', demandKind: 'unknown', taxonomyCodes: [] });
check('薄需求不发布', thin.status !== 'published' && thin.blockers.includes('unknown_demand_kind'));

const ready = dossier.publishDecision('demand', {
  title: '产线视觉检测要能落地',
  problem: '老旧产线缺陷靠人工目检，希望换成可在线运行的视觉检测，并给出试点验收办法和部署条件。',
  orgId: 'o',
  demandKind: 'tech_problem',
  taxonomyCodes: ['mfg.vision'],
});
check('完整需求可发布', ready.status === 'published');

const shadow = dossier.buildMatchDossier({
  breakdown: { hardPass: true, conflicts: [] },
  total: 0.8,
  demandKind: 'tech_problem',
  demandTitle: '视觉检测',
  trl: 6,
  supplyId: 's1',
  supplyTitle: '表面缺陷检测',
  supplyKind: 'outcome',
  sliceStage: 'accumulating',
  primaryPersonId: 'p1',
});
check('蓄水期是影子匹配', shadow.action === 'SHADOW');

const review = dossier.buildMatchDossier({
  breakdown: { hardPass: true, conflicts: [] },
  total: 0.8,
  demandKind: 'tech_problem',
  trl: 6,
  supplyId: 's1',
  supplyTitle: '表面缺陷检测',
  sliceStage: 'outreach',
  sliceKey: 'mfg.vision',
  primaryPersonId: 'p1',
  fresh: true,
});
check('达标高分进入复核', review.action === 'REVIEW' && review.evidence[0].id === 's1');
check('证据写进理由', review.reasonSuffix.includes('表面缺陷检测'));

const summary = dossier.summarizeSlices({
  thresholds: { minTeachers: 1, minDemands: 1, maxAgeDays: 45, minContactRatio: 0.3, reviewMinScore: 0.45 },
  people: [{ id: 'p1', email: 'a@b.c', publishStatus: 'published', taxonomyCodes: ['mfg.vision'], updatedAt: new Date() }],
  demands: [{ id: 'd1', publishStatus: 'published', taxonomyCodes: ['mfg.vision'], industry: [], demandKind: 'tech_problem', updatedAt: new Date() }],
  outcomes: [{ id: 'o1', personId: 'p1', publishStatus: 'published', taxonomyCodes: ['mfg.vision'], updatedAt: new Date() }],
  capabilities: [],
  contacts: [],
});
check('小阈值切片可进入找人', summary.slices[0]?.stage === 'outreach');
check('未发布原因说人话', dossier.BLOCKER_ZH.no_person === '还没挂到具体老师');
check('影子动作说人话', dossier.ACTION_ZH.SHADOW.includes('先不找人'));
check('影子匹配不对机构展示', dossier.visibleToOrg('SHADOW') === false && dossier.visibleToOrg('REVIEW') === true);
const selfOutcome = dossier.publishDecision('outcome', {
  title: '机构自己填写的样机成果',
  type: 'PROTOTYPE',
  abstract: '这是机构自己填写的样机说明，写清了能解决的产线问题、当前试用条件、验收方式、现场约束、样本规模和误报控制，正文足够长，可以公开展示给企业查看。再补充部署节拍、数据口径和试点范围。',
  orgId: 'org',
  sourceCode: 'portal_self',
});
check('机构自填成果不必先挂老师也能发布', selfOutcome.status === 'published');
const thinSelf = dossier.publishDecision('outcome', {
  title: '太短的自填成果',
  type: 'PAPER',
  abstract: '只有一两句。',
  orgId: 'org',
  sourceCode: 'portal_self',
});
check('机构自填成果太短仍不发布', thinSelf.status !== 'published' && thinSelf.blockers.includes('thin_summary'));
const kept = dossier.stripLocked({ abstract: '采集来的新摘要', doi: '10.1/new', title: '标题' }, ['abstract', 'title']);
check('锁定字段不会被采集覆盖', kept.abstract == null && kept.title == null && kept.doi === '10.1/new');
const merged = dossier.mergeLocked({ problem: '人工写定的问题描述，不能被下一轮导入换掉。' }, { problem: '采集想覆盖的正文', title: '同名需求' }, ['problem']);
check('再次导入保留已锁定正文', merged.problem.includes('人工写定') && merged.title === '同名需求');
const demo = dossier.publishDecision('demand', {
  title: '演示需求标题足够长',
  problem: '这是一段足够长的演示问题描述，用来确认演示夹具即使写得很完整也不会进入公开广场。',
  orgId: 'o',
  demandKind: 'tech_problem',
  industry: ['工业视觉'],
  sourceCode: 'demo_fixture',
});
check('演示夹具不进入发布态', demo.status === 'quarantine' && demo.blockers.includes('demo_blocked'));
check('演示来源可识别', dossier.isDemoSource('demo_fixture') === true && dossier.isDemoSource('openalex') === false);
const derived = dossier.publishDecision('capability', {
  title: '某大学·工业视觉方向',
  summary: '根据公开论文高频主题整理出的能力说明，覆盖检测、样本和产线部署，字数已经超过发布门槛。',
  keywords: ['工业视觉', '缺陷检测'],
  orgId: 'org',
  sourceCode: 'openalex-derived',
});
check('自动凝练的能力卡默认不公开', derived.status !== 'published' && derived.blockers.includes('no_evidence'));
check('影子匹配不能发出', dossier.outreachBlock({ action: 'SHADOW', cards: [{ publishStatus: 'published' }] })?.code === 'not_ready');
check('未发布档案不能发出', dossier.outreachBlock({ action: 'REVIEW', cards: [{ publishStatus: 'canonical' }] })?.code === 'unpublished');
check('隔离档案不能发出', dossier.outreachBlock({ action: 'FIND_PEOPLE', cards: [{ publishStatus: 'published', quarantine: true }] })?.code === 'quarantine');
check('演示档案不能发出', dossier.outreachBlock({ action: 'REVIEW', cards: [{ publishStatus: 'published', source: 'demo_fixture' }] })?.code === 'demo');
check('暂停切片不能发出', dossier.outreachBlock({ action: 'FIND_PEOPLE', cards: [{ publishStatus: 'published' }], slicePaused: true })?.code === 'slice_paused');
check('七天内已联系过不能再发', dossier.outreachBlock({ action: 'REVIEW', cards: [{ publishStatus: 'published' }], recentContact: true })?.code === 'frequency_cap');
check('可复核且已发布可以发出', dossier.outreachBlock({ action: 'REVIEW', cards: [{ publishStatus: 'published' }], personStatus: 'published' }) == null);
check('影子匹配不能对外展示', dossier.externalShareBlock({ action: 'SHADOW', cards: [{ publishStatus: 'published' }] })?.code === 'not_ready');
check('未发布不能做成对外一页纸', dossier.externalShareBlock({ action: 'REVIEW', cards: [{ publishStatus: 'canonical' }] })?.code === 'unpublished');
check('已发布的复核结果可以对外展示', dossier.externalShareBlock({ action: 'FIND_PEOPLE', cards: [{ publishStatus: 'published' }] }) == null);
const cleaned = dossier.publicCaseText('华东理工大学与张老师对接，邮箱 a@b.cn，电话 13800138000。建议对接：张老师。', ['华东理工大学']);
check('公开案例去掉真名、邮箱、电话和对接人', cleaned.includes('某机构') && !cleaned.includes('a@b.cn') && !cleaned.includes('13800138000') && !cleaned.includes('建议对接'));

if (fails.length) {
  console.error(fails);
  process.exit(1);
}
console.log('dossier-eval ok', dossier.RULE_VERSION);
