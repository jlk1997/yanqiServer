/**
 * 对空库或现有库做一次清洗发布自检。不打印原文。
 */
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { applyParsedRecords } = require(path.join(root, 'packages/shared/src/apply-parsed.js'));
const prisma = new PrismaClient();
const fails = [];
function check(name, cond) {
  if (!cond) {
    fails.push(name);
    console.log('✗', name);
  } else console.log('✓', name);
}

const stamp = 'selfcheck-' + Date.now();
const applied = await applyParsedRecords(prisma, [
  {
    id: null,
    entityHint: 'demand',
    fields: {
      sourceCode: 'file-demand',
      orgName: stamp + '企业',
      orgType: 'ENTERPRISE',
      title: '短需求',
      problem: '太短',
      demandKind: 'unknown',
    },
  },
  {
    id: null,
    entityHint: 'demand',
    fields: {
      sourceCode: 'file-demand',
      orgName: stamp + '企业',
      orgType: 'ENTERPRISE',
      title: stamp + '视觉检测需求',
      problem: '产线表面缺陷仍靠人工目检，希望换成可在线运行的视觉检测装置，并给出试点验收办法和部署条件。',
      demandKind: 'tech_problem',
      industry: ['工业视觉'],
      taxonomyCodes: ['mfg.vision'],
      region: '上海',
    },
  },
  {
    id: null,
    entityHint: 'outcome',
    fields: {
      sourceCode: 'openalex',
      schoolName: stamp + '大学',
      title: stamp + '表面缺陷检测论文',
      type: 'PAPER',
      year: 2024,
      abstract: '本文给出金属表面缺陷检测流程，覆盖采集、标注、模型与产线部署，并讨论误报控制与验收指标，便于和制造企业的在线检测需求对照。',
      openAlexId: stamp + '-work',
      authors: [{ name: stamp + '老师', order: 1, corresponding: true, openAlexAuthorId: stamp + '-author' }],
      ipcOrDisc: ['工业视觉', '缺陷检测'],
    },
  },
]);

const thin = await prisma.demand.findFirst({ where: { title: '短需求', org: { name: stamp + '企业' } } });
const full = await prisma.demand.findFirst({ where: { title: stamp + '视觉检测需求' } });
const outcome = await prisma.outcome.findFirst({ where: { openAlexId: stamp + '-work' }, include: { person: true, authorships: true } });
check('薄需求不进入发布态', thin && thin.publishStatus !== 'published');
check('完整需求发布', full && full.publishStatus === 'published' && full.demandKind === 'tech_problem');
check('论文挂到老师', Boolean(outcome?.personId && outcome.authorships.length === 1));
check('公开摘要去掉过长残片', (outcome?.summaryPublic || '').length > 20 && (outcome?.summaryPublic || '').length <= 280);

await prisma.demand.update({ where: { id: full.id }, data: { lockedFields: ['problem'], problem: '人工锁定后的问题描述，不应被下一次导入覆盖。这段文字足够长，用来确认锁定。' } });
await applyParsedRecords(prisma, [
  {
    id: null,
    entityHint: 'demand',
    fields: {
      sourceCode: 'file-demand',
      orgName: stamp + '企业',
      title: stamp + '视觉检测需求',
      problem: '这是采集方试图覆盖的另一段很长的问题描述，不应该写进已经锁定的字段里。',
      demandKind: 'tech_problem',
      taxonomyCodes: ['mfg.vision'],
    },
  },
]);
const locked = await prisma.demand.findUnique({ where: { id: full.id } });
check('锁定字段不被覆盖', locked.problem.includes('人工锁定'));

const again = await applyParsedRecords(prisma, [
  {
    id: null,
    entityHint: 'person',
    fields: {
      sourceCode: 'faculty-page',
      name: stamp + '老师',
      schoolName: stamp + '大学',
      collegeName: '机械学院',
      openAlexAuthorId: stamp + '-author',
      researchSummary: '从事工业视觉与表面缺陷在线检测，面向制造产线给出可部署的算法和验收方法。',
    },
  },
]);
check('同一作者 ID 不新建第二个人', Boolean(outcome?.personId) && again.results.some((r) => r.id === outcome.personId));
const people = await prisma.person.count({ where: { openAlexAuthorId: stamp + '-author' } });
check('作者只有一条', people === 1);

const { IngestService } = require(path.join(root, 'apps/api/dist/ingest/ingest.service.js'));
const school = await prisma.organization.findFirst({ where: { name: stamp + '大学' } });
const thinOutcome = await prisma.outcome.create({
  data: {
    orgId: school.id,
    title: stamp + '待补成果',
    type: 'PAPER',
    abstract: '短',
    publishStatus: 'canonical',
    publishBlockers: ['thin_summary', 'no_person'],
  },
});
await prisma.outcome.update({
  where: { id: thinOutcome.id },
  data: {
    personId: outcome.personId,
    year: 2024,
    openAlexId: stamp + '-rejudge',
    abstract: '补齐后的摘要说明这项成果如何对应企业的在线检测需求，并给出可复核的实验、误报控制和部署条件。补充样本规模、产线节拍、验收口径、现场约束和数据口径，避免正文短到不能发布。',
  },
});
const ingest = new IngestService(prisma, { scanAll: async () => ({ total: 0 }) });
const judged = await ingest.rejudge();
const after = await prisma.outcome.findUnique({ where: { id: thinOutcome.id } });
if (after.publishStatus !== 'published') {
  console.log('重判结果', after.publishStatus, after.publishBlockers, (after.abstract || '').length);
}
check('补齐后重判可以发布', after.publishStatus === 'published' && after.publishBlockers.length === 0);
check('重判统计可返回', judged.promoted >= 1);
const junk = await prisma.outcome.create({
  data: {
    orgId: school.id,
    title: 'test',
    type: 'PAPER',
    abstract: 'x'.repeat(120),
    year: 2024,
    personId: outcome.personId,
    publishStatus: 'quarantine',
    publishBlockers: ['junk'],
    extensions: { quarantine: true, quarantineReason: 'junk_title' },
  },
});
await ingest.rejudge();
const junkAfter = await prisma.outcome.findUnique({ where: { id: junk.id } });
check('隔离不会被重判重新发布', junkAfter.publishStatus === 'quarantine');
const released = await ingest.setPublish('outcome', junk.id, 'published');
check('运营确认发布后隔离标记去掉', released.publishStatus === 'published' && !released.extensions?.quarantine);
await prisma.outcome.delete({ where: { id: junk.id } });

const { FlywheelService } = require(path.join(root, 'apps/api/dist/flywheel/flywheel.service.js'));
const flywheel = new FlywheelService(prisma, {}, {}, {}, {}, {});
const keepOut = await prisma.outcome.create({
  data: { orgId: school.id, title: stamp + '重复成果', type: 'PAPER', abstract: null, publishStatus: 'published', year: 2020 },
});
const dropOut = await prisma.outcome.create({
  data: { orgId: school.id, title: stamp + '重复成果', type: 'PAPER', abstract: '被合并进来的较长摘要，用来补留存那条原来空着的摘要字段。', publishStatus: 'published', year: 2024, personId: outcome.personId },
});
const ent = await prisma.organization.findFirst({ where: { name: stamp + '企业' } });
const dem = await prisma.demand.findFirst({ where: { orgId: ent.id } });
const linked = await prisma.matchResult.create({
  data: { demandId: dem.id, outcomeId: dropOut.id, supplyKey: 'o:' + dropOut.id, totalScore: 0.5, scoreBreakdown: { action: 'REVIEW' } },
});
const merged = await flywheel.applyMerge('Outcome', keepOut.id, [dropOut.id]);
const moved = await prisma.matchResult.findUnique({ where: { id: linked.id } });
const keptRow = await prisma.outcome.findUnique({ where: { id: keepOut.id } });
check('重复成果的匹配改挂到留下的那条', moved?.outcomeId === keepOut.id && moved?.supplyKey === 'o:' + keepOut.id && merged.moved === 1);
check('留下的成果补上被合并的摘要', (keptRow.abstract || '').includes('被合并进来'));
await prisma.matchResult.delete({ where: { id: linked.id } }).catch(() => null);
await prisma.outcome.delete({ where: { id: keepOut.id } }).catch(() => null);

await prisma.demand.deleteMany({ where: { org: { name: stamp + '企业' } } });
await prisma.authorship.deleteMany({ where: { outcome: { openAlexId: stamp + '-work' } } });
await prisma.outcome.deleteMany({ where: { OR: [{ openAlexId: stamp + '-work' }, { openAlexId: stamp + '-rejudge' }] } });
await prisma.capability.deleteMany({ where: { person: { openAlexAuthorId: stamp + '-author' } } });
await prisma.person.deleteMany({ where: { openAlexAuthorId: stamp + '-author' } });
await prisma.organization.deleteMany({ where: { name: { startsWith: stamp } } });

if (fails.length) {
  console.error(fails);
  process.exit(1);
}
console.log('ingest-selfcheck ok');
await prisma.$disconnect();
