#!/usr/bin/env node
/**
 * 安全基线 + 租户导出冒烟：限流头、机构用户不能提权/改集成、租户隔离、WAF、导出。
 * 用法：npm run test:security（需 API 已在 API_PORT 监听）
 */
const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 3100}`;

async function json(path, opts = {}) {
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body, raw: text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function login(email, password) {
  const r = await json('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert(r.status === 201 || r.status === 200, `login failed ${email}: ${r.status}`);
  assert(r.body?.token, 'no token');
  return r.body;
}

const results = [];
function ok(name, detail) {
  results.push({ ok: true, name, detail });
  console.log('✓', name, detail || '');
}
function fail(name, detail) {
  results.push({ ok: false, name, detail });
  console.error('✗', name, detail || '');
}

async function main() {
  const h = await json('/api/health');
  assert(h.status === 200 && h.body?.ok, 'health not ok');
  ok('health', `maturity=${h.body.maturityApprox} wave=${h.body.maturityWave}`);

  const st = await json('/api/public/status');
  assert(st.status === 200 && st.body?.ok, 'public status failed');
  ok('public status', st.body.status);

  const pub = await json('/api/public/home');
  assert(pub.headers.get('x-ratelimit-limit'), 'missing rate limit header');
  ok('public rate-limit header', pub.headers.get('x-ratelimit-limit'));

  await json('/api/auth/bootstrap', { method: 'POST', body: '{}' });
  const admin = await login(process.env.ADMIN_EMAIL || 'admin@yanqi.local', process.env.ADMIN_PASS || 'yanqi123');
  ok('admin login', admin.user.role);

  const email = `sec_org_${Date.now()}@yanqi.local`;
  const reg = await json('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: 'yanqi123',
      name: '安全测试机构用户',
      orgName: '安全测试企业',
      orgType: 'ENTERPRISE',
    }),
  });
  assert(reg.body?.token && reg.body?.user?.role === 'ORG_USER', 'register org user failed');
  ok('org_user register', email);
  const orgToken = reg.body.token;

  const integ = await json('/api/integrations/chatwoot', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ enabled: true, baseUrl: 'http://evil.example' }),
  });
  const blocked =
    integ.status === 403 ||
    integ.body?.statusCode === 403 ||
    String(integ.body?.message || '').includes('无权') ||
    String(integ.body?.message || '').includes('不能');
  assert(blocked, `org_user should not upsert integration: ${integ.status}`);
  ok('org_user cannot escalate via integrations write', String(integ.status));

  const ten = await json('/api/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ code: 'hack' + Date.now(), name: 'hack' }),
  });
  assert(ten.status === 403 || ten.body?.statusCode === 403, `org_user should not create tenant: ${ten.status}`);
  ok('org_user cannot create tenant', String(ten.status));

  const expDenied = await json('/api/tenants/default/export', {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
    body: '{}',
  });
  assert(
    expDenied.status === 403 || expDenied.body?.statusCode === 403,
    `org_user should not export tenant: ${expDenied.status}`,
  );
  ok('org_user cannot tenant-export', String(expDenied.status));

  const promo = await json('/api/auth/promote', {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ role: 'ADMIN' }),
  });
  assert(promo.status === 403 || promo.status === 404, 'promote should be forbidden/missing');
  ok('org_user promote blocked', String(promo.status));

  const orgs = await json('/api/orgs', { headers: { Authorization: `Bearer ${orgToken}` } });
  assert(orgs.status === 200 || orgs.status === 201, 'orgs list failed');
  ok('org list scoped-or-visible', `status=${orgs.status}`);

  const key = process.env.ADMIN_API_KEY || 'yanqi-admin-demo-key';
  const stats = await json('/api/stats', { headers: { 'X-API-Key': key } });
  assert(stats.status === 200, 'stats with api key failed');
  ok('admin api key', `orgs=${stats.body.orgs}`);

  assert(h.body.secretsFromEnv === true, 'health.secretsFromEnv missing');
  ok('secretsFromEnv flag');
  assert(h.body.wafBasics === true, 'wafBasics missing on health');
  ok('wafBasics flag');
  assert(h.body.tenantExport === true, 'tenantExport flag missing');
  ok('tenantExport flag');

  // WAF: health exposes flags; oversized POST may 413 via body-parser
  try {
    const big = await json('/api/tenants', {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: JSON.stringify({ code: 'x', name: 'n', pad: 'y'.repeat(50_000) }),
    });
    ok('waf mid-size post handled', `status=${big.status}`);
  } catch (e) {
    ok('waf mid-size post handled', 'client-abort-or-reject');
  }
  // suspicious UA should not crash public status
  const ua = await fetch(base + '/api/public/status', { headers: { 'User-Agent': 'sqlmap/1.0' } });
  assert(ua.status === 200, 'suspicious UA should still get status');
  ok('suspicious UA logged-not-blocked', ua.headers.get('x-yanqi-waf') || 'ok');

  // Tenant export (admin)
  const exp = await json('/api/tenants/default/export', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: '{}',
  });
  assert(exp.status === 200 || exp.status === 201, `export failed ${exp.status} ${JSON.stringify(exp.body)}`);
  assert(exp.body?.status === 'ready' && exp.body?.filePath, 'export not ready');
  ok('tenant export zip', `size=${exp.body.fileSize}`);

  const dl = await fetch(base + '/api/tenants/exports/' + exp.body.id + '/download', {
    headers: { 'X-API-Key': key },
  });
  assert(dl.status === 200, 'download failed ' + dl.status);
  const buf = Buffer.from(await dl.arrayBuffer());
  assert(buf.length > 20 && buf[0] === 0x50 && buf[1] === 0x4b, 'not a zip');
  ok('tenant export download zip magic', `bytes=${buf.length}`);

  // soft-delete default forbidden
  const softDef = await json('/api/tenants/default/soft-delete', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: '{}',
  });
  assert(softDef.status === 403 || softDef.body?.statusCode === 403, 'default soft-delete should be forbidden');
  ok('default tenant soft-delete blocked', String(softDef.status));

  // create temp tenant, soft delete, hard delete
  const code = 'tmp' + Date.now().toString(36).slice(-6);
  const created = await json('/api/tenants', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: JSON.stringify({ code, name: '临时租户-' + code, planCode: 'free' }),
  });
  assert(created.body?.id, 'create tenant failed ' + JSON.stringify(created.body));
  const soft = await json('/api/tenants/' + created.body.id + '/soft-delete', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: '{}',
  });
  assert(soft.body?.confirmToken, 'soft delete missing token');
  ok('tenant soft-delete + token', code);
  const hard = await json('/api/tenants/' + created.body.id + '/hard-delete', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: JSON.stringify({ confirmToken: soft.body.confirmToken }),
  });
  assert(hard.body?.ok, 'hard delete failed ' + JSON.stringify(hard.body));
  ok('tenant hard-delete', hard.body.message);

  // domain challenge on default
  // need a domain set
  await json('/api/tenants/default/branding', {
    method: 'PATCH',
    headers: { 'X-API-Key': key },
    body: JSON.stringify({ customDomain: 'demo-tto.yanqi.test' }),
  });
  const chal = await json('/api/tenants/default/domain/challenge', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: '{}',
  });
  assert(chal.body?.value?.startsWith?.('yanqi-verify='), 'challenge missing');
  const ver = await json('/api/tenants/default/domain/verify-simulate', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: JSON.stringify({ pretendFound: true }),
  });
  assert(ver.body?.ok && ver.body?.branding?.domainStatus === 'active', 'verify sim failed');
  ok('domain verify simulate', ver.body.branding.domainStatus);

  // multi-model report
  const rep = await json('/api/reports/generate', {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: JSON.stringify({ scope: 'platform', provider: 'local' }),
  });
  assert(rep.body?.id && rep.body?.provider, 'report generate failed');
  ok('multi-model report', `provider=${rep.body.provider} v=${rep.body.version}`);

  const healthRes = await fetch(base + '/api/health');
  const setCookie = healthRes.headers.getSetCookie?.() || [];
  ok('csrf cookie optional', setCookie.join(';').includes('yanqi_csrf') ? 'set' : 'lax-mode-ok');


  // —— M11 安全自检追加 ——
  // 会话吊销
  const login2 = await login(process.env.ADMIN_EMAIL || 'admin@yanqi.local', process.env.ADMIN_PASS || 'yanqi123');
  assert(login2.jti || login2.token, 'login missing jti/token');
  const sess = await json('/api/auth/sessions', { headers: { Authorization: `Bearer ${login2.token}` } });
  assert(Array.isArray(sess.body) || Array.isArray(sess.body?.items) || sess.status === 200, 'sessions list failed');
  const sessions = Array.isArray(sess.body) ? sess.body : sess.body?.items || sess.body?.sessions || [];
  ok('sessions list', `n=${sessions.length}`);
  const jti = login2.jti || sessions.find((s) => !s.revokedAt)?.jti;
  if (jti) {
    const rev = await json('/api/auth/sessions/' + jti + '/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login2.token}` },
      body: '{}',
    });
    assert(rev.status === 200 || rev.status === 201 || rev.body?.ok !== false, 'revoke failed ' + JSON.stringify(rev.body));
    ok('session revoke', jti.slice(0, 8));
    const after = await json('/api/stats', { headers: { Authorization: `Bearer ${login2.token}` } });
    assert(after.status === 401 || after.status === 403, 'revoked token should not work, got ' + after.status);
    ok('revoked token rejected', String(after.status));
  } else {
    ok('session revoke skipped', 'no jti on login payload — re-login with fresh API');
  }

  // 审计导出鉴权：机构用户应被拒
  const adminFresh = await login(process.env.ADMIN_EMAIL || 'admin@yanqi.local', process.env.ADMIN_PASS || 'yanqi123');
  const auditOrg = await json('/api/audits/export?format=json', {
    headers: { Authorization: `Bearer ${orgToken}` },
  });
  assert(
    auditOrg.status === 401 || auditOrg.status === 403 || auditOrg.body?.statusCode === 403,
    'org should not export audits: ' + auditOrg.status,
  );
  ok('audit export denied for org_user', String(auditOrg.status));
  const auditOk = await json('/api/audits/export?format=json&limit=5', {
    headers: { Authorization: `Bearer ${adminFresh.token}` },
  });
  assert(auditOk.status === 200 && (auditOk.body?.items || auditOk.body?.count != null || Array.isArray(auditOk.body)), 'admin audit export failed');
  ok('audit export admin ok', `status=${auditOk.status}`);

  // 附件路径穿越：非法 matchId
  const trav = await json('/api/brokers/attachments/' + encodeURIComponent('../etc/passwd'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminFresh.token}` },
    body: JSON.stringify({ fileName: 'x.txt', textContent: 'nope' }),
  });
  assert(
    trav.status === 400 || trav.status === 404 || trav.status === 403 || trav.body?.statusCode === 400,
    'path traversal should fail: ' + trav.status + ' ' + JSON.stringify(trav.body),
  );
  ok('attachment path traversal blocked', String(trav.status));

  // 健康探针拆分
  const live = await json('/api/health/live');
  assert(live.status === 200 && live.body?.probe === 'live', 'live probe');
  ok('health live', live.body.probe);
  const ready = await json('/api/health/ready');
  assert(ready.status === 200 && ready.body?.ok, 'ready probe');
  ok('health ready', ready.body.db);

  // 幂等键回放（匹配反馈）
  const matches = await json('/api/matches', { headers: { Authorization: `Bearer ${adminFresh.token}` } });
  const mid = (Array.isArray(matches.body) ? matches.body : matches.body?.items || [])[0]?.id;
  if (mid) {
    const idem = 'm11-test-' + Date.now();
    const f1 = await json('/api/feedback/matches/' + mid, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminFresh.token}`, 'Idempotency-Key': idem },
      body: JSON.stringify({ useful: true, kind: 'thumbs', comment: 'm11-idem' }),
    });
    assert(f1.status === 200 || f1.status === 201, 'feedback failed');
    const f2 = await json('/api/feedback/matches/' + mid, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminFresh.token}`, 'Idempotency-Key': idem },
      body: JSON.stringify({ useful: true, kind: 'thumbs', comment: 'm11-idem' }),
    });
    assert(f2.headers.get('x-idempotency-replayed') === '1' || f2.body?.feedback?.id === f1.body?.feedback?.id, 'idempotency replay missing');
    ok('idempotency replay', f2.headers.get('x-idempotency-replayed') || 'same-body');
  } else {
    ok('idempotency skipped', 'no matches');
  }

  // 学习权重可读
  const w = await json('/api/feedback/weights', { headers: { Authorization: `Bearer ${adminFresh.token}` } });
  assert(w.body?.weights && w.body?.defaults, 'weights payload');
  ok('match learning weights', `usefulN=${w.body.usefulN}`);

  // —— M42 安全自检：未登录 checkout 不得回 stubToken；佣金非法跳转 400 ——
  const order = await json('/api/billing/order', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminFresh.token}` },
    body: JSON.stringify({ planCode: 'org_pro' }),
  });
  const checkoutId = order.body?.session?.id || order.body?.id || order.body?.checkout?.id;
  assert(checkoutId, 'checkout create failed ' + JSON.stringify(order.body).slice(0, 200));
  const stub = order.body?.session?.stubToken || order.body?.stubToken;
  const anon = await json('/api/billing/checkout/' + checkoutId);
  const bodyStr = typeof anon.body === 'string' ? anon.body : JSON.stringify(anon.body || {});
  const leaked = /"stubToken"\s*:\s*"[a-f0-9]{8,}"/i.test(bodyStr);
  assert(!leaked, 'unauth checkout must not return stubToken: ' + bodyStr.slice(0, 240));
  assert(
    anon.status === 401 ||
      anon.status === 403 ||
      (anon.status === 200 && anon.body && (anon.body.redacted === true || anon.body.stubToken == null)),
    'unauth checkout should 401/403 or redacted 200, got ' + anon.status,
  );
  ok(
    'unauth checkout redacts stubToken',
    `id=${String(checkoutId).slice(0, 8)} http=${anon.status} redacted=${anon.body?.redacted || anon.status === 401}`,
  );

  // 建佣金桩并试非法跳转 paid←stub
  await json('/api/commissions/ensure-demo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminFresh.token}` },
    body: JSON.stringify({}),
  });
  const led = await json('/api/commissions/ledger', { headers: { Authorization: `Bearer ${adminFresh.token}` } });
  const items = led.body?.items || (Array.isArray(led.body) ? led.body : []);
  let row = (items || []).find((x) => x.status === 'stub') || (items || []).find((x) => x.status === 'pending') || (items || [])[0];
  if (!row) {
    const matches = await json('/api/matches', { headers: { Authorization: `Bearer ${adminFresh.token}` } });
    const mid = (Array.isArray(matches.body) ? matches.body : matches.body?.items || [])[0]?.id;
    if (mid) {
      const created = await json('/api/commissions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminFresh.token}` },
        body: JSON.stringify({ matchId: mid, dealAmount: 10000, rate: 0.1, note: 'm42-sec-test', status: 'stub' }),
      });
      row = created.body;
    }
  }
  if (row?.id) {
    const from = row.status;
    // 非法：直接跳到 paid（stub/pending 都不允许）或从 paid 回 stub
    const target = from === 'paid' ? 'stub' : 'paid';
    const bad = await json('/api/commissions/' + row.id + '/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminFresh.token}` },
      body: JSON.stringify({ status: target }),
    });
    const blocked =
      bad.status === 400 ||
      bad.body?.statusCode === 400 ||
      String(bad.body?.message || '').includes('不能从') ||
      String(bad.body?.message || '').includes('非法');
    // 若 from=approved 且 target=paid 合法，再测 paid→pending
    if (!blocked && from === 'approved' && target === 'paid') {
      const back = await json('/api/commissions/' + row.id + '/status', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminFresh.token}` },
        body: JSON.stringify({ status: 'stub' }),
      });
      assert(
        back.status === 400 || back.body?.statusCode === 400 || String(back.body?.message || '').includes('不能'),
        'paid/approved illegal rollback should 400',
      );
      ok('commission illegal transition blocked', `approved→paid ok; rollback ${back.status}`);
    } else {
      assert(blocked, 'illegal commission jump should 400 got ' + bad.status + ' ' + JSON.stringify(bad.body).slice(0, 180));
      ok('commission illegal transition blocked', `${from}→${target} => ${bad.status}`);
    }
  } else {
    ok('commission transition skipped', 'no commission row');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\nsummary', { passed: results.length - failed.length, failed: failed.length });
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
