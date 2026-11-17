#!/usr/bin/env node
/**
 * 无 Docker 时启动嵌入式 Postgres。
 * 队列：MVP 用 API 进程内队列；有 Redis/Docker 时可接 BullMQ。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.data');
fs.mkdirSync(dataDir, { recursive: true });

const PG_PORT = Number(process.env.PG_PORT || 54329);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://yanqi:yanqi@127.0.0.1:${PG_PORT}/yanqi_match`;

const EmbeddedPostgres = (await import('embedded-postgres')).default;
const pg = new EmbeddedPostgres({
  databaseDir: path.join(dataDir, 'pg'),
  user: 'yanqi',
  password: 'yanqi',
  port: PG_PORT,
  persistent: true,
});

console.log('初始化嵌入式 Postgres…');
await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('yanqi_match');
  console.log('已创建数据库 yanqi_match');
} catch {
  console.log('数据库已存在，跳过创建');
}
console.log('Postgres 已启动:', DATABASE_URL);

fs.writeFileSync(
  path.join(root, '.deps-runtime.json'),
  JSON.stringify({ DATABASE_URL, PG_PORT, startedAt: new Date().toISOString() }, null, 2),
);

const envPath = path.join(root, '.env');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (!/DATABASE_URL=/.test(env)) env += `\nDATABASE_URL=${DATABASE_URL}\n`;
else env = env.replace(/DATABASE_URL=.*/g, `DATABASE_URL=${DATABASE_URL}`);
if (!/API_PORT=/.test(env)) env += `API_PORT=3100\n`;
if (!/ADMIN_API_KEY=/.test(env)) env += `ADMIN_API_KEY=yanqi-admin-demo-key\n`;
fs.writeFileSync(envPath, env.trim() + '\n');
fs.copyFileSync(envPath, path.join(root, 'apps/api/.env'));

console.log('依赖就绪。保持此进程运行。Ctrl+C 结束。');

const stop = async () => {
  try { await pg.stop(); } catch {}
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
