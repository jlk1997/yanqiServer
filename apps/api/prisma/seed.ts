import { PrismaClient, OrgType, OutcomeType } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as path from 'path';
const { hashEmbed } = require(path.join(__dirname, '../../../packages/shared/src/match-lib.js'));

const prisma = new PrismaClient();

async function main() {
  console.log('清空旧演示数据…');
  await prisma.lead.deleteMany();
  await prisma.matchResult.deleteMany();
  await prisma.jobLog.deleteMany();
  await prisma.person.deleteMany();
  await prisma.capability.deleteMany();
  await prisma.outcome.deleteMany();
  await prisma.demand.deleteMany();
  await prisma.organization.deleteMany();

  const ust = await prisma.organization.create({
    data: {
      name: '上海理工大学',
      type: OrgType.UNIVERSITY,
      region: '上海',
      website: 'https://www.usst.edu.cn',
      summary: '工科见长的地方高校，光电、智能制造、材料与环境方向活跃。',
      openAlexId: 'I201146174',
      extensions: { alias: ['University of Shanghai for Science and Technology'] },
    },
  });

  const sjtuLab = await prisma.organization.create({
    data: {
      name: '某高校智能制造联合实验室',
      type: OrgType.LAB_INSTITUTE,
      region: '上海',
      website: 'https://example.edu.cn/lab-im',
      summary: '面向离散制造的数字孪生、工业视觉与柔性装配。',
    },
  });

  const entA = await prisma.organization.create({
    data: {
      name: '沪江精密装备有限公司',
      type: OrgType.ENTERPRISE,
      region: '上海',
      website: 'https://example.com/hj-precision',
      summary: '中小型精密零部件与自动化产线集成商，需要视觉检测与工艺优化。',
      creditCode: '91310000MA1KDEMO01',
      extensions: { industry: ['智能制造', '装备'] },
    },
  });

  const entB = await prisma.organization.create({
    data: {
      name: '绿洲新能源科技股份有限公司',
      type: OrgType.ENTERPRISE,
      region: '江苏',
      website: 'https://example.com/lvzhou-energy',
      summary: '储能与电池材料企业，关注电极材料、热管理和失效分析。',
      creditCode: '91320000MA1KDEMO02',
      extensions: { industry: ['新能源', '材料'] },
    },
  });

  const cap1Text = '工业视觉缺陷检测 深度学习 产线在线检测 表面划痕异物识别';
  const cap1 = await prisma.capability.create({
    data: {
      orgId: ust.id,
      title: '工业视觉缺陷检测与产线落地',
      disciplines: ['计算机视觉', '智能制造'],
      keywords: ['工业视觉', '缺陷检测', '深度学习', 'AOI', '产线'],
      offerTypes: ['技术开发', '联合攻关', '样品验证'],
      teamSizeBand: '10-20人',
      contactPolicy: '公开邮箱可初联',
      summary: '面向金属件与注塑件的在线视觉检测，支持小样本学习与边缘部署。',
      embedding: hashEmbed(cap1Text),
    },
  });

  const cap2Text = '数字孪生 柔性装配 工艺仿真 离散制造';
  await prisma.capability.create({
    data: {
      orgId: sjtuLab.id,
      title: '离散制造数字孪生与柔性装配',
      disciplines: ['机械工程', '自动化'],
      keywords: ['数字孪生', '柔性装配', '工艺仿真', '机器人'],
      offerTypes: ['联合实验室', '技术服务'],
      teamSizeBand: '5-15人',
      contactPolicy: '经学院审核',
      summary: '可对产线节拍、工装夹具与机器人轨迹做孪生仿真与优化。',
      embedding: hashEmbed(cap2Text),
    },
  });

  const out1Text = '固态电池 固态电解质 界面阻抗 热管理';
  await prisma.outcome.create({
    data: {
      orgId: ust.id,
      title: '氧化物固态电解质界面改性方法',
      type: OutcomeType.PATENT,
      abstract: '提出一种降低固态电池界面阻抗的改性工艺，并给出热管理配合方案。',
      ipcOrDisc: ['新能源', '材料', '固态电池', '热管理'],
      trl: 4,
      rights: '职务发明-学校持有',
      patentNo: 'CN2023DEMO0001',
      embedding: hashEmbed(out1Text),
    },
  });

  await prisma.outcome.create({
    data: {
      orgId: sjtuLab.id,
      title: '小样本工业缺陷检测算法论文成果',
      type: OutcomeType.PAPER,
      abstract: '在少量标注条件下提升金属表面缺陷召回率，适合中小产线快速部署。',
      ipcOrDisc: ['计算机视觉', '工业视觉', '缺陷检测'],
      trl: 5,
      rights: '论文公开',
      doi: '10.1000/yanqi.demo.001',
      embedding: hashEmbed('小样本 工业缺陷 检测 金属表面'),
    },
  });

  const dem1Text = '视觉检测 零件表面缺陷 误检 产线节拍';
  await prisma.demand.create({
    data: {
      orgId: entA.id,
      title: '精密零件表面缺陷在线视觉检测',
      problem:
        '现有人工抽检漏检高，希望上在线视觉，适配现有节拍，误检率可控，最好能落边缘盒子。',
      expectedOut: '可试点工位的检测原型 + 算法交接',
      budgetBand: '30-80万',
      industry: ['智能制造', '工业视觉', '缺陷检测', 'AOI'],
      urgency: '高',
      regionPref: '上海',
      embedding: hashEmbed(dem1Text),
    },
  });

  await prisma.demand.create({
    data: {
      orgId: entB.id,
      title: '储能电芯热管理与界面失效分析',
      problem: '高倍率工况下热失控风险与界面阻抗上升，需要材料与热管理联合方案。',
      expectedOut: '机理分析报告 + 可中试的改性建议',
      budgetBand: '50-150万',
      industry: ['新能源', '固态电池', '热管理', '材料'],
      urgency: '中',
      regionPref: '长三角',
      embedding: hashEmbed('储能 热管理 界面 失效 固态电池'),
    },
  });

  await prisma.person.createMany({
    data: [
      {
        orgId: ust.id,
        name: '王明',
        role: '副教授 / 实验室负责人',
        email: 'wangming@usst.edu.example',
        source: 'seed',
        consent: 'demo',
      },
      {
        orgId: sjtuLab.id,
        name: '李婷',
        role: '副研究员',
        email: 'liting@lab.example',
        source: 'seed',
        consent: 'demo',
      },
      {
        orgId: entA.id,
        name: '陈强',
        role: '技术总监',
        email: 'chenqiang@hj.example',
        source: 'seed',
        consent: 'demo',
      },
      {
        orgId: entB.id,
        name: '赵雪',
        role: '研发经理',
        email: 'zhaoxue@lvzhou.example',
        source: 'seed',
        consent: 'demo',
      },
    ],
  });

  console.log('种子数据写入完成：', {
    orgs: 4,
    capabilities: 2,
    outcomes: 2,
    demands: 2,
    people: 4,
    sampleCap: cap1.title,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
