#!/usr/bin/env node
import { spawnSync } from 'child_process';
const key = process.env.ADMIN_API_KEY || 'yanqi-admin-demo-key';
const base = process.env.API_BASE || 'http://127.0.0.1:3100';
function sh(cmd) {
  console.log('>', cmd);
  spawnSync(cmd, { shell: true, stdio: 'inherit', env: process.env });
}
sh(`curl -s ${base}/api/health`);
sh(`curl -s ${base}/api/stats -H 'X-API-Key: ${key}' | head -c 400; echo`);
sh(`curl -s -X POST ${base}/api/matches/run -H 'X-API-Key: ${key}' -H 'Content-Type: application/json' -d '{"topN":5,"minScore":0.3}'`);
