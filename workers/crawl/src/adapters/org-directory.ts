/**
 * 机构名录。CSV 列：name,orgType,region,creditCode,website
 * 只建组织，不把名录当成需求。
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const { applyParsedRecords } = require(path.join(__dirname, '../../../../packages/shared/src/apply-parsed.js'));

function splitLine(line: string) {
  return line.split(',').map((s) => s.trim());
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('用法: npx tsx workers/crawl/src/adapters/org-directory.ts <file.csv>');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const headers = splitLine(lines[0]);
  const records = lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cols[i] || ''));
    const orgType = (row.orgType || 'ENTERPRISE').toUpperCase();
    const unitKind = orgType === 'GOVERNMENT' ? 'government' : orgType === 'UNIVERSITY' ? 'school' : 'enterprise';
    return {
      id: null,
      entityHint: 'org',
      fields: {
        sourceCode: 'org-directory',
        name: row.name,
        orgType,
        unitKind,
        region: row.region,
        creditCode: row.creditCode,
        website: row.website,
        summary: row.summary,
      },
    };
  });
  const applied = await applyParsedRecords(prisma, records.filter((r) => r.fields.name));
  console.log(JSON.stringify({ ok: true, source: 'org-directory', count: records.length, applied: applied.results.length }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
