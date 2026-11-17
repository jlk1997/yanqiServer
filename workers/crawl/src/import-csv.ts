/**
 * 企业需求文件导入。列名同时接受旧表（name/demand_title）和授权表（orgName/title）。
 * 写入解析层后走统一对齐，不再各写一套入库。
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, '../../..');
const { applyParsedRecords } = require(path.join(__dirname, '../../../packages/shared/src/apply-parsed.js'));

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ''));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
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

function col(r: Record<string, string>, ...keys: string[]) {
  for (const k of keys) {
    if (r[k] != null && String(r[k]).trim()) return String(r[k]).trim();
  }
  return '';
}

async function main() {
  const file = process.env.CSV_PATH || path.join(ROOT, 'data/imports/enterprises.sample.csv');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const documents = [];
  for (const r of rows) {
    const name = col(r, 'name', 'orgName');
    if (!name) continue;
    const title = col(r, 'demand_title', 'title');
    if (!title) continue;
    documents.push({
      id: null,
      entityHint: 'demand',
      fields: {
        sourceCode: 'file-demand',
        orgName: name,
        orgType: col(r, 'type', 'orgType') || 'ENTERPRISE',
        region: col(r, 'region'),
        website: col(r, 'website'),
        creditCode: col(r, 'creditCode'),
        summary: col(r, 'summary'),
        title,
        problem: col(r, 'demand_problem', 'problem') || title,
        expectedOut: col(r, 'demand_expected', 'expectedOut'),
        budgetBand: col(r, 'demand_budget', 'budgetBand'),
        industry: col(r, 'demand_tags', 'industry')
          .split(/[|;,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        taxonomyCodes: col(r, 'taxonomyCodes')
          .split(/[|;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        licenseNeed: col(r, 'licenseNeed'),
        minTrl: col(r, 'minTrl') ? Number(col(r, 'minTrl')) : null,
        urgency: col(r, 'urgency') || '中',
        demandKind: col(r, 'demandKind'),
      },
    });
  }
  const applied = await applyParsedRecords(
    prisma,
    documents,
  );
  let contacts = 0;
  for (const r of rows) {
    const personName = col(r, 'contact_name');
    if (!personName) continue;
    const org = await prisma.organization.findFirst({ where: { name: col(r, 'name', 'orgName') } });
    if (!org) continue;
    const exists = await prisma.person.findFirst({ where: { orgId: org.id, name: personName } });
    const data = {
      orgId: org.id,
      name: personName,
      role: col(r, 'contact_role') || '联系人',
      email: col(r, 'contact_email') || null,
      phone: col(r, 'contact_phone') || null,
      source: 'file-demand',
      publishStatus: 'published',
    };
    const person = exists
      ? await prisma.person.update({ where: { id: exists.id }, data })
      : await prisma.person.create({ data });
    if (data.email) {
      const dup = await prisma.contactPoint.findFirst({ where: { personId: person.id, kind: 'email', value: data.email } });
      if (!dup) {
        await prisma.contactPoint.create({
          data: { personId: person.id, kind: 'email', value: data.email, sourceCode: 'file-demand', confidence: 0.8, isPublic: false },
        });
      }
    }
    contacts += 1;
  }
  const ok = applied.results.filter((x: any) => x.action !== 'rejected').length;
  console.log(`CSV 导入完成：需求处理 ${ok}/${documents.length}，联系人 ${contacts}（文件 ${file}）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
