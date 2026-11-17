import { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { FindPeopleService } = require(path.join(root, 'apps/api/dist/outreach/find-people.service.js'));
const prisma = new PrismaClient();
const svc = new FindPeopleService(prisma);
const stamp = 'fp-' + Date.now();
const fails = [];
function check(name, cond) {
  if (!cond) {
    fails.push(name);
    console.log('✗', name);
  } else console.log('✓', name);
}

const org = await prisma.organization.create({
  data: { name: stamp + '大学', type: 'UNIVERSITY', unitKind: 'school', publishStatus: 'published' },
});
const ent = await prisma.organization.create({
  data: { name: stamp + '企业', type: 'ENTERPRISE', unitKind: 'enterprise', publishStatus: 'published' },
});
const person = await prisma.person.create({
  data: { name: stamp + '老师', orgId: org.id, email: 'teacher@example.com', publishStatus: 'published', source: 'selfcheck' },
});
const demand = await prisma.demand.create({
  data: {
    orgId: ent.id,
    title: stamp + '需求',
    problem: '需要把表面缺陷检测做到产线里，并给出可验收的试点方案和部署条件说明。',
    demandKind: 'tech_problem',
    taxonomyCodes: ['mfg.vision'],
    publishStatus: 'published',
    industry: ['工业视觉'],
  },
});
const outcome = await prisma.outcome.create({
  data: {
    orgId: org.id,
    personId: person.id,
    title: stamp + '成果',
    type: 'PAPER',
    abstract: '表面缺陷检测的产线部署说明，包含误报控制和验收指标，供和企业需求对照。',
    summaryPublic: '表面缺陷检测的产线部署说明。',
    publishStatus: 'published',
    year: 2025,
  },
});
await prisma.authorship.create({ data: { personId: person.id, outcomeId: outcome.id, authorOrder: 1, isCorresponding: true } });
const shadow = await prisma.matchResult.create({
  data: {
    demandId: demand.id,
    outcomeId: outcome.id,
    supplyKey: 'o:' + outcome.id + ':shadow',
    totalScore: 0.8,
    scoreBreakdown: { action: 'SHADOW', sliceStage: 'accumulating' },
  },
});
const review = await prisma.matchResult.create({
  data: {
    demandId: demand.id,
    outcomeId: outcome.id,
    supplyKey: 'o:' + outcome.id,
    totalScore: 0.82,
    primaryPersonId: person.id,
    scoreBreakdown: { action: 'REVIEW', sliceStage: 'outreach', collabMode: 'lateral', collabModeLabel: '横向开发或技术服务' },
  },
});
const blocked = await svc.findForMatch(shadow.id);
check('蓄水期不生成线索', blocked.ok === false && blocked.code === 'slice_not_ready');
const found = await svc.findForMatch(review.id);
check('达标后写出草稿且未发送', found.ok === true && !found.sentAt);
const lead = await prisma.lead.findFirst({ where: { matchId: review.id } });
check('草稿点名合作方式', Boolean(lead?.draftBody?.includes('横向开发')));
const again = await svc.findForMatch(review.id);
check('七天内不重复生成', again.ok === false && again.code === 'frequency_cap');
const rejected = await svc.reject(review.id, 'wrong_person', '同名');
check('驳回记原因', rejected.reason === 'wrong_person');

const bare = await prisma.person.create({
  data: { name: stamp + '无邮箱', orgId: org.id, publishStatus: 'published', source: 'selfcheck' },
});
const bareOutcome = await prisma.outcome.create({
  data: {
    orgId: org.id,
    personId: bare.id,
    title: stamp + '无邮箱成果',
    type: 'PAPER',
    abstract: '这条成果用来核对没有联系点时会进入缺口，补上邮箱后才生成草稿。',
    summaryPublic: '没有联系点的成果。',
    publishStatus: 'published',
    year: 2025,
  },
});
const bareMatch = await prisma.matchResult.create({
  data: {
    demandId: demand.id,
    outcomeId: bareOutcome.id,
    supplyKey: 'o:' + bareOutcome.id,
    totalScore: 0.8,
    primaryPersonId: bare.id,
    scoreBreakdown: {
      action: 'REVIEW',
      sliceStage: 'outreach',
      sliceKey: 'mfg.vision',
      collabMode: 'lateral',
      collabModeLabel: '横向开发或技术服务',
    },
  },
});
const missing = await svc.findForMatch(bareMatch.id);
check('没有邮箱进入缺口', missing.ok === false && missing.code === 'no_contact' && Boolean(missing.gapId));
const bad = await svc.fillGap(missing.gapId, { email: 'not-an-email' });
check('坏邮箱不会写入', bad.ok === false);
const filled = await svc.fillGap(missing.gapId, { email: 'lab@example.com' });
check('补上联系点后生成未发送草稿', filled.ok === true && filled.draft?.ok === true && !filled.draft.sentAt);

await prisma.lead.deleteMany({ where: { matchId: { in: [shadow.id, review.id, bareMatch.id] } } });
await prisma.contactGap.deleteMany({ where: { matchId: { in: [shadow.id, review.id, bareMatch.id] } } });
await prisma.contactPoint.deleteMany({ where: { personId: { in: [person.id, bare.id] } } });
await prisma.matchFeedback.deleteMany({ where: { matchId: { in: [review.id, bareMatch.id] } } });
await prisma.dataQualityIssue.deleteMany({ where: { entityId: { in: [person.id, bare.id] } } });
await prisma.matchResult.deleteMany({ where: { id: { in: [shadow.id, review.id, bareMatch.id] } } });
await prisma.authorship.deleteMany({ where: { outcomeId: { in: [outcome.id, bareOutcome.id] } } });
await prisma.outcome.deleteMany({ where: { id: { in: [outcome.id, bareOutcome.id] } } });
await prisma.demand.delete({ where: { id: demand.id } });
await prisma.person.deleteMany({ where: { id: { in: [person.id, bare.id] } } });
await prisma.organization.deleteMany({ where: { id: { in: [org.id, ent.id] } } });

if (fails.length) {
  console.error(fails);
  process.exit(1);
}
console.log('find-people-selfcheck ok');
await prisma.$disconnect();
