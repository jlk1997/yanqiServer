#!/usr/bin/env node
/**
 * M11 备份：PG（优先 pg_dump）+ 附件清单/元数据 + 关键表 JSON 校验包。
 * 输出到 backups/drill-<stamp>/
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

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(root, 'backups', `drill-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

function findBin(name) {
  const c = path.join(root, `node_modules/@embedded-postgres/linux-x64/native/bin/${name}`);
  return fs.existsSync(c) ? c : name;
}

function sha256File(p) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function runPgDump() {
  const u = new URL(url);
  const outFile = path.join(outDir, 'yanqi.sql');
  const bin = findBin('pg_dump');
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const args = [
    '-h', u.hostname,
    '-p', u.port || '5432',
    '-U', decodeURIComponent(u.username),
    '-d', u.pathname.replace(/^\//, ''),
    '-F', 'p',
    '-f', outFile,
  ];
  console.log('[backup] pg_dump', bin, '→', outFile);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'inherit', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d;
      process.stderr.write(d);
    });
    child.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        resolve({ ok: true, file: outFile, bytes: fs.statSync(outFile).size, method: 'pg_dump', stderrTail: err.slice(-400) });
      } else {
        resolve({ ok: false, method: 'pg_dump', error: err.slice(-800) || `exit ${code}` });
      }
    });
    child.on('error', (e) => resolve({ ok: false, method: 'pg_dump', error: String(e) }));
  });
}

async function jsonSnapshot(prisma) {
  const tables = {
    organization: await prisma.organization.findMany(),
    capability: await prisma.capability.findMany(),
    outcome: await prisma.outcome.findMany(),
    demand: await prisma.demand.findMany(),
    matchResult: await prisma.matchResult.findMany(),
    person: await prisma.person.findMany(),
    lead: await prisma.lead.findMany(),
    matchFeedback: await prisma.matchFeedback.findMany(),
    matchWeightState: await prisma.matchWeightState.findMany(),
    dealAttachment: await prisma.dealAttachment.findMany(),
    authSession: await prisma.authSession.findMany({
      select: { id: true, userId: true, jti: true, createdAt: true, expiresAt: true, revokedAt: true, userAgent: true, ip: true },
    }),
    auditLog: await prisma.auditLog.findMany({ take: 5000, orderBy: { createdAt: 'desc' } }),
    jobLog: await prisma.jobLog.findMany({ take: 2000, orderBy: { createdAt: 'desc' } }),
    brokerFollowUpEvent: await prisma.brokerFollowUpEvent.findMany({ take: 2000 }),
    savedView: await prisma.savedView.findMany().catch(() => []),
    user: await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, orgId: true, tenantId: true, active: true, createdAt: true },
    }),
  };
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
  const outFile = path.join(outDir, 'snapshot.json');
  fs.writeFileSync(outFile, JSON.stringify({ exportedAt: new Date().toISOString(), counts, tables }, null, 2));
  return { file: outFile, bytes: fs.statSync(outFile).size, counts };
}

function attachmentsManifest() {
  const rootAtt = path.join(root, '.data', 'attachments');
  const files = [];
  function walk(dir, rel = '') {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = path.join(rel, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else {
        files.push({
          rel: r.replace(/\\/g, '/'),
          bytes: st.size,
          mtime: st.mtime.toISOString(),
          sha256: sha256File(full),
        });
      }
    }
  }
  walk(rootAtt);
  const outFile = path.join(outDir, 'attachments-manifest.json');
  fs.writeFileSync(
    outFile,
    JSON.stringify({ exportedAt: new Date().toISOString(), root: '.data/attachments', count: files.length, files }, null, 2),
  );
  // also copy a tar-like flat list note (no secrets)
  return { file: outFile, count: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0) };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const log = { stamp, outDir, startedAt: new Date().toISOString(), steps: [] };
  try {
    const dump = await runPgDump();
    log.steps.push(dump);
    if (!dump.ok) console.warn('[backup] pg_dump 失败，仍写 JSON 快照');

    const snap = await jsonSnapshot(prisma);
    log.steps.push({ ok: true, method: 'json_snapshot', ...snap, counts: snap.counts });
    console.log('[backup] JSON 快照', snap.file, snap.bytes, 'bytes');
    console.log('[backup] 计数', JSON.stringify(snap.counts));

    const att = attachmentsManifest();
    log.steps.push({ ok: true, method: 'attachments_manifest', ...att });
    console.log('[backup] 附件清单', att.count, '个文件 ·', att.bytes, 'bytes');

    log.finishedAt = new Date().toISOString();
    log.ok = true;
    const report = path.join(outDir, 'backup-report.json');
    fs.writeFileSync(report, JSON.stringify(log, null, 2));
    console.log('[backup] 报告', report);
    console.log(JSON.stringify({ ok: true, outDir, counts: snap.counts, sql: dump.ok, attachments: att.count }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
