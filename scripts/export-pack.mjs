#!/usr/bin/env node
/**
 * 销售作战包：按需求或组织导出 Top 匹配 Markdown + 线索 CSV → ZIP
 * 用法：
 *   npm run export:pack -- --demandId=xxx
 *   npm run export:pack -- --orgId=xxx
 *   npm run export:pack -- --top=10
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { ZipArchive } from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const demandId = arg('demandId');
const orgId = arg('orgId');
const topN = Number(arg('top', '10'));

const prisma = new PrismaClient();

function esc(s) {
  return String(s ?? '').replace(/"/g, '""');
}

async function main() {
  const where = {};
  if (demandId) where.demandId = demandId;
  if (orgId) {
    where.OR = [
      { demand: { orgId } },
      { capability: { orgId } },
      { outcome: { orgId } },
    ];
  }

  const matches = await prisma.matchResult.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      demand: { include: { org: true } },
      capability: { include: { org: true } },
      outcome: { include: { org: true } },
      leads: { include: { person: true } },
    },
    orderBy: { totalScore: 'desc' },
    take: topN,
  });

  const visible = matches.filter((m) => {
    const action = m.scoreBreakdown?.action;
    return action !== 'SHADOW' && action !== 'HOLD';
  });
  const packMatches = visible.length ? visible : matches;

  if (!packMatches.length) {
    console.error('没有匹配结果可导出。可先 npm run match:run');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const scope = demandId ? `demand-${demandId.slice(0, 8)}` : orgId ? `org-${orgId.slice(0, 8)}` : 'all-top';
  const outDir = path.join(root, 'exports', `battle-pack-${scope}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const lines = [];
  lines.push('# 研企通 · 销售作战包');
  lines.push('');
  lines.push(`生成时间（上海）：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  lines.push(`范围：${demandId ? '需求 ' + demandId : orgId ? '组织 ' + orgId : '全局 Top'}${topN}`);
  lines.push('');
  lines.push('## Top 匹配');
  lines.push('');
  for (const [i, m] of packMatches.entries()) {
    const supply = m.capability?.title || m.outcome?.title || '-';
    const supplyOrg = m.capability?.org?.name || m.outcome?.org?.name || '-';
    lines.push(`### ${i + 1}. ${(m.totalScore * 100).toFixed(0)}分 · ${m.demand.title}`);
    lines.push('');
    lines.push(`- 需求方：${m.demand.org?.name || '-'}`);
    lines.push(`- 供给：${supply}（${supplyOrg}）`);
    lines.push(`- 状态：${m.status}`);
    lines.push(`- 理由：${m.reason || ''}`);
    const bd = m.scoreBreakdown || {};
    lines.push(
      `- 分项：语义 ${bd.semantic ?? '-'} / 关键词 ${bd.keyword ?? '-'} / 学科 ${bd.discipline ?? '-'} / 地域 ${bd.region ?? '-'} / TRL ${bd.trlFit ?? '-'}`,
    );
    if (m.leads?.length) {
      for (const l of m.leads) {
        lines.push(`- 线索：${l.person?.name || '待补'} <${l.person?.email || '无邮箱'}> · ${l.status}`);
        lines.push(`  - 主题：${l.draftSubject || ''}`);
      }
    }
    lines.push('');
  }

  fs.writeFileSync(path.join(outDir, 'matches.md'), lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'matches-printable.txt'), lines.join('\n'), 'utf8');

  const csvHeader = ['匹配分', '需求', '需求方', '供给', '供给方', '状态', '联系人', '邮箱', '主题', '线索状态'];
  const csvRows = [csvHeader.join(',')];
  for (const m of packMatches) {
    const supply = m.capability?.title || m.outcome?.title || '';
    const supplyOrg = m.capability?.org?.name || m.outcome?.org?.name || '';
    const leads = m.leads?.length ? m.leads : [null];
    for (const l of leads) {
      csvRows.push(
        [
          m.totalScore,
          esc(m.demand.title),
          esc(m.demand.org?.name),
          esc(supply),
          esc(supplyOrg),
          m.status,
          esc(l?.person?.name),
          esc(l?.person?.email),
          esc(l?.draftSubject),
          esc(l?.status),
        ]
          .map((c) => `"${c}"`)
          .join(','),
      );
    }
  }
  fs.writeFileSync(path.join(outDir, 'leads.csv'), '\uFEFF' + csvRows.join('\n'), 'utf8');
  fs.writeFileSync(
    path.join(outDir, '使用说明.txt'),
    [
      '研企通销售作战包',
      '1. 先看 matches.md / matches-printable.txt，挑高分去谈',
      '2. leads.csv 导入你的表格或 CRM',
      '3. 邮件仍须运维台「审核通过并入队发送」，勿直接群发 CSV 里的草稿',
      '4. 本包仅供内部 BD 使用',
    ].join('\n'),
    'utf8',
  );

  const zipPath = `${outDir}.zip`;
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(outDir, false);
    archive.finalize();
  });

  console.log('作战包目录：', outDir);
  console.log('作战包 ZIP：', zipPath);
  console.log(`匹配 ${packMatches.length} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
