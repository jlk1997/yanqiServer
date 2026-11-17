/** M28：运营台仅运营角色；若侧栏已是 details 则不再二次折叠 */
(async function () {
  const token = localStorage.getItem('yanqi_token') || '';
  const key = localStorage.getItem('yanqi_api_key') || '';
  async function me() {
    if (!token && !key) return null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (key) headers['X-API-Key'] = key;
    try {
      const r = await fetch('/api/auth/me', { headers, credentials: 'include' });
      if (!r.ok) return null;
      return r.json();
    } catch (_) {
      return null;
    }
  }
  const info = await me();
  if (info && info.ok && info.shell && info.shell !== 'ops') {
    location.replace(info.homePath || '/');
    return;
  }
  if (info && info.ok && info.user) {
    const el = document.getElementById('authState');
    if (el) el.textContent = `${info.personaLabel || info.user.role} · 已登录`;
  }

  const side = document.getElementById('opsSide');
  if (!side) return;
  if (side.querySelector('details.nav-group')) {
    // HTML 已折叠（M28），只保证「对接干活」默认展开
    return;
  }
  const groups = [
    { title: '档案与标签', tabs: ['orgs', 'cards', 'taxonomy', 'reviews', 'checklists', 'doctpl', 'cases'] },
    { title: '看数与对外', tabs: ['reports', 'events', 'commissions', 'billing', 'plans', 'tenants', 'integrations'] },
    { title: '发信与系统', tabs: ['smtp', 'templates', 'metrics', 'inbox', 'audits', 'webhooks', 'lineage'] },
  ];
  groups.forEach((g) => {
    const nodes = [];
    g.tabs.forEach((tab) => {
      const btn = side.querySelector(`button[data-tab="${tab}"]`);
      if (btn) nodes.push(btn);
    });
    if (!nodes.length) return;
    const details = document.createElement('details');
    details.className = 'nav-group';
    const summary = document.createElement('summary');
    summary.textContent = g.title + ' · 点击展开';
    details.appendChild(summary);
    const first = nodes[0];
    const prev = first.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('sec')) prev.remove();
    first.parentNode.insertBefore(details, first);
    nodes.forEach((n) => details.appendChild(n));
  });
})();
