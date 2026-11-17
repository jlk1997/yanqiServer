/**
 * 导入「演示夹具」企业/政府需求 JSON。非爬取。
 * DEMAND_FIXTURE=path 或 DEMAND_FIXTURE_GLOB=all（默认导入 fixtures 下 *demands*.json）
 */
import { PrismaClient, OrgType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const shared = require(path.join(__dirname, '../../../packages/shared/src/match-lib.js'));
const { embedText } = shared;
const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, '../../..');
const FIX_DIR = path.join(ROOT, 'data/fixtures');

function listFiles(): string[] {
  if (process.env.DEMAND_FIXTURE) return [process.env.DEMAND_FIXTURE];
  return fs
    .readdirSync(FIX_DIR)
    .filter((f) => /demand/i.test(f) && f.endsWith('.json'))
    .map((f) => path.join(FIX_DIR, f));
}

async function importFile(file: string) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(raw.labelZh || file);
  let n = 0;
  for (const d of raw.demands || []) {
    let org = await prisma.organization.findFirst({ where: { name: d.orgName } });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: d.orgName,
          type: (d.orgType as OrgType) || OrgType.ENTERPRISE,
          region: d.region || null,
          summary: `${d.demoLabel || '演示夹具'}组织（非真实工商爬取）`,
          extensions: { source: 'demo_fixture', label: d.demoLabel || '演示夹具', pack: path.basename(file) },
        },
      });
    }
    const title = d.title;
    const existing = await prisma.demand.findFirst({ where: { orgId: org.id, title } });
    const emb = await embedText([title, d.problem, ...(d.industry || [])].join(' '));
    const demandKind = shared.inferDemandKind(d.demandKind, `${title} ${d.problem || ''}`);
    const decision = shared.publishDecision('demand', {
      title,
      problem: d.problem,
      orgId: org.id,
      demandKind,
      industry: d.industry || [],
      taxonomyCodes: d.taxonomyCodes || [],
      sourceCode: 'demo_fixture',
    });
    const data = {
      orgId: org.id,
      title,
      problem: d.problem,
      expectedOut: d.expectedOut || null,
      budgetBand: d.budgetBand || null,
      industry: d.industry || [],
      taxonomyCodes: d.taxonomyCodes || [],
      licenseNeed: d.licenseNeed || null,
      minTrl: d.minTrl != null ? Number(d.minTrl) : null,
      urgency: d.urgency || null,
      regionPref: d.region || org.region,
      demandKind,
      embedding: emb,
      embeddingModel: shared.embeddingMeta().mode,
      publishStatus: decision.status,
      publishBlockers: decision.blockers,
      summaryPublic: shared.summaryPublic(d.problem || ''),
      reviewedAt: new Date(),
      sourceUpdatedAt: new Date(),
      extensions: {
        source: 'demo_fixture',
        label: d.demoLabel || '演示夹具',
        pack: path.basename(file),
      },
    };
    if (existing) {
      const writable = shared.stripLocked(shared.mergeLocked(existing, data, existing.lockedFields), existing.lockedFields);
      await prisma.demand.update({ where: { id: existing.id }, data: writable });
    } else await prisma.demand.create({ data });
    n++;
  }
  return n;
}

async function main() {
  const files = listFiles();
  let total = 0;
  for (const f of files) total += await importFile(f);
  await prisma.jobLog.create({
    data: {
      queue: 'crawl',
      jobName: 'demand_fixture',
      status: 'done',
      message: `演示需求夹具入库 ${total} 条 · ${files.length} 个包`,
      payload: { files: files.map((f) => path.basename(f)), n: total },
    },
  });
  console.log(`合计 ${total} 条 · 文件 ${files.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
