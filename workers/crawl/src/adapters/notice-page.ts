/**
 * 公告页适配器：从本地 HTML/文本或单个 URL 抽出揭榜、采购类需求。
 * 用法：npx tsx workers/crawl/src/adapters/notice-page.ts [file|url]
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const { applyParsedRecords } = require(path.join(__dirname, '../../../../packages/shared/src/apply-parsed.js'));

const prisma = new PrismaClient();

function textOf(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNotice(text: string, url?: string) {
  const titleMatch = text.match(/标题[:：]\s*([^\n]{4,80})/) || text.match(/^(.{4,80})/);
  const title = (titleMatch?.[1] || titleMatch?.[0] || '').trim();
  const problem = text.slice(0, 800);
  let demandKind = 'unknown';
  if (/揭榜|挂帅/.test(text)) demandKind = 'challenge';
  else if (/采购|招标/.test(text)) demandKind = 'procurement';
  else if (/联合研发|概念验证/.test(text)) demandKind = 'joint_rd';
  else if (text.length >= 40) demandKind = 'tech_problem';
  const orgMatch = text.match(/(?:发布单位|需求单位|采购人)[:：]\s*([^\s，。]{2,40})/);
  return {
    entityHint: 'demand',
    fields: {
      sourceCode: 'notice-page',
      sourceUrl: url || null,
      orgName: orgMatch?.[1] || '未署名发布单位',
      orgType: /政府|管委会|厅|局/.test(text) ? 'GOVERNMENT' : 'ENTERPRISE',
      title: title.slice(0, 120),
      problem,
      demandKind,
      industry: [],
    },
  };
}

async function load(target?: string) {
  const input = target || process.env.NOTICE_URL || '';
  if (!input) {
    return {
      url: 'fixture://notice',
      text: '标题：揭榜挂帅：工业视觉在线检测\n发布单位：某高新区管委会\n面向产线缺陷检测，征集可工程化的视觉算法与装置，要求能在试点线部署并给出验收指标。',
    };
  }
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input);
    const html = await res.text();
    return { url: input, text: textOf(html), httpStatus: res.status };
  }
  const html = fs.readFileSync(input, 'utf8');
  return { url: input, text: textOf(html), httpStatus: 200 };
}

async function main() {
  const loaded = await load(process.argv[2]);
  const parsed = parseNotice(loaded.text, loaded.url);
  const applied = await applyParsedRecords(prisma, [{ id: null, entityHint: 'demand', fields: parsed.fields }]);
  console.log(JSON.stringify({ ok: true, source: 'notice-page', url: loaded.url, applied: applied.results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
