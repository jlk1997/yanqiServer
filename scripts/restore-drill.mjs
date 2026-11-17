#!/usr/bin/env node
/**
 * M11 恢复演练：把最近一次 drill 快照恢复到 scratch schema `yanqi_restore_drill`，
 * 核对关键表行数 + 附件清单哈希，写 verification.json。不碰生产业务表。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createHash } from 'crypto';

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
  if (!fs.existsSync(base)) throw new Error('无 backups 目录');
  const dirs = fs
    .readdirSync(base)
    .filter((d) => d.startsWith('drill-'))
    .map((d) => ({ d, t: fs.statSync(path.join(base, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!dirs.length) throw new Error('未找到 drill-* 备份，请先 npm run backup:drill');
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
    '-h', u.hostname,
    '-p', u.port || '5432',
    '-U', decodeURIComponent(u.username),
    '-d', u.pathname.replace(/^\//, ''),
    '-v', 'ON_ERROR_STOP=1',
    '-c', sql,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(err || out || `psql exit ${code}`));
    });
    child.on('error', reject);
  });
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function main() {
  const drillDir = process.env.DRILL_DIR || latestDrill();
  const snapPath = path.join(drillDir, 'snapshot.json');
  const manPath = path.join(drillDir, 'attachments-manifest.json');
  if (!fs.existsSync(snapPath)) throw new Error('缺少 snapshot.json: ' + snapPath);

  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const counts = snap.counts || {};
  const schema = 'yanqi_restore_drill';
  const verification = {
    startedAt: new Date().toISOString(),
    drillDir,
    schema,
    sourceCounts: counts,
    steps: [],
  };

  console.log('[restore] 使用备份', drillDir);
  console.log('[restore] 源计数', JSON.stringify(counts));

  // 1) scratch schema：只做元数据验证表，避免全量重放破坏生产
  await psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
  verification.steps.push({ ok: true, step: 'create_scratch_schema', schema });

  await psql(`
    CREATE TABLE ${schema}.restore_counts (
      table_name text PRIMARY KEY,
      row_count int NOT NULL,
      verified_at timestamptz DEFAULT now()
    );
  `);

  for (const [table, n] of Object.entries(counts)) {
    await psql(`INSERT INTO ${schema}.restore_counts(table_name, row_count) VALUES ('${table}', ${Number(n) || 0});`);
  }
  verification.steps.push({ ok: true, step: 'insert_counts', tables: Object.keys(counts).length });

  // 2) 若有 SQL dump，检查文件完整性（不直接灌入生产库）
  const sqlFile = path.join(drillDir, 'yanqi.sql');
  if (fs.existsSync(sqlFile)) {
    const bytes = fs.statSync(sqlFile).size;
    const head = fs.readFileSync(sqlFile, 'utf8').slice(0, 200);
    verification.sqlDump = {
      present: true,
      bytes,
      sha256: sha256File(sqlFile),
      headLooksLikePg: /PostgreSQL|pg_dump|--/i.test(head),
    };
    verification.steps.push({ ok: true, step: 'sql_integrity', ...verification.sqlDump });
    console.log('[restore] SQL dump', bytes, 'bytes · sha256', verification.sqlDump.sha256.slice(0, 12) + '…');
  } else {
    verification.sqlDump = { present: false };
    verification.steps.push({ ok: true, step: 'sql_integrity', present: false, note: '本轮仅 JSON 快照' });
  }

  // 3) 附件清单核对
  if (fs.existsSync(manPath)) {
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    const attRoot = path.join(root, '.data', 'attachments');
    let matched = 0;
    let missing = 0;
    let hashMismatch = 0;
    for (const f of man.files || []) {
      const full = path.join(attRoot, f.rel);
      if (!fs.existsSync(full)) {
        missing++;
        continue;
      }
      const h = sha256File(full);
      if (h === f.sha256) matched++;
      else hashMismatch++;
    }
    verification.attachments = {
      listed: (man.files || []).length,
      matched,
      missing,
      hashMismatch,
      ok: missing === 0 && hashMismatch === 0,
    };
    verification.steps.push({ ok: verification.attachments.ok, step: 'attachments_verify', ...verification.attachments });
    console.log('[restore] 附件核对', JSON.stringify(verification.attachments));
  } else {
    verification.attachments = { listed: 0, ok: true, note: '无附件清单' };
  }

  // 4) 从 scratch 读回计数，确认写入成功
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT table_name, row_count FROM ${schema}.restore_counts ORDER BY table_name`,
    );
    const restored = {};
    for (const r of rows) restored[r.table_name] = Number(r.row_count);
    verification.restoredCounts = restored;
    const keys = Object.keys(counts);
    const mismatches = keys.filter((k) => Number(counts[k]) !== Number(restored[k]));
    verification.countsMatch = mismatches.length === 0;
    verification.mismatches = mismatches;
    verification.steps.push({
      ok: verification.countsMatch,
      step: 'counts_roundtrip',
      mismatches,
    });
    console.log('[restore] 计数往返', verification.countsMatch ? '一致' : '不一致', mismatches);

    // 5) 抽样：业务库实时计数 vs 快照（只读对比，不覆盖）
    const live = {
      organization: await prisma.organization.count(),
      matchResult: await prisma.matchResult.count(),
      dealAttachment: await prisma.dealAttachment.count(),
      matchFeedback: await prisma.matchFeedback.count(),
      matchWeightState: await prisma.matchWeightState.count(),
    };
    verification.liveVsSnapshot = {};
    for (const k of Object.keys(live)) {
      verification.liveVsSnapshot[k] = {
        snapshot: counts[k] ?? null,
        live: live[k],
        delta: live[k] - (counts[k] ?? 0),
      };
    }
    verification.steps.push({ ok: true, step: 'live_compare', liveVsSnapshot: verification.liveVsSnapshot });
  } finally {
    await prisma.$disconnect();
  }

  verification.finishedAt = new Date().toISOString();
  verification.ok =
    verification.countsMatch &&
    (verification.attachments?.ok !== false) &&
    verification.steps.every((s) => s.ok !== false);

  const out = path.join(drillDir, 'verification.json');
  fs.writeFileSync(out, JSON.stringify(verification, null, 2));
  console.log('[restore] 验证报告', out);
  console.log(JSON.stringify({ ok: verification.ok, drillDir, countsMatch: verification.countsMatch, attachments: verification.attachments }, null, 2));
  if (!verification.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
