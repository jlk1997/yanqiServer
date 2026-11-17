#!/usr/bin/env node
/**
 * M13 发布门禁：match-eval → smoke → security（任一失败即非 0）
 * 用法：API 已在 :3100 时 npm run gate
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps = [
  { name: 'match-eval', cmd: 'npm', args: ['run', 'test:match-eval'] },
  { name: 'smoke', cmd: 'npm', args: ['run', 'smoke'] },
  { name: 'security', cmd: 'npm', args: ['run', 'test:security'] },
];

async function pauseBeforeSmoke() {
  // match-eval + 长冒烟易撞上 auth 每分钟限额；冷却几秒并让 smoke 内 429 重试兜底
  const ms = Number(process.env.GATE_SMOKE_PAUSE_MS || 8000);
  if (ms > 0) {
    console.log(`\n… gate: 冷却 ${ms}ms 后再跑 smoke（避免 429）`);
    await new Promise((r) => setTimeout(r, ms));
  }
}

function run(step) {
  return new Promise((resolve) => {
    console.log('\n══ gate:', step.name, '══');
    const child = spawn(step.cmd, step.args, { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

const summary = [];
for (const s of steps) {
  if (s.name === 'smoke') await pauseBeforeSmoke();
  const code = await run(s);
  summary.push({ name: s.name, ok: code === 0, code });
  if (code !== 0) {
    console.error('\n门禁失败于', s.name, 'exit', code);
    console.error(JSON.stringify({ ok: false, summary }, null, 2));
    process.exit(code);
  }
}
console.log('\n门禁全部通过', summary.map((s) => s.name).join(' → '));
console.log(JSON.stringify({ ok: true, summary, noteZh: '合并前请保证 API :3100 已启动。' }, null, 2));
