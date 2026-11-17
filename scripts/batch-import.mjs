#!/usr/bin/env node
/**
 * 双边冷启动批处理：OpenAlex 多校 + 企业 CSV，再可选跑匹配。
 * 用法：node scripts/batch-import.mjs [--match]
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doMatch = process.argv.includes('--match');

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    console.log('>', cmd, args.join(' '));
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

async function main() {
  await run('npx', ['tsx', 'workers/crawl/src/openalex.ts'], { OPENALEX_BATCH: '1' });
  await run('npx', ['tsx', 'workers/crawl/src/import-csv.ts'], {
    CSV_PATH: path.join(root, 'data/imports/enterprises.sample.csv'),
  });
  if (doMatch) {
    await run('npx', ['tsx', 'workers/match/src/run-match.ts']);
  }
  console.log('双边批导入完成' + (doMatch ? '（含匹配）' : ''));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
