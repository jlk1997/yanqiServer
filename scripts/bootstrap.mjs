#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: root,
      shell: true,
      env: process.env,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' exit ' + code))));
  });
}

const runtime = path.join(root, '.deps-runtime.json');
if (!fs.existsSync(runtime)) {
  console.error('请先在另一个终端运行: npm run deps:up');
  process.exit(1);
}
const { DATABASE_URL } = JSON.parse(fs.readFileSync(runtime, 'utf8'));
process.env.DATABASE_URL = DATABASE_URL;

// sync env
const envPath = path.join(root, '.env');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
env = /DATABASE_URL=/.test(env)
  ? env.replace(/DATABASE_URL=.*/g, `DATABASE_URL=${DATABASE_URL}`)
  : env + `\nDATABASE_URL=${DATABASE_URL}\n`;
fs.writeFileSync(envPath, env.trim() + '\n');
fs.copyFileSync(envPath, path.join(root, 'apps/api/.env'));

console.log('推送 Prisma schema…');
await run('npx', ['prisma', 'db', 'push', '--schema=apps/api/prisma/schema.prisma', '--accept-data-loss']);
await run('npx', ['prisma', 'generate', '--schema=apps/api/prisma/schema.prisma']);
console.log('写入种子…');
await run('npx', ['tsx', 'apps/api/prisma/seed.ts']);
console.log('CSV 企业样例…');
await run('npx', ['tsx', 'workers/crawl/src/import-csv.ts']);
console.log('OpenAlex…');
await run('npx', ['tsx', 'workers/crawl/src/openalex.ts']);
console.log('匹配…');
await run('npx', ['tsx', 'workers/match/src/run-match.ts']);
console.log('Bootstrap 完成。接着: npm run build -w @yanqi/api && node apps/api/dist/main.js');
