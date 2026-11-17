/** M41 登录页：等待 / 失败 / 安全反馈更充分 */
function ensureLoginToast() {
  if (document.getElementById('toastHost')) return;
  const h = document.createElement('div');
  h.id = 'toastHost';
  h.setAttribute('aria-live', 'polite');
  document.body.appendChild(h);
}
function toast(msg, kind) {
  ensureLoginToast();
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || 'ok');
  el.textContent = String(msg || '').slice(0, 240);
  document.getElementById('toastHost').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' || kind === 'security' ? 5000 : 2600);
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const token = localStorage.getItem('yanqi_token') || '';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const method = String(opts.method || 'GET').toUpperCase();
  if ((method === 'POST' || method === 'PATCH') && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] =
      (crypto.randomUUID && crypto.randomUUID()) || 'ik-' + Date.now().toString(36);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
  let r;
  try {
    r = await fetch('/api' + path, { ...opts, headers, credentials: 'include', signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && e.name === 'AbortError';
    throw new Error(aborted ? '登录超时，请检查网络后重试' : e.message || '网络异常');
  }
  clearTimeout(timer);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const msg = (body && body.message) || (typeof body === 'string' ? body : r.statusText);
    if (r.status === 429) throw new Error('尝试太频繁，请稍后再登录');
    if (r.status === 401 || r.status === 403) throw new Error(msg || '账号或密码不对');
    throw new Error(msg);
  }
  return body;
}

function applySession(res) {
  if (res.token) localStorage.setItem('yanqi_token', res.token);
  if (res.apiKey) localStorage.setItem('yanqi_api_key', res.apiKey);
  else localStorage.removeItem('yanqi_api_key');
  const home = res.homePath || res.user?.homePath || '/portal.html';
  toast('登录成功，正在进入工作台…', 'ok');
  location.href = home;
}

async function doLogin(id, pass) {
  loginMsg.textContent = '登录中，请稍候…';
  document.body.classList.add('yb-busy');
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: id, username: id, password: pass }),
    });
    applySession(res);
  } finally {
    document.body.classList.remove('yb-busy');
  }
}

btnLogin.onclick = () => {
  doLogin(loginId.value.trim(), loginPass.value).catch((e) => {
    loginMsg.textContent = e.message || '登录失败';
    toast(e.message || '登录失败', 'err');
  });
};
document.body.classList.add('density-m40');
document.body.classList.add('feedback-m41');
loginMsg && loginMsg.setAttribute('role', 'status');
ensureLoginToast();

async function loadDemos() {
  try {
    const d = await api('/auth/demo-accounts');
    demoList.innerHTML = (d.items || [])
      .map(
        (it) => `<button type="button" class="demo-item" role="listitem" data-login="${it.login}" aria-label="一键进入：${it.noteZh}">
        <div class="demo-title">${it.noteZh}</div>
        <div class="muted">${it.login} · → ${it.shell}</div>
      </button>`,
      )
      .join('');
    demoList.querySelectorAll('.demo-item').forEach((btn) => {
      btn.onclick = () => {
        loginId.value = btn.dataset.login;
        loginMsg.textContent = '正在进入「' + (btn.querySelector('.demo-title')?.textContent || btn.dataset.login) + '」…';
        doLogin(btn.dataset.login, 'yanqi123').catch((e) => {
          loginMsg.textContent = e.message || '登录失败';
          toast(e.message || '登录失败', 'err');
        });
      };
    });
  } catch (e) {
    demoList.innerHTML = `<p class="muted">演示列表暂不可用：${e.message}</p>`;
    toast(e.message || '演示列表加载失败', 'warn');
  }
}

// 已登录则直达自家首页
(async () => {
  try {
    const me = await api('/auth/me');
    if (me.ok && me.homePath) {
      location.replace(me.homePath);
      return;
    }
  } catch (_) {}
  loadDemos();
})();
