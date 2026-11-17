/**
 * 师资/实验室页适配器。输入为 JSON：
 * { "schoolName": "", "people": [{ "name": "", "collegeName": "", "labName": "", "researchSummary": "", "email": "" }] }
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const { applyParsedRecords } = require(path.join(__dirname, '../../../../packages/shared/src/apply-parsed.js'));

const prisma = new PrismaClient();

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('用法: npx tsx workers/crawl/src/adapters/faculty-page.ts <file.json>');
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const records = [];
  if (data.schoolName) {
    records.push({
      id: null,
      entityHint: 'org',
      fields: { sourceCode: 'faculty-page', name: data.schoolName, unitKind: 'school', region: data.region, website: data.website },
    });
  }
  for (const lab of data.labs || []) {
    records.push({
      id: null,
      entityHint: 'lab',
      fields: {
        sourceCode: 'faculty-page',
        name: lab.name,
        parentName: lab.collegeName || data.schoolName,
        unitKind: 'lab',
        summary: lab.summary,
        website: lab.website,
        region: data.region,
      },
    });
  }
  for (const person of data.people || []) {
    records.push({
      id: null,
      entityHint: 'person',
      fields: { sourceCode: 'faculty-page', schoolName: data.schoolName, ...person },
    });
  }
  const applied = await applyParsedRecords(prisma, records);
  console.log(JSON.stringify({ ok: true, source: 'faculty-page', count: records.length, applied: applied.results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
