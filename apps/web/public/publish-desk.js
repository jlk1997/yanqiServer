(function () {
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function refreshPublishDesk() {
    const box = document.getElementById('publishDesk');
    const queue = document.getElementById('deskQueue');
    if (!box || typeof api !== 'function') return;
    const desk = await api('/ingest/desk');
    const clean = desk.columns?.cleaning || {};
    const slices = desk.columns?.slices || [];
    const stageZh = desk.stageZh || {};
    box.innerHTML = `
      <article class="item"><h3>待清洗</h3><p>未处理草稿 ${esc(clean.pendingParsed || 0)} 条 · 进行中的批次 ${esc(clean.runningBatches || 0)}</p></article>
      <article class="item"><h3>未发布</h3><p>${esc((desk.queue || []).length)} 条还不能进门户和匹配</p></article>
      <article class="item"><h3>产业切片</h3><p>${slices.length ? slices.map((s) => `${esc(s.taxonomyCode)} · ${esc(stageZh[s.stage] || s.stage)} · 老师 ${esc(s.teacherCount)} · 需求 ${esc(s.demandCount)}`).join('<br>') : '还没有可计算的行业切片'}</p>${(desk.pausedSlices || []).map((s) => `<p>${esc(s.note || '找人已暂停')} <button type="button" data-resume-slice="${esc(s.key)}">恢复找人</button></p>`).join('')}</article>
    `;
    box.querySelectorAll('[data-resume-slice]').forEach((btn) => {
      btn.onclick = async () => {
        const r = await api('/ingest/slices/resume', { method: 'POST', body: JSON.stringify({ key: btn.dataset.resumeSlice }) });
        alert(r.message || (r.ok ? '已恢复' : '没有恢复'));
        refreshPublishDesk().catch((e) => alert(e.message || e));
      };
    });
    if (!queue) return;
    queue.innerHTML = (desk.queue || []).map((row) => `
      <div class="item">
        <h4>${esc(row.title)}</h4>
        <div class="meta">${esc(row.org || '未挂机构')} · ${esc(row.publishStatus)}</div>
        <div class="reason">${esc((row.blockerZh || []).join('；') || '等待重判')}</div>
        <div class="row">
          <button type="button" data-publish="${esc(row.entityType)}:${esc(row.id)}">确认发布</button>
          <button type="button" class="ghost" data-hold="${esc(row.entityType)}:${esc(row.id)}">继续不发布</button>
        </div>
      </div>
    `).join('') || '<div class="muted">没有待发布的档案。</div>';
    queue.querySelectorAll('[data-publish]').forEach((btn) => {
      btn.onclick = async () => {
        const [entityType, entityId] = btn.dataset.publish.split(':');
        await api('/ingest/publish', { method: 'POST', body: JSON.stringify({ entityType, entityId, status: 'published' }) });
        refreshPublishDesk().catch((e) => alert(e.message || e));
      };
    });
    queue.querySelectorAll('[data-hold]').forEach((btn) => {
      btn.onclick = async () => {
        const [entityType, entityId] = btn.dataset.hold.split(':');
        await api('/ingest/publish', { method: 'POST', body: JSON.stringify({ entityType, entityId, status: 'canonical' }) });
        refreshPublishDesk().catch((e) => alert(e.message || e));
      };
    });
    const gaps = document.getElementById('deskGaps');
    if (gaps) {
      gaps.innerHTML = (desk.gaps || []).map((g) => `
        <div class="item">
          <h4>${esc(g.demandTitle)} → ${esc(g.supplyTitle)}</h4>
          <div class="meta">${esc(g.teacherName || '还没有老师')} · ${esc(g.reasonZh || g.reason)}</div>
          <div class="reason">${esc(g.note || '补上联系点后才会生成草稿，不会自动发出。')}</div>
          <div class="row">
            ${g.teacherName ? '' : `<input data-gap-name="${esc(g.id)}" aria-label="老师姓名" placeholder="老师姓名" />`}
            <input data-gap-email="${esc(g.id)}" aria-label="邮箱" placeholder="邮箱" />
            <input data-gap-phone="${esc(g.id)}" aria-label="电话" placeholder="电话" />
            <button type="button" data-fill-gap="${esc(g.id)}">补上并生成草稿</button>
          </div>
        </div>
      `).join('') || '<div class="muted">没有待补的联系人缺口。</div>';
      gaps.querySelectorAll('[data-fill-gap]').forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.fillGap;
          const email = gaps.querySelector('[data-gap-email="' + id + '"]')?.value || '';
          const phone = gaps.querySelector('[data-gap-phone="' + id + '"]')?.value || '';
          const personName = gaps.querySelector('[data-gap-name="' + id + '"]')?.value || '';
          const r = await api('/matches/contact-gaps/' + id + '/fill', {
            method: 'POST',
            body: JSON.stringify({ email, phone, personName }),
          });
          alert(r.message || (r.ok ? '已补上' : '没有补上'));
          refreshPublishDesk().catch((e) => alert(e.message || e));
        };
      });
    }
    const dupes = document.getElementById('deskDupes');
    if (dupes) {
      dupes.innerHTML = (desk.dupes || []).map((g, i) => `
        <div class="item">
          <h4>${esc(g.name)} · ${esc(g.org)}</h4>
          <div class="row">
            <label>保留 <select data-dupe-keep="${i}">${g.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} ${esc(p.email || '无邮箱')}</option>`).join('')}</select></label>
            <label>并入 <select data-dupe-drop="${i}">${g.people.map((p, n) => `<option value="${esc(p.id)}"${n === 1 ? ' selected' : ''}>${esc(p.name)} ${esc(p.email || '无邮箱')}</option>`).join('')}</select></label>
            <button type="button" data-merge="${i}">合并为保留的那位</button>
          </div>
        </div>
      `).join('') || '<div class="muted">没有待合并的同名老师。</div>';
      dupes.querySelectorAll('[data-merge]').forEach((btn) => {
        btn.onclick = async () => {
          const i = btn.dataset.merge;
          const keepId = dupes.querySelector('[data-dupe-keep="' + i + '"]')?.value;
          const dropId = dupes.querySelector('[data-dupe-drop="' + i + '"]')?.value;
          const r = await api('/ingest/persons/merge', { method: 'POST', body: JSON.stringify({ keepId, dropId }) });
          alert(r.message || (r.ok ? '已合并' : '没有合并'));
          refreshPublishDesk().catch((e) => alert(e.message || e));
        };
      });
    }
  }

  document.getElementById('btnDeskRefresh')?.addEventListener('click', () => {
    refreshPublishDesk().catch((e) => alert(e.message || e));
  });
  document.getElementById('btnDeskRejudge')?.addEventListener('click', async () => {
    await api('/ingest/rejudge', { method: 'POST', body: '{}' });
    await refreshPublishDesk();
  });
  document.getElementById('btnDeskClean')?.addEventListener('click', async () => {
    await api('/ingest/pipeline/run', { method: 'POST', body: '{}' });
    await refreshPublishDesk();
  });
  document.querySelector('[data-tab="flywheel"]')?.addEventListener('click', () => {
    refreshPublishDesk().catch(() => {});
  });
})();
