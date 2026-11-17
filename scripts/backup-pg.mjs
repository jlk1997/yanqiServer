#!/usr/bin/env node
/**
 * 备份：优先 pg_dump；版本不匹配则 Prisma JSON 全量导出
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('缺少 DATABASE_URL');
  process.exit(1);
}

const outDir = path.join(root, 'backups');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function findEmbeddedPgDump() {
  const c = path.join(root, 'node_modules/@embedded-postgres/linux-x64/native/bin/pg_dump');
  return fs.existsSync(c) ? c : null;
}

function tryPgDump() {
  const u = new URL(url);
  const host = u.hostname;
  const port = u.port || '5432';
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  const db = u.pathname.replace(/^\//, '');
  const bin = findEmbeddedPgDump() || 'pg_dump';
  const outFile = path.join(outDir, `yanqi-${stamp}.sql`);
  const env = { ...process.env, PGPASSWORD: pass };
  const args = ['-h', host, '-p', String(port), '-U', user, '-d', db, '-F', 'p', '-f', outFile];
  console.log('尝试 pg_dump（', bin, '）→', outFile);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'inherit', 'pipe'] });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        console.log(`SQL 备份完成 ${outFile}（${fs.statSync(outFile).size} bytes）`);
        resolve(true);
      } else {
        console.warn('pg_dump 不可用或版本不匹配，改走 JSON 备份…');
        try {
          if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
        } catch (_) {}
        resolve(false);
      }
    });
    child.on('error', () => resolve(false));
  });
}

async function jsonBackup() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: '研企通 JSON 全量备份（pg_dump 不可用时的回退）',
      organization: await prisma.organization.findMany(),
      capability: await prisma.capability.findMany(),
      outcome: await prisma.outcome.findMany(),
      demand: await prisma.demand.findMany(),
      matchResult: await prisma.matchResult.findMany(),
      person: await prisma.person.findMany(),
      lead: await prisma.lead.findMany(),
      jobLog: await prisma.jobLog.findMany(),
      auditLog: await prisma.auditLog.findMany(),
    };
    const outFile = path.join(outDir, `yanqi-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`JSON 备份完成 ${outFile}（${fs.statSync(outFile).size} bytes）`);
    console.log(
      `计数：org=${payload.organization.length} cap=${payload.capability.length} out=${payload.outcome.length} demand=${payload.demand.length} match=${payload.matchResult.length} lead=${payload.lead.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const ok = await tryPgDump();
if (!ok) await jsonBackup();
