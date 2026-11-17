/**
 * 专利/软著清单。CSV 列：orgName,title,patentNo,abstract,inventors,year,ipc
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const { applyParsedRecords } = require(path.join(__dirname, '../../../../packages/shared/src/apply-parsed.js'));

const prisma = new PrismaClient();

function splitLine(line: string) {
  return line.split(',').map((s) => s.trim());
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('用法: npx tsx workers/crawl/src/adapters/patent-list.ts <file.csv>');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const headers = splitLine(lines[0]);
  const records = lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cols[i] || ''));
    const inventors = (row.inventors || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    return {
      id: null,
      entityHint: 'outcome',
      fields: {
        sourceCode: 'patent-list',
        orgName: row.orgName,
        schoolName: row.orgName,
        title: row.title,
        type: row.type || 'PATENT',
        patentNo: row.patentNo,
        abstract: row.abstract,
        year: row.year ? Number(row.year) : null,
        ipcOrDisc: (row.ipc || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean),
        authors: inventors.map((name, i) => ({ name, order: i + 1, corresponding: i === 0 })),
      },
    };
  });
  const applied = await applyParsedRecords(prisma, records.filter((r) => r.fields.title));
  console.log(JSON.stringify({ ok: true, source: 'patent-list', count: records.length, applied: applied.results.length }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
