const P = {
  token: localStorage.getItem('yanqi_token') || '',
  apiKey: localStorage.getItem('yanqi_api_key') || '',
};

function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (P.token) headers['Authorization'] = 'Bearer ' + P.token;
  if (P.apiKey) headers['X-API-Key'] = P.apiKey;
  return fetch('/api' + path, { ...opts, headers, credentials: 'include' }).then(async (r) => {
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(typeof data === 'string' ? data : data.message || r.statusText);
    return data;
  });
}

function showPage(name) {
  document.querySelectorAll('.page').forEach((el) => (el.style.display = 'none'));
  document.querySelectorAll('.navp a').forEach((a) => a.classList.toggle('on', a.dataset.p === name));
  const el = document.getElementById('page-' + name);
  if (el) el.style.display = 'block';
  if (name === 'home') loadHome();
  if (name === 'outcomes') loadOutcomes();
  if (name === 'demands') loadDemands();
  if (name === 'capabilities') loadCapabilities();
  if (name === 'matches') loadPublicMatches();
  if (name === 'workspace') loadWs();
  if (name === 'deals') loadMyDeals();
  if (name === 'cases') loadPortalCases();
  if (name === 'pricing' || name === 'plans') loadPricing();
}

function route() {
  const h = (location.hash || '#home').replace('#', '') || 'home';
  showPage(h === 'notifications' ? 'workspace' : h);
}

async function refreshWho() {
  try {
    const me = await api('/auth/me');
    if (me.ok && me.user) who.textContent = `${me.user.name} · ${me.user.role} · ${me.user.planCode || 'free'}`;
    else who.textContent = '未登录';
  } catch {
    who.textContent = '未登录';
  }
}

function cardMsg(text, ok) {
  const el = document.getElementById('cardMsg');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#3ecf8e' : '#f07178';
}

async function loadHome() {
  const h = await api('/public/home');
  applyBranding(h.product || h.branding || {});
  homeStats.innerHTML = [
    ['组织', h.stats.orgs],
    ['成果', h.stats.outs],
    ['需求', h.stats.demands],
    ['匹配', h.stats.matches],
  ]
    .map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join('');
  homeCases.innerHTML =
    (h.cases || [])
      .map(
        (c) => `<div class="item"><h4><span class="score">${(c.score * 100).toFixed(0)}分</span> · ${c.demandTitle || ''}</h4>
        <div class="meta">${c.demandOrg || ''} 需求 ↔ ${c.supplyTitle || ''}</div>
        <div class="reason">${c.reason || ''}</div></div>`,
      )
      .join('') || '<div class="muted">暂无高分案例，运营跑一轮匹配后会出现</div>';
}

function applyBranding(p) {
  if (!p) return;
  const name = p.productName || p.name || '研企通';
  const tag = p.tagline || '';
  const color = p.primaryColor || '#3d8bfd';
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent2', color);
  const logo = document.querySelector('.brand .logo');
  if (logo) logo.textContent = name;
  const sub = document.querySelector('.brand .sub');
  if (sub && tag) sub.textContent = tag;
  document.title = name + ' · 科研成果与企业需求对接';
  const h1 = document.querySelector('.hero h1');
  if (h1 && tag) {
    /* keep hero title; inject product chip */
  }
  let chip = document.getElementById('brandChip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'brandChip';
    chip.className = 'pill';
    chip.style.margin = '8px 20px';
    const hero = document.querySelector('.hero');
    if (hero) hero.prepend(chip);
  }
  chip.textContent = name + (p.customDomain ? ' · ' + p.customDomain : ' · 免费开用');
}

// boot branding even before home
api('/public/branding').then(applyBranding).catch(() => {});


async function loadOutcomes() {
  const q = oq.value ? `?q=${encodeURIComponent(oq.value)}` : '';
  const rows = await api('/public/outcomes' + q);
  outList.innerHTML = rows
    .map(
      (o) => `<div class="item"><h4>${o.title}</h4>
      <div class="meta">${o.teacherName ? o.teacherName + ' · ' : ''}${o.org?.name || ''} · ${o.type} · TRL ${o.trl ?? '—'}</div>
      <div class="reason">${(o.abstract || '').slice(0, 180)}</div></div>`,
    )
    .join('');
}

async function loadDemands() {
  const q = dq.value ? `?q=${encodeURIComponent(dq.value)}` : '';
  const rows = await api('/public/demands' + q);
  demList.innerHTML = rows
    .map(
      (d) => `<div class="item"><h4>${d.title}</h4>
      <div class="meta">${d.org?.name || ''} · 预算 ${d.budgetBand || '未填'} · ${d.urgency || ''}</div>
      <div class="reason">${(d.problem || '').slice(0, 180)}</div></div>`,
    )
    .join('');
}

async function loadCapabilities() {
  const q = cq && cq.value ? `?q=${encodeURIComponent(cq.value)}` : '';
  const rows = await api('/public/capabilities' + q);
  capList.innerHTML =
    rows
      .map(
        (c) => `<div class="item"><h4>${c.title}</h4>
        <div class="meta">${c.teacherName ? c.teacherName + ' · ' : ''}${c.org?.name || ''}</div>
        <div class="tags">${(c.keywords || []).slice(0, 8).map((x) => `<span>${x}</span>`).join('')}</div>
        <div class="reason">${(c.summary || '').slice(0, 180)}</div></div>`,
      )
      .join('') || '<div class="muted">暂无能力卡</div>';
}

async function loadPublicMatches() {
  const q = mq && mq.value ? `?q=${encodeURIComponent(mq.value)}` : '';
  const rows = await api('/public/matches' + q);
  matchPublicList.innerHTML =
    rows
      .map(
        (m) => `<div class="item"><h4><span class="score">${(m.score * 100).toFixed(0)}分</span> · ${m.demandTitle || ''}</h4>
        <div class="meta">${m.demandOrg || ''} 需求 ↔ ${m.supplyTitle || ''}（${m.supplyOrg || ''}）</div>
        <div class="reason">${m.reason || ''}</div></div>`,
      )
      .join('') || '<div class="muted">暂无公开案例</div>';
}

async function loadPricing() {
  try { await loadPortalUsage(); } catch (_) {}
  const plans = await api('/plans');
  priceCards.innerHTML = plans
    .map((p) => {
      const qs = p.quotas || {};
      return `<div class="price-card ${p.code === 'free' ? 'hot' : ''}">
        <div class="pill">${p.code}</div>
        <h3>${p.name}</h3>
        <div class="price">${p.priceMonthly ? '¥' + p.priceMonthly + '/月' : '免费'}</div>
        <div class="muted">${p.description || ''}</div>
        <ul>
          <li>匹配次数 / 月：${qs.match_runs ?? '—'}</li>
          <li>采集任务 / 月：${qs.crawl_jobs ?? '—'}</li>
          <li>分析报告 / 月：${qs.reports ?? '—'}</li>
          <li>卡片配额 / 月：${qs.cards ?? '—'}</li>
          <li>席位：${qs.seats ?? '—'}</li>
        </ul>
        <a class="buttonish" href="#auth" style="margin-top:auto">${p.priceMonthly ? '联系开通（演示）' : '免费注册'}</a>
      </div>`;
    })
    .join('');
}

btnO && (btnO.onclick = loadOutcomes);
btnD && (btnD.onclick = loadDemands);
btnC && (btnC.onclick = loadCapabilities);
btnM && (btnM.onclick = loadPublicMatches);

btnLoginP.onclick = async () => {
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: loginEmail.value, password: loginPass.value }),
    });
    P.token = res.token;
    P.apiKey = res.apiKey;
    localStorage.setItem('yanqi_token', P.token);
    if (P.apiKey) localStorage.setItem('yanqi_api_key', P.apiKey);
    else localStorage.removeItem('yanqi_api_key');
    loginMsg.textContent = '登录成功，正在进入工作台…';
    const home = res.homePath || res.user?.homePath;
    if (home && !String(home).includes('portal.html')) {
      location.href = home;
      return;
    }
    await refreshWho();
    location.hash = '#workspace';
  } catch (e) {
    loginMsg.textContent = e.message;
  }
};

btnReg.onclick = async () => {
  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: regEmail.value,
        password: regPass.value,
        name: regName.value,
        orgName: regOrg.value,
        orgType: regType.value,
      }),
    });
    P.token = res.token;
    P.apiKey = res.apiKey;
    localStorage.setItem('yanqi_token', P.token);
    localStorage.setItem('yanqi_api_key', P.apiKey);
    regMsg.textContent = '注册成功';
    await refreshWho();
    const home = res.homePath || res.user?.homePath;
    if (home && !String(home).includes('portal.html')) { location.href = home; return; }
    location.hash = '#workspace';
  } catch (e) {
    regMsg.textContent = e.message;
  }
};

async function loadWs() {
  try {
    const w = await api('/portal/workspace');
    if (w.ok === false) {
      wsHead.innerHTML = `<div class="muted">${w.message || '请先登录'} <a href="#auth">去登录</a></div>`;
      wsClaim.style.display = 'none';
      if (wsOrgEdit) wsOrgEdit.style.display = 'none';
      return;
    }
    const unread = w.unreadNotifications || (w.notifications || []).filter((n) => !n.readAt).length;
    if (navUnread) navUnread.textContent = unread ? `通知(${unread})` : '通知';

    if (!w.org) {
      wsHead.innerHTML = `<h3>尚未绑定组织</h3><div class="reason">从冷启动库认领，或新建一个组织后再维护三张卡。</div>`;
      wsClaim.style.display = 'block';
      if (wsOrgEdit) wsOrgEdit.style.display = 'none';
      claimOrgSelect.innerHTML =
        '<option value="">— 请选择 —</option>' +
        (w.claimable || [])
          .map((o) => `<option value="${o.id}">${o.name}（${o.type} · ${o.region || '地域未填'}）</option>`)
          .join('');
      wsMatches.innerHTML = '';
      wsCards.innerHTML = '';
      wsHints.innerHTML = '';
    } else {
      wsClaim.style.display = 'none';
      if (wsOrgEdit) wsOrgEdit.style.display = 'block';
      wsHead.innerHTML = `<h3>${w.org.name}</h3>
        <div class="meta">${w.user?.name} · ${w.user?.role} · 套餐 ${w.user?.planCode}
        <span class="pill">${w.org.type || ''}</span>
        <span class="pill">租户 ${w.org.tenantId || 'default'}</span></div>
        <div class="reason">${w.org.summary || '完善组织简介有助于匹配。'}</div>`;
      orgSummary.value = w.org.summary || '';
      orgRegion.value = w.org.region || '';
      orgWebsite.value = w.org.website || '';
    }

    wsHints.innerHTML = (w.qualityHints || [])
      .map((h) => `<div class="item"><span class="pill">质检提示</span> ${h}</div>`)
      .join('');

    const mm = [...(w.matches || []), ...(w.supplyMatches || [])].slice(0, 15);
    wsMatches.innerHTML =
      mm
        .map((m) => {
          const supply = m.capability?.title || m.outcome?.title || '';
          const who = m.teacherName ? `建议对接 ${m.teacherName}` : '';
          const how = m.collabModeLabel || '';
          const extra = [who, how].filter(Boolean).join(' · ');
          return `<div class="item"><h4><span class="score">${(m.totalScore * 100).toFixed(0)}分</span> · ${m.demand?.title || ''}</h4>
          <div class="meta">供给：${supply}${extra ? ' · ' + extra : ''}</div><div class="reason">${m.reason || ''}</div>
          <div class="row">
            <button data-fb-yes="${m.id}">有用</button>
            <button class="ghost" data-fb-no="${m.id}">不准</button>
          </div></div>`;
        })
        .join('') || '<div class="muted">暂无推荐：先发布需求/能力，再请运营跑匹配</div>';

    wsMatches.querySelectorAll('[data-fb-yes]').forEach((b) => {
      b.onclick = async () => {
        await api('/feedback/matches/' + b.dataset.fbYes, {
          method: 'POST',
          body: JSON.stringify({ useful: true, comment: '门户用户标记有用' }),
        });
        cardMsg('已记录「有用」', true);
        loadWs();
      };
    });
    wsMatches.querySelectorAll('[data-fb-no]').forEach((b) => {
      b.onclick = async () => {
        await api('/feedback/matches/' + b.dataset.fbNo, {
          method: 'POST',
          body: JSON.stringify({ useful: false, comment: '门户用户标记不准' }),
        });
        cardMsg('已记录「不准」', true);
        loadWs();
      };
    });

    const renderCard = (kind, row) => {
      const pill = kind === 'demand' ? '需求' : kind === 'capability' ? '能力' : '成果';
      const unpublished = row.publishStatus && row.publishStatus !== 'published' ? '<span class="pill">未发布</span>' : '';
      const locked = (row.lockedFields || []).length ? `<span class="pill">已锁定 ${row.lockedFields.length} 项，采集不会覆盖</span>` : '';
      const body =
        kind === 'demand' ? row.problem : kind === 'capability' ? (row.keywords || []).join('、') : (row.abstract || '').slice(0, 120);
      return `<div class="item"><span class="pill">${pill}</span>${unpublished}${locked}<h4>${row.title}</h4><div class="reason">${body || ''}</div>
        <div class="row"><button class="ghost" data-del-${kind}="${row.id}">删除</button></div></div>`;
    };
    wsCards.innerHTML =
      [
        ...(w.demands || []).map((d) => renderCard('demand', d)),
        ...(w.capabilities || []).map((c) => renderCard('capability', c)),
        ...(w.outcomes || []).map((o) => renderCard('outcome', o)),
      ].join('') || '<div class="muted">还没有卡，用上面的表单自助发布</div>';

    const bindDel = (attr, path) => {
      wsCards.querySelectorAll(`[${attr}]`).forEach((b) => {
        b.onclick = async () => {
          if (!confirm('确认删除？')) return;
          await api(path + b.getAttribute(attr), { method: 'DELETE' });
          loadWs();
        };
      });
    };
    bindDel('data-del-demand', '/portal/demands/');
    bindDel('data-del-capability', '/portal/capabilities/');
    bindDel('data-del-outcome', '/portal/outcomes/');

    wsNotes.innerHTML =
      (w.notifications || [])
        .map((n) => {
          const read = n.readAt ? '已读' : '未读';
          return `<div class="item"><h4>${n.title} <span class="pill">${read}</span></h4>
          <div class="meta">${new Date(n.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} Asia/Shanghai</div>
          <div class="reason">${n.body}</div>
          ${!n.readAt ? `<button class="ghost" data-read="${n.id}">标已读</button>` : ''}</div>`;
        })
        .join('') || '<div class="muted">暂无通知</div>';
    wsNotes.querySelectorAll('[data-read]').forEach((b) => {
      b.onclick = async () => {
        await api('/notifications/' + b.dataset.read + '/read', { method: 'POST', body: '{}' });
        loadWs();
      };
    });
  } catch (e) {
    wsHead.innerHTML = `<div class="muted">${e.message} · <a href="#auth">去登录</a></div>`;
  }
}

btnClaim &&
  (btnClaim.onclick = async () => {
    try {
      const body = {
        orgId: claimOrgSelect.value || undefined,
        orgName: claimOrgName.value || undefined,
        orgType: claimOrgType.value,
      };
      const r = await api('/portal/claim-org', { method: 'POST', body: JSON.stringify(body) });
      claimMsg.textContent = '认领成功：' + (r.org?.name || '');
      loadWs();
    } catch (e) {
      claimMsg.textContent = e.message;
    }
  });

btnAddDem &&
  (btnAddDem.onclick = async () => {
    try {
      const created = await api('/portal/demands', {
        method: 'POST',
        body: JSON.stringify({
          title: demTitle.value,
          problem: demProblem.value,
          industry: demTags.value,
          budgetBand: demBudget.value,
          licenseNeed: document.getElementById('demLicenseNeed')?.value || null,
          minTrl: document.getElementById('demMinTrl')?.value || null,
        }),
      });
      cardMsg(created.publishNoteZh || '需求已保存', created.publishStatus === 'published');
      demTitle.value = demProblem.value = demTags.value = demBudget.value = '';
      loadWs();
    } catch (e) {
      cardMsg(e.message, false);
    }
  });

btnAddCap &&
  (btnAddCap.onclick = async () => {
    try {
      const created = await api('/portal/capabilities', {
        method: 'POST',
        body: JSON.stringify({
          title: capTitle.value,
          summary: capSummary.value,
          keywords: capKeywords.value,
          disciplines: capDisc.value,
          trl: document.getElementById('capTrl')?.value || null,
          ipOwnership: document.getElementById('capIp')?.value || null,
          licenseOpenness: document.getElementById('capLicense')?.value || null,
          readinessBand: document.getElementById('capReady')?.value || null,
        }),
      });
      cardMsg(created.publishNoteZh || '能力已保存', created.publishStatus === 'published');
      capTitle.value = capSummary.value = capKeywords.value = capDisc.value = '';
      loadWs();
    } catch (e) {
      cardMsg(e.message, false);
    }
  });

btnAddOut &&
  (btnAddOut.onclick = async () => {
    try {
      const created = await api('/portal/outcomes', {
        method: 'POST',
        body: JSON.stringify({
          title: outTitle.value,
          type: outType.value,
          abstract: outAbstract.value,
          ipcOrDisc: outTags.value,
          trl: outTrl.value,
          rights: document.getElementById('outRights')?.value || null,
          ipOwnership: document.getElementById('outIp')?.value || null,
          licenseOpenness: document.getElementById('outLicense')?.value || null,
          readinessBand: document.getElementById('outReady')?.value || null,
        }),
      });
      cardMsg(created.publishNoteZh || '成果已保存', created.publishStatus === 'published');
      outTitle.value = outAbstract.value = outTags.value = outTrl.value = '';
      loadWs();
    } catch (e) {
      cardMsg(e.message, false);
    }
  });

btnSaveOrg &&
  (btnSaveOrg.onclick = async () => {
    try {
      await api('/portal/my-org', {
        method: 'PATCH',
        body: JSON.stringify({
          summary: orgSummary.value,
          region: orgRegion.value,
          website: orgWebsite.value,
        }),
      });
      cardMsg('组织资料已保存', true);
      loadWs();
    } catch (e) {
      cardMsg(e.message, false);
    }
  });

btnReadAll &&
  (btnReadAll.onclick = async () => {
    await api('/notifications/me/read-all', { method: 'POST', body: '{}' });
    loadWs();
  });

btnReportOrg &&
  (btnReportOrg.onclick = async () => {
    const me = await api('/auth/me');
    if (!me.ok || !me.user?.orgId) {
      wsReport.style.display = 'block';
      wsReport.textContent = '请先注册并绑定组织';
      return;
    }
    const r = await api('/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ scope: 'org', targetId: me.user.orgId }),
    });
    wsReport.style.display = 'block';
    wsReport.textContent = r.contentMd;
  });

btnUpgrade &&
  (btnUpgrade.onclick = async () => {
    const r = await api('/billing/checkout', { method: 'POST', body: JSON.stringify({ planCode: 'org_pro' }) });
    if (r.session?.id) {
      const ok = confirm(
        (r.message || '已创建演示结账') +
          '\n金额：' +
          ((r.session.amount || 0) / 100).toFixed(2) +
          ' 元（桩）\n点确定模拟支付成功',
      );
      if (ok) {
        const paid = await api('/billing/checkout/' + r.session.id + '/simulate-pay', {
          method: 'POST',
          body: JSON.stringify({ stubToken: r.session.stubToken }),
        });
        alert(paid.message || '已升级（演示）');
      }
    } else {
      alert(r.message || '完成');
    }
    refreshWho();
    loadWs();
  });

// 深链 ?checkout=&token= 自动模拟支付
(async function handleCheckoutQuery() {
  const q = new URLSearchParams(location.hash.split('?')[1] || location.search.slice(1));
  const cid = q.get('checkout');
  const token = q.get('token');
  if (!cid || !P.token) return;
  try {
    const paid = await api('/billing/checkout/' + cid + '/simulate-pay', {
      method: 'POST',
      body: JSON.stringify({ stubToken: token }),
    });
    alert(paid.message || '演示支付完成');
    history.replaceState(null, '', '#workspace');
    refreshWho();
    loadWs();
  } catch (e) {
    console.warn(e);
  }
})();

btnAskMatch &&
  (btnAskMatch.onclick = async () => {
    try {
      await api('/notifications/me/read-all', { method: 'POST', body: '{}' });
    } catch (_) {}
    cardMsg('已记录「请运营匹配」意向：请运营在中台跑一轮匹配（演示）', true);
    alert('已记录请求。运营可在中台点击「跑一轮匹配」。');
  });

window.addEventListener('hashchange', route);
refreshWho().then(route);

/* —— M7：引导向导 / 空状态 / 状态页 —— */
function emptyHtml(title, tip, actions) {
  return `<div class="empty-state"><h3>${title}</h3><p>${tip}</p>
    <div class="actions">${(actions || [])
      .map((a) => `<a class="buttonish${a.ghost ? ' ghost' : ''}" href="${a.href}">${a.label}</a>`)
      .join('')}</div></div>`;
}

const _loadOutcomes = loadOutcomes;
loadOutcomes = async function () {
  await _loadOutcomes();
  if (!outList.innerHTML.trim()) {
    outList.innerHTML = emptyHtml('成果广场还是空的', '运营导入 OpenAlex / 机构发布成果后会出现在这里。', [
      { href: '#auth', label: '免费开通机构' },
      { href: '#workspace', label: '去工作台发成果', ghost: true },
    ]);
  }
};
const _loadDemands = loadDemands;
loadDemands = async function () {
  await _loadDemands();
  if (!demList.innerHTML.trim()) {
    demList.innerHTML = emptyHtml('暂无公开需求', '企业把痛点写成需求卡后，会展示在广场并进入匹配。', [
      { href: '#auth', label: '注册企业账号' },
    ]);
  }
};
const _loadCapabilities = loadCapabilities;
loadCapabilities = async function () {
  await _loadCapabilities();
  if (!capList.innerHTML.trim()) {
    capList.innerHTML = emptyHtml('暂无能力卡', '实验室把可对外服务的能力写清楚，企业才找得到。', [
      { href: '#workspace', label: '去发布能力' },
    ]);
  }
};
const _loadPublicMatches = loadPublicMatches;
loadPublicMatches = async function () {
  await _loadPublicMatches();
  if (!matchPublicList.innerHTML.trim()) {
    matchPublicList.innerHTML = emptyHtml('还没有可展示的对接案例', '等运营跑完匹配并复核后，高分案例会出现在这里。', [
      { href: '#home', label: '回首页', ghost: true },
    ]);
  }
};

function renderOnboard(w) {
  const box = document.getElementById('onboardBox');
  if (!box) return;
  const key = 'yanqi_onboard_done_' + (w.user?.id || 'anon');
  if (localStorage.getItem(key) === '1' && w.org && (w.demands?.length || w.capabilities?.length || w.outcomes?.length)) {
    box.style.display = 'none';
    return;
  }
  const step1 = !!w.user;
  const step2 = !!w.org;
  const step3 = (w.demands?.length || 0) + (w.capabilities?.length || 0) + (w.outcomes?.length || 0) > 0;
  const step4 = (w.matches?.length || 0) + (w.supplyMatches?.length || 0) > 0;
  const cur = !step2 ? 2 : !step3 ? 3 : !step4 ? 4 : 5;
  box.style.display = 'block';
  box.innerHTML = `<h3>开通引导（约 3 分钟）</h3>
    <p class="muted">先把组织认领好，再发一张卡；剩下的匹配与触达交给运营/经纪人。</p>
    <div class="steps">
      <div class="step ${step1 ? 'on' : ''}"><b>1. 登录</b>已完成</div>
      <div class="step ${step2 || cur === 2 ? 'on' : ''}"><b>2. 认领组织</b>${step2 ? '已绑定' : '从名录认领或新建'}</div>
      <div class="step ${step3 || cur === 3 ? 'on' : ''}"><b>3. 发一张卡</b>${step3 ? '已有卡片' : '需求 / 能力 / 成果任选'}</div>
      <div class="step ${step4 || cur === 4 ? 'on' : ''}"><b>4. 看推荐</b>${step4 ? '已有匹配' : '请运营跑匹配'}</div>
    </div>
    <div class="row">
      ${!step2 ? '<span class="muted">下一步：在下方认领或新建组织</span>' : ''}
      ${step2 && !step3 ? '<span class="muted">下一步：用下面的表单发布需求或能力</span>' : ''}
      ${step3 && !step4 ? '<button id="btnOnboardAsk" class="ghost">提醒运营帮我匹配</button>' : ''}
      <button id="btnOnboardDismiss" class="ghost">暂时隐藏引导</button>
    </div>`;
  const dismiss = document.getElementById('btnOnboardDismiss');
  if (dismiss)
    dismiss.onclick = () => {
      localStorage.setItem(key, '1');
      box.style.display = 'none';
    };
  const ask = document.getElementById('btnOnboardAsk');
  if (ask && btnAskMatch) ask.onclick = () => btnAskMatch.click();
}

const _loadWs = loadWs;
loadWs = async function () {
  await _loadWs();
  try {
    const w = await api('/portal/workspace');
    if (w && w.ok !== false) renderOnboard(w);
  } catch (_) {}
};

// status chip on home
(async function refreshStatusChip() {
  try {
    const s = await api('/public/status');
    let chip = document.getElementById('sysStatusChip');
    if (!chip) {
      chip = document.createElement('a');
      chip.id = 'sysStatusChip';
      chip.href = '/api/public/status';
      chip.target = '_blank';
      chip.className = 'status-chip';
      chip.style.marginLeft = '8px';
      const auth = document.querySelector('header .auth');
      if (auth) auth.prepend(chip);
    }
    chip.className = 'status-chip' + (s.status === 'operational' ? '' : s.status === 'degraded' ? ' warn' : ' down');
    chip.textContent = '系统 ' + (s.status || 'unknown');
  } catch (_) {}
})();

/* M8 portal polish */
(async function syncPortalStatus() {
  try {
    const s = await api('/public/status');
    const chip = document.getElementById('portalStatusChip') || document.getElementById('sysStatusChip');
    if (!chip) return;
    const email = s.components?.email || '';
    const ok = s.status === 'operational';
    chip.className = 'status-chip' + (ok ? '' : ' warn');
    chip.textContent =
      (ok ? '系统正常' : '系统降级') +
      (email === 'egress_blocked_or_down' ? ' · 邮件出网受限' : email === 'live_gated' ? ' · 邮件可真发(门闸)' : '');
    chip.title = s.note || '';
  } catch (_) {
    const chip = document.getElementById('portalStatusChip');
    if (chip) {
      chip.className = 'status-chip down';
      chip.textContent = '状态不可用';
    }
  }
})();

const _loadWsM8 = loadWs;
loadWs = async function () {
  await _loadWsM8();
  const hint = document.getElementById('sampleDataHint');
  if (hint) hint.style.display = 'block';
  try {
    const notes = await api('/notifications/me');
    const unread = notes.unread || 0;
    const uh = document.getElementById('wsUnreadHint');
    if (uh) uh.textContent = unread ? `未读 ${unread}` : '全部已读';
    if (navUnread) navUnread.textContent = unread ? `通知(${unread})` : '通知';
  } catch (_) {}
};

const toggle = document.getElementById('toggleSamplePreview');
if (toggle) {
  toggle.onchange = async () => {
    const box = document.getElementById('samplePreview');
    if (!toggle.checked) {
      box.innerHTML = '';
      return;
    }
    const rows = await api('/public/matches?limit=5').catch(() => []);
    const list = rows.items || rows || [];
    box.innerHTML =
      list
        .map((m) => {
          const supply = m.capability?.title || m.outcome?.title || m.supplyTitle || '-';
          return `<div class="item"><h4>${m.demand?.title || m.demandTitle || '对接案例'}</h4>
          <div class="meta">供给：${supply} · 分 ${(m.totalScore != null ? (m.totalScore * 100).toFixed(0) : '-')}</div>
          <div class="reason">${m.reason || '公开脱敏预览，不会写入你的机构库。'}</div></div>`;
        })
        .join('') || '<div class="muted">暂时没有公开案例可预览</div>';
  };
}

/* M9 portal: field validation UX + match timeline + richer forms */
function fieldError(el, msg) {
  let tip = el.parentElement?.querySelector('.field-err');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'field-err badge-danger';
    tip.style.fontSize = '12px';
    tip.style.marginTop = '-6px';
    tip.style.marginBottom = '8px';
    el.parentElement?.insertBefore(tip, el.nextSibling);
  }
  tip.textContent = msg || '';
  tip.style.display = msg ? 'block' : 'none';
  el.style.borderColor = msg ? 'var(--danger)' : '';
}

function clearFieldErrors(root) {
  (root || document).querySelectorAll('.field-err').forEach((x) => (x.style.display = 'none'));
}

async function validateClient(kind, body) {
  try {
    const r = await api('/portal/validate/' + kind, { method: 'POST', body: JSON.stringify(body) });
    return r;
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
}

if (btnAddDem) {
  const prev = btnAddDem.onclick;
  btnAddDem.onclick = async () => {
    clearFieldErrors(btnAddDem.closest('.item') || document);
    const body = {
      title: demTitle.value,
      problem: demProblem.value,
      industry: demTags.value,
      budgetBand: demBudget?.value,
    };
    if (!body.title || body.title.trim().length < 2) return fieldError(demTitle, '标题至少 2 个字');
    if (!body.problem || body.problem.trim().length < 12) return fieldError(demProblem, '问题描述至少 12 个字');
    if (!String(demTags.value || '').trim()) return fieldError(demTags, '请填行业标签');
    const v = await validateClient('demand', body);
    if (!v.ok) {
      cardMsg.textContent = v.message || '校验未通过';
      return toast(v.message || '校验失败', 'err');
    }
    if (typeof prev === 'function') return prev();
  };
}
if (btnAddCap) {
  const prev = btnAddCap.onclick;
  btnAddCap.onclick = async () => {
    if (!capTitle.value || capTitle.value.trim().length < 2) return fieldError(capTitle, '标题至少 2 个字');
    if (!capSummary.value || capSummary.value.trim().length < 12) return fieldError(capSummary, '摘要至少 12 个字');
    if (!capKeywords.value.trim()) return fieldError(capKeywords, '请填关键词');
    const v = await validateClient('capability', {
      title: capTitle.value,
      summary: capSummary.value,
      keywords: capKeywords.value,
      disciplines: capDisc?.value,
    });
    if (!v.ok) return (cardMsg.textContent = v.message || '校验失败');
    if (typeof prev === 'function') return prev();
  };
}
if (btnAddOut) {
  const prev = btnAddOut.onclick;
  btnAddOut.onclick = async () => {
    if (!outTitle.value || outTitle.value.trim().length < 2) return fieldError(outTitle, '标题至少 2 个字');
    if (!outAbstract.value || outAbstract.value.trim().length < 12) return fieldError(outAbstract, '摘要至少 12 个字');
    const v = await validateClient('outcome', {
      title: outTitle.value,
      abstract: outAbstract.value,
      type: outType.value,
      ipcOrDisc: outTags?.value,
      trl: outTrl?.value,
    });
    if (!v.ok) return (cardMsg.textContent = v.message || '校验失败');
    if (typeof prev === 'function') return prev();
  };
}

// richer form hints
(function enrichForms() {
  const demBox = demTitle?.closest('.item');
  if (demBox && !document.getElementById('demExpected')) {
    const lab = document.createElement('label');
    lab.textContent = '期望产出（可选）';
    const inp = document.createElement('input');
    inp.id = 'demExpected';
    inp.placeholder = '例如：可试点工位原型 + 算法交接';
    demBudget?.parentElement?.insertBefore(lab, demBudget);
    demBudget?.parentElement?.insertBefore(inp, demBudget);
  }
  const capBox = capTitle?.closest('.item');
  if (capBox && !document.getElementById('capOffer')) {
    const lab = document.createElement('label');
    lab.innerHTML = '可提供形态 <span class="muted">联合研发/检测/中试/咨询</span>';
    const inp = document.createElement('input');
    inp.id = 'capOffer';
    inp.placeholder = '联合研发,检测';
    capDisc?.parentElement?.appendChild(lab);
    capDisc?.parentElement?.appendChild(inp);
  }
})();

async function openPortalTimeline(matchId) {
  let box = document.getElementById('portalTimeline');
  if (!box) {
    box = document.createElement('div');
    box.id = 'portalTimeline';
    box.className = 'item';
    box.style.marginTop = '12px';
    wsMatches?.parentElement?.insertBefore(box, wsMatches.nextSibling);
  }
  box.innerHTML = '<div class="muted">加载时间线…</div>';
  try {
    const t = await api('/portal/matches/' + matchId + '/timeline');
    const ev = (t.events || [])
      .map(
        (e) => `<div class="item" style="padding:10px">
        <div class="meta"><span class="timeline-dot"></span>${new Date(e.at).toLocaleString('zh-CN', { hour12: false })}</div>
        <h4 style="margin:0 0 4px;font-size:14px">${e.title}</h4>
        <div class="reason">${e.detail || ''}</div>
      </div>`,
      )
      .join('');
    box.innerHTML = `<h3 style="margin-top:0">对接时间线 · ${t.match?.demandTitle || ''} → ${t.match?.supplyTitle || ''}</h3>
      <div class="meta">${t.match?.statusLabel || ''} · 跟进 ${t.match?.followUpLabel || '未分派'} · 分 ${t.match?.totalScore != null ? Math.round(t.match.totalScore * 100) : '-'}</div>
      <div class="list" style="margin-top:8px">${ev || '<div class="muted">暂无事件</div>'}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="badge-danger">${e.message || e}</div>`;
  }
}

const _loadWsTimeline = loadWs;
loadWs = async function () {
  await _loadWsTimeline();
  // add timeline buttons on match cards
  document.querySelectorAll('#wsMatches .item').forEach((el) => {
    if (el.querySelector('[data-tl]')) return;
    const idBtn = el.querySelector('[data-fb-yes], [data-id], button');
    // try read match id from existing handlers by scraping data attributes
  });
  // re-render matches with timeline button if we can fetch workspace again
  try {
    const w = await api('/portal/workspace');
    if (!w || !w.matches) return;
    const host = document.getElementById('wsMatches');
    if (!host) return;
    const existing = host.innerHTML;
    // append timeline buttons by rewiring after default render — inject into cards via match ids
    (w.matches || []).forEach((m) => {
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = '看状态时间线';
      btn.style.marginTop = '6px';
      btn.onclick = () => openPortalTimeline(m.id);
      // find card containing title
      host.querySelectorAll('.item').forEach((card) => {
        if (card.textContent.includes(m.demand?.title || m.demandTitle || '___never___') && !card.querySelector('.tl-btn')) {
          btn.classList.add('tl-btn');
          card.appendChild(btn.cloneNode(true));
          card.querySelector('.tl-btn').onclick = () => openPortalTimeline(m.id);
        }
      });
    });
  } catch (_) {}
};

function toast(msg, kind) {
  // portal may not have toastHost
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || 'ok');
  el.textContent = String(msg);
  host.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* M10/M12/M13 我的对接 · 看板拖拽 */
let dealsViewMode = localStorage.getItem('yanqi_deals_mode') || 'board';
let lastDealUndo = null;

function dealColumnKey(m) {
  if (m.boardColumn) return m.boardColumn;
  const fu = m.followUpStatus || '';
  const st = m.status || '';
  if (fu === 'closed_won') return 'closed';
  if (fu === 'closed_lost' || st === 'REJECTED') return 'declined';
  if (st === 'CLOSED') return 'closed';
  if (fu === 'interested' || st === 'CONTACTED') return 'intent';
  if (fu === 'assigned' || fu === 'contacting' || st === 'APPROVED') return 'progress';
  return 'requested';
}

function showUndoToast(msg, undo) {
  toast(msg);
  lastDealUndo = undo || null;
  const host = document.getElementById('toastHost') || document.body;
  let bar = document.getElementById('dealUndoBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dealUndoBar';
    bar.className = 'item';
    bar.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:40;max-width:280px;box-shadow:0 8px 24px rgba(0,0,0,.35)';
    host.appendChild(bar);
  }
  if (!lastDealUndo) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  bar.innerHTML = `<div class="meta">${msg}</div><button id="btnUndoDealMove" class="ghost">撤销挪列</button>`;
  const b = document.getElementById('btnUndoDealMove');
  if (b) {
    b.onclick = async () => {
      try {
        const u = lastDealUndo;
        lastDealUndo = null;
        bar.style.display = 'none';
        await api('/portal/my-deals/' + u.matchId + '/move', {
          method: 'POST',
          body: JSON.stringify({ toColumn: u.toColumn, note: '撤销拖拽' }),
        });
        toast('已撤销');
        loadMyDeals();
      } catch (e) {
        toast(e.message || e, 'err');
      }
    };
  }
  setTimeout(() => {
    if (bar) bar.style.display = 'none';
  }, 8000);
}

function renderDealCard(m) {
  const actions = (m.allowedActions || [])
    .map((a) => {
      const label = { request_contact: '请求联系', confirm_interest: '确认有意向', decline: '婉拒关闭' }[a] || a;
      return `<button class="ghost" data-deal="${m.id}" data-act="${a}">${label}</button>`;
    })
    .join('');
  const chips = (m.conflictChips || [])
    .map((c) => `<span class="conflict-chip ${c.tone || 'warning'}" title="${(c.tip || '').replace(/"/g, '')}">${c.label}</span>`)
    .join('');
  const clPct = m.checklistPct != null ? m.checklistPct : null;
  const clWarn = m.checklistWarn
    ? `<span class="conflict-chip warning" title="${(m.checklistSummaryZh || '').replace(/"/g, '')}">清单 ${clPct}% · 关键未齐</span>`
    : clPct != null
      ? `<span class="cl-pct" title="${(m.checklistSummaryZh || '').replace(/"/g, '')}">合同前清单 ${clPct}%</span>`
      : '';
  return `<div class="deal-card item" draggable="true" tabindex="0" role="listitem" aria-grabbed="false" aria-label="对接卡片：${(m.demandTitle || '').replace(/"/g, '')}" data-card-id="${m.id}" data-from-col="${dealColumnKey(m)}" style="margin:0 0 8px;padding:10px;cursor:grab">
    <h4><span class="score">${Math.round((m.totalScore || 0) * 100)}分</span> ${m.demandTitle || ''} → ${m.supplyTitle || ''}</h4>
    <div class="meta">${m.statusLabel || ''} · ${m.followUpLabel || '还没分派'} · ${m.side === 'demand' ? '我是需求方' : '我是供给方'} · 经纪人 ${m.brokerName || '暂无'}</div>
    <div>${chips} ${clWarn}</div>
    <div class="reason" style="font-size:12px">${(m.reason || '暂无匹配说明').slice(0, 120)}</div>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
      <button class="ghost" data-tl-deal="${m.id}">看时间线</button>
      <button class="ghost" data-cl-deal="${m.id}">合同前清单</button>
      ${actions || '<span class="muted">这列暂时没有快捷按钮，可直接拖卡片</span>'}
    </div>
  </div>`;
}

function bindDealActions(root) {
  if (!root) return;
  root.querySelectorAll('[data-tl-deal]').forEach((b) => {
    b.onclick = () => openPortalTimeline(b.dataset.tlDeal);
  });
  root.querySelectorAll('[data-cl-deal]').forEach((b) => {
    b.onclick = async () => {
      try {
        const d = await api('/portal/my-deals/' + b.dataset.clDeal + '/checklist');
        const lines = (d.items || [])
          .map((it) => `${it.done ? '✓' : '○'} ${it.critical ? '[关键] ' : ''}${it.labelZh}${it.note ? ' · ' + it.note : ''}`)
          .join('\n');
        const tip = (d.summaryZh || '') + '\n\n' + lines + '\n\n输入要勾选的代码（如 ip_clear），取消则留空';
        const code = prompt(tip, '');
        if (!code) return;
        const item = (d.items || []).find((x) => x.code === code.trim());
        await api('/portal/my-deals/' + b.dataset.clDeal + '/checklist/' + code.trim(), {
          method: 'POST',
          body: JSON.stringify({ done: item ? !item.done : true }),
        });
        toast('清单已更新');
        loadMyDeals();
      } catch (e) {
        toast(e.message || e, 'err');
      }
    };
  });
  root.querySelectorAll('[data-deal]').forEach((b) => {
    b.onclick = async () => {
      const note = prompt('备注（可不填）') || '';
      try {
        let r = await api('/portal/my-deals/' + b.dataset.deal + '/action', {
          method: 'POST',
          body: JSON.stringify({ action: b.dataset.act, note }),
        });
        if (r && r.softBlock && r.needForce) {
          const ok = confirm((r.message || '关键清单未齐') + '\n\n仍要强制确认意向？');
          if (!ok) return;
          r = await api('/portal/my-deals/' + b.dataset.deal + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: b.dataset.act, note, force: true }),
          });
        }
        toast(r.message || '已提交');
        loadMyDeals();
      } catch (e) {
        toast(e.message || e, 'err');
      }
    };
  });
}

function bindDealDnD(board) {
  if (!board) return;
  board.querySelectorAll('[data-card-id]').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.cardId);
      e.dataTransfer.setData('application/x-from-col', card.dataset.fromCol || '');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  board.querySelectorAll('[data-col]').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const from = e.dataTransfer.getData('application/x-from-col');
      const to = col.dataset.col;
      if (!id || !to || from === to) return;
      const card = board.querySelector(`[data-card-id="${id}"]`);
      // optimistic: move DOM
      const body = col.querySelector('.deal-col-body') || col;
      if (card) body.prepend(card);
      try {
        let r = await api('/portal/my-deals/' + id + '/move', {
          method: 'POST',
          body: JSON.stringify({ toColumn: to, note: '看板拖拽' }),
        });
        if (r && r.softBlock && r.needForce) {
          const ok = confirm((r.message || '关键清单未齐') + '\n\n仍要拖到有意向？');
          if (!ok) {
            loadMyDeals();
            return;
          }
          r = await api('/portal/my-deals/' + id + '/move', {
            method: 'POST',
            body: JSON.stringify({ toColumn: to, note: '看板拖拽（强制）', force: true }),
          });
        }
        if (r.unchanged) return;
        showUndoToast(r.message || '已挪列', r.undo);
        loadMyDeals();
      } catch (err) {
        toast(err.message || err, 'err');
        loadMyDeals();
      }
    });
  });
  // M16：键盘 ← → 挪到相邻列
  const order = ['requested', 'progress', 'intent', 'closed', 'declined'];
  board.querySelectorAll('[data-card-id]').forEach((card) => {
    card.addEventListener('keydown', async (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const from = card.dataset.fromCol;
      const idx = order.indexOf(from);
      if (idx < 0) return;
      const to = order[ev.key === 'ArrowRight' ? Math.min(order.length - 1, idx + 1) : Math.max(0, idx - 1)];
      if (to === from) return;
      try {
        const r = await api('/portal/my-deals/' + card.dataset.cardId + '/move', {
          method: 'POST',
          body: JSON.stringify({ toColumn: to, note: '键盘挪列' }),
        });
        toast(r.message || '已挪列');
        loadMyDeals();
      } catch (err) {
        toast(err.message || err, 'err');
      }
    });
  });
}

async function loadMyDeals() {
  const list = document.getElementById('dealsList');
  const board = document.getElementById('dealsBoard');
  const hint = document.getElementById('dealsHint');
  if (!list && !board) return;
  if (list) list.innerHTML = '<div class="skeleton" style="height:48px;margin:8px 0"></div>';
  if (board) board.innerHTML = '<div class="skeleton" style="height:120px;margin:8px 0"></div><div class="skeleton" style="height:120px;margin:8px 0;width:80%"></div>';
  try {
    const d = await api('/portal/my-deals');
    const items = d.items || [];
    if (hint) hint.textContent = `一共 ${items.length} 条 · ${dealsViewMode === 'board' ? '拖卡片换列，错了可点撤销' : '列表模式'}`;

    const cols = [
      { key: 'requested', title: '待处理', tip: '刚对上或还在等运营' },
      { key: 'progress', title: '推进中', tip: '已通过 / 联系中' },
      { key: 'intent', title: '有意向', tip: '双方在往下谈' },
      { key: 'closed', title: '已成交/关闭', tip: '成了或正常关掉' },
      { key: 'declined', title: '已婉拒', tip: '不想继续这条' },
    ];
    const buckets = Object.fromEntries(cols.map((c) => [c.key, []]));
    for (const m of items) buckets[dealColumnKey(m)]?.push(m);

    if (board) {
      board.style.display = dealsViewMode === 'board' ? '' : 'none';
      board.innerHTML = cols
        .map((c) => {
          const cards = buckets[c.key].map(renderDealCard).join('') || '<div class="empty-state" style="padding:12px"><h3 style="font-size:13px;margin:0">这列是空的</h3><p style="margin:4px 0 0;font-size:12px">把卡片拖过来，或等运营推进。</p></div>';
          return `<div class="deal-col" data-col="${c.key}"><h3><span>${c.title}</span><span class="pill">${buckets[c.key].length}</span></h3><div class="muted" style="font-size:11px;margin-bottom:8px">${c.tip}</div><div class="deal-col-body">${cards}</div></div>`;
        })
        .join('');
      bindDealActions(board);
      bindDealDnD(board);
    }
    if (list) {
      list.style.display = dealsViewMode === 'list' ? '' : 'none';
      list.innerHTML =
        items.map(renderDealCard).join('') ||
        '<div class="empty-state"><h3>还没有对接</h3><p>先发一条需求或能力卡，再请运营跑一轮匹配。</p></div>';
      bindDealActions(list);
    }
  } catch (e) {
    if (list) list.innerHTML = `<div class="badge-danger">${e.message || e}</div>`;
    if (board) board.innerHTML = `<div class="badge-danger">${e.message || e}</div>`;
  }
}
const btnRefreshDeals = document.getElementById('btnRefreshDeals');
btnRefreshDeals && (btnRefreshDeals.onclick = () => loadMyDeals());
document.getElementById('btnDealsBoardMode') &&
  (document.getElementById('btnDealsBoardMode').onclick = () => {
    dealsViewMode = 'board';
    localStorage.setItem('yanqi_deals_mode', 'board');
    loadMyDeals();
  });
document.getElementById('btnDealsListMode') &&
  (document.getElementById('btnDealsListMode').onclick = () => {
    dealsViewMode = 'list';
    localStorage.setItem('yanqi_deals_mode', 'list');
    loadMyDeals();
  });

/* M11：我的对接密度提示 */
(function () {
  const tip = document.createElement('div');
  tip.id = 'm11DealHint';
  tip.className = 'muted';
  tip.style.cssText = 'font-size:12px;margin:6px 0 10px';
  tip.textContent = '卡片可以拖到别的列（有权限校验）。按钮还是那几个：请求联系、确认意向、婉拒。点「有用/不准」也会微调匹配权重。';
  const boot = () => {
    const host = document.querySelector('#view-my-deals .page-head, #myDeals, [data-view="my-deals"]') || document.getElementById('myDealsList');
    if (host && !document.getElementById('m11DealHint')) {
      host.parentElement ? host.parentElement.insertBefore(tip, host) : host.prepend(tip);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 500);
})();


/* M14：协作邀请 + 白标已由 branding.js 处理 */
async function refreshTeamInvites() {
  const box = document.getElementById('teamInviteBox');
  if (!box) return;
  const role = window.__portalUser?.role;
  if (role === 'TENANT_ADMIN' || role === 'ADMIN' || role === 'OPERATOR') {
    box.style.display = '';
  } else {
    box.style.display = 'none';
    return;
  }
  try {
    const d = await api('/team/invites');
    const list = document.getElementById('teamInvList');
    list.innerHTML =
      (d.items || [])
        .map(
          (i) =>
            `<div class="item"><div class="meta">${i.email} · ${i.role} · ${i.status}</div>
            ${i.status === 'pending' ? `<button class="ghost" data-rev-inv="${i.id}">撤销</button>` : ''}</div>`,
        )
        .join('') || '<div class="muted">还没有邀请</div>';
    list.querySelectorAll('[data-rev-inv]').forEach((b) => {
      b.onclick = async () => {
        await api('/team/invites/' + b.dataset.revInv + '/revoke', { method: 'POST', body: '{}' });
        toast('已撤销');
        refreshTeamInvites();
      };
    });
  } catch (e) {
    document.getElementById('teamInvMsg').textContent = e.message || e;
  }
}
document.getElementById('btnCreateTeamInv') &&
  (document.getElementById('btnCreateTeamInv').onclick = async () => {
    try {
      const r = await api('/team/invites', {
        method: 'POST',
        body: JSON.stringify({
          email: teamInvEmail.value.trim(),
          name: teamInvName.value.trim(),
          role: teamInvRole.value,
        }),
      });
      teamInvCopy.value = r.copyText || r.acceptUrl || '';
      teamInvMsg.textContent = r.message || '已生成';
      toast('邀请链接已生成，复制发给同事');
      refreshTeamInvites();
    } catch (e) {
      teamInvMsg.textContent = e.message || e;
      toast(e.message || e, 'err');
    }
  });
document.getElementById('btnRefreshTeamInv') &&
  (document.getElementById('btnRefreshTeamInv').onclick = () => refreshTeamInvites());

// stash user role when who updates
const __whoEl = document.getElementById('who');
if (__whoEl) {
  const obs = new MutationObserver(() => {
    /* noop — portal.js sets who text; we hook login success below */
  });
  obs.observe(__whoEl, { childList: true, characterData: true, subtree: true });
}
const _origApi = typeof api === 'function' ? api : null;
// after login pages, try refresh — hook setWho if exists
if (typeof setWho === 'function') {
  const _sw = setWho;
  setWho = function (u) {
    window.__portalUser = u;
    _sw.apply(this, arguments);
    refreshTeamInvites().catch(() => {});
  };
} else {
  // poll me
  setTimeout(async () => {
    try {
      const me = await api('/auth/me');
      window.__portalUser = me.user || me;
      refreshTeamInvites();
    } catch (_) {}
  }, 1200);
}


/* M16 用量 + PWA 开关 */
async function loadPortalUsage() {
  const panel = document.getElementById('usagePanel');
  const ws = document.getElementById('wsUsage');
  if (!panel && !ws) return;
  try {
    const snap = await api('/portal/usage');
    const html =
      (snap.items || [])
        .map((it) => {
          const cls = it.level === 'ok' ? '' : it.level;
          const hint = it.hintZh
            ? `<div class="usage-hint ${it.level === 'exhausted' || it.level === 'critical' ? 'bad' : ''}">${it.hintZh}</div>`
            : '';
          return `<div class="item"><h4>${it.labelZh} · ${it.used}/${it.limit}</h4>
            <div class="usage-meter ${cls}" aria-hidden="true"><i style="width:${Math.min(100, it.pct || 0)}%"></i></div>
            ${hint}</div>`;
        })
        .join('') || `<div class="muted">${snap.message || '登录后可看本月用量'}</div>`;
    if (panel) panel.innerHTML = `<div class="meta">${snap.summaryZh || ''} · ${snap.planName || ''}</div>` + html;
    if (ws) ws.innerHTML = `<h3>本月用量</h3>` + html;
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="muted">登录后可看用量（${e.message || e}）</div>`;
  }
}

(async function respectPwaFlag() {
  try {
    const pack = await fetch('/api/flags').then((r) => r.json());
    const pwa = (pack.flags || []).find((f) => f.key === 'pwa');
    if (pwa && !pwa.enabled && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      console.info('[yanqi] pwa flag off — SW unregistered');
    }
  } catch (_) {}
})();


async function loadPortalCases() {
  const tax = document.getElementById('caseTaxFilter')?.value?.trim() || '';
  const outcome = document.getElementById('caseOutcomeFilter')?.value || '';
  const qs = new URLSearchParams();
  if (tax) qs.set('taxonomy', tax);
  if (outcome) qs.set('outcome', outcome);
  const d = await api('/cases/public' + (qs.toString() ? '?' + qs : ''));
  const box = document.getElementById('portalCaseList');
  if (!box) return;
  box.innerHTML = (d.items || [])
    .map(
      (c) => `<div class="item">
      <h4>${c.title}</h4>
      <div class="meta">${c.outcome} · ${c.demandAlias || ''} × ${c.supplyAlias || ''}
        · ${(c.taxonomyCodes || []).join('、') || '无标签'} · TRL ${c.trlBand || '—'}</div>
      <p>${c.summaryZh || ''}</p>
      <div class="reason" style="font-size:12px;white-space:pre-wrap">${(c.detailZh || '').slice(0, 400)}</div>
    </div>`,
    )
    .join('') || '<p class="muted">还没有已发布的脱敏案例。运营审批后会出现在这里。</p>';
}
document.getElementById('btnLoadCases') &&
  (document.getElementById('btnLoadCases').onclick = () => loadPortalCases().catch((e) => toast(e.message || e, 'err')));

/* M25：一句话发需求（高置信直接发，缺项高亮） */
window.__portalOneLineDraft = null;
window.__portalOneLineUndo = null;
function __fillDemFromDraft(d) {
  const titleEl = document.getElementById('demTitle');
  const problemEl = document.getElementById('demProblem');
  const budgetEl = document.getElementById('demBudget');
  const tagsEl = document.getElementById('demTags');
  const lic = document.getElementById('demLicenseNeed');
  const trl = document.getElementById('demMinTrl');
  if (titleEl) titleEl.value = d.title || '';
  if (problemEl) problemEl.value = d.problem || '';
  if (budgetEl) budgetEl.value = d.budgetBand || '';
  if (tagsEl) tagsEl.value = (d.industry || []).join(',');
  if (lic && d.licenseNeed) lic.value = d.licenseNeed;
  if (trl && d.minTrl != null) trl.value = String(d.minTrl);
}
function __paintOneLineHints(r) {
  const host = document.getElementById('portalOneLineHints');
  const ta = document.getElementById('portalOneLine');
  if (ta) {
    ta.style.outline = r.thin || r.confidence === 'low' ? '2px solid #c45' : r.confidence === 'high' ? '2px solid #2a7' : '';
  }
  if (!host) return;
  const chips = [];
  const hints = r.hints || [];
  const mark = (key, label, missing) => {
    chips.push(
      `<span style="padding:2px 8px;border-radius:999px;font-size:12px;background:${missing ? '#fde8e8' : '#e8f6ee'};color:${missing ? '#a33' : '#185'}">${missing ? '缺·' : '有·'}${label}</span>`,
    );
  };
  const d = r.draft || {};
  mark('org', '单位', !d.orgName);
  mark('budget', '预算', !d.budgetBand);
  mark('problem', '要解决啥', !(d.problem && String(d.problem).length >= 12));
  mark('industry', '行业词', !(d.industry && d.industry.length));
  host.innerHTML = chips.join(' ') + (hints.length ? `<div class="muted" style="width:100%;font-size:12px;margin-top:4px">${hints.map((h) => '· ' + h).join('<br/>')}</div>` : '');
}
async function __publishOneLine(text, force) {
  return api('/portal/demands/publish-one-line', {
    method: 'POST',
    body: JSON.stringify({ text, force: Boolean(force) }),
  });
}
document.getElementById('btnOneLinePreview') &&
  (document.getElementById('btnOneLinePreview').onclick = async () => {
    const text = document.getElementById('portalOneLine')?.value || '';
    if (text.trim().length < 8) return toast('多写两句再预览', 'warn');
    const r = await api('/portal/demands/parse-one-line', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    window.__portalOneLineDraft = {
      text,
      draft: r.draft,
      hints: r.hints || [],
      thin: r.thin,
      confidence: r.confidence || (r.thin ? 'low' : 'medium'),
    };
    __paintOneLineHints(r);
    document.getElementById('portalOneLineOut').textContent =
      (r.message ? r.message + '\n' : '') +
      '置信：' + (r.confidence || '-') +
      '\n标题：' + (r.draft?.title || '') +
      '\n问题：' + (r.draft?.problem || '') +
      '\n预算：' + (r.draft?.budgetBand || '未识别') +
      '\n标签：' + ((r.draft?.industry || []).join('、') || '待补') +
      '\n' + (r.noteZh || '');
    const pub = document.getElementById('btnOneLinePublish');
    if (pub) {
      pub.disabled = false;
      pub.textContent = r.confidence === 'high' ? '直接发布' : '确认并发布';
    }
    toast(r.confidence === 'high' ? '信息够清楚，可直接发布' : r.thin ? (r.message || '信息有点薄') : '草稿好了');
  });
document.getElementById('btnOneLinePublish') &&
  (document.getElementById('btnOneLinePublish').onclick = async () => {
    const text =
      window.__portalOneLineDraft?.text ||
      document.getElementById('portalOneLine')?.value ||
      '';
    if (text.trim().length < 8) return toast('先写一句话', 'warn');
    const conf = window.__portalOneLineDraft?.confidence;
    const pub = document.getElementById('btnOneLinePublish');
    const force = conf === 'high' || window.__portalForceArmed === true;
    let r = await __publishOneLine(text, force);
    if (!r.ok && !r.demand && r.canForce && !force) {
      __paintOneLineHints(r);
      const out = document.getElementById('portalOneLineOut');
      if (out) {
        out.textContent = (r.message || '信息偏薄') + '\n' + (r.hints || []).map((h) => '· ' + h).join('\n');
      }
      if (pub) pub.textContent = '仍要发布';
      window.__portalForceArmed = true;
      return toast('缺项已标红，补两句或再点一次「仍要发布」');
    }
    if (!r.ok && !r.demand) {
      __paintOneLineHints(r);
      return toast(r.message || '发布失败', 'err');
    }
    const demId = r.demand?.id;
    window.__portalOneLineUndo = demId;
    toast(r.noteZh || '已发布');
    const out = document.getElementById('portalOneLineOut');
    if (out) {
      out.innerHTML = '';
      out.textContent =
        '已发布：' + (r.demand?.title || '') + '（编号 ' + (demId || '') + '）';
      if (demId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost';
        btn.style.marginLeft = '8px';
        btn.textContent = '撤消（删除刚发的）';
        btn.onclick = async () => {
          try {
            await api('/portal/demands/' + demId, { method: 'DELETE' });
            toast('已撤消');
            out.textContent = '已撤消刚才那条需求';
            window.__portalOneLineUndo = null;
            if (typeof loadWorkspace === 'function') loadWorkspace().catch(() => {});
          } catch (e) {
            toast(e.message || e, 'err');
          }
        };
        out.appendChild(btn);
      }
    }
    document.getElementById('btnOneLinePublish').disabled = true;
    document.getElementById('btnOneLinePublish').textContent = '确认并发布';
    window.__portalOneLineDraft = null;
    window.__portalForceArmed = false;
    if (typeof loadWorkspace === 'function') loadWorkspace().catch(() => {});
  });
document.getElementById('btnPortalParse') &&
  (document.getElementById('btnPortalParse').onclick = async () => {
    const text = document.getElementById('portalOneLine')?.value || '';
    if (text.trim().length < 8) return toast('多写两句再拆', 'warn');
    const r = await api('/portal/demands/parse-one-line', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    __paintOneLineHints(r);
    __fillDemFromDraft(r.draft || {});
    toast('已填进详细表单，可改完再点「发布需求」');
  });
