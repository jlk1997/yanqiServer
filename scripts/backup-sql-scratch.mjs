#!/usr/bin/env node
/**
 * M12：把最近 drill 的 JSON 快照灌进隔离 schema `yanqi_sql_scratch`（建表+INSERT），
 * 不碰 public 业务表。embedded 无同版本 pg_dump 时的可靠加深路径。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('缺少 DATABASE_URL');
  process.exit(1);
}

function latestDrill() {
  const base = path.join(root, 'backups');
  const dirs = fs
    .readdirSync(base)
    .filter((d) => d.startsWith('drill-'))
    .map((d) => ({ d, t: fs.statSync(path.join(base, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!dirs.length) throw new Error('无 drill 备份，先 npm run backup:drill');
  return path.join(base, dirs[0].d);
}

function findBin(name) {
  const c = path.join(root, `node_modules/@embedded-postgres/linux-x64/native/bin/${name}`);
  return fs.existsSync(c) ? c : name;
}

function psql(sql) {
  const u = new URL(url);
  const bin = findBin('psql');
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const args = [
    '-h', u.hostname, '-p', u.port || '5432',
    '-U', decodeURIComponent(u.username),
    '-d', u.pathname.replace(/^\//, ''),
    '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(err || out || `exit ${code}`))));
    child.on('error', reject);
  });
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const drillDir = process.env.DRILL_DIR || latestDrill();
  const snap = JSON.parse(fs.readFileSync(path.join(drillDir, 'snapshot.json'), 'utf8'));
  const schema = 'yanqi_sql_scratch';
  const report = { startedAt: new Date().toISOString(), drillDir, schema, steps: [] };

  console.log('[sql-scratch] 源', drillDir);
  await psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
  report.steps.push({ ok: true, step: 'create_schema' });

  // 精简表：organization / demand / match_result / deal_attachment 元数据
  await psql(`
    CREATE TABLE ${schema}.organization (
      id text PRIMARY KEY, name text, type text, region text, summary text, raw jsonb
    );
    CREATE TABLE ${schema}.demand (
      id text PRIMARY KEY, org_id text, title text, problem text, industry jsonb, raw jsonb
    );
    CREATE TABLE ${schema}.match_result (
      id text PRIMARY KEY, demand_id text, total_score double precision, status text, reason text, raw jsonb
    );
    CREATE TABLE ${schema}.deal_attachment (
      id text PRIMARY KEY, match_id text, file_name text, size_bytes int, storage_path text, raw jsonb
    );
  `);
  report.steps.push({ ok: true, step: 'create_tables' });

  const orgs = snap.tables?.organization || [];
  for (const o of orgs) {
    await psql(
      `INSERT INTO ${schema}.organization(id,name,type,region,summary,raw) VALUES (${esc(o.id)},${esc(o.name)},${esc(o.type)},${esc(o.region)},${esc(o.summary)},${esc(o)})`,
    );
  }
  const demands = snap.tables?.demand || [];
  for (const d of demands) {
    await psql(
      `INSERT INTO ${schema}.demand(id,org_id,title,problem,industry,raw) VALUES (${esc(d.id)},${esc(d.orgId)},${esc(d.title)},${esc(d.problem)},${esc(d.industry||[])},${esc(d)})`,
    );
  }
  const matches = snap.tables?.matchResult || [];
  for (const m of matches) {
    await psql(
      `INSERT INTO ${schema}.match_result(id,demand_id,total_score,status,reason,raw) VALUES (${esc(m.id)},${esc(m.demandId)},${esc(m.totalScore)},${esc(m.status)},${esc(m.reason)},${esc(m)})`,
    );
  }
  const atts = snap.tables?.dealAttachment || [];
  for (const a of atts) {
    await psql(
      `INSERT INTO ${schema}.deal_attachment(id,match_id,file_name,size_bytes,storage_path,raw) VALUES (${esc(a.id)},${esc(a.matchId)},${esc(a.fileName)},${esc(a.sizeBytes)},${esc(a.storagePath)},${esc(a)})`,
    );
  }
  report.steps.push({
    ok: true,
    step: 'insert_rows',
    counts: { organization: orgs.length, demand: demands.length, match_result: matches.length, deal_attachment: atts.length },
  });

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const counts = {};
    for (const t of ['organization', 'demand', 'match_result', 'deal_attachment']) {
      const rows = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS c FROM ${schema}.${t}`);
      counts[t] = rows[0]?.c ?? 0;
    }
    report.restoredCounts = counts;
    report.ok =
      counts.organization === orgs.length &&
      counts.demand === demands.length &&
      counts.match_result === matches.length &&
      counts.deal_attachment === atts.length;
    report.steps.push({ ok: report.ok, step: 'verify_counts', counts });
    console.log('[sql-scratch] 校验', counts, report.ok ? '一致' : '不一致');
  } finally {
    await prisma.$disconnect();
  }

  report.finishedAt = new Date().toISOString();
  report.noteZh =
    '本路径用 JSON→隔离 schema INSERT，回避 pg_dump 大版本不匹配。不等于官方物理备份；生产仍应配合同版本 client tools。';
  const out = path.join(drillDir, 'sql-scratch-verification.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('[sql-scratch] 报告', out);
  console.log(JSON.stringify({ ok: report.ok, counts: report.restoredCounts }, null, 2));
  if (!report.ok) process.exit(2);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
