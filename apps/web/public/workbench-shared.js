/** M48 工作台共享：SSE 短票 path 绑定、壳侧续跑卡、冲突预览/CSV、阶段文案、写后 bust */
window.YB = {
  _etagCache: new Map(),
  token: localStorage.getItem('yanqi_token') || '',
  demos: [
    { login: 'enterprise', label: '企业', shell: 'enterprise' },
    { login: 'uni', label: '高校', shell: 'research' },
    { login: 'broker', label: '经纪人', shell: 'broker' },
    { login: 'park', label: '园区', shell: 'guest' },
    { login: 'admin', label: '运营', shell: 'ops' },
  ],
  ensureFeedbackHosts() {
    if (!document.getElementById('toastHost')) {
      const h = document.createElement('div');
      h.id = 'toastHost';
      h.setAttribute('aria-live', 'polite');
      h.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(h);
    }
    if (!document.getElementById('ybBusyBar')) {
      const b = document.createElement('div');
      b.id = 'ybBusyBar';
      b.hidden = true;
      b.setAttribute('role', 'status');
      b.innerHTML = '<span class="yb-busy-spin" aria-hidden="true"></span><span class="yb-busy-text">处理中…</span><span class="yb-busy-pct" hidden></span>';
      document.body.appendChild(b);
    }
    if (!document.getElementById('ybSecurityBanner')) {
      const s = document.createElement('div');
      s.id = 'ybSecurityBanner';
      s.hidden = true;
      s.setAttribute('role', 'alert');
      document.body.appendChild(s);
    }
    if (!document.getElementById('ybProgressPanel')) {
      const p = document.createElement('div');
      p.id = 'ybProgressPanel';
      p.hidden = true;
      p.className = 'yb-progress-panel feedback-m41';
      p.setAttribute('role', 'status');
      p.innerHTML =
        '<div class="yb-progress-head"><strong class="yb-progress-title">任务进度</strong>' +
        '<button type="button" class="ghost yb-progress-cancel" hidden>取消</button></div>' +
        '<div class="yb-progress-phase muted" hidden></div>' +
        '<div class="yb-progress-bar" aria-hidden="true"><i class="yb-progress-fill"></i></div>' +
        '<div class="yb-progress-meta muted"></div>' +
        '<div class="yb-progress-actions" style="margin-top:8px;display:none"></div>';
      document.body.appendChild(p);
    }
  },
  toast(msg, kind = 'ok', ms) {
    YB.ensureFeedbackHosts();
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'ok');
    el.textContent = String(msg || '').slice(0, 280);
    host.appendChild(el);
    const ttl = ms != null ? ms : kind === 'err' || kind === 'security' ? 5200 : 2800;
    setTimeout(() => el.remove(), ttl);
  },
  securityBanner(msg, kind = 'security') {
    YB.ensureFeedbackHosts();
    const el = document.getElementById('ybSecurityBanner');
    el.hidden = false;
    el.className = 'yb-security-banner ' + kind;
    el.textContent = String(msg || '');
    clearTimeout(YB._secBannerTimer);
    YB._secBannerTimer = setTimeout(() => {
      el.hidden = true;
    }, 8000);
  },
  busy(on, text, percent) {
    YB.ensureFeedbackHosts();
    const bar = document.getElementById('ybBusyBar');
    if (!on) {
      bar.hidden = true;
      document.body.classList.remove('yb-busy');
      return;
    }
    bar.hidden = false;
    document.body.classList.add('yb-busy');
    const t = bar.querySelector('.yb-busy-text');
    if (t) t.textContent = text || '处理中，请稍候…';
    const p = bar.querySelector('.yb-busy-pct');
    if (p) {
      if (percent == null || Number.isNaN(Number(percent))) {
        p.hidden = true;
      } else {
        p.hidden = false;
        p.textContent = Math.max(0, Math.min(100, Math.round(Number(percent)))) + '%';
      }
    }
  },
  debounce(fn, wait) {
    let timer;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait == null ? 320 : wait);
    };
  },
  _idemKey() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return 'ik-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  },
  async api(path, opts = {}) {
    YB.ensureFeedbackHosts();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (YB.token) headers['Authorization'] = 'Bearer ' + YB.token;
    const key = localStorage.getItem('yanqi_api_key');
    if (key) headers['X-API-Key'] = key;
    const method = String(opts.method || 'GET').toUpperCase();
    if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && !headers['Idempotency-Key'] && !headers['idempotency-key']) {
      headers['Idempotency-Key'] = YB._idemKey();
    }
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : path.includes('/matches/run') || path.includes('/imports') || path.includes('/jobs/') ? 90000 : 20000;
    const ctrl = opts.signal ? null : new AbortController();
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const quiet = Boolean(opts.quiet);
    const showBusy = opts.busy === true || (opts.busy !== false && method !== 'GET');
    if (showBusy) YB.busy(true, opts.busyText || (method === 'GET' ? '加载中…' : '提交中…'));
    if (opts.ifNoneMatch) {
      headers['If-None-Match'] = opts.ifNoneMatch;
    } else if (opts.useEtagCache) {
      const hit = YB._etagCache && YB._etagCache.get(path);
      if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
    }
    let r;
    try {
      r = await fetch('/api' + path, {
        ...opts,
        headers,
        credentials: 'include',
        signal: opts.signal || (ctrl && ctrl.signal),
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (showBusy) YB.busy(false);
      const aborted = e && (e.name === 'AbortError' || String(e.message || '').includes('abort'));
      const msg = aborted ? '请求超时，请稍后重试（网络慢或任务较重）' : e.message || '网络异常';
      if (!quiet) YB.toast(msg, 'err');
      const err = new Error(msg);
      err.code = aborted ? 'TIMEOUT' : 'NETWORK';
      throw err;
    }
    if (timer) clearTimeout(timer);
    if (showBusy) YB.busy(false);
    const ct = r.headers.get('content-type') || '';
    if (r.status === 304 && opts.useEtagCache && YB._etagCache) {
      const hit = YB._etagCache.get(path);
      if (showBusy) YB.busy(false);
      if (hit && hit.body != null) {
        if (opts.successToast) YB.toast(opts.successToast, 'ok');
        return typeof hit.body === 'object' ? Object.assign({}, hit.body, { cache: 'NOT_MODIFIED' }) : hit.body;
      }
    }
    const body = ct.includes('application/json') ? await r.json().catch(() => ({})) : await r.text();
    const etagHdr = r.headers.get('etag');
    if (etagHdr && opts.useEtagCache) {
      if (!YB._etagCache) YB._etagCache = new Map();
      YB._etagCache.set(path, { etag: etagHdr, body, at: Date.now() });
      if (YB._etagCache.size > 80) {
        const first = YB._etagCache.keys().next().value;
        YB._etagCache.delete(first);
      }
    }
    if (!r.ok) {
      const msg =
        (body && (body.message || body.hintZh || body.messageZh)) ||
        (typeof body === 'string' ? body : r.statusText) ||
        '请求失败';
      if (r.status === 401) {
        if (!quiet) {
          YB.toast('登录已失效，请重新登录', 'security');
          YB.securityBanner('安全提示：未登录或会话过期（401）。请重新登录后再操作。', 'security');
        }
        if (!opts.noRedirectOn401) {
          try {
            localStorage.removeItem('yanqi_token');
          } catch (_) {}
          setTimeout(() => {
            location.href = '/';
          }, 600);
        }
      } else if (r.status === 403) {
        if (!quiet) {
          YB.toast('没有权限做这件事', 'security');
          YB.securityBanner('安全提示：当前身份无权（403）。可切演示号或联系运营开通。', 'security');
        }
      } else if (r.status === 429) {
        const ra = (body && body.retryAfterSec) || r.headers.get('Retry-After') || 60;
        if (!quiet) YB.toast('操作太快了，请 ' + ra + ' 秒后再试', 'warn');
      } else if (!quiet) {
        YB.toast(String(msg).slice(0, 200), 'err');
      }
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      err.status = r.status;
      err.body = body;
      throw err;
    }
    if (opts.successToast) YB.toast(opts.successToast, 'ok');
    // M43：五壳写操作统一打穿工作台 home 短缓存（少漏网）
    const mutating = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
    const skipBust =
      opts.noBust === true ||
      opts.bustHome === false ||
      path.indexOf('/workbench/home/bust') === 0 ||
      path.indexOf('/auth/login') === 0 ||
      path.indexOf('/auth/logout') === 0 ||
      path.indexOf('/jobs/progress') >= 0 ||
      path.indexOf('/progress') >= 0;
    if (mutating && !skipBust) {
      try {
        YB.bustHomeCache();
      } catch (_) {}
    }
    return body;
  },
  /** M46–M48：优先 mint 一次性 sse_ticket（streamPath + 可选 jobId）；失败再退回 access_token */
  async withSseAuth(url) {
    const base = String(url || '');
    let streamPath = base;
    let jobId = null;
    try {
      if (/^https?:\/\//i.test(base)) {
        const u = new URL(base);
        streamPath = u.pathname;
        jobId = u.searchParams.get('id') || u.searchParams.get('jobId');
      } else {
        streamPath = String(base).split('?')[0];
        const qs = String(base).includes('?') ? String(base).split('?')[1] : '';
        const sp = new URLSearchParams(qs);
        jobId = sp.get('id') || sp.get('jobId');
      }
      if (streamPath && !streamPath.startsWith('/')) streamPath = '/' + streamPath;
      if (streamPath.startsWith('/jobs/') || streamPath.startsWith('/imports/')) streamPath = '/api' + streamPath;
      if (!jobId) {
        const m = /\/jobs\/([^/]+)\/progress/.exec(streamPath);
        if (m && m[1] !== 'progress') jobId = m[1];
      }
    } catch (_) {
      streamPath = String(base).split('?')[0];
    }
    try {
      const body = { purpose: 'sse-progress', streamPath: streamPath };
      if (jobId) body.jobId = jobId;
      const r = await YB.api('/jobs/sse-ticket', {
        method: 'POST',
        body: JSON.stringify(body),
        quiet: true,
        busy: false,
        noBust: true,
      });
      if (r && r.ticket) {
        const join = base.includes('?') ? '&' : '?';
        return base + join + 'sse_ticket=' + encodeURIComponent(r.ticket);
      }
    } catch (_) {}
    try {
      const tok = YB.token || localStorage.getItem('yanqi_token') || '';
      if (!tok) return base;
      const join = base.includes('?') ? '&' : '?';
      return base + join + 'access_token=' + encodeURIComponent(tok);
    } catch (_) {
      return base;
    }
  },
  /** 同步兜底（仅旧调用）；新代码请 await withSseAuth */
  withSseAuthSync(url) {
    try {
      const tok = YB.token || localStorage.getItem('yanqi_token') || '';
      if (!tok) return url;
      const join = String(url).includes('?') ? '&' : '?';
      return String(url) + join + 'access_token=' + encodeURIComponent(tok);
    } catch (_) {
      return url;
    }
  },
  /** M45：统一续跑任务卡（冷静：进度/取消/续跑/合并策略） */
  async loadResumeCards(mountEl, opts = {}) {
    const el = typeof mountEl === 'string' ? document.getElementById(mountEl) : mountEl;
    if (!el) return null;
    el.setAttribute('aria-busy', 'true');
    try {
      const q = [];
      if (opts.limit) q.push('limit=' + encodeURIComponent(opts.limit));
      if (opts.shell) q.push('shell=' + encodeURIComponent(opts.shell));
      if (opts.kinds) q.push('kinds=' + encodeURIComponent(opts.kinds));
      const data = await YB.api('/jobs/resume-cards' + (q.length ? '?' + q.join('&') : ''), {
        quiet: true,
        busy: false,
      });
      YB.renderResumeCards(el, data, opts);
      return data;
    } catch (e) {
      el.innerHTML = '<p class="muted">续跑任务卡加载失败：' + (e.message || e) + '</p>';
      return null;
    } finally {
      el.removeAttribute('aria-busy');
    }
  },
  renderResumeCards(el, data, opts = {}) {
    if (!el) return;
    const cards = (data && data.cards) || [];
    if (!cards.length) {
      el.innerHTML =
        '<div class="item resume-card empty-calm"><p class="muted" style="margin:0">' +
        ((data && data.emptyZh) || '暂无进行中或可续跑任务') +
        '</p></div>';
      return;
    }
    el.innerHTML = cards
      .map((c) => {
        const pct = c.percent == null ? '' : Math.round(Number(c.percent)) + '%';
        const strat =
          c.kind === 'import'
            ? '<label class="muted resume-merge">策略 <select data-card-id="' +
              c.id +
              '" class="resume-merge-select">' +
              ['fill-empty', 'skip', 'overwrite']
                .map((s) => {
                  const labels = { 'fill-empty': '仅补空', skip: '跳过已有', overwrite: '覆盖已有' };
                  return (
                    '<option value="' +
                    s +
                    '"' +
                    (c.mergeStrategy === s ? ' selected' : '') +
                    '>' +
                    labels[s] +
                    '</option>'
                  );
                })
                .join('') +
              '</select></label>'
            : '';
        const previewBtn =
          c.kind === 'import' && c.resumeAvailable
            ? '<button type="button" class="ghost resume-preview-btn" data-id="' +
              c.id +
              '">冲突预览</button>'
            : '';
        const csvBtn =
          c.kind === 'import' && c.resumeAvailable
            ? '<button type="button" class="ghost resume-csv-btn" data-id="' +
              c.id +
              '">导出预览 CSV</button>'
            : '';
        const fullCsvBtn =
          c.kind === 'import' && c.resumeAvailable
            ? '<button type="button" class="ghost resume-full-csv-btn" data-id="' +
              c.id +
              '">全量 CSV</button>'
            : '';
        const fullZipBtn =
          c.kind === 'import' && c.resumeAvailable
            ? '<button type="button" class="ghost resume-full-zip-btn" data-id="' +
              c.id +
              '">全量 ZIP</button>'
            : '';
        const cancelBtn = c.cancelPath
          ? '<button type="button" class="ghost resume-cancel-btn" data-path="' +
            c.cancelPath +
            '">取消</button>'
          : '';
        const resumeBtn = c.resumeAvailable
          ? '<button type="button" class="resume-go-btn" data-kind="' +
            c.kind +
            '" data-id="' +
            c.id +
            '" data-path="' +
            (c.resumePath || '') +
            '">续跑</button>'
          : '';
        const rc = c.resumeCursor || {};
        const confirmOnlyBtn =
          c.kind === 'import' && c.resumeAvailable && c.confirmOnlyResumePath
            ? '<button type="button" class="ghost resume-confirm-only-btn m72-cp-jobcard-resume" data-kind="' +
              c.kind +
              '" data-id="' +
              c.id +
              '" data-path="' +
              (c.confirmOnlyResumePath || c.resumePath || '') +
              '" data-bucket="' +
              (rc.bucket || '') +
              '" data-page-cursor="' +
              (rc.pageCursor || '') +
              '" data-slim-offset="' +
              (rc.slimOffset != null ? rc.slimOffset : '') +
              '" data-slim-limit="' +
              (rc.slimLimit != null ? rc.slimLimit : '') +
              '" data-conflict-types="' +
              ((rc.conflictTypes || []).join(',') || '') +
              '">' +
              (c.confirmOnlyResumeLabelZh || '仅确认行续跑（带桶/游标）') +
              '</button>'
            : '';
        const bucketCursorZh =
          c.kind === 'import' && c.resumeAvailable
            ? '<p class="muted m72-jobcard-bucket-cursor" style="margin:4px 0 0;font-size:12px">' +
              ((c.undecidedBuckets && c.undecidedBuckets.tipZh) || '') +
              (rc.tipZh ? ' · ' + rc.tipZh : '') +
              (rc.bucket ? ' · 桶 ' + rc.bucket : '') +
              '</p>'
            : '';
        return (
          '<div class="item resume-card tone-' +
          (c.calmTone || 'idle') +
          ' m72-cp-jobcard-resume" data-kind="' +
          c.kind +
          '" data-id="' +
          c.id +
          '" data-bucket="' +
          (rc.bucket || '') +
          '">' +
          '<div class="row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<strong>' +
          (c.titleZh || c.kindZh) +
          '</strong>' +
          '<span class="muted">' +
          (c.statusZh || '') +
          (pct ? ' · ' + pct : '') +
          '</span></div>' +
          '<p style="margin:6px 0 4px">' +
          (c.summaryZh || '') +
          '</p>' +
          (c.hintZh ? '<p class="muted" style="margin:0 0 8px">' + c.hintZh + '</p>' : '') +
          '<div class="yb-progress-bar" style="margin:0 0 8px"><i class="yb-progress-fill" style="width:' +
          (c.percent || 0) +
          '%"></i></div>' +
          '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
          strat +
          previewBtn +
          csvBtn +
          fullCsvBtn +
          fullZipBtn +
          cancelBtn +
          resumeBtn +
          confirmOnlyBtn +
          (c.kind === 'import' && c.resumeAvailable && c.undoSkipBucketPath
            ? '<button type="button" class="ghost m73-jobcard-undo-skip" data-path="' +
              c.undoSkipBucketPath +
              '" data-id="' +
              c.id +
              '">' +
              (c.undoSkipBucketLabelZh || '撤销上次分桶跳过') +
              '</button>'
            : '') +
          (c.kind === 'import' && c.resumeAvailable && c.confirmBucketAndResumePath
            ? '<button type="button" class="ghost m73-jobcard-confirm-bucket-resume m73-cp-confirm-bucket-resume" data-path="' +
              c.confirmBucketAndResumePath +
              '" data-id="' +
              c.id +
              '" data-bucket="' +
              (rc.bucket || 'org') +
              '">' +
              (c.confirmBucketAndResumeLabelZh || '确认本桶+续跑') +
              '</button>'
            : '') +
          (c.kind === 'import' && c.resumeAvailable && c.skipBucketDiffReplayPath
            ? '<button type="button" class="ghost m74-jobcard-skip-diff m75-jobcard-skip-diff" data-path="' +
              c.skipBucketDiffReplayPath +
              '" data-id="' +
              c.id +
              '">' +
              (c.skipBucketDiffReplayLabelZh || '回放分桶跳过差分') +
              '</button>'
            : '') +
          (c.kind === 'import' && c.resumeAvailable && c.jumpToSeqRestorePath
            ? '<button type="button" class="ghost m75-jobcard-jump-seq" data-path="' +
              c.jumpToSeqRestorePath +
              '" data-id="' +
              c.id +
              '">' +
              (c.jumpToSeqRestoreLabelZh || '跳到 seq 还原') +
              '</button>'
            : '') +
          (c.kind === 'import' && c.resumeAvailable && c.confirmBucketWritePreviewPath
            ? '<button type="button" class="ghost m74-jobcard-write-preview" data-path="' +
              c.confirmBucketWritePreviewPath +
              '" data-id="' +
              c.id +
              '" data-bucket="' +
              (rc.bucket || 'org') +
              '">' +
              (c.confirmBucketWritePreviewLabelZh || '确认本桶写库预演') +
              '</button>'
            : '') +
          '</div>' +
          bucketCursorZh +
          ((c.crossPageDecisionSummary && c.crossPageDecisionSummary.tipZh)
            ? '<p class="muted m69-cross-page-summary" style="margin:4px 0 0;font-size:12px">' +
              c.crossPageDecisionSummary.tipZh +
              '</p>'
            : '') +
          '<pre class="resume-preview-out muted" hidden style="margin:8px 0 0;white-space:pre-wrap;font-size:12px;max-height:160px;overflow:auto"></pre>' +
          '</div>'
        );
      })
      .join('');

    el.querySelectorAll('.resume-cancel-btn').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const path = String(btn.getAttribute('data-path') || '').replace(/^\/api/, '');
          const r = await YB.api(path, { method: 'POST', body: '{}', busyText: '正在取消…' });
          YB.toast((r && (r.summaryZh || r.messageZh)) || '已请求取消', 'warn');
          if (typeof opts.onChanged === 'function') opts.onChanged(r);
          else YB.loadResumeCards(el, opts);
        } catch (e) {
          btn.disabled = false;
          YB.toast(e.message || '取消失败', 'err');
        }
      };
    });
        el.querySelectorAll('.resume-preview-btn').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('.resume-card');
        const id = btn.getAttribute('data-id');
        const sel = card && card.querySelector('.resume-merge-select');
        const strategy = sel ? sel.value : 'fill-empty';
        const out = card && card.querySelector('.resume-preview-out');
        btn.disabled = true;
        if (out) {
          out.hidden = false;
          out.classList.add('m63-cp-stream');
          out.textContent = '冲突摘要骨架加载中…';
        }
        try {
          const base =
            '/imports/enterprise/jobs/' +
            encodeURIComponent(id) +
            '/conflict-preview?mergeStrategy=' +
            encodeURIComponent(strategy);
          const sum = await YB.api(base + '&fields=summary', {
            quiet: true,
            busy: true,
            busyText: '冲突摘要骨架…',
            useEtagCache: true,
          });
          if (out) {
            const sk = sum.skeletonLabelsZh || {};
            const skLine = [sk.org, sk.demand, sk.person].filter(Boolean).join(' · ');
            out.textContent =
              (sum.summaryZh || '摘要完成') +
              (sum.timingMs != null ? ' · ' + sum.timingMs + 'ms' : '') +
              (sum.skeleton ? ' · 骨架' : '') +
              (sum.progressiveLoad || sum.streamNext ? ' · 流式' : '') +
              (skLine ? '\n' + skLine : '') +
              '\n' +
              ((sum.streamNext && sum.streamNext.tipZh) || '骨架已就绪，明细流式加载中…');
          }
          YB.toast(sum.summaryZh || '冲突摘要骨架完成', 'ok', 1800);
          const pageLimit = (sum.streamNext && sum.streamNext.limit) || 40;
          let offset = 0;
          let allRows = [];
          let allDemand = [];
          let allPerson = [];
          let last = null;
          let pages = 0;
          let cancelledMid = false;
          const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
          if (out) {
            out.innerHTML =
              '<div class="m65-cp-page m66-cp-rowindex m67-cp-row-decide m64-cp-page m63-cp-stream" style="white-space:pre-wrap"></div>' +
              '<div class="row" style="margin-top:6px;gap:8px">' +
              '<button type="button" class="ghost m65-cp-cancel m66-cp-rowindex">取消分页加载</button>' +
              '<span class="muted m65-cp-busy">明细分页加载中…</span></div>';
            const cancelBtn = out.querySelector('.m65-cp-cancel');
            if (cancelBtn) {
              cancelBtn.onclick = () => {
                cancelledMid = true;
                try { if (ac) ac.abort(); } catch (_) {}
                YB.toast('已取消冲突分页加载（已拉取页保留）', 'warn', 2200);
              };
            }
          }
          while (pages < 8 && !cancelledMid) {
            try {
              last = await YB.api(
                base + '&fields=slim&offset=' + offset + '&limit=' + pageLimit,
                {
                  quiet: true,
                  busy: true,
                  busyText: '冲突明细分页加载… 第 ' + (pages + 1) + ' 页（可取消）',
                  useEtagCache: true,
                  signal: ac && ac.signal,
                },
              );
            } catch (e) {
              if (cancelledMid || (e && (e.code === 'TIMEOUT' || /abort|取消/i.test(String(e.message || ''))))) {
                cancelledMid = true;
                break;
              }
              throw e;
            }
            pages += 1;
            allRows = allRows.concat(last.rows || []);
            const dpPage = last.demandPersonWritePlan || {};
            allDemand = allDemand.concat(dpPage.demandRows || []);
            allPerson = allPerson.concat(dpPage.personRows || []);
            const pane = out && out.querySelector('.m65-cp-page');
            const busyEl = out && out.querySelector('.m65-cp-busy');
            if (busyEl) {
              busyEl.textContent =
                '明细分页加载中… 第 ' +
                pages +
                ' 页 · 已 ' +
                allRows.length +
                ' 行' +
                (last.paging && last.paging.total != null ? ' / ' + last.paging.total : '') +
                (dpPage.rowIndexAlign || dpPage.cursorAlign || dpPage.alignedWithSlim ? ' · 需求/联系人 rowIndex 已对齐' : '');
            }
            if (pane) {
              pane.textContent =
                (sum.summaryZh || '') +
                '\n加载中… 第 ' +
                pages +
                ' 页 · ' +
                allRows.length +
                ' 行';
            }
            if (
              !(last.paging && last.paging.hasMore) &&
              !(last.streamNext && last.streamNext.fields === 'slim' && last.streamNext.offset != null)
            ) {
              break;
            }
            offset =
              last.streamNext && last.streamNext.offset != null
                ? last.streamNext.offset
                : last.paging && last.paging.nextOffset != null
                  ? last.paging.nextOffset
                  : offset + pageLimit;
          }
          const r = last || { rows: allRows };
          if (out) {
            const dp = r.demandPersonWritePlan || sum.demandPersonWritePlan || {};
            const pane = out.querySelector('.m65-cp-page') || out;
            const cancelBtn = out.querySelector('.m65-cp-cancel');
            const busyEl = out.querySelector('.m65-cp-busy');
            if (cancelBtn) cancelBtn.hidden = true;
            if (busyEl) {
              busyEl.textContent = cancelledMid
                ? '已取消分页（保留已加载 ' + pages + ' 页）'
                : '明细分页完成（' +
                  pages +
                  ' 页）' +
                  (dp.rowIndexAlign || dp.cursorAlign || dp.alignedWithSlim ? ' · rowIndex 对齐' : '') +
                  ' · 可按行确认/跳过';
            }
            pane.classList.add('m63-cp-stream', 'm64-cp-page', 'm65-cp-page', 'm66-cp-rowindex', 'm67-cp-row-decide', 'm68-cp-bulk-decide', 'm69-cp-confirm-only', 'm70-cp-undecided-wizard', 'm71-cp-undecided-buckets', 'm72-cp-bucket-skip', 'm72-cp-jobcard-resume', 'm73-cp-bucket-undo', 'm73-cp-confirm-bucket-resume', 'm74-cp-skip-diff', 'm74-cp-write-preview', 'm76-cp-seq-scrubber', 'm76-cp-field-confirm', 'm77-cp-scrubber-playback', 'm77-cp-field-live-rewrite', 'm79-cp-scrubber-speed', 'm79-cp-field-strategy-templates');
            const decisions = {};
            (allRows || []).forEach((row) => {
              const ri = row.rowIndex != null ? row.rowIndex : row.index;
              if (ri == null) return;
              if (row.decision === 'skip' || row.decision === 'confirm') decisions[ri] = row.decision;
            });
            const counts = r.confirmOnlyResumeCounts || {};
            const cross = r.crossPageDecisionSummary || {};
            const confirmN =
              cross.confirm != null
                ? cross.confirm
                : counts.confirm != null
                  ? counts.confirm
                  : r.userConfirmCount != null
                    ? r.userConfirmCount
                    : Object.keys(decisions).filter((k) => decisions[k] === 'confirm').length;
            const skipN =
              cross.skip != null
                ? cross.skip
                : counts.skip != null
                  ? counts.skip
                  : r.userSkipCount != null
                    ? r.userSkipCount
                    : Object.keys(decisions).filter((k) => decisions[k] === 'skip').length;
            const undecidedN = cross.undecided != null ? cross.undecided : Math.max(0, (cross.totalRemaining || 0) - confirmN - skipN);
            const head =
              '<div class="m67-cp-head m68-cp-counts muted" style="margin-bottom:6px;white-space:pre-wrap">' +
              (r.summaryZh || sum.summaryZh || '') +
              (r.timingMs != null ? ' · ' + r.timingMs + 'ms · ' + (r.cache || '') : '') +
              (r.paging ? ' · 分页 ' + allRows.length + '/' + (r.paging.total || allRows.length) : '') +
              (dp.rowIndexAlign || dp.cursorAlign || dp.alignedWithSlim ? ' · rowIndex 对齐' : '') +
              (cancelledMid ? ' · 中途取消' : ' · 分页明细就绪') +
              '\\n确认 ' +
              confirmN +
              ' · 跳过 ' +
              skipN +
              '（仅确认行续跑计数）' +
              '\\n跨页确认 ' + confirmN + ' · 跳过 ' + skipN + (undecidedN != null ? ' · 未决 ' + undecidedN : '') + '；可仅确认行续跑；中页取消仍可用。' +
              ((r.undecidedBuckets && r.undecidedBuckets.tipZh) ? '\\n' + r.undecidedBuckets.tipZh : '') +
              ((r.resumeCursor && r.resumeCursor.tipZh) ? '\\n' + r.resumeCursor.tipZh : '') +
              '</div>';
            const rowHtml = allRows
              .slice(0, 40)
              .map((row) => {
                const ri = row.rowIndex != null ? row.rowIndex : row.index;
                const checkedSkip = decisions[ri] === 'skip' ? ' checked' : '';
                const checkedConfirm = decisions[ri] === 'confirm' || !decisions[ri] ? ' checked' : '';
                return (
                  '<label class="m67-cp-row" data-row-index="' +
                  ri +
                  '" style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;flex-wrap:wrap">' +
                  '<span style="min-width:12rem">' +
                  ri +
                  '. ' +
                  (row.name || '') +
                  ' → ' +
                  (row.actionZh || '') +
                  '</span>' +
                  '<span class="pill"><input type="radio" name="m67-dec-' +
                  id +
                  '-' +
                  ri +
                  '" value="confirm"' +
                  checkedConfirm +
                  '/> 确认写入</span>' +
                  '<span class="pill"><input type="radio" name="m67-dec-' +
                  id +
                  '-' +
                  ri +
                  '" value="skip"' +
                  checkedSkip +
                  '/> 跳过本行</span>' +
                  '</label>'
                );
              })
              .join('');
            const dpLines = []
              .concat(
                allDemand
                  .slice(0, 8)
                  .map(
                    (row) =>
                      '需求#' +
                      (row.rowIndex != null ? row.rowIndex : '?') +
                      ' · ' +
                      (row.title || row.id || '') +
                      ' → ' +
                      (row.actionZh || ''),
                  ),
              )
              .concat(
                allPerson
                  .slice(0, 8)
                  .map(
                    (row) =>
                      '联系人#' +
                      (row.rowIndex != null ? row.rowIndex : '?') +
                      ' · ' +
                      (row.name || row.id || '') +
                      ' → ' +
                      (row.actionZh || ''),
                  ),
              );
            const actions =
              '<div class="row m67-cp-actions m68-cp-actions m70-cp-wizard" style="margin-top:8px;gap:8px;flex-wrap:wrap">' +
              '<button type="button" class="ghost m68-cp-all-confirm">本页全确认</button>' +
              '<button type="button" class="ghost m68-cp-all-skip">本页全跳过</button>' +
              '<button type="button" class="ghost m70-cp-undecided-confirm">未决全确认</button>' +
              '<button type="button" class="ghost m70-cp-undecided-skip">未决全跳过</button>' +
              '<button type="button" class="ghost m71-cp-bucket-org">机构未决确认</button>' +
              '<button type="button" class="ghost m71-cp-bucket-demand">需求未决确认</button>' +
              '<button type="button" class="ghost m71-cp-bucket-person">联系人未决确认</button>' +
              '<button type="button" class="ghost m72-cp-skip-bucket-org">仅跳过机构桶</button>' +
              '<button type="button" class="ghost m72-cp-skip-bucket-demand">仅跳过需求桶</button>' +
              '<button type="button" class="ghost m72-cp-skip-bucket-person">仅跳过联系人桶</button>' +
              '<button type="button" class="ghost m73-cp-undo-skip-bucket">撤销上次分桶跳过</button>' +
              '<button type="button" class="ghost m74-cp-skip-bucket-diff m75-cp-skip-bucket-diff">回放分桶跳过差分</button>' +
              '<button type="button" class="ghost m75-cp-jump-seq-restore m76-cp-jump-seq-restore" title="先回放再跳到 seq">跳到 seq 还原</button>' +
              '<button type="button" class="ghost m76-cp-seq-scrubber" title="时间线 scrubber">seq scrubber</button>' +
              '<button type="button" class="ghost m77-cp-scrubber-playback" title="播放差分序列">播放差分</button>' +
              '<button type="button" class="ghost m73-cp-confirm-bucket-org">确认机构桶+续跑</button>' +
              '<button type="button" class="ghost m73-cp-confirm-bucket-demand">确认需求桶+续跑</button>' +
              '<button type="button" class="ghost m73-cp-confirm-bucket-person">确认联系人桶+续跑</button>' +
              '<button type="button" class="ghost m74-cp-confirm-bucket-write-preview-org m75-cp-write-preview-org">确认机构桶写库预演</button>' +
              '<button type="button" class="ghost m74-cp-confirm-bucket-write-preview-demand m75-cp-write-preview-demand">确认需求桶写库预演</button>' +
              '<button type="button" class="ghost m74-cp-confirm-bucket-write-preview-person m75-cp-write-preview-person">确认联系人桶写库预演</button>' +
              '<button type="button" class="ghost m67-cp-preview-apply">按行确认预演写库计划</button>' +
              '<button type="button" class="ghost m69-cp-confirm-only-resume">仅确认行续跑（带桶/游标）</button>' +
              '<button type="button" class="ghost m67-cp-save-decisions">保存行决策</button>' +
              '<span class="muted m67-cp-preview-out m68-cp-counts-out">确认 ' +
              confirmN +
              ' · 跳过 ' +
              skipN +
              '</span></div>' +
              (dpLines.length
                ? '<pre class="muted m67-cp-dp" style="white-space:pre-wrap;margin-top:6px">【需求/联系人】\\n' +
                  dpLines.join('\\n') +
                  '</pre>'
                : '');
            pane.innerHTML = head + '<div class="m67-cp-rows">' + rowHtml + '</div>' + actions;
            const collectDecisions = () => {
              const skipRowIndexes = [];
              const confirmRowIndexes = [];
              pane.querySelectorAll('.m67-cp-row').forEach((lab) => {
                const ri = Number(lab.getAttribute('data-row-index'));
                if (!Number.isFinite(ri)) return;
                const skip = lab.querySelector('input[value="skip"]');
                const confirm = lab.querySelector('input[value="confirm"]');
                if (skip && skip.checked) skipRowIndexes.push(ri);
                else if (confirm && confirm.checked) confirmRowIndexes.push(ri);
              });
              return { skipRowIndexes, confirmRowIndexes };
            };
            const saveBtn = pane.querySelector('.m67-cp-save-decisions');
            const previewBtn = pane.querySelector('.m67-cp-preview-apply');
            const previewOut = pane.querySelector('.m67-cp-preview-out');
            const allConfirmBtn = pane.querySelector('.m68-cp-all-confirm');
            const allSkipBtn = pane.querySelector('.m68-cp-all-skip');
            const refreshCountOut = () => {
              const dec = collectDecisions();
              if (previewOut) {
                previewOut.textContent =
                  '确认 ' +
                  dec.confirmRowIndexes.length +
                  ' · 跳过 ' +
                  dec.skipRowIndexes.length +
                  '（本页已加载）';
              }
            };
            const setAllRadios = (value) => {
              pane.querySelectorAll('.m67-cp-row').forEach((lab) => {
                const input = lab.querySelector('input[value="' + value + '"]');
                if (input) input.checked = true;
              });
              refreshCountOut();
            };
            if (allConfirmBtn) {
              allConfirmBtn.onclick = async () => {
                setAllRadios('confirm');
                const dec = collectDecisions();
                allConfirmBtn.disabled = true;
                try {
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/row-decisions',
                    {
                      method: 'POST',
                      body: JSON.stringify({ allConfirmRowIndexes: dec.confirmRowIndexes }),
                      busy: true,
                      busyText: '本页全确认…',
                    },
                  );
                  YB.toast(resp.toastZh || '本页已全确认', 'ok', 2200);
                  if (previewOut) {
                    previewOut.textContent =
                      (resp.confirmOnlyResumeCounts && resp.confirmOnlyResumeCounts.tipZh) ||
                      resp.tipZh ||
                      '';
                  }
                } catch (e) {
                  const msg = e.message || '全确认失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  allConfirmBtn.disabled = false;
                }
              };
            }
            if (allSkipBtn) {
              allSkipBtn.onclick = async () => {
                setAllRadios('skip');
                const dec = collectDecisions();
                allSkipBtn.disabled = true;
                try {
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/row-decisions',
                    {
                      method: 'POST',
                      body: JSON.stringify({ allSkipRowIndexes: dec.skipRowIndexes }),
                      busy: true,
                      busyText: '本页全跳过…',
                    },
                  );
                  YB.toast(resp.toastZh || '本页已全跳过', 'ok', 2200);
                  if (previewOut) {
                    previewOut.textContent =
                      (resp.confirmOnlyResumeCounts && resp.confirmOnlyResumeCounts.tipZh) ||
                      resp.tipZh ||
                      '';
                  }
                } catch (e) {
                  const msg = e.message || '全跳过失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  allSkipBtn.disabled = false;
                }
              };
            }
            const pageSlimOffset = Number(r.paging && r.paging.offset != null ? r.paging.offset : 0) || 0;
            const pageSlimLimit = Number(
              (r.paging && r.paging.limit != null ? r.paging.limit : null) ||
                (allRows && allRows.length) ||
                5,
            );
            const undecidedConfirmBtn = pane.querySelector('.m70-cp-undecided-confirm');
            const undecidedSkipBtn = pane.querySelector('.m70-cp-undecided-skip');
            const runUndecidedWizard = async (action, btn, bucket) => {
              if (!btn) return;
              btn.disabled = true;
              try {
                const resp = await YB.api(
                  '/imports/enterprise/jobs/' +
                    encodeURIComponent(id) +
                    '/conflict-preview/undecided-wizard',
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      action,
                      slimOffset: pageSlimOffset,
                      slimLimit: pageSlimLimit,
                      pageCursor: 'slim:o' + pageSlimOffset + ':l' + pageSlimLimit,
                      persistCursor: true,
                      bucket: bucket || undefined,
                      conflictType: bucket || undefined,
                    }),
                    busy: true,
                    busyText: bucket
                      ? (bucket === 'org' ? '机构' : bucket === 'demand' ? '需求' : '联系人') +
                        '未决' +
                        (action === 'confirm' ? '确认' : '跳过') +
                        '…'
                      : action === 'confirm'
                        ? '未决全确认…'
                        : '未决全跳过…',
                  },
                );
                YB.toast(resp.toastZh || '未决向导已完成', 'ok', 2200);
                if (previewOut) {
                  previewOut.textContent =
                    (resp.crossPageDecisionSummary && resp.crossPageDecisionSummary.tipZh) ||
                    resp.tipZh ||
                    '';
                }
                // 同步本页单选：仅未决变为目标决策
                pane.querySelectorAll('.m67-cp-row').forEach((lab) => {
                  const ri = Number(lab.getAttribute('data-row-index'));
                  if (!Number.isFinite(ri)) return;
                  const skip = lab.querySelector('input[value="skip"]');
                  const confirm = lab.querySelector('input[value="confirm"]');
                  const wasSkip = skip && skip.checked;
                  const wasConfirm = confirm && confirm.checked;
                  if (wasSkip || wasConfirm) return; // 已决策不动；向导服务端也只动未决
                  const input = lab.querySelector('input[value="' + action + '"]');
                  if (input) input.checked = true;
                });
                refreshCountOut();
              } catch (e) {
                const msg = e.message || '未决向导失败';
                YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
              } finally {
                btn.disabled = false;
              }
            };
            if (undecidedConfirmBtn) {
              undecidedConfirmBtn.onclick = () => runUndecidedWizard('confirm', undecidedConfirmBtn);
            }
            if (undecidedSkipBtn) {
              undecidedSkipBtn.onclick = () => runUndecidedWizard('skip', undecidedSkipBtn);
            }
            const bucketOrgBtn = pane.querySelector('.m71-cp-bucket-org');
            const bucketDemandBtn = pane.querySelector('.m71-cp-bucket-demand');
            const bucketPersonBtn = pane.querySelector('.m71-cp-bucket-person');
            if (bucketOrgBtn) {
              bucketOrgBtn.onclick = () => runUndecidedWizard('confirm', bucketOrgBtn, 'org');
            }
            if (bucketDemandBtn) {
              bucketDemandBtn.onclick = () => runUndecidedWizard('confirm', bucketDemandBtn, 'demand');
            }
            if (bucketPersonBtn) {
              bucketPersonBtn.onclick = () => runUndecidedWizard('confirm', bucketPersonBtn, 'person');
            }
            const runSkipBucketOnly = async (bucket, btn) => {
              if (!btn || !bucket) return;
              btn.disabled = true;
              const label = bucket === 'org' ? '机构' : bucket === 'demand' ? '需求' : '联系人';
              try {
                const resp = await YB.api(
                  '/imports/enterprise/jobs/' +
                    encodeURIComponent(id) +
                    '/conflict-preview/skip-bucket',
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      bucket,
                      conflictType: bucket,
                      persistCursor: true,
                      pageCursor: 'slim:o' + pageSlimOffset + ':l' + pageSlimLimit,
                    }),
                    busy: true,
                    busyText: '仅跳过' + label + '桶…',
                  },
                );
                YB.toast(resp.toastZh || '仅本桶已跳过', 'ok', 2200);
                if (previewOut) {
                  previewOut.textContent =
                    (resp.tipSkipBucketOnlyZh || '') +
                    ' ' +
                    (resp.resumeCursor && resp.resumeCursor.tipZh ? resp.resumeCursor.tipZh : resp.tipZh || '');
                }
                // 同步本页：向导返回的 skip 行
                const skipped = (resp.undecidedIndexes || []).slice();
                pane.querySelectorAll('.m67-cp-row').forEach((lab) => {
                  const ri = Number(lab.getAttribute('data-row-index'));
                  if (!Number.isFinite(ri)) return;
                  if (skipped.length && !skipped.includes(ri)) return;
                  const skip = lab.querySelector('input[value="skip"]');
                  const confirm = lab.querySelector('input[value="confirm"]');
                  if (confirm && confirm.checked) return;
                  if (skip) skip.checked = true;
                });
                refreshCountOut();
              } catch (e) {
                const msg = e.message || '仅本桶跳过失败';
                YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
              } finally {
                btn.disabled = false;
              }
            };
            const skipOrgBtn = pane.querySelector('.m72-cp-skip-bucket-org');
            const skipDemandBtn = pane.querySelector('.m72-cp-skip-bucket-demand');
            const skipPersonBtn = pane.querySelector('.m72-cp-skip-bucket-person');
            if (skipOrgBtn) skipOrgBtn.onclick = () => runSkipBucketOnly('org', skipOrgBtn);
            if (skipDemandBtn) skipDemandBtn.onclick = () => runSkipBucketOnly('demand', skipDemandBtn);
            if (skipPersonBtn) skipPersonBtn.onclick = () => runSkipBucketOnly('person', skipPersonBtn);

            const undoSkipBtn = pane.querySelector('.m73-cp-undo-skip-bucket');
            if (undoSkipBtn) {
              undoSkipBtn.onclick = async () => {
                undoSkipBtn.disabled = true;
                try {
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/undo-skip-bucket',
                    { method: 'POST', body: JSON.stringify({}), busy: true, busyText: '撤销分桶跳过…' },
                  );
                  YB.toast(resp.toastZh || '已撤销分桶跳过', resp.ok === false ? 'err' : 'ok', 2400);
                  if (previewOut) previewOut.textContent = resp.tipZh || resp.toastZh || '';
                } catch (e) {
                  const msg = e.message || '撤销失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  undoSkipBtn.disabled = false;
                }
              };
            }
            const wireConfirmBucket = (btn, bucket) => {
              if (!btn) return;
              btn.onclick = async () => {
                btn.disabled = true;
                try {
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' +
                      encodeURIComponent(id) +
                      '/conflict-preview/confirm-bucket-resume',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        bucket: bucket,
                        persistCursor: true,
                        dryRunDecideOnly: false,
                      }),
                      busy: true,
                      busyText: '确认本桶+续跑…',
                      cancellable: true,
                    },
                  );
                  YB.toast(resp.toastZh || '确认本桶+续跑完成', resp.ok === false ? 'err' : 'ok', 2600);
                  if (previewOut) {
                    previewOut.textContent =
                      (resp.tipZh || '') +
                      ((resp.resume && resp.resume.tipZh) ? '\\n' + resp.resume.tipZh : '');
                  }
                } catch (e) {
                  const msg = e.message || '确认本桶续跑失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  btn.disabled = false;
                }
              };
            };
            wireConfirmBucket(pane.querySelector('.m73-cp-confirm-bucket-org'), 'org');
            wireConfirmBucket(pane.querySelector('.m73-cp-confirm-bucket-demand'), 'demand');
            wireConfirmBucket(pane.querySelector('.m73-cp-confirm-bucket-person'), 'person');
            const diffBtn = pane.querySelector('.m74-cp-skip-bucket-diff');
            if (diffBtn) {
              diffBtn.onclick = async () => {
                try {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '回放分桶跳过差分…');
                  const r = await api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/skip-bucket-diff',
                    { method: 'GET' },
                  );
                  const events = r.events || [];
                  pane.__m75SkipDiffEvents = events;
                  const lines = events
                    .slice(-12)
                    .map(
                      (e) =>
                        '#' +
                        e.seq +
                        ' · ' +
                        (e.actionZh || e.action) +
                        (e.bucketZh ? ' · ' + e.bucketZh : '') +
                        ' · ' +
                        (e.tipZh || '') +
                        (e.restoreAvailable ? ' · 可还原' : '') +
                        (e.at ? ' · ' + e.at : ''),
                    );
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '差分回放', 'ok', 2400);
                  const out = pane.querySelector('.m67-cp-preview-out');
                  if (out) out.textContent = r.tipZh || '差分回放';
                  if (typeof showDlg === 'function') {
                    showDlg(
                      (r.tipZh || '') +
                        (lines.length ? '\n' + lines.join('\n') : '\n暂无差分') +
                        '\n提示：点「跳到 seq 还原」可还原到某一 seq。',
                    );
                  }
                } catch (e) {
                  const msg = e.message || '回放失败';
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(msg, 'err');
                } finally {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                }
              };
            }
            const ensureSkipDiffEvents = async () => {
              let events = pane.__m75SkipDiffEvents;
              let scrub = pane.__m76SeqScrubber;
              if (!events || !events.length) {
                if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '先回放差分…');
                const r0 = await api(
                  '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/skip-bucket-diff',
                  { method: 'GET' },
                );
                events = r0.events || [];
                scrub = r0.seqRestoreScrubber || null;
                pane.__m75SkipDiffEvents = events;
                pane.__m76SeqScrubber = scrub;
              }
              return { events, scrub };
            };
            const runSeqRestore = async (seq) => {
              if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '跳到 seq #' + seq + ' 还原…');
              const r = await api(
                '/imports/enterprise/jobs/' +
                  encodeURIComponent(id) +
                  '/conflict-preview/skip-bucket-diff/restore',
                { method: 'POST', body: JSON.stringify({ seq }) },
              );
              if (typeof YB !== 'undefined' && YB.toast)
                YB.toast(r.toastZh || '已跳到 seq 还原', r.ok === false ? 'err' : 'ok', 2600);
              const out = pane.querySelector('.m67-cp-preview-out');
              if (out) out.textContent = (r.tipZh || '').slice(0, 200);
              return r;
            };
            const jumpBtn = pane.querySelector('.m75-cp-jump-seq-restore');
            if (jumpBtn) {
              jumpBtn.onclick = async () => {
                try {
                  const { events } = await ensureSkipDiffEvents();
                  if (!events.length) {
                    if (typeof YB !== 'undefined' && YB.toast) YB.toast('暂无差分可还原', 'warn');
                    return;
                  }
                  const last = events[events.length - 1];
                  const raw =
                    typeof prompt === 'function'
                      ? prompt('跳到哪个 seq 还原？（1..' + events.length + '）', String(last.seq || events.length))
                      : String(last.seq || events.length);
                  const seq = Number(raw);
                  if (!Number.isFinite(seq) || seq < 1) {
                    if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消跳到 seq 还原', 'warn');
                    return;
                  }
                  await runSeqRestore(seq);
                } catch (e) {
                  const msg = e.message || '跳到 seq 还原失败';
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(msg, 'err');
                } finally {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                }
              };
            }
            const scrubBtn = pane.querySelector('.m76-cp-seq-scrubber');
            if (scrubBtn) {
              scrubBtn.onclick = async () => {
                try {
                  const { events, scrub } = await ensureSkipDiffEvents();
                  if (!events.length) {
                    if (typeof YB !== 'undefined' && YB.toast) YB.toast('暂无差分可 scrub', 'warn');
                    return;
                  }
                  const minSeq = (scrub && scrub.minSeq) || events[0].seq || 1;
                  const maxSeq = (scrub && scrub.maxSeq) || events[events.length - 1].seq || events.length;
                  let cur = (scrub && scrub.currentSeq) || maxSeq;
                  let host = pane.querySelector('.m76-cp-scrubber-host');
                  if (!host) {
                    host = document.createElement('div');
                    host.className = 'm76-cp-scrubber-host';
                    host.style.cssText = 'margin-top:8px;padding:8px;border:1px dashed #ccc;border-radius:8px';
                    pane.appendChild(host);
                  }
                  host.innerHTML =
                    '<label class="muted m76-seq-scrubber-label">seq 还原 scrubber（' +
                    minSeq +
                    '…' +
                    maxSeq +
                    '）· 当前 <strong class="m76-seq-scrubber-val">' +
                    cur +
                    '</strong></label>' +
                    '<input type="range" class="m76-seq-scrubber-range" min="' +
                    minSeq +
                    '" max="' +
                    maxSeq +
                    '" value="' +
                    cur +
                    '" style="width:100%;margin:6px 0" />' +
                    '<button type="button" class="ghost m76-seq-scrubber-apply">跳到此 seq 还原</button>' +
                    '<span class="muted m76-seq-scrubber-tip" style="margin-left:8px;font-size:12px">' +
                    ((scrub && scrub.tipZh) || '拖动后点还原；中页取消仍可用') +
                    '</span>';
                  const range = host.querySelector('.m76-seq-scrubber-range');
                  const valEl = host.querySelector('.m76-seq-scrubber-val');
                  const apply = host.querySelector('.m76-seq-scrubber-apply');
                  if (range && valEl) {
                    range.oninput = () => {
                      valEl.textContent = String(range.value);
                    };
                  }
                  if (apply) {
                    apply.onclick = async () => {
                      const seq = Number(range && range.value);
                      if (!Number.isFinite(seq)) return;
                      try {
                        await runSeqRestore(seq);
                      } catch (e) {
                        if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '还原失败', 'err');
                      } finally {
                        if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                      }
                    };
                  }
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast('已打开 seq scrubber', 'ok', 1800);
                } catch (e) {
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'scrubber 失败', 'err');
                } finally {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                }
              };
            }
            const playBtn = pane.querySelector('.m77-cp-scrubber-playback');
            if (playBtn) {
              playBtn.onclick = async () => {
                try {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '加载差分播放序列…');
                  const r0 = await api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/skip-bucket-diff',
                    { method: 'GET' },
                  );
                  const play = r0.scrubberDiffPlayback || {};
                  const frames = play.frames || [];
                  const intervalMs = play.intervalMs || 900;
                  if (!frames.length) {
                    if (typeof YB !== 'undefined' && YB.toast) YB.toast('暂无差分可播放', 'warn');
                    return;
                  }
                  let host = pane.querySelector('.m77-cp-playback-host');
                  if (!host) {
                    host = document.createElement('div');
                    host.className = 'm77-cp-playback-host m78-cp-scrubber-pause-seek m79-cp-scrubber-speed m80-cp-scrubber-speed-memory m81-cp-role-overlays m82-role-ab-preview m82-bucket-field-defaults m83-role-ab-apply m83-bucket-defaults-write-preview m84-role-ab-undo m84-bucket-field-grain m85-role-ab-timeline m85-field-grain-into-preview m86-role-ab-timeline-scrubber m86-field-grain-undo m87-role-ab-seek-apply m87-field-grain-undo-stack m88-role-ab-seek-confirm m88-field-grain-undo-timeline';
                    host.style.cssText = 'margin-top:8px;padding:8px;border:1px dashed #9cf;border-radius:8px;font-size:12px';
                    pane.appendChild(host);
                  }
                  if (pane.__m77PlaybackTimer) {
                    clearInterval(pane.__m77PlaybackTimer);
                    pane.__m77PlaybackTimer = null;
                  }
                  const speedOpts = play.speedOptions || [
                    { speed: 0.5, intervalMs: 1800, labelZh: '0.5× 慢放' },
                    { speed: 1, intervalMs: 900, labelZh: '1× 常速' },
                    { speed: 1.5, intervalMs: 600, labelZh: '1.5×' },
                    { speed: 2, intervalMs: 450, labelZh: '2× 快放' },
                  ];
                  const remembered =
                    (play.rememberedSpeed != null ? Number(play.rememberedSpeed) : null) ||
                    (play.defaultSpeed != null ? Number(play.defaultSpeed) : null) ||
                    (r0.conflictUiTenantPrefs && r0.conflictUiTenantPrefs.lastScrubberSpeed) ||
                    1;
                  const rememberedOpt = speedOpts.find((o) => Number(o.speed) === Number(remembered));
                  pane.__m78Playback = {
                    frames,
                    i: 0,
                    paused: false,
                    intervalMs: (rememberedOpt && rememberedOpt.intervalMs) || intervalMs,
                    speed: remembered,
                    speedOptions: speedOpts,
                  };
                  const paintFrame = () => {
                    const st = pane.__m78Playback;
                    if (!st) return;
                    const f = st.frames[st.i];
                    if (!f) {
                      if (pane.__m77PlaybackTimer) {
                        clearInterval(pane.__m77PlaybackTimer);
                        pane.__m77PlaybackTimer = null;
                      }
                      host.querySelector('.m78-playback-status') &&
                        (host.querySelector('.m78-playback-status').textContent =
                          '播放结束 · 共 ' + st.frames.length + ' 帧；中页取消仍可用');
                      if (typeof YB !== 'undefined' && YB.toast) YB.toast('差分播放结束', 'ok', 1800);
                      return;
                    }
                    const status =
                      (st.paused ? '已暂停 ' : '播放 ') + (st.i + 1) + '/' + st.frames.length;
                    const speedSel =
                      '<label class="muted m79-playback-speed-label">' +
                      (play.playbackSpeedLabelZh || r0.scrubberPlaybackSpeedLabelZh || '播放倍速') +
                      ' <select class="m79-cp-playback-speed">' +
                      (st.speedOptions || [])
                        .map(function (o) {
                          return (
                            '<option value="' +
                            o.speed +
                            '"' +
                            (Number(o.speed) === Number(st.speed) ? ' selected' : '') +
                            '>' +
                            (o.labelZh || o.speed + '×') +
                            '</option>'
                          );
                        })
                        .join('') +
                      '</select></label>';
                    const body =
                      '<div class="row m78-playback-controls m79-playback-speed-controls" style="gap:6px;align-items:center;flex-wrap:wrap">' +
                      '<strong class="m77-playback-frame m78-playback-status">' +
                      status +
                      '</strong>' +
                      '<button type="button" class="ghost m78-cp-playback-pause">' +
                      (st.paused ? play.resumeLabelZh || '继续播放' : play.pauseLabelZh || '暂停播放') +
                      '</button>' +
                      speedSel +
                      '<label class="muted">seek seq <input type="number" class="m78-cp-seek-seq" min="' +
                      (st.frames[0] && st.frames[0].seq) +
                      '" max="' +
                      (st.frames[st.frames.length - 1] && st.frames[st.frames.length - 1].seq) +
                      '" value="' +
                      (f.seq || st.i + 1) +
                      '" style="width:64px"/></label>' +
                      '<button type="button" class="ghost m78-cp-seek-restore">' +
                      (play.seekToSeqLabelZh || r0.scrubberPauseSeekRestoreLabelZh || '定点 seek 还原') +
                      '</button>' +
                      '</div>' +
                      '<div>' +
                      (f.labelZh || '') +
                      '</div><div class="muted">' +
                      (f.tipZh || '') +
                      '</div>';
                    host.innerHTML = body;
                    const out = pane.querySelector('.m67-cp-preview-out');
                    if (out) out.textContent = (f.labelZh || '') + ' · ' + (f.tipZh || '');
                    const pauseBtn = host.querySelector('.m78-cp-playback-pause');
                    if (pauseBtn) {
                      pauseBtn.onclick = () => {
                        st.paused = !st.paused;
                        if (st.paused) {
                          if (pane.__m77PlaybackTimer) {
                            clearInterval(pane.__m77PlaybackTimer);
                            pane.__m77PlaybackTimer = null;
                          }
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast('已暂停差分播放', 'ok', 1400);
                          paintFrame();
                        } else {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast('继续播放', 'ok', 1400);
                          paintFrame();
                          pane.__m77PlaybackTimer = setInterval(step, st.intervalMs);
                        }
                      };
                    }
                    const speedEl = host.querySelector('.m79-cp-playback-speed');
                    if (speedEl) {
                      speedEl.onchange = async () => {
                        const sp = Number(speedEl.value) || 1;
                        const opt = (st.speedOptions || []).find((o) => Number(o.speed) === sp);
                        st.speed = sp;
                        st.intervalMs = (opt && opt.intervalMs) || Math.round(900 / sp);
                        if (!st.paused && pane.__m77PlaybackTimer) {
                          clearInterval(pane.__m77PlaybackTimer);
                          pane.__m77PlaybackTimer = setInterval(step, st.intervalMs);
                        }
                        try {
                          const roleKey =
                            (r0.conflictUiRoleKey ||
                              (r0.conflictUiTenantPrefs && r0.conflictUiTenantPrefs.roleKey) ||
                              null);
                          await api('/imports/enterprise/conflict-ui-prefs', {
                            method: 'POST',
                            body: JSON.stringify(
                              roleKey
                                ? {
                                    lastScrubberSpeed: sp,
                                    role: roleKey,
                                    asRoleOverlay: true,
                                    roleOverlay: { lastScrubberSpeed: sp },
                                  }
                                : { lastScrubberSpeed: sp, asRoleOverlay: false },
                            ),
                          });
                        } catch (_) {}
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast('播放倍速 ' + sp + '×（已记租户偏好）', 'ok', 1400);
                      };
                    }
                    const seekBtn = host.querySelector('.m78-cp-seek-restore');
                    if (seekBtn) {
                      seekBtn.onclick = async () => {
                        const inp = host.querySelector('.m78-cp-seek-seq');
                        const seq = Number(inp && inp.value) || f.seq;
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '定点 seek 还原…');
                          st.paused = true;
                          if (pane.__m77PlaybackTimer) {
                            clearInterval(pane.__m77PlaybackTimer);
                            pane.__m77PlaybackTimer = null;
                          }
                          const idx = st.frames.findIndex((x) => Number(x.seq) === Number(seq));
                          if (idx >= 0) st.i = idx;
                          const resp = await api(
                            '/imports/enterprise/jobs/' +
                              encodeURIComponent(id) +
                              '/conflict-preview/skip-bucket-diff/restore',
                            { method: 'POST', body: JSON.stringify({ seq: Number(seq) }) },
                          );
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || resp.tipZh || '已定点还原', 'ok', 2200);
                          paintFrame();
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || 'seek 还原失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }
                  };
                  const step = () => {
                    const st = pane.__m78Playback;
                    if (!st || st.paused) return;
                    st.i += 1;
                    paintFrame();
                  };
                  if (typeof YB !== 'undefined' && YB.toast)
                    YB.toast(r0.scrubberDiffPlaybackLabelZh || '开始播放差分', 'ok', 1800);
                  paintFrame();
                  pane.__m77PlaybackTimer = setInterval(step, intervalMs);
                } catch (e) {
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '播放失败', 'err');
                } finally {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                }
              };
            }
            const wireWritePreview = (btn, bucket) => {
              if (!btn) return;
              btn.onclick = async () => {
                try {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '确认本桶写库预演（行级字段 diff）…');
                  const r = await api(
                    '/imports/enterprise/jobs/' +
                      encodeURIComponent(id) +
                      '/conflict-preview/confirm-bucket-write-preview',
                    {
                      method: 'POST',
                      body: JSON.stringify({ bucket, persistCursor: true }),
                    },
                  );
                  const wp = r.writePlanPreview || r;
                  const fd = wp.rowFieldDiff || r.rowFieldDiff || null;
                  const fdRows = (fd && fd.rows) || [];
                  const lines = fdRows.slice(0, 8).map((row) => {
                    const ch = (row.fields || [])
                      .filter((f) => f.change && f.change !== 'unchanged')
                      .slice(0, 4)
                      .map(
                        (f) =>
                          (f.fieldZh || f.field) +
                          ':' +
                          (f.before == null ? '∅' : String(f.before).slice(0, 24)) +
                          '→' +
                          (f.after == null ? '∅' : String(f.after).slice(0, 24)) +
                          '(' +
                          (f.changeZh || f.change) +
                          ')',
                      );
                    return (
                      '#' +
                      row.rowIndex +
                      ' ' +
                      (row.name || '') +
                      ' · ' +
                      (row.actionZh || '') +
                      (ch.length ? ' · ' + ch.join('；') : '')
                    );
                  });
                  // M76：按字段确认/跳过面板
                  let fieldHost = pane.querySelector('.m76-cp-field-decide-host');
                  if (!fieldHost) {
                    fieldHost = document.createElement('div');
                    fieldHost.className = 'm76-cp-field-decide-host';
                    fieldHost.style.cssText = 'margin-top:8px;max-height:220px;overflow:auto;font-size:12px';
                    pane.appendChild(fieldHost);
                  }
                  const decidable = [];
                  fdRows.slice(0, 12).forEach((row) => {
                    (row.fields || [])
                      .filter((f) => f.confirmSkipAvailable || (f.change && f.change !== 'unchanged'))
                      .slice(0, 6)
                      .forEach((f) => {
                        decidable.push({
                          rowIndex: row.rowIndex,
                          field: f.field,
                          fieldZh: f.fieldZh || f.field,
                          decision: f.decision || null,
                          changeZh: f.changeZh || f.change,
                        });
                      });
                  });
                  if (decidable.length) {
                    fieldHost.innerHTML =
                      '<div class="muted m76-field-confirm-skip-label" style="margin-bottom:4px">' +
                      ((fd && fd.fieldConfirmSkipLabelZh) || '按字段确认/跳过') +
                      '</div>' +
                      '<div class="row m78-batch-field-bar m79-field-strategy-bar m80-field-strategy-tenant-prefs m81-field-strategy-role-overlays m82-role-ab-preview m82-bucket-field-defaults m83-role-ab-apply m83-bucket-defaults-write-preview m84-role-ab-undo m84-bucket-field-grain m85-role-ab-timeline m85-field-grain-into-preview m86-role-ab-timeline-scrubber m86-field-grain-undo m87-role-ab-seek-apply m87-field-grain-undo-stack m88-role-ab-seek-confirm m88-field-grain-undo-timeline m86-role-ab-timeline-scrubber m86-field-grain-undo m87-role-ab-seek-apply m87-field-grain-undo-stack m88-role-ab-seek-confirm m88-field-grain-undo-timeline m89-role-ab-folded-diffs m89-field-grain-seek-undo m90-seek-undo-preview m90-folded-apply-one" style="gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">' +
                      '<label><input type="checkbox" class="m78-batch-select-all" checked/> 全选本页行</label>' +
                      '<button type="button" class="ghost m78-batch-field-confirm">批量确认选中行同字段</button>' +
                      '<button type="button" class="ghost m78-batch-field-skip">批量跳过选中行同字段</button>' +
                      '<button type="button" class="ghost m79-field-strategy-overwrite" title="按字段类型套用覆盖模板">模板·覆盖</button>' +
                      '<button type="button" class="ghost m79-field-strategy-fill-empty" title="按字段类型套用仅填空">模板·仅填空</button>' +
                      '<button type="button" class="ghost m79-field-strategy-skip" title="按字段类型套用跳过">模板·跳过</button>' +
                      '<button type="button" class="ghost m82-role-ab-preview-btn" title="保存前对照租户默认与角色覆盖">角色覆盖 A/B 预演</button>' +
                      '<button type="button" class="ghost m83-role-ab-apply-btn m84-role-ab-apply-btn" title="将 B 侧角色覆盖一键落盘">A/B 一键应用</button>' +
                      '<button type="button" class="ghost m84-role-ab-undo-btn" title="撤销上次 A/B 一键应用">撤销 A/B 应用</button>' +
                      '<button type="button" class="ghost m85-role-ab-timeline-btn m86-role-ab-timeline-scrubber-btn" title="查看 A/B 应用/撤销差分时间线">A/B 差分时间线</button>' +
                      '<button type="button" class="ghost m86-role-ab-timeline-scrubber-btn" title="A/B 时间线 scrubber seek">A/B 时间线 scrubber</button>' +
                      '<button type="button" class="ghost m85-field-grain-into-preview-btn m86-field-grain-undo-btn" title="字段粒决策一键灌入写库预演">字段粒灌入写库预演</button>' +
                      '<button type="button" class="ghost m86-field-grain-undo-btn m87-field-grain-undo-stack-btn m88-field-grain-undo-timeline-btn" title="多步撤销字段粒灌入">撤销字段粒灌入（栈）</button><button type="button" class="ghost m88-field-grain-undo-timeline-btn" title="字段粒撤销栈时间线">撤销栈时间线</button><button type="button" class="ghost m89-field-grain-seek-undo-btn m90-seek-undo-preview-btn m91-seek-undo-keepfields-btn m92-seek-undo-bulk-keep m93-seek-undo-except m94-except-templates" title="定点撤销（可勾选保留字段）">定点撤销</button><button type="button" class="ghost m90-folded-apply-one-btn m91-folded-multiselect-btn m92-folded-undo-summary m93-folded-undo-scrubber m94-folded-undo-onepager" title="折叠差异多选角色/分桶套用">折叠差异多选套用</button><button type="button" class="ghost m94-except-templates-btn m95-except-shared-preview-btn m96-shared-copy-draft-btn" title="排除字段模板按角色">排除字段模板</button><button type="button" class="ghost m95-except-shared-preview-btn m96-shared-copy-draft-btn" title="排除模板只读共享预览">模板只读共享预览</button><button type="button" class="ghost m96-shared-copy-draft-btn m97-draft-shared-diff-btn" title="共享预览复制为本角色草稿">复制为本角色草稿</button><button type="button" class="ghost m97-draft-shared-diff-btn m98-draft-resync-btn" title="本角色草稿与共享源差分">草稿↔共享源差分</button><button type="button" class="ghost m98-draft-resync-btn m99-resync-buckets-btn" title="草稿差分一键回同步共享源">草稿回同步共享源</button><button type="button" class="ghost m99-resync-buckets-btn m100-resync-contrast-btn" title="草稿回同步按分桶选择">分桶回同步</button><button type="button" class="ghost m100-resync-contrast-btn m101-resync-changed-only-btn" title="分桶回同步 before/after 对照">分桶回同步对照</button><button type="button" class="ghost m101-resync-changed-only-btn m102-skip-list-btn" title="对照卡一键只同步变更桶">只同步变更桶</button><button type="button" class="ghost m102-skip-list-btn" title="变更桶跳过清单预览">跳过清单预览</button><button type="button" class="ghost m94-undo-onepager-btn m95-undo-sidebar-btn m96-sidebar-match-highlight-btn m97-sidebar-bidir-seek-btn m98-bidir-remember-anchor-btn m99-anchor-by-matchid-btn" title="可撤销摘要站内一页纸">摘要一页纸</button><button type="button" class="ghost m95-undo-sidebar-btn m96-sidebar-match-highlight-btn m97-sidebar-bidir-seek-btn m98-bidir-remember-anchor-btn m99-anchor-by-matchid-btn" title="摘要一页纸并入匹配解释侧栏">摘要并入解释侧栏</button><button type="button" class="ghost m96-sidebar-match-highlight-btn m97-sidebar-bidir-seek-btn m98-bidir-remember-anchor-btn m99-anchor-by-matchid-btn" title="侧栏摘要联动 matchId 一页纸高亮">侧栏联动一页纸高亮</button><button type="button" class="ghost m97-sidebar-bidir-seek-btn m98-bidir-remember-anchor-btn m99-anchor-by-matchid-btn" title="侧栏与一页纸章节双向定位">侧栏↔一页纸双向seek</button><button type="button" class="ghost m98-bidir-remember-anchor-btn m99-anchor-by-matchid-btn" title="双向seek记住章节锚点">双向seek记住锚点</button><button type="button" class="ghost m99-anchor-by-matchid-btn m100-anchor-template-btn" title="双向seek锚点按matchId">锚点按matchId</button><button type="button" class="ghost m100-anchor-template-btn m101-anchor-by-role-btn" title="matchId锚点跨会话模板">跨会话锚点模板</button><button type="button" class="ghost m101-anchor-by-role-btn m102-role-tpl-clone-btn" title="跨会话锚点模板按角色分套">跨会话模板按角色</button><button type="button" class="ghost m102-role-tpl-clone-btn" title="按角色模板跨租户只读克隆">模板跨租户只读克隆</button><button type="button" class="ghost m103-skip-force-include-btn m104-force-include-role-defaults-btn" title="强制纳入存为角色默认">强制纳入角色默认</button><button type="button" class="ghost m103-clone-diff-adopt-btn m104-clone-diff-field-subset-btn" title="克隆差分字段子集采纳">克隆差分字段子集</button><button type="button" class="ghost m105-role-defaults-ab-btn m104-force-include-role-defaults-btn m106-ab-winner-soft-undo-btn" title="角色默认A/B对照套用">角色默认A/B套用</button><button type="button" class="ghost m105-field-subset-soft-undo-btn m104-clone-diff-field-subset-btn m106-field-subset-softundo-ba-btn" title="字段子集采纳软撤销">字段子集软撤销</button><button type="button" class="ghost m106-ab-winner-soft-undo-btn m107-ab-winner-softundo-ba-btn" title="A/B胜出侧套用软撤销">A/B胜出侧软撤销</button><button type="button" class="ghost m106-field-subset-softundo-ba-btn m107-field-subset-pinpoint-oneside-btn" title="字段子集软撤销前后对照">子集软撤销前后对照</button><button type="button" class="ghost m107-ab-winner-softundo-ba-btn m108-winner-ba-pinpoint-btn" title="胜出侧软撤销前后对照">胜出侧软撤销前后对照</button><button type="button" class="ghost m107-field-subset-pinpoint-oneside-btn m108-oneside-softundo-summary-btn" title="子集前后卡定点/只采纳一侧">子集前后卡定点/一侧</button><button type="button" class="ghost m108-winner-ba-pinpoint-btn m109-winner-pinpoint-rebypass-btn" title="胜出侧前后卡定点标注">胜出侧前后卡定点</button><button type="button" class="ghost m108-oneside-softundo-summary-btn m109-oneside-summary-scrub-ab-btn" title="只采纳一侧可软撤销摘要">一侧采纳软撤销摘要</button><button type="button" class="ghost m109-winner-pinpoint-rebypass-btn m110-pinpoint-rebypass-fail-fold-btn" title="胜出侧定点触发供给再旁路">胜出侧定点再旁路</button><button type="button" class="ghost m109-oneside-summary-scrub-ab-btn m110-ab-summary-frame-pinpoint-btn" title="一侧摘要scrub进A/B时间线">一侧摘要进A/B时间线</button><button type="button" class="ghost m110-pinpoint-rebypass-fail-fold-btn m111-fail-attr-retry-fold-taskcard-btn" title="定点再旁路失败并入归因">定点再旁路失败归因</button><button type="button" class="ghost m110-ab-summary-frame-pinpoint-btn m111-summary-pinpoint-rebypass-btn" title="A/B时间线摘要帧定点">摘要帧定点标注</button><button type="button" class="ghost m111-fail-attr-retry-fold-taskcard-btn m112-retry-phase-pause-grace-btn" title="失败归因一键重试折进任务卡">失败归因重试折进任务卡</button><button type="button" class="ghost m111-summary-pinpoint-rebypass-btn m112-summary-rebypass-before-after-btn" title="摘要帧定点触发供给再旁路">摘要帧定点再旁路</button><button type="button" class="ghost m112-retry-phase-pause-grace-btn m113-grace-soft-cancel-ledger-btn" title="任务卡重试单阶段暂停宽限">重试阶段暂停宽限</button><button type="button" class="ghost m112-summary-rebypass-before-after-btn m113-summary-ba-pinpoint-rebypass-btn" title="摘要帧再旁路前后对照">摘要帧再旁路前后对照</button><button type="button" class="ghost m113-grace-soft-cancel-ledger-btn m113-grace-soft-cancel-ledger m114-soft-cancel-ledger-role-audit-btn" title="宽限闹钟软取消进中文台账">宽限软取消进台账</button><button type="button" class="ghost m113-summary-ba-pinpoint-rebypass-btn m113-summary-ba-pinpoint-rebypass m114-summary-pinpoint-rebypass-fail-fold-btn" title="摘要前后卡定点再旁路">摘要前后卡定点再旁路</button><button type="button" class="ghost m114-soft-cancel-ledger-role-audit-btn m114-soft-cancel-ledger-role-audit m115-soft-cancel-audit-seek-ledger-btn" title="软取消台账角色审计一页纸">软取消台账角色审计一页纸</button><button type="button" class="ghost m114-summary-pinpoint-rebypass-fail-fold-btn m114-summary-pinpoint-rebypass-fail-fold m115-summary-fail-attr-ff-replay-btn" title="摘要定点再旁路失败并入归因">摘要定点再旁路失败并入归因</button><button type="button" class="ghost m115-soft-cancel-audit-seek-ledger-btn m115-soft-cancel-audit-seek-ledger m116-soft-cancel-seek-multiselect-btn" title="软取消审计一页纸seek回台账">软取消审计一页纸seek回台账</button><button type="button" class="ghost m115-summary-fail-attr-ff-replay-btn m115-summary-fail-attr-ff-replay m116-summary-ff-replay-scrubber-bm-btn" title="摘要失败归因字段过滤回放">摘要失败归因字段过滤回放</button><button type="button" class="ghost m116-soft-cancel-seek-multiselect-btn m116-soft-cancel-seek-multiselect" title="软取消seek台账多选中文对照">软取消seek台账多选对照</button><button type="button" class="ghost m116-summary-ff-replay-scrubber-bm-btn m116-summary-ff-replay-scrubber-bm" title="摘要失败归因过滤回放scrubber书签">摘要失败归因回放scrubber书签</button><button type="button" class="ghost m117-soft-cancel-seek-clip-scrubber-btn m117-soft-cancel-seek-clip-scrubber m118-multiselect-clip-scrubber-kf-bm-btn" title="软取消seek多选对照短片scrubber">多选对照短片scrubber</button><button type="button" class="ghost m118-multiselect-clip-scrubber-kf-bm-btn m118-multiselect-clip-scrubber-kf-bm m119-multiselect-clip-kf-bm-xsession-btn" title="多选对照短片scrubber关帧书签">多选对照短片关帧书签</button><button type="button" class="ghost m119-multiselect-clip-kf-bm-xsession-btn m119-multiselect-clip-kf-bm-xsession m120-kf-xsession-diff-preview-adopt-btn" title="多选对照关帧书签跨会话只读分享">关帧书签跨会话只读分享</button><button type="button" class="ghost m120-kf-xsession-diff-preview-adopt-btn m120-kf-xsession-diff-preview-adopt m121-diff-preview-adopt-soft-undo-ba-btn" title="关帧跨会话分享差分预览再采纳">关帧跨会话差分预览再采纳</button><button type="button" class="ghost m121-diff-preview-adopt-soft-undo-ba-btn m121-diff-preview-adopt-soft-undo-ba m122-soft-undo-ba-pinpoint-rebypass-btn" title="差分预览采纳软撤销前后卡">差分预览采纳软撤销前后卡</button><button type="button" class="ghost m122-soft-undo-ba-pinpoint-rebypass-btn m122-soft-undo-ba-pinpoint-rebypass m123-pinpoint-rebypass-fail-fold-btn" title="软撤销前后卡定点再旁路">软撤销前后卡定点再旁路</button><button type="button" class="ghost m123-pinpoint-rebypass-fail-fold-btn m123-pinpoint-rebypass-fail-fold m124-pinpoint-fail-attr-retry-fold-btn" title="定点再旁路失败并入归因">定点再旁路失败并入归因</button><button type="button" class="ghost m124-pinpoint-fail-attr-retry-fold-btn m124-pinpoint-fail-attr-retry-fold m125-fail-attr-retry-phase-pause-grace-btn" title="定点失败归因一键重试折进任务卡">定点失败归因一键重试折进任务卡</button><button type="button" class="ghost m125-fail-attr-retry-phase-pause-grace-btn m125-fail-attr-retry-phase-pause-grace m126-fail-attr-retry-pause-grace-soft-cancel-ledger-btn" title="失败归因重试任务卡单阶段暂停宽限">失败归因重试任务卡单阶段暂停宽限</button><button type="button" class="ghost m126-fail-attr-retry-pause-grace-soft-cancel-ledger-btn m126-fail-attr-retry-pause-grace-soft-cancel-ledger" title="失败归因重试暂停宽限软取消进台账">失败归因重试暂停宽限软取消进台账</button><button type="button" class="ghost m127-fail-attr-soft-cancel-ledger-role-audit-btn m127-fail-attr-soft-cancel-ledger-role-audit m128-fail-attr-soft-cancel-audit-seek-ledger-btn" title="失败归因软取消台账角色审计一页纸">失败归因软取消台账角色审计一页纸</button><button type="button" class="ghost m128-fail-attr-soft-cancel-audit-seek-ledger-btn m128-fail-attr-soft-cancel-audit-seek-ledger m129-fail-attr-soft-cancel-seek-multiselect-btn" title="失败归因软取消审计回跳台账">失败归因软取消审计回跳台账</button><button type="button" class="ghost m129-fail-attr-soft-cancel-seek-multiselect-btn m129-fail-attr-soft-cancel-seek-multiselect m130-fail-attr-soft-cancel-multiselect-clip-scrubber-btn" title="失败归因软取消回跳多选中文对照">失败归因软取消回跳多选对照</button><button type="button" class="ghost m130-fail-attr-soft-cancel-multiselect-clip-scrubber-btn m130-fail-attr-soft-cancel-multiselect-clip-scrubber m131-fail-attr-soft-cancel-multiselect-clip-kf-bm-btn" title="失败归因软取消多选对照短片scrubber">失败归因软取消多选对照短片scrubber</button><button type="button" class="ghost m131-fail-attr-soft-cancel-multiselect-clip-kf-bm-btn m131-fail-attr-soft-cancel-multiselect-clip-kf-bm m132-fail-attr-soft-cancel-clip-kf-bm-xsession-btn" title="失败归因软取消多选对照短片关帧书签">失败归因软取消多选对照短片关帧书签</button><button type="button" class="ghost m132-fail-attr-soft-cancel-clip-kf-bm-xsession-btn m132-fail-attr-soft-cancel-clip-kf-bm-xsession" title="失败归因软取消多选短片关帧跨会话只读分享">失败归因软取消多选短片关帧跨会话只读分享</button><button type="button" class="ghost m133-fail-attr-soft-cancel-kf-bm-xsession-expiry-btn m133-fail-attr-soft-cancel-kf-bm-xsession-expiry m134-fail-attr-soft-cancel-expiry-ledger-role-audit-btn" title="失败归因软取消关帧跨会话过期吊销进台账">失败归因软取消关帧跨会话过期吊销进台账</button><button type="button" class="ghost m134-fail-attr-soft-cancel-expiry-ledger-role-audit-btn m134-fail-attr-soft-cancel-expiry-ledger-role-audit" title="失败归因软取消过期吊销台账角色审计一页纸">失败归因软取消过期吊销台账角色审计一页纸</button><button type="button" class="ghost m117-summary-ff-replay-bm-xsession-btn m117-summary-ff-replay-bm-xsession m118-summary-ff-replay-bm-diff-preview-adopt-btn" title="摘要失败归因回放书签跨会话只读分享">摘要回放书签跨会话只读分享</button><button type="button" class="ghost m118-summary-ff-replay-bm-diff-preview-adopt-btn m118-summary-ff-replay-bm-diff-preview-adopt m119-summary-diff-preview-oneside-soft-undo-btn" title="摘要回放书签差分预览再采纳">摘要回放书签差分预览再采纳</button><button type="button" class="ghost m119-summary-diff-preview-oneside-soft-undo-btn m119-summary-diff-preview-oneside-soft-undo m120-oneside-soft-undo-scrub-ab-btn" title="摘要差分预览一侧软撤销">摘要差分预览一侧软撤销</button><button type="button" class="ghost m120-oneside-soft-undo-scrub-ab-btn m120-oneside-soft-undo-scrub-ab m121-ab-timeline-frame-pinpoint-btn" title="一侧软撤销scrub进A/B时间线">一侧软撤销scrub进A/B时间线</button><button type="button" class="ghost m121-ab-timeline-frame-pinpoint-btn m121-ab-timeline-frame-pinpoint m122-ab-frame-pinpoint-supply-rebypass-btn" title="A/B时间线帧定点标注">A/B时间线帧定点标注</button><button type="button" class="ghost m122-ab-frame-pinpoint-supply-rebypass-btn m122-ab-frame-pinpoint-supply-rebypass m123-ab-frame-rebypass-ba-btn" title="A/B帧定点触发供给再旁路">A/B帧定点触发供给再旁路</button><button type="button" class="ghost m123-ab-frame-rebypass-ba-btn m123-ab-frame-rebypass-ba m124-ab-frame-rebypass-ba-pinpoint-btn" title="A/B帧再旁路前后对照卡">A/B帧再旁路前后对照卡</button><button type="button" class="ghost m124-ab-frame-rebypass-ba-pinpoint-btn m124-ab-frame-rebypass-ba-pinpoint m125-ab-frame-rebypass-pinpoint-fail-attr-btn" title="A/B帧再旁路前后卡定点再旁路">A/B帧再旁路前后卡定点再旁路</button><button type="button" class="ghost m125-ab-frame-rebypass-pinpoint-fail-attr-btn m125-ab-frame-rebypass-pinpoint-fail-attr m126-ab-pinpoint-fail-attr-one-click-retry-btn" title="A/B帧再旁路定点失败并入归因">A/B帧再旁路定点失败并入归因</button><button type="button" class="ghost m126-ab-pinpoint-fail-attr-one-click-retry-btn m126-ab-pinpoint-fail-attr-one-click-retry" title="A/B帧定点失败归因一键重试">A/B帧定点失败归因一键重试</button><button type="button" class="ghost m127-ab-fail-attr-one-click-retry-fold-taskcard-btn m127-ab-fail-attr-one-click-retry-fold-taskcard m128-ab-fail-attr-retry-taskcard-phase-pause-grace-btn" title="A/B帧定点失败归因一键重试折进任务卡">A/B帧定点失败归因一键重试折进任务卡</button><button type="button" class="ghost m128-ab-fail-attr-retry-taskcard-phase-pause-grace-btn m128-ab-fail-attr-retry-taskcard-phase-pause-grace m129-ab-fail-attr-retry-pause-grace-soft-cancel-ledger-btn" title="A/B失败归因重试任务卡单阶段暂停宽限">A/B失败归因重试任务卡单阶段暂停宽限</button><button type="button" class="ghost m129-ab-fail-attr-retry-pause-grace-soft-cancel-ledger-btn m129-ab-fail-attr-retry-pause-grace-soft-cancel-ledger m130-ab-fail-attr-soft-cancel-ledger-role-audit-btn" title="A/B失败归因重试暂停宽限软取消进台账">A/B失败归因重试暂停宽限软取消进台账</button><button type="button" class="ghost m130-ab-fail-attr-soft-cancel-ledger-role-audit-btn m130-ab-fail-attr-soft-cancel-ledger-role-audit m131-ab-fail-attr-soft-cancel-role-audit-seek-btn" title="A/B失败归因软取消台账角色审计一页纸">A/B失败归因软取消台账角色审计一页纸</button><button type="button" class="ghost m131-ab-fail-attr-soft-cancel-role-audit-seek-btn m131-ab-fail-attr-soft-cancel-role-audit-seek m132-ab-fail-attr-soft-cancel-role-audit-seek-ms-btn" title="A/B失败归因软取消角色审计回跳台账">A/B失败归因软取消角色审计回跳台账</button><button type="button" class="ghost m132-ab-fail-attr-soft-cancel-role-audit-seek-ms-btn m132-ab-fail-attr-soft-cancel-role-audit-seek-ms" title="A/B失败归因软取消角色审计回跳多选对照">A/B失败归因软取消角色审计回跳多选对照</button><button type="button" class="ghost m133-ab-fail-attr-soft-cancel-seek-ms-clip-scrubber-btn m133-ab-fail-attr-soft-cancel-seek-ms-clip-scrubber m134-ab-fail-attr-soft-cancel-seek-ms-clip-kf-bm-btn" title="A/B失败归因软取消回跳多选短片scrubber">A/B失败归因软取消回跳多选短片scrubber</button><button type="button" class="ghost m134-ab-fail-attr-soft-cancel-seek-ms-clip-kf-bm-btn m134-ab-fail-attr-soft-cancel-seek-ms-clip-kf-bm" title="A/B失败归因软取消多选短片关帧书签">A/B失败归因软取消多选短片关帧书签</button>' +
                      '<button type="button" class="ghost m82-bucket-default-org" title="本角色·机构桶默认仅填空">桶默认·机构·仅填空</button>' +
                      '<button type="button" class="ghost m82-bucket-default-demand" title="本角色·需求桶默认覆盖">桶默认·需求·覆盖</button>' +
                      '<button type="button" class="ghost m82-bucket-default-person" title="本角色·联系人桶默认跳过">桶默认·联系人·跳过</button>' +
                      '<span class="muted m78-batch-field-label">跨行批量字段确认/跳过</span>' +
                      '<span class="muted m79-field-strategy-label m82-role-ab-preview-label m83-role-ab-apply-label m84-role-ab-undo-label m85-role-ab-timeline-label m85-field-grain-into-preview-label">按字段类型策略模板 · A/B 时间线 scrubber · 字段粒灌入可撤销</span>' +
                      '</div>' +
                      decidable
                        .map((d, i) => {
                          return (
                            '<div class="row m76-field-decide-row" data-row-index="' +
                            d.rowIndex +
                            '" data-field="' +
                            d.field +
                            '" style="gap:6px;align-items:center;margin:2px 0">' +
                            '<input type="checkbox" class="m78-batch-row-check" checked data-row-index="' +
                            d.rowIndex +
                            '" data-field="' +
                            d.field +
                            '"/>' +
                            '<span>#' +
                            d.rowIndex +
                            ' · ' +
                            d.fieldZh +
                            '（' +
                            d.changeZh +
                            '）</span>' +
                            '<button type="button" class="ghost m76-field-confirm" data-i="' +
                            i +
                            '">确认字段</button>' +
                            '<button type="button" class="ghost m76-field-skip" data-i="' +
                            i +
                            '">跳过字段</button>' +
                            '</div>'
                          );
                        })
                        .join('');
                    const saveFieldDecision = async (rowIndex, field, decision) => {
                      try {
                        if (typeof YB !== 'undefined' && YB.busy)
                          YB.busy(true, '保存字段决策并即时改写预演…');
                        const resp = await api(
                          '/imports/enterprise/jobs/' +
                            encodeURIComponent(id) +
                            '/conflict-preview/field-decisions',
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              decisions: [{ rowIndex, field, decision }],
                              bucket: bucket,
                            }),
                          },
                        );
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast(resp.toastZh || '字段决策已保存', 'ok', 2000);
                        const out2 = pane.querySelector('.m67-cp-preview-out');
                        const live = resp.liveWritePreview || null;
                        const samples = (live && live.beforeAfterSample) || [];
                        const liveLines = samples.map((row) => {
                          const ch = (row.fields || [])
                            .slice(0, 4)
                            .map(
                              (f) =>
                                (f.fieldZh || f.field) +
                                ':' +
                                (f.before == null ? '∅' : String(f.before).slice(0, 20)) +
                                '→' +
                                (f.after == null ? '∅' : String(f.after).slice(0, 20)) +
                                (f.decisionZh ? '(' + f.decisionZh + ')' : ''),
                            );
                          return '#' + row.rowIndex + ' ' + (row.name || '') + (ch.length ? ' · ' + ch.join('；') : '');
                        });
                        let liveHost = pane.querySelector('.m77-cp-live-rewrite-host');
                        if (!liveHost) {
                          liveHost = document.createElement('div');
                          liveHost.className = 'm77-cp-live-rewrite-host';
                          liveHost.style.cssText =
                            'margin-top:6px;padding:6px;border:1px solid #cde;border-radius:8px;font-size:12px';
                          fieldHost.appendChild(liveHost);
                        }
                        liveHost.innerHTML =
                          '<div class="muted m77-field-live-rewrite-label">' +
                          ((resp.fieldConfirmLiveRewriteLabelZh ||
                            (live && live.labelZh) ||
                            '字段确认后即时改写预演')) +
                          '</div>' +
                          (liveLines.length
                            ? '<pre style="white-space:pre-wrap;margin:4px 0 0">' +
                              liveLines.join('\n') +
                              '</pre>'
                            : '<span class="muted">预演已改写（无变更样例）</span>');
                        if (out2)
                          out2.textContent = (
                            (resp.tipZh || '') +
                            (live && live.tipZh ? '\n' + live.tipZh : '') +
                            (liveLines.length ? '\n' + liveLines.join('\n') : '')
                          ).slice(0, 500);
                      } catch (e) {
                        if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '保存失败', 'err');
                      } finally {
                        if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                      }
                    };
                    fieldHost.querySelectorAll('.m76-field-confirm').forEach((btn) => {
                      btn.onclick = () => {
                        const row = btn.closest('.m76-field-decide-row');
                        if (!row) return;
                        saveFieldDecision(
                          Number(row.getAttribute('data-row-index')),
                          row.getAttribute('data-field'),
                          'confirm',
                        );
                      };
                    });
                    fieldHost.querySelectorAll('.m76-field-skip').forEach((btn) => {
                      btn.onclick = () => {
                        const row = btn.closest('.m76-field-decide-row');
                        if (!row) return;
                        saveFieldDecision(
                          Number(row.getAttribute('data-row-index')),
                          row.getAttribute('data-field'),
                          'skip',
                        );
                      };
                    });
                    const selectAll = fieldHost.querySelector('.m78-batch-select-all');
                    if (selectAll) {
                      selectAll.onchange = () => {
                        fieldHost.querySelectorAll('.m78-batch-row-check').forEach((c) => {
                          c.checked = !!selectAll.checked;
                        });
                      };
                    }
                    const runBatch = async (decision) => {
                      const checks = [...fieldHost.querySelectorAll('.m78-batch-row-check')].filter((c) => c.checked);
                      if (!checks.length) {
                        if (typeof YB !== 'undefined' && YB.toast) YB.toast('请先勾选行', 'warn');
                        return;
                      }
                      // group by field — apply each field across selected rows that share it
                      const byField = {};
                      checks.forEach((c) => {
                        const field = c.getAttribute('data-field');
                        const ri = Number(c.getAttribute('data-row-index'));
                        if (!field || !Number.isFinite(ri)) return;
                        if (!byField[field]) byField[field] = [];
                        byField[field].push(ri);
                      });
                      try {
                        if (typeof YB !== 'undefined' && YB.busy)
                          YB.busy(true, '跨行批量字段决策并即时改写预演…');
                        let last = null;
                        for (const [field, rowIndexes] of Object.entries(byField)) {
                          last = await api(
                            '/imports/enterprise/jobs/' +
                              encodeURIComponent(id) +
                              '/conflict-preview/field-decisions',
                            {
                              method: 'POST',
                              body: JSON.stringify({
                                batch: { rowIndexes, field, decision },
                                bucket: bucket,
                              }),
                            },
                          );
                        }
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast((last && last.toastZh) || '批量字段决策已保存', 'ok', 2200);
                        const live = last && last.liveWritePreview;
                        let liveHost = pane.querySelector('.m77-cp-live-rewrite-host');
                        if (!liveHost) {
                          liveHost = document.createElement('div');
                          liveHost.className = 'm77-cp-live-rewrite-host m78-batch-live-rewrite';
                          liveHost.style.cssText =
                            'margin-top:6px;padding:6px;border:1px solid #cde;border-radius:8px;font-size:12px';
                          fieldHost.appendChild(liveHost);
                        }
                        liveHost.innerHTML =
                          '<div class="muted">' +
                          ((last && last.batchFieldDecisionsLabelZh) || '跨行批量字段确认/跳过') +
                          ' · 批量 ' +
                          ((last && last.batchApplied) || 0) +
                          '</div>' +
                          '<div class="muted">' +
                          ((live && live.tipZh) || (last && last.tipZh) || '') +
                          '</div>';
                      } catch (e) {
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast(e.message || '批量失败', 'err');
                      } finally {
                        if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                      }
                    };
                    const bc = fieldHost.querySelector('.m78-batch-field-confirm');
                    if (bc) bc.onclick = () => runBatch('confirm');
                    const bs = fieldHost.querySelector('.m78-batch-field-skip');
                    if (bs) bs.onclick = () => runBatch('skip');
                    const runStrategy = async (strategyTemplate) => {
                      const checks = [...fieldHost.querySelectorAll('.m78-batch-row-check')].filter((c) => c.checked);
                      const rowIndexes = [
                        ...new Set(
                          checks
                            .map((c) => Number(c.getAttribute('data-row-index')))
                            .filter((n) => Number.isFinite(n)),
                        ),
                      ];
                      const fields = [
                        ...new Set(
                          checks
                            .map((c) => c.getAttribute('data-field'))
                            .filter(Boolean),
                        ),
                      ];
                      try {
                        if (typeof YB !== 'undefined' && YB.busy)
                          YB.busy(true, '按字段类型策略模板套用并即时改写预演…');
                        const resp = await api(
                          '/imports/enterprise/jobs/' +
                            encodeURIComponent(id) +
                            '/conflict-preview/field-decisions',
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              applyStrategyTemplates: true,
                              persistTenantPrefs: true,
                              strategyTemplate,
                              batch: {
                                rowIndexes: rowIndexes.length ? rowIndexes : undefined,
                                fields: fields.length ? fields : undefined,
                              },
                              rowIndexes: rowIndexes.length ? rowIndexes : undefined,
                              fields: fields.length ? fields : undefined,
                              bucket: bucket,
                            }),
                          },
                        );
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast(
                            resp.toastZh ||
                              resp.fieldStrategyTemplatesLabelZh ||
                              '策略模板已套用',
                            'ok',
                            2200,
                          );
                        let liveHost = pane.querySelector('.m77-cp-live-rewrite-host');
                        if (!liveHost) {
                          liveHost = document.createElement('div');
                          liveHost.className =
                            'm77-cp-live-rewrite-host m79-strategy-live-rewrite';
                          liveHost.style.cssText =
                            'margin-top:6px;padding:6px;border:1px solid #cde;border-radius:8px;font-size:12px';
                          fieldHost.appendChild(liveHost);
                        }
                        const samples = (resp.strategySamples || [])
                          .slice(0, 6)
                          .map(
                            (s) =>
                              '#' +
                              s.rowIndex +
                              ' ' +
                              s.field +
                              '·' +
                              s.template +
                              '→' +
                              (s.decisionZh || s.decision),
                          );
                        liveHost.innerHTML =
                          '<div class="muted m79-field-strategy-label m80-field-strategy-tenant-prefs m81-field-strategy-role-overlays-label">' +
                          (resp.fieldStrategyTemplatesLabelZh ||
                            resp.conflictUiTenantPrefsLabelZh ||
                            '按字段类型策略模板（租户偏好）') +
                          ' · 套用 ' +
                          (resp.strategyApplied || 0) +
                          '</div>' +
                          '<div class="muted">' +
                          (resp.tipZh || '') +
                          '</div>' +
                          (samples.length
                            ? '<pre style="white-space:pre-wrap;margin:4px 0 0">' +
                              samples.join('\n') +
                              '</pre>'
                            : '');
                      } catch (e) {
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast(e.message || '策略模板失败', 'err');
                      } finally {
                        if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                      }
                    };
                    const so = fieldHost.querySelector('.m79-field-strategy-overwrite');
                    if (so) so.onclick = () => runStrategy('overwrite');
                    const sf = fieldHost.querySelector('.m79-field-strategy-fill-empty');
                    if (sf) sf.onclick = () => runStrategy('fill-empty');
                    const ss = fieldHost.querySelector('.m79-field-strategy-skip');
                    if (ss) ss.onclick = () => runStrategy('skip');

                    const abBtn = fieldHost.querySelector('.m82-role-ab-preview-btn');
                    if (abBtn) {
                      abBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '角色覆盖 A/B 预演…');
                          const roleKey =
                            (r0 && (r0.conflictUiRoleKey || (r0.conflictUiTenantPrefs && r0.conflictUiTenantPrefs.roleKey))) ||
                            'enterprise';
                          const resp = await api(
                            '/imports/enterprise/conflict-ui-prefs/ab-preview?role=' + encodeURIComponent(roleKey),
                          );
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || 'A/B 预演已生成', 'ok', 2200);
                          const rows = (((resp.ab || {}).sideBySide || {}).rows) || [];
                          const lines = rows.slice(0, 16).map(function (row) {
                            return (
                              (row.fieldZh || row.field) +
                              ' | A:' +
                              row.tenant +
                              ' | B:' +
                              row.overlay +
                              ' | 生效:' +
                              row.effective +
                              (row.changed ? ' *' : '')
                            );
                          });
                          let abHost = pane.querySelector('.m82-role-ab-preview-host');
                          if (!abHost) {
                            abHost = document.createElement('div');
                            abHost.className = 'm82-role-ab-preview-host';
                            abHost.style.cssText =
                              'margin-top:6px;padding:6px;border:1px dashed #9cf;border-radius:8px;font-size:12px';
                            fieldHost.appendChild(abHost);
                          }
                          abHost.innerHTML =
                            '<div class="muted m82-role-ab-preview-label">' +
                            (resp.labelZh || '角色覆盖 A/B 预演（未保存）') +
                            '</div><div class="muted">' +
                            (resp.tipZh || '') +
                            '</div><pre style="white-space:pre-wrap;margin:4px 0 0">' +
                            (lines.length ? lines.join('\n') : '无差异行') +
                            '</pre>';
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || 'A/B 预演失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    const abApplyBtn = fieldHost.querySelector('.m83-role-ab-apply-btn');
                    if (abApplyBtn) {
                      abApplyBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 一键应用角色覆盖…');
                          const roleKey =
                            (r0 && (r0.conflictUiRoleKey || (r0.conflictUiTenantPrefs && r0.conflictUiTenantPrefs.roleKey))) ||
                            'enterprise';
                          const resp = await api('/imports/enterprise/conflict-ui-prefs/ab-apply', {
                            method: 'POST',
                            body: JSON.stringify({ role: roleKey, asRoleOverlay: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || 'A/B 已应用', 'ok', 2200);
                          let abHost = pane.querySelector('.m82-role-ab-preview-host');
                          if (!abHost) {
                            abHost = document.createElement('div');
                            abHost.className = 'm82-role-ab-preview-host m83-role-ab-apply-host m84-role-ab-undo-host';
                            abHost.style.cssText =
                              'margin-top:6px;padding:6px;border:1px dashed #9cf;border-radius:8px;font-size:12px';
                            fieldHost.appendChild(abHost);
                          }
                          const grain = resp.fieldGrainPreview;
                          let grainZh = '';
                          if (grain && grain.byBucket) {
                            grainZh =
                              '\n【字段粒】' +
                              ['org', 'demand', 'person']
                                .map(function (b) {
                                  const x = grain.byBucket[b];
                                  if (!x) return '';
                                  return (
                                    (x.bucketZh || b) +
                                    ' 套用' +
                                    (x.appliedCount || 0) +
                                    '/跳过' +
                                    (x.skippedCount || 0)
                                  );
                                })
                                .filter(Boolean)
                                .join(' · ');
                          }
                          abHost.innerHTML =
                            '<div class="muted m83-role-ab-apply-label m84-role-ab-undo-label">' +
                            (resp.labelZh || 'A/B 一键应用角色覆盖') +
                            '</div><div class="muted">' +
                            (resp.tipZh || '') +
                            grainZh +
                            '</div>';
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || 'A/B 应用失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    const abUndoBtn = fieldHost.querySelector('.m84-role-ab-undo-btn');
                    if (abUndoBtn) {
                      abUndoBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '撤销上次 A/B 一键应用…');
                          const resp = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undo', {
                            method: 'POST',
                            body: JSON.stringify({}),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(
                              resp.toastZh || resp.tipZh || '撤销结果',
                              resp.undone ? 'ok' : 'warn',
                              2400,
                            );
                          let abHost = pane.querySelector('.m82-role-ab-preview-host');
                          if (!abHost) {
                            abHost = document.createElement('div');
                            abHost.className = 'm82-role-ab-preview-host m84-role-ab-undo-host m85-role-ab-timeline-host';
                            abHost.style.cssText =
                              'margin-top:6px;padding:6px;border:1px dashed #c9c;border-radius:8px;font-size:12px';
                            fieldHost.appendChild(abHost);
                          }
                          const tl = resp.abDiffTimeline && resp.abDiffTimeline.latest
                            ? '<div class="muted m85-role-ab-timeline-label">时间线·' +
                              (resp.abDiffTimeline.latest.summaryZh || resp.abDiffTimeline.latest.actionZh || '') +
                              '</div>'
                            : '';
                          abHost.innerHTML =
                            '<div class="muted m84-role-ab-undo-label">' +
                            (resp.labelZh || '撤销 A/B 一键应用') +
                            '</div><div class="muted">' +
                            (resp.tipZh || '') +
                            '</div>' +
                            tl;
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || '撤销失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    const abTimelineBtn = fieldHost.querySelector('.m85-role-ab-timeline-btn');
                    if (abTimelineBtn) {
                      abTimelineBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '加载 A/B 差分时间线…');
                          const resp = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || resp.tipZh || '时间线', 'ok', 2200);
                          let abHost = pane.querySelector('.m82-role-ab-preview-host');
                          if (!abHost) {
                            abHost = document.createElement('div');
                            abHost.className = 'm82-role-ab-preview-host m85-role-ab-timeline-host';
                            abHost.style.cssText =
                              'margin-top:6px;padding:6px;border:1px dashed #c9c;border-radius:8px;font-size:12px';
                            fieldHost.appendChild(abHost);
                          }
                          const items = (resp.items || [])
                            .slice(0, 8)
                            .map(function (it) {
                              return (
                                '<div>· ' +
                                (it.actionZh || it.action) +
                                ' · ' +
                                (it.summaryZh || '') +
                                (it.diffKeys && it.diffKeys.length
                                  ? ' · 差分键 ' + it.diffKeys.slice(0, 4).join(',')
                                  : '') +
                                '</div>'
                              );
                            })
                            .join('');
                          const scrub = resp.abTimelineScrubber || {};
                          const scrubHtml = scrub.enabled
                            ? '<div class="m86-ab-timeline-scrubber" style="margin-top:6px">' +
                              '<label class="muted">' +
                              (scrub.labelZh || 'scrubber') +
                              ' <input type="range" class="m86-ab-tl-scrub" min="' +
                              (scrub.minSeq || 0) +
                              '" max="' +
                              (scrub.maxSeq || 0) +
                              '" value="' +
                              (scrub.currentSeq || scrub.maxSeq || 0) +
                              '"/></label>' +
                              '<button type="button" class="ghost m86-ab-tl-seek-btn" style="margin-left:6px">seek</button>' +
                              '<button type="button" class="ghost m86-ab-tl-pause-btn">暂停</button>' +
                              '<button type="button" class="ghost m87-ab-tl-apply-btn" title="确认真套用该帧 prefs">确认套用 prefs</button>' +
                              '</div>'
                            : '';
                          abHost.innerHTML =
                            '<div class="muted m85-role-ab-timeline-label m86-role-ab-timeline-scrubber-label">' +
                            (resp.labelZh || 'A/B 差分时间线') +
                            '</div><div class="muted">' +
                            (resp.tipZh || '') +
                            '</div>' +
                            items +
                            scrubHtml;
                          const seekBtn = abHost.querySelector('.m86-ab-tl-seek-btn');
                          const scrubInput = abHost.querySelector('.m86-ab-tl-scrub');
                          const pauseBtn = abHost.querySelector('.m86-ab-tl-pause-btn');
                          if (seekBtn && scrubInput) {
                            seekBtn.onclick = async () => {
                              try {
                                if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 时间线 seek…');
                                const sresp = await api(
                                  '/imports/enterprise/conflict-ui-prefs/ab-apply/timeline/seek',
                                  {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      seq: Number(scrubInput.value),
                                      pause: false,
                                      applyPreview: true,
                                    }),
                                  },
                                );
                                if (typeof YB !== 'undefined' && YB.toast)
                                  YB.toast(sresp.toastZh || sresp.tipZh || 'seek', 'ok', 2000);
                              } catch (e) {
                                if (typeof YB !== 'undefined' && YB.toast)
                                  YB.toast(e.message || 'seek 失败', 'err');
                              } finally {
                                if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                              }
                            };
                          }
                          if (pauseBtn && scrubInput) {
                            pauseBtn.onclick = async () => {
                              try {
                                const sresp = await api(
                                  '/imports/enterprise/conflict-ui-prefs/ab-apply/timeline/seek',
                                  {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      seq: Number(scrubInput.value),
                                      pause: true,
                                    }),
                                  },
                                );
                                if (typeof YB !== 'undefined' && YB.toast)
                                  YB.toast(sresp.toastZh || '已暂停', 'ok', 1800);
                              } catch (e) {
                                if (typeof YB !== 'undefined' && YB.toast)
                                  YB.toast(e.message || '暂停失败', 'err');
                              }
                            };
                          }
                          const applyBtn = abHost.querySelector('.m87-ab-tl-apply-btn');
                          if (applyBtn && scrubInput) {
                            applyBtn.classList.add('m88-ab-tl-confirm-apply-btn');
                            applyBtn.onclick = async () => {
                              try {
                                if (typeof YB !== 'undefined' && YB.busy)
                                  YB.busy(true, '生成 A/B 套用确认卡…');
                                const preview = await api(
                                  '/imports/enterprise/conflict-ui-prefs/ab-apply/timeline/seek',
                                  {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      seq: Number(scrubInput.value),
                                      pause: true,
                                      previewConfirm: true,
                                      applyPreview: true,
                                    }),
                                  },
                                );
                                const card = preview.confirmCard || {};
                                const folded = card.foldedDiffs || {};
                                const roleLines = (folded.byRole || [])
                                  .filter(function (r) { return r.changed; })
                                  .slice(0, 6)
                                  .map(function (r) { return '角色·' + (r.roleZh || r.role) + ': ' + (r.changedZh || ''); })
                                  .join('\n');
                                const bucketLines = (folded.byBucket || [])
                                  .filter(function (r) { return r.changed; })
                                  .slice(0, 6)
                                  .map(function (r) { return '分桶·' + (r.bucketZh || r.bucket) + ': ' + (r.changedZh || ''); })
                                  .join('\n');
                                const diffLines = (card.diff || [])
                                  .slice(0, 8)
                                  .map(function (d) {
                                    return (d.key || '') + ': ' + JSON.stringify(d.before) + ' → ' + JSON.stringify(d.after);
                                  })
                                  .join('\n');
                                const foldBlock =
                                  (roleLines || bucketLines || folded.summaryZh)
                                    ? ('\n—— 折叠差异（角色/分桶）——\n' +
                                      (folded.summaryZh ? folded.summaryZh + '\n' : '') +
                                      (roleLines ? roleLines + '\n' : '') +
                                      (bucketLines ? bucketLines + '\n' : ''))
                                    : '';
                                const msg =
                                  (card.titleZh || '套用前确认') +
                                  '\n' +
                                  (card.bodyZh || preview.tipZh || '') +
                                  foldBlock +
                                  (diffLines ? '\n—— 扁平差异 ——\n' + diffLines : '');
                                if (
                                  typeof window !== 'undefined' &&
                                  window.confirm &&
                                  !window.confirm(msg)
                                ) {
                                  if (typeof YB !== 'undefined' && YB.toast)
                                    YB.toast('已取消套用', 'warn', 1800);
                                  return;
                                }
                                if (typeof YB !== 'undefined' && YB.busy)
                                  YB.busy(true, 'A/B seek 套用 prefs…');
                                const sresp = await api(
                                  '/imports/enterprise/conflict-ui-prefs/ab-apply/timeline/seek',
                                  {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      seq: Number(scrubInput.value),
                                      pause: true,
                                      confirmApply: true,
                                      confirmCardAck: true,
                                      applyPreview: true,
                                    }),
                                  },
                                );
                                if (typeof YB !== 'undefined' && YB.toast)
                                  YB.toast(
                                    sresp.toastZh || sresp.tipZh || '已套用',
                                    sresp.realPrefsApplied ? 'ok' : 'warn',
                                    2400,
                                  );
                              } catch (e) {
                                if (typeof YB !== 'undefined' && YB.toast)
                                  YB.toast(e.message || '套用失败', 'err');
                              } finally {
                                if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                              }
                            };
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || '时间线失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    const abScrubberBtn = fieldHost.querySelectorAll('.m86-role-ab-timeline-scrubber-btn')[1];
                    if (abScrubberBtn) {
                      abScrubberBtn.onclick = () => {
                        const tlBtn = fieldHost.querySelector('.m85-role-ab-timeline-btn');
                        if (tlBtn) tlBtn.click();
                      };
                    }

                    const grainIntoBtn = fieldHost.querySelector('.m85-field-grain-into-preview-btn');
                    if (grainIntoBtn) {
                      grainIntoBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy)
                            YB.busy(true, '字段粒灌入写库预演…');
                          const jobId =
                            (r0 && (r0.jobId || r0.id)) ||
                            (typeof currentImportJobId !== 'undefined' ? currentImportJobId : null);
                          if (!jobId) {
                            if (typeof YB !== 'undefined' && YB.toast)
                              YB.toast('缺少导入任务 id', 'warn');
                            return;
                          }
                          const bucket =
                            (r0 && (r0.confirmBucket || r0.bucket || r0.conflictType)) || 'org';
                          const resp = await api(
                            '/imports/enterprise/jobs/' +
                              encodeURIComponent(jobId) +
                              '/conflict-preview/field-grain-into-write-preview',
                            {
                              method: 'POST',
                              body: JSON.stringify({ bucket: bucket }),
                            },
                          );
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || resp.tipZh || '已灌入', 'ok', 2400);
                          let abHost = pane.querySelector('.m82-role-ab-preview-host');
                          if (!abHost) {
                            abHost = document.createElement('div');
                            abHost.className =
                              'm82-role-ab-preview-host m85-field-grain-into-preview-host';
                            abHost.style.cssText =
                              'margin-top:6px;padding:6px;border:1px dashed #9c9;border-radius:8px;font-size:12px';
                            fieldHost.appendChild(abHost);
                          }
                          abHost.innerHTML =
                            '<div class="muted m85-field-grain-into-preview-label m86-field-grain-undo-label">' +
                            (resp.labelZh || '字段粒灌入写库预演') +
                            '</div><div class="muted">' +
                            (resp.tipZh || '') +
                            (resp.undoAvailable ? ' · 可撤销' : '') +
                            '</div>';
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || '字段粒灌入失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    const grainUndoBtn = fieldHost.querySelectorAll('.m86-field-grain-undo-btn')[1];
                    if (grainUndoBtn) {
                      grainUndoBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '撤销字段粒灌入…');
                          const jobId =
                            (r0 && (r0.jobId || r0.id)) ||
                            (typeof currentImportJobId !== 'undefined' ? currentImportJobId : null);
                          if (!jobId) {
                            if (typeof YB !== 'undefined' && YB.toast)
                              YB.toast('缺少导入任务 id', 'warn');
                            return;
                          }
                          const bucket =
                            (r0 && (r0.confirmBucket || r0.bucket || r0.conflictType)) || 'org';
                          const resp = await api(
                            '/imports/enterprise/jobs/' +
                              encodeURIComponent(jobId) +
                              '/conflict-preview/field-grain-into-write-preview/undo',
                            {
                              method: 'POST',
                              body: JSON.stringify({ bucket: bucket }),
                            },
                          );
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast((resp.toastZh || resp.tipZh || '已撤销') + (resp.undoStackDepth != null ? ' · 栈余 ' + resp.undoStackDepth : ''), resp.undone ? 'ok' : 'warn', 2400);
                          let abHost = pane.querySelector('.m82-role-ab-preview-host');
                          if (!abHost) {
                            abHost = document.createElement('div');
                            abHost.className =
                              'm82-role-ab-preview-host m86-field-grain-undo-host';
                            abHost.style.cssText =
                              'margin-top:6px;padding:6px;border:1px dashed #c99;border-radius:8px;font-size:12px';
                            fieldHost.appendChild(abHost);
                          }
                          abHost.innerHTML =
                            '<div class="muted m86-field-grain-undo-label">' +
                            (resp.labelZh || '撤销字段粒灌入') +
                            '</div><div class="muted">' +
                            (resp.tipZh || '') +
                            '</div>';
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(e.message || '撤销失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M88：字段粒撤销栈时间线
                    const tlBtn = fieldHost.querySelector('.m88-field-grain-undo-timeline-btn:not(.m87-field-grain-undo-stack-btn)');
                    if (tlBtn) {
                      tlBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '加载字段粒撤销栈时间线…');
                          const jobId =
                            (r0 && (r0.jobId || r0.id)) ||
                            (typeof currentImportJobId !== 'undefined' ? currentImportJobId : null) ||
                            (window.__yanqiImportJobId) ||
                            '';
                          const path = jobId
                            ? '/imports/enterprise/jobs/' + encodeURIComponent(jobId) + '/conflict-preview/field-grain-into-write-preview/undo-timeline'
                            : '/imports/enterprise/conflict-preview/field-grain-undo-stack/timeline';
                          const resp = await api(path);
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || resp.tipZh || '撤销栈时间线', 'ok', 2200);
                          const frames = (resp.frames || [])
                            .slice(0, 8)
                            .map(function (f) {
                              return '#' + f.seq + ' ' + (f.summaryZh || '');
                            })
                            .join('\n');
                          let box = fieldHost.querySelector('.m88-field-grain-undo-timeline-box');
                          if (!box) {
                            box = document.createElement('pre');
                            box.className = 'm88-field-grain-undo-timeline-box';
                            box.style.cssText = 'white-space:pre-wrap;font-size:12px;max-height:120px;overflow:auto;margin-top:6px';
                            fieldHost.appendChild(box);
                          }
                          box.textContent = (resp.labelZh || '撤销栈时间线') + '\n' + (resp.tipZh || '') + '\n' + frames;
                          box.dataset.maxSeq = String(resp.scrubber && resp.scrubber.maxSeq != null ? resp.scrubber.maxSeq : (resp.depth || 0));
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '时间线失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M89/M90：字段粒时间线定点撤销 + 预览确认卡
                    const seekUndoBtn = fieldHost.querySelector('.m89-field-grain-seek-undo-btn:not(.m88-field-grain-undo-timeline-btn)');
                    if (seekUndoBtn) {
                      seekUndoBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '生成定点撤销确认卡…');
                          const jobId =
                            (r0 && (r0.jobId || r0.id)) ||
                            (typeof currentImportJobId !== 'undefined' ? currentImportJobId : null) ||
                            (window.__yanqiImportJobId) ||
                            '';
                          if (!jobId) {
                            if (typeof YB !== 'undefined' && YB.toast) YB.toast('缺 jobId，无法定点撤销', 'warn');
                            return;
                          }
                          const box = fieldHost.querySelector('.m88-field-grain-undo-timeline-box');
                          const maxSeq = Number((box && box.dataset.maxSeq) || 0);
                          let seq = maxSeq > 0 ? Math.max(0, maxSeq - 1) : 0;
                          if (typeof window !== 'undefined' && window.prompt) {
                            const raw = window.prompt('定点撤销：保留到第几帧（含）？留空=撤到上一帧', String(seq));
                            if (raw == null) {
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消定点撤销', 'warn', 1600);
                              return;
                            }
                            if (String(raw).trim() !== '') seq = Number(raw);
                          }
                          const preview = await api(
                            '/imports/enterprise/jobs/' + encodeURIComponent(jobId) + '/conflict-preview/field-grain-into-write-preview/undo-timeline/seek',
                            {
                              method: 'POST',
                              body: JSON.stringify({ seq: seq, keepSeq: true, previewConfirm: true }),
                            },
                          );
                          const card = preview.confirmCard || {};
                          const beforeLines = ((card.before && card.before.frames) || [])
                            .map(function (f) { return '#' + f.seq + ' ' + (f.summaryZh || ''); })
                            .join('\n');
                          const afterLines = ((card.after && card.after.frames) || [])
                            .map(function (f) { return '#' + f.seq + ' ' + (f.summaryZh || ''); })
                            .join('\n');
                          const dropLines = (card.dropping || [])
                            .map(function (f) { return '丢弃 #' + f.seq + ' ' + (f.summaryZh || ''); })
                            .join('\n');
                          const keepChoices = card.keepFieldChoices || preview.keepFieldChoices || [];
                          const keepHint = keepChoices.length
                            ? '\n—— 可保留字段（逗号分隔勾选）——\n' +
                              keepChoices.map(function (c) { return c.field + ' · ' + (c.labelZh || ''); }).join('\n')
                            : '';
                          const msg =
                            (card.titleZh || '定点撤销前确认') +
                            '\n' +
                            (card.bodyZh || preview.tipZh || '') +
                            '\n—— before ——\n' +
                            (beforeLines || (card.before && card.before.summaryZh) || '') +
                            '\n—— after ——\n' +
                            (afterLines || (card.after && card.after.summaryZh) || '') +
                            (dropLines ? '\n—— 将丢弃 ——\n' + dropLines : '') +
                            keepHint;
                          if (typeof window !== 'undefined' && window.confirm && !window.confirm(msg)) {
                            if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消定点撤销', 'warn', 1600);
                            return;
                          }
                          let keepFields = [];
                          let bulkKeepBuckets = [];
                          let exceptFieldsByBucket = {};
                          if (typeof window !== 'undefined' && window.prompt) {
                            const bulkRaw = window.prompt(
                              '按桶批量勾选保留（org/demand/person，逗号分隔）；留空=不按桶，下一步再勾字段',
                              (card.bulkKeepBuckets && card.bulkKeepBuckets.length)
                                ? card.bulkKeepBuckets.join(',')
                                : 'org,demand',
                            );
                            if (bulkRaw == null) {
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消定点撤销', 'warn', 1600);
                              return;
                            }
                            bulkKeepBuckets = String(bulkRaw)
                              .split(',')
                              .map(function (s) { return s.trim(); })
                              .filter(Boolean);
                          }
                          if (typeof window !== 'undefined' && window.prompt && bulkKeepBuckets.length) {
                            const exceptRaw = window.prompt(
                              '全选本桶但排除字段：bucket:field 或 field（逗号分隔）；留空=不排除',
                              '',
                            );
                            if (exceptRaw == null) {
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消定点撤销', 'warn', 1600);
                              return;
                            }
                            String(exceptRaw)
                              .split(',')
                              .map(function (s) { return s.trim(); })
                              .filter(Boolean)
                              .forEach(function (tok) {
                                if (tok.indexOf(':') >= 0) {
                                  const parts = tok.split(':');
                                  const bk = parts[0];
                                  const f = parts.slice(1).join(':');
                                  if (!exceptFieldsByBucket[bk]) exceptFieldsByBucket[bk] = [];
                                  exceptFieldsByBucket[bk].push(f);
                                } else if (bulkKeepBuckets[0]) {
                                  const bk = bulkKeepBuckets[0];
                                  if (!exceptFieldsByBucket[bk]) exceptFieldsByBucket[bk] = [];
                                  exceptFieldsByBucket[bk].push(tok);
                                }
                              });
                          }
                          if (keepChoices.length && typeof window !== 'undefined' && window.prompt) {
                            const rawKeep = window.prompt(
                              '勾选保留字段：填写字段名，逗号分隔；留空=仅用按桶勾选/排除',
                              keepChoices
                                .filter(function (c) { return c.checkedDefault || !bulkKeepBuckets.length; })
                                .slice(0, 4)
                                .map(function (c) { return c.field; })
                                .join(','),
                            );
                            if (rawKeep == null) {
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消定点撤销', 'warn', 1600);
                              return;
                            }
                            keepFields = String(rawKeep)
                              .split(',')
                              .map(function (s) { return s.trim(); })
                              .filter(Boolean);
                          }
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '字段粒定点撤销…');
                          const resp = await api(
                            '/imports/enterprise/jobs/' + encodeURIComponent(jobId) + '/conflict-preview/field-grain-into-write-preview/undo-timeline/seek',
                            {
                              method: 'POST',
                              body: JSON.stringify({
                                seq: seq,
                                keepSeq: true,
                                confirmUndo: true,
                                confirmCardAck: true,
                                keepFields: keepFields,
                                bulkKeepBuckets: bulkKeepBuckets,
                                exceptFieldsByBucket: exceptFieldsByBucket,
                              }),
                            },
                          );
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || resp.tipZh || '定点撤销', resp.undone ? 'ok' : 'warn', 2400);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '定点撤销失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M90：折叠差异只套用某一角色或分桶
                    const foldedOneBtn = fieldHost.querySelector('.m90-folded-apply-one-btn, .m91-folded-multiselect-btn');
                    if (foldedOneBtn) {
                      foldedOneBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '折叠差异只套用一角…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          let onlyRoles = [];
                          let onlyBuckets = [];
                          if (typeof window !== 'undefined' && window.prompt) {
                            const scope = window.prompt(
                              '多选套用：角色逗号分隔(admin/enterprise/broker/uni)，或分桶(org/demand/person)；可用 role=a,b bucket=x,y',
                              'enterprise,broker',
                            );
                            if (scope == null) {
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消只套用', 'warn', 1600);
                              return;
                            }
                            const s = String(scope).trim();
                            const rolePart = (s.match(/role\s*=\s*([^;]+)/i) || [])[1] || '';
                            const bucketPart = (s.match(/bucket\s*=\s*([^;]+)/i) || [])[1] || '';
                            const raw = rolePart || bucketPart ? '' : s;
                            const roleTokens = (rolePart || raw)
                              .split(',')
                              .map(function (x) { return x.trim(); })
                              .filter(Boolean);
                            const bucketTokens = (bucketPart || '')
                              .split(',')
                              .map(function (x) { return x.trim(); })
                              .filter(Boolean);
                            roleTokens.forEach(function (tok) {
                              if (['org', 'demand', 'person'].indexOf(tok) >= 0) onlyBuckets.push(tok);
                              else onlyRoles.push(tok);
                            });
                            bucketTokens.forEach(function (tok) {
                              if (onlyBuckets.indexOf(tok) < 0) onlyBuckets.push(tok);
                            });
                            if (!onlyRoles.length && !onlyBuckets.length) onlyRoles = ['enterprise'];
                          }
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline/seek', {
                            method: 'POST',
                            body: JSON.stringify({
                              seq: seq,
                              pause: true,
                              previewConfirm: true,
                              applyPreview: true,
                              applyOnlyRoles: onlyRoles,
                              applyOnlyBuckets: onlyBuckets,
                              applyOnlyRole: onlyRoles[0] || null,
                              applyOnlyBucket: onlyBuckets[0] || null,
                            }),
                          });
                          const card = preview.confirmCard || {};
                          const folded = card.foldedDiffs || {};
                          const msg =
                            (card.titleZh || '折叠差异多选套用') +
                            '\n' +
                            (card.bodyZh || preview.tipZh || '') +
                            '\n' +
                            (folded.summaryZh || '') +
                            '\n角色=' +
                            (onlyRoles.join(',') || '—') +
                            ' 分桶=' +
                            (onlyBuckets.join(',') || '—');
                          if (typeof window !== 'undefined' && window.confirm && !window.confirm(msg)) {
                            if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消只套用', 'warn', 1600);
                            return;
                          }
                          const resp = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline/seek', {
                            method: 'POST',
                            body: JSON.stringify({
                              seq: seq,
                              pause: true,
                              confirmApply: true,
                              confirmCardAck: true,
                              applyOnlyRoles: onlyRoles,
                              applyOnlyBuckets: onlyBuckets,
                              applyOnlyRole: onlyRoles[0] || null,
                              applyOnlyBucket: onlyBuckets[0] || null,
                            }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(resp.toastZh || resp.tipZh || '已只套用', resp.realPrefsApplied ? 'ok' : 'warn', 2400);
                          const sum = resp.undoableSummary || null;
                          if (sum && resp.realPrefsApplied) {
                            const sumMsg =
                              (sum.titleZh || '折叠多选套用摘要') +
                              '\n' +
                              (sum.bodyZh || '') +
                              ((sum.linesZh && sum.linesZh.length) ? '\n' + sum.linesZh.join('\n') : '') +
                              '\n是否软撤销本次套用？';
                            if (typeof window !== 'undefined' && window.confirm && window.confirm(sumMsg)) {
                              if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软撤销折叠多选套用…');
                              const und = await api(sum.softUndoPath || '/imports/enterprise/conflict-ui-prefs/ab-apply/undo', {
                                method: 'POST',
                                body: JSON.stringify({}),
                              });
                              if (typeof YB !== 'undefined' && YB.toast)
                                YB.toast(und.toastZh || und.tipZh || '已软撤销', und.undone ? 'ok' : 'warn', 2400);
                            }
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '只套用失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M94：排除字段模板按角色
                    const exceptTplBtn = fieldHost.querySelector('.m94-except-templates-btn, .m94-except-templates');
                    if (exceptTplBtn) {
                      exceptTplBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '排除字段模板按角色…');
                          let role = 'enterprise';
                          let nameZh = '机构税号排除';
                          let exceptFieldsByBucket = { org: ['taxId'] };
                          if (typeof window !== 'undefined' && window.prompt) {
                            const raw = window.prompt(
                              '保存排除模板：role|nameZh|bucket:field,bucket:field（例 enterprise|税号排除|org:taxId）',
                              'enterprise|机构税号排除|org:taxId',
                            );
                            if (raw == null) {
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消保存模板', 'warn', 1600);
                              return;
                            }
                            const parts = String(raw).split('|').map(function (s) { return s.trim(); });
                            if (parts[0]) role = parts[0];
                            if (parts[1]) nameZh = parts[1];
                            if (parts[2]) {
                              exceptFieldsByBucket = {};
                              String(parts[2])
                                .split(',')
                                .map(function (s) { return s.trim(); })
                                .filter(Boolean)
                                .forEach(function (tok) {
                                  const i = tok.indexOf(':');
                                  if (i < 0) return;
                                  const bk = tok.slice(0, i);
                                  const f = tok.slice(i + 1);
                                  if (!exceptFieldsByBucket[bk]) exceptFieldsByBucket[bk] = [];
                                  exceptFieldsByBucket[bk].push(f);
                                });
                            }
                          }
                          const saved = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates', {
                            method: 'POST',
                            body: JSON.stringify({ role: role, nameZh: nameZh, exceptFieldsByBucket: exceptFieldsByBucket }),
                          });
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/apply', {
                            method: 'POST',
                            body: JSON.stringify({ role: role, templateId: saved.template && saved.template.id }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(applied.toastZh || saved.toastZh || '排除模板', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '排除模板失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M94：可撤销摘要 → 站内一页纸
                    const undoOnePagerBtn = fieldHost.querySelector('.m94-undo-onepager-btn, .m94-folded-undo-onepager');
                    if (undoOnePagerBtn) {
                      undoOnePagerBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '渲染可撤销摘要一页纸…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager', {
                            method: 'POST',
                            body: JSON.stringify({ seq: seq }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '摘要一页纸', 'ok', 2200);
                          const sheet = (r.onePager && r.onePager.sheet) || {};
                          if (typeof window !== 'undefined' && window.alert) {
                            window.alert(
                              (r.labelZh || '可撤销摘要站内一页纸') +
                                '\n' +
                                (sheet.titleZh || '') +
                                '\n' +
                                ((sheet.whyBullets && sheet.whyBullets.join('；')) || r.tipZh || ''),
                            );
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要一页纸失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }


                    // M95：排除模板只读共享预览
                    const exceptSharedBtn = fieldHost.querySelector('.m95-except-shared-preview-btn, .m95-except-shared-preview');
                    if (exceptSharedBtn) {
                      exceptSharedBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '排除模板只读共享预览…');
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', readOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '只读共享预览', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '共享预览失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M95：摘要一页纸并入匹配解释侧栏
                    const undoSidebarBtn = fieldHost.querySelector('.m95-undo-sidebar-btn, .m95-undo-sidebar');
                    if (undoSidebarBtn) {
                      undoSidebarBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要一页纸并入匹配解释侧栏…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar', {
                            method: 'POST',
                            body: JSON.stringify({ seq: seq }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '侧栏摘要', 'ok', 2200);
                          const side = r.matchExplainSidebar || {};
                          const sheet = side.sheet || ((r.onePager && r.onePager.sheet) || {});
                          if (typeof YB !== 'undefined' && YB.openSheetLoading && YB.renderOnePager) {
                            YB.openSheetLoading(side.titleZh || '可撤销摘要 · 匹配解释侧栏');
                            const body = document.getElementById('ybSheetBody');
                            if (body) {
                              const fakeOp = {
                                scoreLabelZh: side.titleZh || '可撤销摘要',
                                statusZh: '侧栏·干跑',
                                pairLineZh: side.subtitleZh || '',
                                whyBullets: side.whyBullets || sheet.whyBullets || [],
                                riskCues: [],
                                rightsCues: (sheet.sections || []).map(function (s) { return (s.headingZh || '') + '：' + (s.bodyZh || ''); }),
                                nextStep: { labelZh: '软撤销仍在', whyZh: side.softUndoPath || '' },
                                trustNoteZh: '干跑无外发 · 并入匹配解释侧栏',
                              };
                              body.innerHTML = YB.renderOnePager(fakeOp, { roleHint: 'broker' });
                            }
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '侧栏摘要失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M96：共享预览复制为本角色草稿
                    const copyDraftBtn = fieldHost.querySelector('.m96-shared-copy-draft-btn, .m96-shared-copy-draft');
                    if (copyDraftBtn) {
                      copyDraftBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '复制共享预览为本角色草稿…');
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '已复制为本角色草稿', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '复制草稿失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M96：侧栏摘要联动 matchId 一页纸高亮
                    const matchHighlightBtn = fieldHost.querySelector('.m96-sidebar-match-highlight-btn, .m96-sidebar-match-highlight');
                    if (matchHighlightBtn) {
                      matchHighlightBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '侧栏摘要联动 matchId 一页纸高亮…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight', {
                            method: 'POST',
                            body: JSON.stringify({ seq: seq }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '侧栏联动高亮', 'ok', 2200);
                          const side = r.matchExplainSidebar || {};
                          const hi = r.highlight || side.highlight || {};
                          if (typeof YB !== 'undefined' && YB.openSheetLoading && YB.renderOnePager) {
                            YB.openSheetLoading((side.titleZh || '侧栏联动') + ' · ' + (r.matchId || hi.matchId || ''));
                            const body = document.getElementById('ybSheetBody');
                            if (body) {
                              body.classList.add('m96-sidebar-match-highlight', 'yb-sidebar-item-highlight');
                              const fakeOp = {
                                scoreLabelZh: side.titleZh || '侧栏联动一页纸',
                                statusZh: '联动高亮·干跑',
                                pairLineZh: 'matchId=' + (r.matchId || hi.matchId || ''),
                                whyBullets: side.whyBullets || [hi.tipZh || r.tipZh || ''],
                                riskCues: [],
                                rightsCues: ['一页纸路径：' + (hi.onePagerPath || side.onePagerPath || '')],
                                nextStep: { labelZh: '打开真实一页纸', whyZh: hi.onePagerPath || '' },
                                trustNoteZh: '干跑无外发 · 侧栏↔matchId 高亮',
                              };
                              body.innerHTML = YB.renderOnePager(fakeOp, { roleHint: 'broker' });
                            }
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '侧栏联动失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }


                    // M97：本角色草稿 ↔ 共享源差分
                    const draftDiffBtn = fieldHost.querySelector('.m97-draft-shared-diff-btn, .m97-draft-shared-diff');
                    if (draftDiffBtn) {
                      draftDiffBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '比对本角色草稿与共享源…');
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '草稿差分', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '草稿差分失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M97：侧栏 ↔ 一页纸章节双向 seek
                    const bidirSeekBtn = fieldHost.querySelector('.m97-sidebar-bidir-seek-btn, .m97-sidebar-bidir-seek');
                    if (bidirSeekBtn) {
                      bidirSeekBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '侧栏与一页纸章节双向定位…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek', {
                            method: 'POST',
                            body: JSON.stringify({ seq: seq, direction: 'both', sectionId: 'why' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '双向 seek', 'ok', 2200);
                          const body = document.getElementById('ybSheetBody');
                          if (body) {
                            body.classList.add('m97-sidebar-bidir-seek', 'yb-sidebar-item-highlight');
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '双向 seek 失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }


                    // M98：草稿回同步共享源
                    const draftResyncBtn = fieldHost.querySelector('.m98-draft-resync-btn, .m98-draft-resync');
                    if (draftResyncBtn) {
                      draftResyncBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '草稿回同步共享源…');
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, previewConfirm: true }),
                          });
                          if (preview && preview.confirmCard && typeof YB !== 'undefined' && YB.toast)
                            YB.toast(preview.toastZh || '请确认回同步', 'ok', 1800);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, confirmResync: true, confirmCardAck: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '已回同步', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '回同步失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M98：双向 seek 记住章节锚点
                    const rememberBtn = fieldHost.querySelector('.m98-bidir-remember-anchor-btn, .m98-bidir-remember-anchor');
                    if (rememberBtn) {
                      rememberBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '双向 seek 并记住章节锚点…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor', {
                            method: 'POST',
                            body: JSON.stringify({ seq: seq, direction: 'both', sectionId: 'risk', remember: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '已记住锚点', 'ok', 2200);
                          const body = document.getElementById('ybSheetBody');
                          if (body) {
                            body.classList.add('m98-bidir-remember-anchor', 'm97-sidebar-bidir-seek', 'yb-sidebar-item-highlight');
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '记住锚点失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }



                    // M99：分桶选择性回同步
                    const selectiveResyncBtn = fieldHost.querySelector('.m99-resync-buckets-btn, .m99-resync-buckets');
                    if (selectiveResyncBtn) {
                      selectiveResyncBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '分桶选择性回同步…');
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand'], previewConfirm: true }),
                          });
                          if (preview && preview.confirmCard && typeof YB !== 'undefined' && YB.toast)
                            YB.toast(preview.toastZh || '请确认分桶回同步', 'ok', 1800);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand'], confirmResync: true, confirmCardAck: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '已分桶回同步', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '分桶回同步失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    // M99：双向 seek 锚点按 matchId
                    const byMatchBtn = fieldHost.querySelector('.m99-anchor-by-matchid-btn, .m99-anchor-by-matchid');
                    if (byMatchBtn) {
                      byMatchBtn.onclick = async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '按 matchId 双向 seek 并记住章节锚点…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number(
                            (abTl.abTimelineScrubber && (abTl.abTimelineScrubber.currentSeq || abTl.abTimelineScrubber.maxSeq)) || 1,
                          );
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id', {
                            method: 'POST',
                            body: JSON.stringify({ seq: seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m99', remember: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast)
                            YB.toast(r.toastZh || r.tipZh || '已按 matchId 记住锚点', 'ok', 2200);
                          const body = document.getElementById('ybSheetBody');
                          if (body) {
                            body.classList.add('m99-anchor-by-matchid', 'm98-bidir-remember-anchor', 'yb-sidebar-item-highlight');
                          }
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'matchId 锚点失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      };
                    }

                    const saveBucketDefault = async (bucket, strategyTemplate) => {
                      try {
                        if (typeof YB !== 'undefined' && YB.busy)
                          YB.busy(true, '保存分桶字段默认…');
                        const roleKey =
                          (r0 && (r0.conflictUiRoleKey || (r0.conflictUiTenantPrefs && r0.conflictUiTenantPrefs.roleKey))) ||
                          'enterprise';
                        const bucketFieldDefaults = {};
                        bucketFieldDefaults[bucket] = { strategyTemplate: strategyTemplate };
                        const resp = await api('/imports/enterprise/conflict-ui-prefs', {
                          method: 'POST',
                          body: JSON.stringify({
                            role: roleKey,
                            asRoleOverlay: true,
                            roleOverlay: { bucketFieldDefaults: bucketFieldDefaults },
                            bucketFieldDefaults: bucketFieldDefaults,
                          }),
                        });
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast(resp.toastZh || '分桶默认已保存', 'ok', 2000);
                      } catch (e) {
                        if (typeof YB !== 'undefined' && YB.toast)
                          YB.toast(e.message || '分桶默认失败', 'err');
                      } finally {
                        if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                      }
                    };
                    const bOrg = fieldHost.querySelector('.m82-bucket-default-org');
                    if (bOrg) bOrg.onclick = () => saveBucketDefault('org', 'fill-empty');
                    const bDem = fieldHost.querySelector('.m82-bucket-default-demand');
                    if (bDem) bDem.onclick = () => saveBucketDefault('demand', 'overwrite');
                    const bPer = fieldHost.querySelector('.m82-bucket-default-person');
                    if (bPer) bPer.onclick = () => saveBucketDefault('person', 'skip');

                  } else {
                    fieldHost.innerHTML = '<span class="muted">本桶暂无变更字段可确认/跳过</span>';
                  }
                  if (typeof YB !== 'undefined' && YB.toast)
                    YB.toast(r.toastZh || wp.toastZh || (fd && fd.toastZh) || '写库预演完成', 'ok', 2600);
                  const out = pane.querySelector('.m67-cp-preview-out');
                  if (out)
                    out.textContent = (
                      (wp.tipZh || r.tipZh || '写库预演') +
                      (fd && fd.tipZh ? '\n' + fd.tipZh : '') +
                      (lines.length ? '\n' + lines.join('\n') : '')
                    ).slice(0, 900);
                  if (typeof showDlg === 'function' && lines.length) {
                    showDlg(
                      (wp.tipZh || r.tipZh || '写库预演') +
                        '\n【行级字段 diff】\n' +
                        lines.join('\n') +
                        (fdRows.length > 8 ? '\n…共 ' + fdRows.length + ' 行' : ''),
                    );
                  }
                } catch (e) {
                  const msg = e.message || '写库预演失败';
                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(msg, 'err');
                } finally {
                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                }
              };
            };
            wireWritePreview(pane.querySelector('.m74-cp-confirm-bucket-write-preview-org'), 'org');
            wireWritePreview(pane.querySelector('.m74-cp-confirm-bucket-write-preview-demand'), 'demand');
            wireWritePreview(pane.querySelector('.m74-cp-confirm-bucket-write-preview-person'), 'person');
            const confirmOnlyResumeBtn = pane.querySelector('.m69-cp-confirm-only-resume');
            if (confirmOnlyResumeBtn) {
              confirmOnlyResumeBtn.onclick = async () => {
                const dec = collectDecisions();
                confirmOnlyResumeBtn.disabled = true;
                try {
                  await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/row-decisions',
                    {
                      method: 'POST',
                      body: JSON.stringify(dec),
                      busy: true,
                      busyText: '保存决策后仅确认行续跑…',
                    },
                  );
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/resume',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        asyncWrite: true,
                        mergeStrategy: strategy,
                        confirmOnly: true,
                        respectRowDecisions: true,
                        skipRowIndexes: dec.skipRowIndexes,
                        confirmRowIndexes: dec.confirmRowIndexes,
                        slimOffset: pageSlimOffset,
                        slimLimit: pageSlimLimit,
                        pageCursor: 'slim:o' + pageSlimOffset + ':l' + pageSlimLimit,
                        alignConfirmOnlyCursor: true,
                        persistCursor: true,
                        conflictTypes:
                          (r.resumeCursor && r.resumeCursor.conflictTypes) || undefined,
                        bucket: (r.resumeCursor && r.resumeCursor.bucket) || undefined,
                      }),
                      busy: true,
                      busyText: '仅确认行续跑（游标对齐）…',
                    },
                  );
                  const zh =
                    (resp.crossPageDecisionSummary && resp.crossPageDecisionSummary.beforeApplyZh) ||
                    resp.summaryZh ||
                    resp.toastZh ||
                    '仅确认行续跑已入队';
                  YB.toast(zh, 'ok', 2600);
                  if (previewOut) {
                    previewOut.textContent =
                      zh +
                      (resp.confirmOnlyResumeCounts && resp.confirmOnlyResumeCounts.tipZh
                        ? ' · ' + resp.confirmOnlyResumeCounts.tipZh
                        : '') +
                      (resp.confirmOnlyResumeCursor && resp.confirmOnlyResumeCursor.tipZh
                        ? ' · ' + resp.confirmOnlyResumeCursor.tipZh
                        : '');
                  }
                } catch (e) {
                  const msg = e.message || '仅确认行续跑失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  confirmOnlyResumeBtn.disabled = false;
                }
              };
            }
            if (saveBtn) {
              saveBtn.onclick = async () => {
                const dec = collectDecisions();
                saveBtn.disabled = true;
                try {
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/row-decisions',
                    {
                      method: 'POST',
                      body: JSON.stringify(dec),
                      busy: true,
                      busyText: '保存按行确认/跳过…',
                    },
                  );
                  YB.toast(resp.toastZh || resp.tipZh || '行决策已保存', 'ok', 2200);
                  if (previewOut) previewOut.textContent = resp.tipZh || '';
                } catch (e) {
                  const msg = e.message || '保存失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  saveBtn.disabled = false;
                }
              };
            }
            if (previewBtn) {
              previewBtn.onclick = async () => {
                const dec = collectDecisions();
                previewBtn.disabled = true;
                try {
                  const resp = await YB.api(
                    '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/apply-preview',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        mergeStrategy: strategy,
                        persistDecisions: true,
                        skipRowIndexes: dec.skipRowIndexes,
                        confirmRowIndexes: dec.confirmRowIndexes,
                      }),
                      busy: true,
                      busyText: '按行确认预演写库计划…',
                    },
                  );
                  YB.toast(resp.toastZh || '预演完成', 'ok', 2400);
                  if (previewOut) {
                    previewOut.textContent =
                      (resp.tipZh || '') +
                      (resp.userSkipCountZh ? ' · ' + resp.userSkipCountZh : '') +
                      (resp.demandPersonWritePlan && resp.demandPersonWritePlan.summaryZh
                        ? ' · ' + resp.demandPersonWritePlan.summaryZh
                        : '');
                  }
                } catch (e) {
                  const msg = e.message || '预演失败';
                  YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
                } finally {
                  previewBtn.disabled = false;
                }
              };
            }
          }
          YB.toast(
            cancelledMid
              ? '冲突分页已取消（部分明细保留）'
              : '冲突明细已分页加载（可按行确认/跳过 · 一键全确认/全跳过）',
            cancelledMid ? 'warn' : 'ok',
            1600,
          )
        } catch (e) {
          const msg = e.message || '预览失败';
          const is401 = /401|登录|会话|未登录|Unauthorized/i.test(msg);
          const is403 = /403|无权|没有权限|Forbidden/i.test(msg);
          const zh = is401
            ? '登录已失效，无法预览冲突（401）。请重新登录。'
            : is403
              ? '没有权限预览冲突（403）。请切换有导入权限的账号。'
              : msg;
          if (out) out.textContent = zh;
          YB.toast(zh, is401 || is403 ? 'security' : 'err');
        } finally {
          btn.disabled = false;
        }
      };
    });
el.querySelectorAll('.resume-csv-btn').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('.resume-card');
        const id = btn.getAttribute('data-id');
        const sel = card && card.querySelector('.resume-merge-select');
        const strategy = sel ? sel.value : 'fill-empty';
        btn.disabled = true;
        try {
          const path =
            '/api/imports/enterprise/jobs/' +
            encodeURIComponent(id) +
            '/conflict-preview.csv?mergeStrategy=' +
            encodeURIComponent(strategy);
          const tok = YB.token || localStorage.getItem('yanqi_token') || '';
          const r = await fetch(path, {
            headers: tok ? { Authorization: 'Bearer ' + tok } : {},
            credentials: 'include',
          });
          if (!r.ok) throw new Error('导出失败 ' + r.status);
          const blob = await r.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'conflict-preview-' + String(id).slice(0, 8) + '.csv';
          document.body.appendChild(a);
          a.click();
          a.remove();
          YB.toast('冲突预览 CSV 已下载', 'ok');
        } catch (e) {
          YB.toast(e.message || '导出失败', 'err');
        } finally {
          btn.disabled = false;
        }
      };
    });
    el.querySelectorAll('.resume-full-csv-btn, .resume-full-zip-btn').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('.resume-card');
        const id = btn.getAttribute('data-id');
        const sel = card && card.querySelector('.resume-merge-select');
        const strategy = sel ? sel.value : 'fill-empty';
        const isZip = btn.classList.contains('resume-full-zip-btn');
        const ext = isZip ? 'zip' : 'csv';
        btn.disabled = true;
        try {
          const path =
            '/api/imports/enterprise/jobs/' +
            encodeURIComponent(id) +
            '/conflict-export.' +
            ext +
            '?mergeStrategy=' +
            encodeURIComponent(strategy);
          const tok = YB.token || localStorage.getItem('yanqi_token') || '';
          const r = await fetch(path, {
            headers: tok ? { Authorization: 'Bearer ' + tok } : {},
            credentials: 'include',
          });
          if (!r.ok) throw new Error('全量导出失败 ' + r.status);
          const rows = r.headers.get('x-yanqi-conflict-rows') || '';
          const blob = await r.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'conflict-full-' + String(id).slice(0, 8) + '.' + ext;
          document.body.appendChild(a);
          a.click();
          a.remove();
          YB.toast('全量冲突 ' + ext.toUpperCase() + ' 已下载' + (rows ? '（' + rows + ' 行）' : ''), 'ok');
        } catch (e) {
          YB.toast(e.message || '全量导出失败', 'err');
        } finally {
          btn.disabled = false;
        }
      };
    });
    el.querySelectorAll('.resume-go-btn').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('.resume-card');
        const kind = btn.getAttribute('data-kind');
        const path = String(btn.getAttribute('data-path') || '').replace(/^\/api/, '');
        const sel = card && card.querySelector('.resume-merge-select');
        const body = kind === 'import' ? { asyncWrite: true, mergeStrategy: sel ? sel.value : 'fill-empty' } : {};
        btn.disabled = true;
        btn.textContent = '续跑入队中…';
        try {
          if (typeof opts.onResume === 'function') {
            await opts.onResume({ kind, path, body, card });
          } else {
            const r = await YB.api(path, { method: 'POST', body: JSON.stringify(body), busyText: '续跑入队…' });
            YB.toast((r && (r.summaryZh || r.messageZh)) || '已续跑入队', 'ok');
          }
          if (typeof opts.onChanged === 'function') opts.onChanged();
          else YB.loadResumeCards(el, opts);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = '续跑';
          YB.toast(e.message || '续跑失败', 'err');
        }
      };
    });
    el.querySelectorAll('.resume-confirm-only-btn').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('.resume-card');
        const kind = btn.getAttribute('data-kind');
        const path = String(btn.getAttribute('data-path') || '').replace(/^\/api/, '');
        const sel = card && card.querySelector('.resume-merge-select');
        const sumEl = card && card.querySelector('.m69-cross-page-summary');
        const beforeZh = sumEl ? sumEl.textContent : '';
        if (beforeZh) {
          YB.toast('跨页决策摘要：' + beforeZh.slice(0, 120), 'ok', 2200);
        }
        const bucket = btn.getAttribute('data-bucket') || '';
        const pageCursor = btn.getAttribute('data-page-cursor') || '';
        const slimOffsetRaw = btn.getAttribute('data-slim-offset');
        const slimLimitRaw = btn.getAttribute('data-slim-limit');
        const conflictTypesRaw = btn.getAttribute('data-conflict-types') || '';
        const conflictTypes = conflictTypesRaw
          ? conflictTypesRaw.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const body =
          kind === 'import'
            ? {
                asyncWrite: true,
                mergeStrategy: sel ? sel.value : 'fill-empty',
                confirmOnly: true,
                respectRowDecisions: true,
                persistCursor: true,
                alignConfirmOnlyCursor: true,
                bucket: bucket || undefined,
                conflictType: bucket || undefined,
                conflictTypes: conflictTypes,
                pageCursor: pageCursor || undefined,
                slimOffset:
                  slimOffsetRaw !== '' && slimOffsetRaw != null
                    ? Number(slimOffsetRaw)
                    : undefined,
                slimLimit:
                  slimLimitRaw !== '' && slimLimitRaw != null
                    ? Number(slimLimitRaw)
                    : undefined,
              }
            : { confirmOnly: true };
        btn.disabled = true;
        const oldLabel = btn.textContent;
        btn.textContent = '仅确认行续跑（带桶/游标）…';
        try {
          const r = await YB.api(path, {
            method: 'POST',
            body: JSON.stringify(body),
            busy: true,
            busyText: '仅确认行续跑（桶/游标）入队…',
          });
          const zh =
            (r &&
              ((r.crossPageDecisionSummary && r.crossPageDecisionSummary.beforeApplyZh) ||
                r.summaryZh ||
                r.messageZh)) ||
            '仅确认行续跑已入队';
          YB.toast(zh, 'ok', 2600);
          if (typeof opts.onChanged === 'function') opts.onChanged();
          else YB.loadResumeCards(el, opts);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = oldLabel || '仅确认行续跑';
          const msg = e.message || '仅确认行续跑失败';
          YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
        }
      };
    });
    el.querySelectorAll('.m73-jobcard-undo-skip').forEach((btn) => {
      btn.onclick = async () => {
        const path = String(btn.getAttribute('data-path') || '').replace(/^\/api/, '');
        btn.disabled = true;
        try {
          const r = await YB.api(path, {
            method: 'POST',
            body: JSON.stringify({}),
            busy: true,
            busyText: '撤销分桶跳过…',
          });
          YB.toast(r.toastZh || r.tipZh || '已撤销分桶跳过', r.ok === false ? 'err' : 'ok', 2400);
          if (typeof opts.onChanged === 'function') opts.onChanged();
          else YB.loadResumeCards(el, opts);
        } catch (e) {
          const msg = e.message || '撤销失败';
          YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
        } finally {
          btn.disabled = false;
        }
      };
    });
    el.querySelectorAll('.m73-jobcard-confirm-bucket-resume').forEach((btn) => {
      btn.onclick = async () => {
        const path = String(btn.getAttribute('data-path') || '').replace(/^\/api/, '');
        const bucket = btn.getAttribute('data-bucket') || 'org';
        const card = btn.closest('.resume-card');
        const sel = card && card.querySelector('.resume-merge-select');
        btn.disabled = true;
        const oldLabel = btn.textContent;
        btn.textContent = '确认本桶+续跑…';
        try {
          const r = await YB.api(path, {
            method: 'POST',
            body: JSON.stringify({
              bucket: bucket,
              persistCursor: true,
              mergeStrategy: sel ? sel.value : 'fill-empty',
            }),
            busy: true,
            busyText: '确认本桶+续跑…',
            cancellable: true,
          });
          YB.toast(r.toastZh || r.tipZh || '确认本桶+续跑完成', r.ok === false ? 'err' : 'ok', 2600);
          if (typeof opts.onChanged === 'function') opts.onChanged();
          else YB.loadResumeCards(el, opts);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = oldLabel || '确认本桶+续跑';
          const msg = e.message || '确认本桶续跑失败';
          YB.toast(msg, /401|403/.test(msg) ? 'security' : 'err');
        }
      };
    });
    el.querySelectorAll('.m74-jobcard-skip-diff').forEach((btn) => {
      btn.onclick = async () => {
        const path = btn.getAttribute('data-path');
        if (!path) return;
        try {
          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '回放分桶跳过差分…');
          const r = await api(path.replace(/^\/api/, ''), { method: 'GET' });
          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '差分回放', 'ok', 2400);
          const out = el.querySelector('.resume-preview-out');
          if (out) {
            out.hidden = false;
            const events = r.events || [];
            out.textContent =
              (r.tipZh || '') +
              '\n' +
              events
                .slice(-8)
                .map((e) => '#' + e.seq + ' ' + (e.actionZh || '') + ' ' + (e.tipZh || ''))
                .join('\n');
          }
        } catch (e) {
          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '回放失败', 'err');
        } finally {
          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
        }
      };
    });
    el.querySelectorAll('.m75-jobcard-jump-seq').forEach((btn) => {
      btn.onclick = async () => {
        const path = btn.getAttribute('data-path');
        const id = btn.getAttribute('data-id');
        if (!path) return;
        try {
          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '读取差分后跳到 seq 还原…');
          const diffPath =
            '/imports/enterprise/jobs/' + encodeURIComponent(id) + '/conflict-preview/skip-bucket-diff';
          const diff = await api(diffPath, { method: 'GET' });
          const events = diff.events || [];
          if (!events.length) {
            if (typeof YB !== 'undefined' && YB.toast) YB.toast('暂无差分可还原', 'warn');
            return;
          }
          const last = events[events.length - 1];
          const raw =
            typeof prompt === 'function'
              ? prompt('跳到哪个 seq 还原？（1..' + events.length + '）', String(last.seq || events.length))
              : String(last.seq || events.length);
          const seq = Number(raw);
          if (!Number.isFinite(seq) || seq < 1) {
            if (typeof YB !== 'undefined' && YB.toast) YB.toast('已取消跳到 seq 还原', 'warn');
            return;
          }
          const r = await api(path.replace(/^\/api/, ''), {
            method: 'POST',
            body: JSON.stringify({ seq }),
          });
          if (typeof YB !== 'undefined' && YB.toast)
            YB.toast(r.toastZh || '已跳到 seq 还原', r.ok === false ? 'err' : 'ok', 2600);
          const out = el.querySelector('.resume-preview-out');
          if (out) {
            out.hidden = false;
            out.textContent = r.tipZh || '';
          }
        } catch (e) {
          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '跳到 seq 还原失败', 'err');
        } finally {
          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
        }
      };
    });
    el.querySelectorAll('.m74-jobcard-write-preview').forEach((btn) => {
      btn.onclick = async () => {
        const path = btn.getAttribute('data-path');
        const bucket = btn.getAttribute('data-bucket') || 'org';
        if (!path) return;
        try {
          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '确认本桶写库预演（行级字段 diff）…');
          const r = await api(path.replace(/^\/api/, ''), {
            method: 'POST',
            body: JSON.stringify({ bucket, persistCursor: true }),
          });
          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '写库预演完成', 'ok', 2600);
          const out = el.querySelector('.resume-preview-out');
          if (out) {
            out.hidden = false;
            const wp = r.writePlanPreview || {};
            const fd = wp.rowFieldDiff || {};
            const lines = (fd.rows || []).slice(0, 6).map((row) => {
              const ch = (row.fields || [])
                .filter((f) => f.change && f.change !== 'unchanged')
                .slice(0, 3)
                .map((f) => (f.fieldZh || f.field) + ':' + (f.changeZh || f.change));
              return '#' + row.rowIndex + ' ' + (row.name || '') + (ch.length ? ' · ' + ch.join('；') : '');
            });
            out.textContent =
              (r.tipZh || '') +
              (wp.tipZh ? '\n' + wp.tipZh : '') +
              (fd.tipZh ? '\n' + fd.tipZh : '') +
              (lines.length ? '\n' + lines.join('\n') : '');
          }
        } catch (e) {
          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '写库预演失败', 'err');
        } finally {
          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
        }
      };
    });


  }

                    // M100：分桶回同步 before/after 对照
                    const contrastResyncBtn = fieldHost.querySelector('.m100-resync-contrast-btn, .m100-resync-contrast');
                    if (contrastResyncBtn && !contrastResyncBtn._m100Bound) {
                      contrastResyncBtn._m100Bound = true;
                      contrastResyncBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '分桶回同步 before/after 对照…');
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand'], previewConfirm: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(preview.toastZh || '请确认对照', 'ok', 1600);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand'], confirmResync: true, confirmCardAck: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '已对照回同步', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '对照回同步失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M100：matchId 锚点跨会话模板
                    const crossTplBtn = fieldHost.querySelector('.m100-anchor-template-btn, .m100-anchor-template');
                    if (crossTplBtn && !crossTplBtn._m100bound) {
                      crossTplBtn._m100bound = true;
                      crossTplBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '保存/加载 matchId 跨会话锚点模板…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m100', remember: true, saveAsTemplate: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '跨会话模板', 'ok', 2200);
                          const body = document.body;
                          if (body) body.classList.add('m100-anchor-template', 'm99-anchor-by-matchid', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '跨会话模板失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    // M101：对照卡只同步变更桶
                    const changedOnlyBtn = fieldHost.querySelector('.m101-resync-changed-only-btn, .m101-resync-changed-only');
                    if (changedOnlyBtn && !changedOnlyBtn._m101bound) {
                      changedOnlyBtn._m101bound = true;
                      changedOnlyBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '分桶回同步 · 只同步变更桶…');
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], previewConfirm: true, syncChangedBucketsOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(preview.toastZh || '请确认只同步变更桶', 'ok', 1600);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], confirmResync: true, confirmCardAck: true, syncChangedBucketsOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '已只同步变更桶', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '只同步变更桶失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M101：跨会话锚点模板按角色分套
                    const byRoleTplBtn = fieldHost.querySelector('.m101-anchor-by-role-btn, .m101-anchor-by-role');
                    if (byRoleTplBtn && !byRoleTplBtn._m101bound) {
                      byRoleTplBtn._m101bound = true;
                      byRoleTplBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '保存/加载按角色跨会话锚点模板…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m101', remember: true, saveAsTemplate: true, role: 'broker', templateNameZh: '演示·经纪人跨会话' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '按角色跨会话模板', 'ok', 2200);
                          const body = document.body;
                          if (body) body.classList.add('m101-anchor-by-role', 'm100-anchor-template', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '按角色模板失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    // M102：变更桶跳过清单预览
                    const skipListBtn = fieldHost.querySelector('.m102-skip-list-btn, .m102-skip-list');
                    if (skipListBtn && !skipListBtn._m102bound) {
                      skipListBtn._m102bound = true;
                      skipListBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '只同步变更桶 · 跳过清单预览…');
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], previewConfirm: true, previewSkipList: true, syncChangedBucketsOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '跳过清单预览', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '跳过清单失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M102：按角色模板跨租户只读克隆
                    const cloneTplBtn = fieldHost.querySelector('.m102-role-tpl-clone-btn, .m102-role-tpl-clone');
                    if (cloneTplBtn && !cloneTplBtn._m102bound) {
                      cloneTplBtn._m102bound = true;
                      cloneTplBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '跨租户只读克隆按角色模板…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m102', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, confirmClone: true, confirmCardAck: true, templateNameZh: '演示·跨租户只读克隆' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '跨租户只读克隆', 'ok', 2200);
                          const body = document.body;
                          if (body) body.classList.add('m102-role-tpl-clone', 'm101-anchor-by-role', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '跨租户克隆失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    // M103：跳过清单勾选强制纳入
                    const forceIncBtn = fieldHost.querySelector('.m103-skip-force-include-btn, .m103-skip-force-include');
                    if (forceIncBtn && !forceIncBtn._m103bound) {
                      forceIncBtn._m103bound = true;
                      forceIncBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '跳过清单 · 勾选强制纳入…');
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], previewConfirm: true, previewSkipList: true, forceIncludePicks: true, forceIncludeBuckets: ['person'], syncChangedBucketsOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '强制纳入预览', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '强制纳入失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M103：跨租户克隆差分预览再采纳
                    const cloneDiffBtn = fieldHost.querySelector('.m103-clone-diff-adopt-btn, .m103-clone-diff-adopt');
                    if (cloneDiffBtn && !cloneDiffBtn._m103bound) {
                      cloneDiffBtn._m103bound = true;
                      cloneDiffBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '跨租户只读克隆差分预览再采纳…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m103', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, diffPreview: true, showDiffPreview: true, templateNameZh: '演示·跨租户克隆差分' }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m103', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: '演示·跨租户克隆差分' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || preview.toastZh || '差分采纳', 'ok', 2200);
                          const body = document.body;
                          if (body) body.classList.add('m103-clone-diff-adopt', 'm102-role-tpl-clone', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '克隆差分采纳失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    // M104：强制纳入存为角色默认
                    const forceDefBtn = fieldHost.querySelector('.m104-force-include-role-defaults-btn, .m104-force-include-role-defaults');
                    if (forceDefBtn && !forceDefBtn._m104bound) {
                      forceDefBtn._m104bound = true;
                      forceDefBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '强制纳入 · 存为角色默认…');
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults', {
                            method: 'POST',
                            body: JSON.stringify({ fromRole: 'enterprise', toRole: 'broker', myRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], previewSkipList: true, forceIncludePicks: true, forceIncludeBuckets: ['person'], saveAsRoleDefaults: true, syncChangedBucketsOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || '已存角色默认', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '角色默认失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M104：克隆差分字段子集采纳
                    const cloneSubsetBtn = fieldHost.querySelector('.m104-clone-diff-field-subset-btn, .m104-clone-diff-field-subset');
                    if (cloneSubsetBtn && !cloneSubsetBtn._m104bound) {
                      cloneSubsetBtn._m104bound = true;
                      cloneSubsetBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '克隆差分字段子集采纳…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m104', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], templateNameZh: '演示·字段子集采纳' }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m104', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: '演示·字段子集采纳' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || preview.toastZh || '字段子集采纳', 'ok', 2200);
                          const body = document.body;
                          if (body) body.classList.add('m104-clone-diff-field-subset', 'm103-clone-diff-adopt', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '字段子集采纳失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    // M105：角色默认 A/B 套用
                    const roleAbBtn = fieldHost.querySelector('.m105-role-defaults-ab-btn, .m105-role-defaults-ab');
                    if (roleAbBtn && !roleAbBtn._m105bound) {
                      roleAbBtn._m105bound = true;
                      roleAbBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '角色默认 A/B 对照套用…');
                          const preview = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || preview.toastZh || '角色默认A/B', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '角色默认A/B失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M105：字段子集采纳软撤销
                    const softUndoBtn = fieldHost.querySelector('.m105-field-subset-soft-undo-btn, .m105-field-subset-soft-undo');
                    if (softUndoBtn && !softUndoBtn._m105bound) {
                      softUndoBtn._m105bound = true;
                      softUndoBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '字段子集采纳软撤销…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m105', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: '演示·字段子集软撤销' }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo', {
                            method: 'POST',
                            body: JSON.stringify({ softUndo: true, undoToken: adopted.softUndoToken || null, role: 'broker', matchId: 'demo-match-m105' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || adopted.toastZh || '软撤销', 'ok', 2200);
                          const body = document.body;
                          if (body) body.classList.add('m105-field-subset-soft-undo', 'm104-clone-diff-field-subset', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '字段子集软撤销失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });

                    // M106：A/B 胜出侧软撤销
                    const abSoftBtn = fieldHost.querySelector('.m106-ab-winner-soft-undo-btn, .m106-ab-winner-soft-undo');
                    if (abSoftBtn && !abSoftBtn._m106bound) {
                      abSoftBtn._m106bound = true;
                      abSoftBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 胜出侧软撤销…');
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo', {
                            method: 'POST',
                            body: JSON.stringify({ softUndo: true, undoToken: applied.softUndoToken || null, targetRole: 'broker' }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || applied.toastZh || '胜出侧软撤销', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '胜出侧软撤销失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M106：字段子集软撤销前后对照
                    const softBaBtn = fieldHost.querySelector('.m106-field-subset-softundo-ba-btn, .m106-field-subset-softundo-ba');
                    if (softBaBtn && !softBaBtn._m106bound) {
                      softBaBtn._m106bound = true;
                      softBaBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '字段子集软撤销前后对照…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m106', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: '演示·字段子集软撤销前后对照' }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast', {
                            method: 'POST',
                            body: JSON.stringify({ softUndo: true, undoToken: adopted.softUndoToken || null, role: 'broker', matchId: 'demo-match-m106', showBeforeAfterCard: true, beforeAfterContrast: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || adopted.toastZh || '软撤销前后对照', 'ok', 2200);
                          if (document.body) document.body.classList.add('m106-field-subset-softundo-ba', 'm105-field-subset-soft-undo', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '软撤销前后对照失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    // M107：胜出侧软撤销前后对照
                    const abSoftBaBtn = fieldHost.querySelector('.m107-ab-winner-softundo-ba-btn, .m107-ab-winner-softundo-ba');
                    if (abSoftBaBtn && !abSoftBaBtn._m107bound) {
                      abSoftBaBtn._m107bound = true;
                      abSoftBaBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '胜出侧软撤销前后对照…');
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true }),
                          });
                          const r = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast', {
                            method: 'POST',
                            body: JSON.stringify({ softUndo: true, undoToken: applied.softUndoToken || null, targetRole: 'broker', showBeforeAfterCard: true, beforeAfterContrast: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(r.toastZh || applied.toastZh || '胜出侧软撤销前后对照', 'ok', 2200);
                          if (document.body) document.body.classList.add('m107-ab-winner-softundo-ba', 'm106-ab-winner-soft-undo');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '胜出侧软撤销前后对照失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    // M107：字段子集前后卡定点/只采纳一侧
                    

                    const winnerPinReBtn = fieldHost.querySelector('.m109-winner-pinpoint-rebypass-btn, .m109-winner-pinpoint-rebypass');
                    if (winnerPinReBtn && !winnerPinReBtn._m109Bound) {
                      winnerPinReBtn._m109Bound = true;
                      winnerPinReBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '胜出侧定点再旁路…');
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true }),
                          });
                          const undone = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass', {
                            method: 'POST',
                            body: JSON.stringify({ softUndo: true, undoToken: applied.softUndoToken || null, targetRole: 'broker', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateFields: ['org', 'person'], noteZh: 'wb·胜出侧定点再旁路', pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(undone.toastZh || '定点再旁路', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '定点再旁路失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const onesideScrubBtn = fieldHost.querySelector('.m109-oneside-summary-scrub-ab-btn, .m109-oneside-summary-scrub-ab');
                    if (onesideScrubBtn && !onesideScrubBtn._m109Bound) {
                      onesideScrubBtn._m109Bound = true;
                      onesideScrubBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '一侧摘要进A/B时间线…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m109', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: 'wb一侧摘要进时间线', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'sectionId'], adoptOneSideOnly: true, adoptSide: 'before', confirmOneside: true, showUndoableSummary: true, onesideSoftUndoSummary: true, scrubIntoAbTimeline: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || '一侧摘要已入时间线', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '一侧摘要进时间线失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }


                    const pinFailFoldBtn = fieldHost.querySelector('.m110-pinpoint-rebypass-fail-fold-btn, .m110-pinpoint-rebypass-fail-fold');
                    if (pinFailFoldBtn && !pinFailFoldBtn._m110bound) {
                      pinFailFoldBtn._m110bound = true;
                      pinFailFoldBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '定点再旁路失败并入归因…');
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateFields: ['org', 'person'], pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, simulateFailure: true, forceFailure: true, failureCode: 'PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(applied.toastZh || '失败已入归因', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '失败并入归因失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const summaryPinBtn = fieldHost.querySelector('.m110-ab-summary-frame-pinpoint-btn, .m110-ab-summary-frame-pinpoint');
                    if (summaryPinBtn && !summaryPinBtn._m110bound) {
                      summaryPinBtn._m110bound = true;
                      summaryPinBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B摘要帧定点…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m110', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: 'wb摘要帧定点', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateSummaryFrames: true, summaryFramePinpoint: true, annotateFields: ['titleZh', 'sectionId'], adoptOneSideOnly: true, adoptSide: 'before', confirmOneside: true, showUndoableSummary: true, onesideSoftUndoSummary: true, scrubIntoAbTimeline: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || '摘要帧已定点', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要帧定点失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }


                    const failRetryFoldBtn = fieldHost.querySelector('.m111-fail-attr-retry-fold-taskcard-btn, .m111-fail-attr-retry-fold-taskcard');
                    if (failRetryFoldBtn && !failRetryFoldBtn._m111bound) {
                      failRetryFoldBtn._m111bound = true;
                      failRetryFoldBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '失败归因一键重试折进任务卡…');
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateFields: ['org', 'person'], pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, simulateFailure: true, forceFailure: true, failureCode: 'PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, oneClickRetry: true, retryFromAttribution: true, foldIntoChainTaskCard: true, foldRetryIntoChainTaskCard: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(applied.toastZh || '重试已折进任务卡', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '重试折进任务卡失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const summaryReBtn = fieldHost.querySelector('.m111-summary-pinpoint-rebypass-btn, .m111-summary-pinpoint-rebypass');
                    if (summaryReBtn && !summaryReBtn._m111bound) {
                      summaryReBtn._m111bound = true;
                      summaryReBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要帧定点再旁路…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m111', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: 'wb摘要帧定点再旁路', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateSummaryFrames: true, summaryFramePinpoint: true, annotateFields: ['titleZh', 'sectionId'], adoptOneSideOnly: true, adoptSide: 'before', confirmOneside: true, showUndoableSummary: true, onesideSoftUndoSummary: true, scrubIntoAbTimeline: true, pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || '摘要帧定点再旁路', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要帧定点再旁路失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

                    const pauseGraceBtn = fieldHost.querySelector('.m112-retry-phase-pause-grace-btn, .m112-retry-phase-pause-grace, .m113-grace-soft-cancel-ledger-btn, .m113-grace-soft-cancel-ledger');
                    if (pauseGraceBtn && !pauseGraceBtn._m112bound) {
                      pauseGraceBtn._m112bound = true;
                      pauseGraceBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '任务卡重试单阶段暂停宽限…');
                          const applied = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace', {
                            method: 'POST',
                            body: JSON.stringify({ roleA: 'broker', roleB: 'admin', targetRole: 'broker', forceIncludeBucketsA: ['person'], forceIncludeBucketsB: ['org', 'person'], ensureSaveA: true, ensureSaveB: true, abCompare: true, applyWinner: true, confirmApply: true, confirmCardAck: true, fromRole: 'enterprise', toRole: 'broker', ensureCopy: true, buckets: ['org', 'demand', 'person'], syncChangedBucketsOnly: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateFields: ['org', 'person'], pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, simulateFailure: true, forceFailure: true, failureCode: 'PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, oneClickRetry: true, retryFromAttribution: true, foldIntoChainTaskCard: true, foldRetryIntoChainTaskCard: true, pausePhase: true, phasePause: true, phase: 'one-click-retry', graceAlarm: true, showGraceAlarm: true, autoResumeAfterGrace: true, graceMs: 15000 }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(applied.toastZh || '阶段暂停宽限', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '阶段暂停宽限失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const summaryBaBtn = fieldHost.querySelector('.m112-summary-rebypass-before-after-btn, .m112-summary-rebypass-before-after, .m113-summary-ba-pinpoint-rebypass-btn, .m113-summary-ba-pinpoint-rebypass');
                    if (summaryBaBtn && !summaryBaBtn._m112bound) {
                      summaryBaBtn._m112bound = true;
                      summaryBaBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要帧再旁路前后对照…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m112', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: 'wb摘要帧再旁路前后对照', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateSummaryFrames: true, summaryFramePinpoint: true, annotateFields: ['titleZh', 'sectionId'], adoptOneSideOnly: true, adoptSide: 'before', confirmOneside: true, showUndoableSummary: true, onesideSoftUndoSummary: true, scrubIntoAbTimeline: true, pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || '摘要帧再旁路前后对照', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要帧再旁路前后对照失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }


                    const softCancelRoleAuditBtn = fieldHost.querySelector('.m114-soft-cancel-ledger-role-audit-btn, .m114-soft-cancel-ledger-role-audit');
                    if (softCancelRoleAuditBtn && !softCancelRoleAuditBtn._m114bound) {
                      softCancelRoleAuditBtn._m114bound = true;
                      softCancelRoleAuditBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软取消台账角色过滤审计一页纸…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager', {
                            method: 'POST',
                            body: JSON.stringify({ softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true, targetRole: 'broker', role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true, oneClickRetry: true, retryFromAttribution: true, foldIntoChainTaskCard: true, foldRetryIntoChainTaskCard: true, pausePhase: true, phasePause: true, phase: 'one-click-retry', graceAlarm: true, showGraceAlarm: true, autoResumeAfterGrace: true, graceMs: 15000, simulateFailure: true, forceFailure: true, failureCode: 'PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, dryRun: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '软取消审计一页纸', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '软取消审计一页纸失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const summaryFailFoldBtn = fieldHost.querySelector('.m114-summary-pinpoint-rebypass-fail-fold-btn, .m114-summary-pinpoint-rebypass-fail-fold');
                    const softCancelSeekBtn = fieldHost.querySelector('.m115-soft-cancel-audit-seek-ledger-btn, .m115-soft-cancel-audit-seek-ledger');
                    const summaryFfReplayBtn = fieldHost.querySelector('.m115-summary-fail-attr-ff-replay-btn, .m115-summary-fail-attr-ff-replay');
                    
                    if (softCancelSeekBtn && !softCancelSeekBtn._m115Bound) {
                      softCancelSeekBtn._m115Bound = true;
                      softCancelSeekBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软取消审计一页纸 seek 回台账…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger', { method: 'POST', body: JSON.stringify({ softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true, role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true, seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, dryRun: true }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '审计一页纸seek回台账', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'seek回台账失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    if (summaryFfReplayBtn && !summaryFfReplayBtn._m115Bound) {
                      summaryFfReplayBtn._m115Bound = true;
                      summaryFfReplayBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要失败归因字段过滤回放…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m115', simulateFailure: true, forceFailure: true, failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, fieldFilterReplay: true, fieldFilter: ['titleZh', 'sectionId'], annotateFields: ['titleZh', 'sectionId'] }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '摘要失败归因字段过滤回放', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要失败归因回放失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const softCancelSeekMsBtn = fieldHost.querySelector('.m116-soft-cancel-seek-multiselect-btn, .m116-soft-cancel-seek-multiselect');
                    const summaryFfReplayBmBtn = fieldHost.querySelector('.m116-summary-ff-replay-scrubber-bm-btn, .m116-summary-ff-replay-scrubber-bm');
                    if (softCancelSeekMsBtn && !softCancelSeekMsBtn._m116Bound) {
                      softCancelSeekMsBtn._m116Bound = true;
                      softCancelSeekMsBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软取消 seek 台账多选对照…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast', { method: 'POST', body: JSON.stringify({ softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true, role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true, seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1], dryRun: true }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '软取消seek台账多选对照', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '多选对照失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    if (summaryFfReplayBmBtn && !summaryFfReplayBmBtn._m116Bound) {
                      summaryFfReplayBmBtn._m116Bound = true;
                      summaryFfReplayBmBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要失败归因过滤回放 scrubber 书签…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m116', simulateFailure: true, forceFailure: true, failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, fieldFilterReplay: true, fieldFilter: ['titleZh', 'sectionId'], annotateFields: ['titleZh', 'sectionId'], scrubberBookmarks: true, fieldFilterReplayScrubberBookmarks: true, bookmarkNameZh: 'wb·M116摘要失败归因回放书签' }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '摘要失败归因回放书签', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要失败归因回放书签失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    const softCancelSeekClipBtn = fieldHost.querySelector('.m117-soft-cancel-seek-clip-scrubber-btn, .m117-soft-cancel-seek-clip-scrubber');
                    const summaryFfBmXsessionBtn = fieldHost.querySelector('.m117-summary-ff-replay-bm-xsession-btn, .m117-summary-ff-replay-bm-xsession');
                    const multiselectClipKfBmBtn = fieldHost.querySelector('.m118-multiselect-clip-scrubber-kf-bm-btn, .m118-multiselect-clip-scrubber-kf-bm');
                    const summaryFfBmDiffAdoptBtn = fieldHost.querySelector('.m118-summary-ff-replay-bm-diff-preview-adopt-btn, .m118-summary-ff-replay-bm-diff-preview-adopt');
                    const multiselectClipKfBmXSessionBtn = fieldHost.querySelector('.m119-multiselect-clip-kf-bm-xsession-btn, .m119-multiselect-clip-kf-bm-xsession');
                    const kfXsessionDiffPreviewAdoptBtn = fieldHost.querySelector('.m120-kf-xsession-diff-preview-adopt-btn, .m120-kf-xsession-diff-preview-adopt');
                    const summaryDiffOnesideSoftUndoBtn = fieldHost.querySelector('.m119-summary-diff-preview-oneside-soft-undo-btn, .m119-summary-diff-preview-oneside-soft-undo');
                    const onesideSoftUndoScrubAbBtn = fieldHost.querySelector('.m120-oneside-soft-undo-scrub-ab-btn, .m120-oneside-soft-undo-scrub-ab');
                    const diffPreviewAdoptSoftUndoBaBtn = fieldHost.querySelector('.m121-diff-preview-adopt-soft-undo-ba-btn, .m121-diff-preview-adopt-soft-undo-ba');
                    const softUndoBaPinpointRebypassBtn = fieldHost.querySelector('.m122-soft-undo-ba-pinpoint-rebypass-btn, .m122-soft-undo-ba-pinpoint-rebypass');
                    const abTimelineFramePinpointBtn = fieldHost.querySelector('.m121-ab-timeline-frame-pinpoint-btn, .m121-ab-timeline-frame-pinpoint');
                    const abFramePinpointSupplyRebypassBtn = fieldHost.querySelector('.m122-ab-frame-pinpoint-supply-rebypass-btn, .m122-ab-frame-pinpoint-supply-rebypass');
                    const softUndoBaPinpointRebypassFailFoldBtn = fieldHost.querySelector('.m123-pinpoint-rebypass-fail-fold-btn, .m123-pinpoint-rebypass-fail-fold');
                    const abFrameRebypassBeforeAfterBtn = fieldHost.querySelector('.m123-ab-frame-rebypass-ba-btn, .m123-ab-frame-rebypass-ba');
                    const pinpointFailAttrRetryFoldBtn = fieldHost.querySelector('.m124-pinpoint-fail-attr-retry-fold-btn, .m124-pinpoint-fail-attr-retry-fold');
                    const abFrameRebypassBaPinpointRebypassBtn = fieldHost.querySelector('.m124-ab-frame-rebypass-ba-pinpoint-btn, .m124-ab-frame-rebypass-ba-pinpoint');
                    const failAttrRetryPhasePauseGraceBtn = fieldHost.querySelector('.m125-fail-attr-retry-phase-pause-grace-btn, .m125-fail-attr-retry-phase-pause-grace');
                    const abFrameRebypassPinpointFailFoldAttrBtn = fieldHost.querySelector('.m125-ab-frame-rebypass-pinpoint-fail-attr-btn, .m125-ab-frame-rebypass-pinpoint-fail-attr');
                    const failAttrRetryPauseGraceSoftCancelLedgerBtn = fieldHost.querySelector('.m126-fail-attr-retry-pause-grace-soft-cancel-ledger-btn, .m126-fail-attr-retry-pause-grace-soft-cancel-ledger');
                    const failAttrSoftCancelLedgerRoleAuditBtn = fieldHost.querySelector('.m127-fail-attr-soft-cancel-ledger-role-audit-btn, .m127-fail-attr-soft-cancel-ledger-role-audit');
                    const abFailAttrOneClickRetryFoldTaskCardBtn = fieldHost.querySelector('.m127-ab-fail-attr-one-click-retry-fold-taskcard-btn, .m127-ab-fail-attr-one-click-retry-fold-taskcard');
                    const abPinpointFailAttrOneClickRetryBtn = fieldHost.querySelector('.m126-ab-pinpoint-fail-attr-one-click-retry-btn, .m126-ab-pinpoint-fail-attr-one-click-retry');
                    if (softCancelSeekClipBtn && !softCancelSeekClipBtn._m117bound) {
                      softCancelSeekClipBtn._m117bound = true;
                      softCancelSeekClipBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '多选对照短片 scrubber…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber', { method: 'POST', body: JSON.stringify({ softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true, role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true, seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1], clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true, dryRun: true }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '多选对照短片scrubber', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '多选对照短片scrubber失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    if (summaryFfBmXsessionBtn && !summaryFfBmXsessionBtn._m117bound) {
                      summaryFfBmXsessionBtn._m117bound = true;
                      summaryFfBmXsessionBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要失败归因回放书签跨会话只读分享…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m117', simulateFailure: true, forceFailure: true, failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, fieldFilterReplay: true, fieldFilter: ['titleZh', 'sectionId'], annotateFields: ['titleZh', 'sectionId'], scrubberBookmarks: true, fieldFilterReplayScrubberBookmarks: true, bookmarkNameZh: 'wb·M117摘要回放书签跨会话', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m117', targetSessionId: 'wb-peer-m117' }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '摘要回放书签跨会话只读分享', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要回放书签跨会话失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    if (multiselectClipKfBmBtn && !multiselectClipKfBmBtn._m118bound) {
                      multiselectClipKfBmBtn._m118bound = true;
                      multiselectClipKfBmBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '多选对照短片 scrubber 关帧书签…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks', { method: 'POST', body: JSON.stringify({ softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true, role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true, seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1], clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true, keyframeBookmarks: true, scrubberKeyframeBookmarks: true, scrubberBookmarks: true, bookmarkNameZh: 'wb·M118多选对照短片关帧书签', dryRun: true }) });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '多选对照短片关帧书签', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '多选对照短片关帧书签失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    if (summaryFfBmDiffAdoptBtn && !summaryFfBmDiffAdoptBtn._m118bound) {
                      summaryFfBmDiffAdoptBtn._m118bound = true;
                      summaryFfBmDiffAdoptBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要回放书签差分预览再采纳…');
                          const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m118', simulateFailure: true, forceFailure: true, failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, fieldFilterReplay: true, fieldFilter: ['titleZh', 'sectionId'], annotateFields: ['titleZh', 'sectionId'], scrubberBookmarks: true, fieldFilterReplayScrubberBookmarks: true, bookmarkNameZh: 'wb·M118摘要回放书签差分预览再采纳', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m118', targetSessionId: 'wb-peer-m118', chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true }) });
                        if (multiselectClipKfBmXSessionBtn && !multiselectClipKfBmXSessionBtn._m119Bound) {
                          multiselectClipKfBmXSessionBtn._m119bound = true;
                          multiselectClipKfBmXSessionBtn.addEventListener('click', async () => {
                            try {
                              if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '关帧书签跨会话只读分享…');
                              const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share', { method: 'POST', body: JSON.stringify({ softCancel: true, softCancelWinsOverGrace: true, writeSoftCancelLedger: true, chineseLedger: true, role: 'broker', filterRole: 'broker', roleFilteredAudit: true, roleAuditOnePager: true, renderAuditOnePager: true, inAppOnePager: true, seekLedgerRow: true, seekBackToLedger: true, highlightLedgerRow: true, seekEntryIndex: 0, multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1], clipFrameScrubber: true, scrubber: true, scrubIndex: 0, exportClipFrames: true, clipFrames: true, keyframeBookmarks: true, scrubberKeyframeBookmarks: true, scrubberBookmarks: true, bookmarkNameZh: 'wb·M119多选对照关帧书签跨会话', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m119', targetSessionId: 'wb-peer-m119', dryRun: true }) });
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '关帧书签跨会话只读分享', 'ok', 2600);
                            } catch (e) { if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '跨会话分享失败', 'err'); }
                            finally { if (typeof YB !== 'undefined' && YB.busy) YB.busy(false); }
                          });
                        }
                        if (summaryDiffOnesideSoftUndoBtn && !summaryDiffOnesideSoftUndoBtn._m119bound) {
                          summaryDiffOnesideSoftUndoBtn._m119bound = true;
                          summaryDiffOnesideSoftUndoBtn.addEventListener('click', async () => {
                            try {
                              if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '差分预览一侧软撤销…');
                              const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m119', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true, simulateFailure: true, forceFailure: true, failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, fieldFilterReplay: true, fieldFilter: ['titleZh', 'sectionId'], annotateFields: ['titleZh', 'sectionId'], scrubberBookmarks: true, fieldFilterReplayScrubberBookmarks: true, bookmarkNameZh: 'wb·M119摘要差分预览一侧软撤销', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m119-s', targetSessionId: 'wb-peer-m119-s' }) });
                              if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '差分预览一侧软撤销', 'ok', 2600);
                            } catch (e) { if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '一侧软撤销失败', 'err'); }
                            finally { if (typeof YB !== 'undefined' && YB.busy) YB.busy(false); }
                          });
                            if (kfXsessionDiffPreviewAdoptBtn && !kfXsessionDiffPreviewAdoptBtn._m120Bound) {
                              kfXsessionDiffPreviewAdoptBtn._m120Bound = true;
                              kfXsessionDiffPreviewAdoptBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '关帧跨会话分享差分预览再采纳…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt', { method: 'POST', body: JSON.stringify({ softCancel: true, role: 'broker', filterRole: 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1], clipFrameScrubber: true, scrubber: true, keyframeBookmarks: true, scrubberBookmarks: true, bookmarkNameZh: 'wb·M120关帧跨会话差分预览再采纳', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m120', targetSessionId: 'wb-peer-m120', chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true, dryRun: true }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '关帧跨会话差分预览已采纳', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '关帧跨会话差分预览失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (onesideSoftUndoScrubAbBtn && !onesideSoftUndoScrubAbBtn._m120Bound) {
                              onesideSoftUndoScrubAbBtn._m120Bound = true;
                              onesideSoftUndoScrubAbBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '一侧软撤销 scrubber 进 A/B 时间线…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m120', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true, chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true, bookmarkNameZh: 'wb·M120一侧软撤销scrub进A/B', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m120-s', targetSessionId: 'wb-peer-m120-s' }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '一侧软撤销已 scrub 进 A/B 时间线', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '一侧软撤销 scrub 失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (diffPreviewAdoptSoftUndoBaBtn && !diffPreviewAdoptSoftUndoBaBtn._m121bound) {
                              diffPreviewAdoptSoftUndoBaBtn._m121bound = true;
                              diffPreviewAdoptSoftUndoBaBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '差分预览采纳软撤销前后卡…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after', { method: 'POST', body: JSON.stringify({ softCancel: true, role: 'broker', filterRole: 'broker', multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1], clipFrameScrubber: true, scrubber: true, keyframeBookmarks: true, scrubberBookmarks: true, bookmarkNameZh: 'wb·M121差分预览采纳软撤销前后卡', shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m121', targetSessionId: 'wb-peer-m121', chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true, softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true, dryRun: true }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '差分预览采纳可软撤销·前后卡', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '差分预览采纳软撤销失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (abTimelineFramePinpointBtn && !abTimelineFramePinpointBtn._m121bound) {
                              abTimelineFramePinpointBtn._m121bound = true;
                              abTimelineFramePinpointBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 时间线帧定点标注…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m121', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: 'wb·M121 A/B时间线帧定点标注', chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true, bookmarkNameZh: 'wb·M121帧定点', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m121-s', targetSessionId: 'wb-peer-m121-s' }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || 'A/B 时间线帧已定点标注', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B 时间线帧定点失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (softUndoBaPinpointRebypassBtn && !softUndoBaPinpointRebypassBtn._m122bound) {
                              softUndoBaPinpointRebypassBtn._m122bound = true;
                              softUndoBaPinpointRebypassBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '软撤销前后卡定点再旁路…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass', { method: 'POST', body: JSON.stringify({ softCancel: true, role: 'broker', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'org'], noteZh: 'wb·M122软撤销前后卡定点再旁路', pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, confirmAdopt: true, confirmCardAck: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m122', targetSessionId: 'wb-peer-m122', dryRun: true }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '软撤销前后卡定点·供给再旁路', 'ok', 2200);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '定点再旁路失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (abFramePinpointSupplyRebypassBtn && !abFramePinpointSupplyRebypassBtn._m122bound) {
                              abFramePinpointSupplyRebypassBtn._m122bound = true;
                              abFramePinpointSupplyRebypassBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 时间线帧定点再旁路…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m122', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: 'wb·M122 A/B帧定点触发供给再旁路', pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, confirmAdopt: true, confirmCardAck: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m122-s', targetSessionId: 'wb-peer-m122-s' }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || 'A/B帧定点·供给再旁路', 'ok', 2200);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B帧定点再旁路失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (softUndoBaPinpointRebypassFailFoldBtn && !softUndoBaPinpointRebypassFailFoldBtn._m123bound) {
                              softUndoBaPinpointRebypassFailFoldBtn._m123bound = true;
                              softUndoBaPinpointRebypassFailFoldBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '定点再旁路失败并入归因…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr', { method: 'POST', body: JSON.stringify({ softCancel: true, role: 'broker', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'org'], noteZh: 'wb·M123定点再旁路失败并入归因', pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, simulateFailure: true, forceFailure: true, failureCode: 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true, chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, confirmAdopt: true, confirmCardAck: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m123', targetSessionId: 'wb-peer-m123', dryRun: true }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '定点再旁路失败已并入归因中文卡', 'ok', 2200);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '定点再旁路失败归因失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (abFrameRebypassBeforeAfterBtn && !abFrameRebypassBeforeAfterBtn._m123bound) {
                              abFrameRebypassBeforeAfterBtn._m123bound = true;
                              abFrameRebypassBeforeAfterBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 帧再旁路前后对照…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after', { method: 'POST', body: JSON.stringify({ role: 'broker', matchId: 'demo-match-m123', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before', softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: 'wb·M123 A/B帧再旁路前后对照', pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, confirmAdopt: true, confirmCardAck: true, crossSessionShare: true, readOnlyShare: true, sessionId: 'wb-session-m123-s', targetSessionId: 'wb-peer-m123-s' }) });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || 'A/B帧再旁路前后对照卡已开', 'ok', 2200);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B帧再旁路前后对照失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (pinpointFailAttrRetryFoldBtn && !pinpointFailAttrRetryFoldBtn._m124bound) {
                              pinpointFailAttrRetryFoldBtn._m124bound = true;
                              pinpointFailAttrRetryFoldBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '定点失败归因一键重试折进任务卡…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      softCancel: true, role: 'broker', filterRole: 'broker',
                                      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
                                      clipFrameScrubber: true, scrubber: true, keyframeBookmarks: true, scrubberBookmarks: true,
                                      bookmarkNameZh: '演示·M124定点失败归因重试',
                                      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
                                      sessionId: 'session-demo-m124-clip', targetSessionId: 'session-peer-m124-clip',
                                      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
                                      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
                                      pinpointAnnotate: true, annotateFields: ['titleZh', 'org'], noteZh: '演示·M124定点失败归因一键重试折进任务卡',
                                      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
                                      simulateFailure: true, forceFailure: true, failureCode: 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
                                      foldFailureIntoAttribution: true, showFailureAttribution: true,
                                      oneClickRetry: true, retryFromAttribution: true, foldIntoChainTaskCard: true, foldRetryIntoChainTaskCard: true, dryRun: true,
                                    }),
                                  });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '定点失败归因一键重试已折进中文任务卡', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '定点失败归因重试失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (abFrameRebypassBaPinpointRebypassBtn && !abFrameRebypassBaPinpointRebypassBtn._m124bound) {
                              abFrameRebypassBaPinpointRebypassBtn._m124bound = true;
                              abFrameRebypassBaPinpointRebypassBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 帧再旁路前后卡定点再旁路…');
                                  const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                                  const seq = Number(abTl?.abTimelineScrubber?.currentSeq || abTl?.abTimelineScrubber?.maxSeq || 1);
                                  const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      seq, role: 'broker', matchId: 'demo-match-m124', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
                                      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
                                      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M124 A/B帧再旁路前后卡定点再旁路',
                                      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
                                      bookmarkNameZh: '演示·M124 A/B帧再旁路前后卡定点再旁路', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
                                      sessionId: 'session-demo-m124-summary', targetSessionId: 'session-peer-m124-summary',
                                      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
                                    }),
                                  });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || 'A/B 帧再旁路前后卡定点再旁路已触发', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B帧再旁路前后卡定点再旁路失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (failAttrRetryPhasePauseGraceBtn && !failAttrRetryPhasePauseGraceBtn._m125bound) {
                              failAttrRetryPhasePauseGraceBtn._m125bound = true;
                              failAttrRetryPhasePauseGraceBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '失败归因重试任务卡阶段暂停宽限…');
                                  const page = await api('/imports/enterprise/conflict-ui-prefs/except-fields-templates/shared-preview/copy-as-my-role-draft/diff-shared-source/resync/selective-buckets/before-after-contrast/sync-changed-buckets-only/skip-list-preview/force-include-picks/role-defaults/ab-compare-apply/soft-undo/before-after-contrast/pinpoint/rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace/soft-cancel-ledger/role-audit-onepager/seek-ledger/multi-select-contrast/clip-scrubber/keyframe-bookmarks/xsession-ro-share/diff-preview-adopt/soft-undo-before-after/pinpoint-rebypass/fail-fold-attr/one-click-retry-fold-task-card/phase-pause-grace', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      softCancel: true, role: 'broker', filterRole: 'broker',
                                      multiSelectLedgerRows: true, multiSelectContrast: true, seekEntryIndexes: [0, 1],
                                      clipFrameScrubber: true, scrubber: true, keyframeBookmarks: true, scrubberBookmarks: true,
                                      bookmarkNameZh: '演示·M125定点失败归因重试暂停宽限',
                                      shareFfReplayBookmarks: true, crossSessionShareBookmarks: true, crossSessionShare: true, readOnlyShare: true,
                                      sessionId: 'session-demo-m125-clip', targetSessionId: 'session-peer-m125-clip',
                                      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
                                      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, softUndoBeforeAfter: true,
                                      pinpointAnnotate: true, annotateFields: ['titleZh', 'org'], noteZh: '演示·M125定点失败归因重试任务卡阶段暂停宽限',
                                      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
                                      simulateFailure: true, forceFailure: true, failureCode: 'SOFT_UNDO_BA_PINPOINT_REBYPASS_FAIL',
                                      foldFailureIntoAttribution: true, showFailureAttribution: true,
                                      oneClickRetry: true, retryFromAttribution: true, foldIntoChainTaskCard: true, foldRetryIntoChainTaskCard: true,
                                      pausePhase: true, phasePause: true, phase: 'one-click-retry', graceAlarm: true, showGraceAlarm: true, autoResumeAfterGrace: true, graceMs: 15000, dryRun: true,
                                    }),
                                  });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '失败归因重试任务卡已单阶段暂停宽限', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '失败归因重试任务卡暂停宽限失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }
                            if (abFrameRebypassPinpointFailFoldAttrBtn && !abFrameRebypassPinpointFailFoldAttrBtn._m125bound) {
                              abFrameRebypassPinpointFailFoldAttrBtn._m125bound = true;
                              abFrameRebypassPinpointFailFoldAttrBtn.addEventListener('click', async () => {
                                try {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, 'A/B 帧再旁路定点失败并入归因…');
                                  const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                                  const seq = Number(abTl?.abTimelineScrubber?.currentSeq || abTl?.abTimelineScrubber?.maxSeq || 1);
                                  const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr/field-filter-replay/scrubber-bookmarks/xsession-ro-share/diff-preview-adopt/oneside-soft-undo/scrub-ab-timeline/frame-pinpoint-annotate/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      seq, role: 'broker', matchId: 'demo-match-m125', adoptOneSideOnly: true, onesideSoftUndo: true, adoptSide: 'before',
                                      softUndoAdopt: true, softUndo: true, showBeforeAfterCard: true, beforeAfterContrast: true, scrubIntoAbTimeline: true,
                                      pinpointAnnotate: true, annotateFields: ['titleZh', 'score'], noteZh: '演示·M125 A/B帧再旁路定点失败并入归因',
                                      chineseDiffPreview: true, diffPreviewConfirm: true, diffPreviewThenAdopt: true, adoptSharedBookmarks: true, confirmAdopt: true, confirmCardAck: true,
                                      bookmarkNameZh: '演示·M125 A/B帧再旁路定点失败并入归因', shareFfReplayBookmarks: true, crossSessionShare: true, readOnlyShare: true,
                                      sessionId: 'session-demo-m125-summary', targetSessionId: 'session-peer-m125-summary',
                                      pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true,
                                      simulateFailure: true, forceFailure: true, failureCode: 'AB_FRAME_REBYPASS_BA_PINPOINT_REBYPASS_FAIL',
                                      foldFailureIntoAttribution: true, showFailureAttribution: true,
                                    }),
                                  });
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || 'A/B 帧再旁路定点失败已并入中文归因', 'ok', 2400);
                                } catch (e) {
                                  if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || 'A/B帧再旁路定点失败归因失败', 'err');
                                } finally {
                                  if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                                }
                              });
                            }

                        }
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(page.toastZh || '摘要回放书签差分预览再采纳', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要回放书签差分预览再采纳失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }
                    if (summaryFailFoldBtn && !summaryFailFoldBtn._m114bound) {
                      summaryFailFoldBtn._m114bound = true;
                      summaryFailFoldBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '摘要定点再旁路失败并入归因…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt/soft-undo-summary/scrub-ab-timeline/summary-frame-pinpoint/supply-rebypass/before-after/pinpoint-rebypass/fail-fold-attr', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m114', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: 'wb摘要定点再旁路失败并入归因', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateSummaryFrames: true, summaryFramePinpoint: true, annotateFields: ['titleZh', 'sectionId'], adoptOneSideOnly: true, adoptSide: 'before', confirmOneside: true, showUndoableSummary: true, onesideSoftUndoSummary: true, scrubIntoAbTimeline: true, pinpointToSupplyReBypass: true, oneClickReBypass: true, reBypass: true, baPinpointAnnotate: true, pinpointFromBeforeAfter: true, simulateFailure: true, forceFailure: true, failureCode: 'SUMMARY_BA_PINPOINT_REBYPASS_FAIL', foldFailureIntoAttribution: true, showFailureAttribution: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(adopted.toastZh || '摘要定点再旁路失败并入归因', 'ok', 2200);
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '摘要定点再旁路失败并入归因失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }

const softBaPinBtn = fieldHost.querySelector('.m107-field-subset-pinpoint-oneside-btn, .m107-field-subset-pinpoint-oneside');
                    if (softBaPinBtn && !softBaPinBtn._m107bound) {
                      softBaPinBtn._m107bound = true;
                      softBaPinBtn.addEventListener('click', async () => {
                        try {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(true, '子集前后卡定点/只采纳一侧…');
                          const abTl = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/timeline');
                          const seq = Number((abTl.abTimelineScrubber && abTl.abTimelineScrubber.currentSeq) || (abTl.abTimelineScrubber && abTl.abTimelineScrubber.maxSeq) || 1);
                          const adopted = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt', {
                            method: 'POST',
                            body: JSON.stringify({ seq, direction: 'both', sectionId: 'risk', matchId: 'demo-match-m107', role: 'broker', cloneFromTenant: 'demo-peer', crossTenantClone: true, readOnlyClone: true, seedSource: true, fieldSubsetAdopt: true, adoptFields: ['titleZh', 'sectionId'], adoptClone: true, confirmAdopt: true, confirmClone: true, confirmCardAck: true, templateNameZh: '演示·子集前后卡定点一侧' }),
                          });
                          const undone = await api('/imports/enterprise/conflict-ui-prefs/ab-apply/undoable-summary/one-pager/match-explain-sidebar/match-highlight/bidir-seek/remember-anchor/by-match-id/cross-session-template/by-role/cross-tenant-readonly-clone/diff-preview-adopt/field-subset/soft-undo/before-after-contrast/pinpoint-oneside-adopt', {
                            method: 'POST',
                            body: JSON.stringify({ softUndo: true, undoToken: adopted.softUndoToken || null, role: 'broker', matchId: 'demo-match-m107', showBeforeAfterCard: true, beforeAfterContrast: true, pinpointAnnotate: true, annotateFields: ['titleZh', 'sectionId'], noteZh: '演示·子集前后卡定点', adoptOneSideOnly: true, adoptSide: 'before', confirmOneside: true, confirmCardAck: true }),
                          });
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(undone.toastZh || adopted.toastZh || '定点/一侧', 'ok', 2200);
                          if (document.body) document.body.classList.add('m107-field-subset-pinpoint-oneside', 'm106-field-subset-softundo-ba', 'yb-sidebar-item-highlight');
                        } catch (e) {
                          if (typeof YB !== 'undefined' && YB.toast) YB.toast(e.message || '定点/一侧失败', 'err');
                        } finally {
                          if (typeof YB !== 'undefined' && YB.busy) YB.busy(false);
                        }
                      });
                    }


,
    /** M44/M45：优先 SSE，失败则强化轮询（阶段文案 + 可取消） */
  async waitJobProgress(opts = {}) {
    const maxMs = opts.maxMs || 120000;
    const start = Date.now();
    let last = null;
    const cancelPath = opts.cancelPath || null;
    const applyProgress = (payload) => {
      last = payload;
      const pct = payload && payload.percent != null ? payload.percent : null;
      const banner = (payload && payload.bannerZh) || '任务进行中…';
      const phaseText = (payload && (payload.phaseText || payload.phaseZh)) || '';
      YB.busy(true, banner, pct);
      YB.showProgress({
        title: opts.title || banner,
        percent: pct,
        phase: phaseText,
        meta: (payload && payload.hintZh) || '',
        cancelPath: (payload && payload.cancelPath) || cancelPath,
        resumePath: payload && payload.resumePath,
        resumeAvailable: payload && payload.resumeAvailable,
        onCancel: opts.onCancel,
        onResume: opts.onResume,
      });
    };
    YB.showProgress({
      title: opts.title || '任务进度',
      percent: 0,
      phase: '准备中',
      meta: '优先走实时推送；不通则自动轮询…',
      cancelPath,
      onCancel: opts.onCancel,
    });

    const streamUrl = await (async () => {
      let u = null;
      if (opts.streamPath) u = opts.streamPath.startsWith('/api') ? opts.streamPath : '/api' + opts.streamPath;
      else if (opts.kind === 'import' && opts.id)
        u = '/api/imports/enterprise/jobs/' + encodeURIComponent(opts.id) + '/progress/stream';
      else if (opts.id) u = '/api/jobs/progress/stream?id=' + encodeURIComponent(opts.id);
      return u ? await YB.withSseAuth(u) : null;
    })();

    if (streamUrl && typeof EventSource !== 'undefined' && opts.forcePoll !== true) {
      try {
        const done = await new Promise((resolve) => {
          let settled = false;
          const es = new EventSource(streamUrl, { withCredentials: true });
          const finish = (val) => {
            if (settled) return;
            settled = true;
            try {
              es.close();
            } catch (_) {}
            resolve(val);
          };
          const timer = setTimeout(() => finish('timeout'), maxMs);
          es.addEventListener('progress', (ev) => {
            try {
              const data = JSON.parse(ev.data || '{}');
              applyProgress(data);
              if (data && !data.waiting) {
                clearTimeout(timer);
                finish('done');
              }
            } catch (_) {}
          });
          es.addEventListener('end', () => {
            clearTimeout(timer);
            finish('done');
          });
          es.onerror = () => {
            clearTimeout(timer);
            finish('error');
          };
        });
        if (done === 'done' && last) {
          YB.busy(false);
          if (!(opts.keepProgressOnDone)) YB.hideProgress();
          if (last.bannerZh) YB.toast(last.bannerZh, last.job && last.job.status === 'failed' ? 'err' : 'ok');
          if (opts.bustHome !== false) YB.bustHomeCache();
          return last;
        }
      } catch (_) {}
    }

    while (Date.now() - start < maxMs) {
      try {
        let path;
        if (opts.progressPath) {
          path = opts.progressPath.replace(/^\/api/, '');
        } else if (opts.kind === 'import' && opts.id) {
          path = '/imports/enterprise/jobs/' + encodeURIComponent(opts.id) + '/progress';
        } else {
          const q =
            (opts.id ? '?id=' + encodeURIComponent(opts.id) : '') +
            (opts.kind ? (opts.id ? '&' : '?') + 'kind=' + encodeURIComponent(opts.kind) : '');
          path = '/jobs/progress' + q;
        }
        const payload = await YB.api(path, { quiet: true, busy: false });
        applyProgress(payload);
        if (payload && !payload.waiting) {
          YB.busy(false);
          if (!(opts.keepProgressOnDone)) YB.hideProgress();
          if (payload.bannerZh) YB.toast(payload.bannerZh, payload.job && payload.job.status === 'failed' ? 'err' : 'ok');
          if (opts.bustHome !== false) YB.bustHomeCache();
          return payload;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, opts.intervalMs || 900));
    }
    YB.busy(false);
    YB.hideProgress();
    YB.toast('等待超时：可到任务列表查看结果', 'warn');
    return last;
  },
  showProgress(opts = {}) {
    YB.ensureFeedbackHosts();
    const panel = document.getElementById('ybProgressPanel');
    if (!panel) return;
    panel.hidden = false;
    const title = panel.querySelector('.yb-progress-title');
    const meta = panel.querySelector('.yb-progress-meta');
    const phaseEl = panel.querySelector('.yb-progress-phase');
    const fill = panel.querySelector('.yb-progress-fill');
    const btn = panel.querySelector('.yb-progress-cancel');
    const actions = panel.querySelector('.yb-progress-actions');
    if (title) title.textContent = opts.title || '任务进度';
    if (meta) meta.textContent = opts.meta || '';
    if (phaseEl) {
      const ph = opts.phase || opts.phaseText || '';
      phaseEl.textContent = ph ? '阶段：' + ph : '';
      phaseEl.hidden = !ph;
    }
    if (fill) {
      const pct = opts.percent == null || Number.isNaN(Number(opts.percent)) ? 8 : Math.max(0, Math.min(100, Number(opts.percent)));
      fill.style.width = pct + '%';
    }
    if (btn) {
      const path = opts.cancelPath;
      if (path) {
        btn.hidden = false;
        btn.disabled = false;
        btn.textContent = '取消';
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = '取消中…';
          try {
            const apiPath = String(path).replace(/^\/api/, '');
            const r = await YB.api(apiPath, { method: 'POST', body: '{}', busyText: '正在取消…' });
            YB.toast((r && (r.summaryZh || r.messageZh || r.message)) || '已请求取消', 'warn');
            if (typeof opts.onCancel === 'function') opts.onCancel(r);
          } catch (e) {
            btn.disabled = false;
            btn.textContent = '取消';
            YB.toast(e.message || '取消失败', 'err');
          }
        };
      } else {
        btn.hidden = true;
      }
    }
    if (actions) {
      if (opts.resumeAvailable && opts.resumePath) {
        actions.style.display = 'block';
        actions.innerHTML = '<button type="button" class="ghost yb-progress-resume">按剩余续跑</button>';
        const rb = actions.querySelector('.yb-progress-resume');
        if (rb) {
          rb.onclick = async () => {
            rb.disabled = true;
            rb.textContent = '续跑入队中…';
            try {
              if (typeof opts.onResume === 'function') {
                await opts.onResume(opts.resumePath);
              } else {
                const apiPath = String(opts.resumePath).replace(/^\/api/, '');
                const r = await YB.api(apiPath, { method: 'POST', body: '{}', busyText: '续跑入队…' });
                YB.toast((r && (r.summaryZh || r.messageZh)) || '已续跑入队', 'ok');
              }
            } catch (e) {
              rb.disabled = false;
              rb.textContent = '按剩余续跑';
              YB.toast(e.message || '续跑失败', 'err');
            }
          };
        }
      } else {
        actions.style.display = 'none';
        actions.innerHTML = '';
      }
    }
  },
  hideProgress() {
    const panel = document.getElementById('ybProgressPanel');
    if (panel) panel.hidden = true;
  },
  /** 写后打穿工作台短缓存 */
  bustHomeCache() {
    YB._homeFresh = true;
    try {
      YB.api('/workbench/home/bust', { method: 'POST', body: '{}', quiet: true, busy: false, noBust: true }).catch(() => {});
    } catch (_) {}
  },
  homePath(extra) {
    const fresh = YB._homeFresh || (extra && extra.fresh);
    if (YB._homeFresh) YB._homeFresh = false;
    return '/workbench/home' + (fresh ? '?fresh=1' : '');
  },
  async loadHome(extra) {
    return YB.api(YB.homePath(extra), { quiet: extra && extra.quiet, busy: false });
  },
  /** M58/M60：收件箱增量 — opaque cursor 优先，其次 since + knownIds */
  async fetchInboxDelta(opts) {
    opts = opts || {};
    const known = Array.isArray(opts.knownIds) ? opts.knownIds : [];
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    else if (opts.since) q.set('since', opts.since);
    if (known.length) q.set('knownIds', known.slice(0, 80).join(','));
    return YB.api('/workbench/inbox/delta?' + q.toString(), {
      quiet: true,
      busy: false,
      noBust: true,
      useEtagCache: true,
    });
  },
  /** 渲染企业/科研收件箱卡片 HTML（含 sheetPreview） */
  renderInboxCardsHtml(recent, opts) {
    opts = opts || {};
    const roleHint = opts.roleHint || 'enterprise';
    const emptyHtml =
      opts.emptyHtml ||
      `<div class="empty-state calm primary-empty"><div class="empty-ico" aria-hidden="true">信</div><strong>收件箱还是空的</strong><p class="muted">匹配跑完会出现「看一页纸」。无需整页刷新，增量会自动补上。</p></div>`;
    const rows = Array.isArray(recent) ? recent : [];
    if (!rows.length) return emptyHtml;
    return rows
      .map((m) => {
        const canAct = roleHint === 'research' ? m.canRespond : m.canAct;
        const actLabel = roleHint === 'research' ? '④ 有意向，愿意谈' : '③ 确认有意向';
        const actPrimary = roleHint === 'research' ? 'confirm_interest' : 'confirm_interest';
        const actions = `<div class="inbox-actions">
                  <button type="button" class="ghost btn-sheet" data-sheet="${YB.esc(m.id)}" aria-label="查看匹配一页纸说明">看一页纸</button>
                  ${
                    canAct
                      ? `<button type="button" class="btn-act" data-id="${YB.esc(m.id)}" data-act="${actPrimary}" aria-label="${actLabel}">${actLabel}</button>
                  <button type="button" class="ghost btn-act" data-id="${YB.esc(m.id)}" data-act="request_contact">${
                          roleHint === 'research' ? '请运营牵线' : '请求联系'
                        }</button>
                  <button type="button" class="ghost btn-act" data-id="${YB.esc(m.id)}" data-act="decline">暂不合适</button>`
                      : ''
                  }
                </div>`;
        const prev = m.sheetPreview || {};
        const snip = prev.reasonSnippet
          ? `<div class="meta muted m57-sheet-snip m58-sheet-snip">${YB.esc(prev.reasonSnippet)}</div>`
          : '';
        const metaLine =
          roleHint === 'research'
            ? `<div class="meta">${YB.esc(m.orgName || '')}</div>`
            : `<div class="meta">对应需求：${YB.esc(m.demandTitle || '')}</div>`;
        const whoLine = m.teacherName || m.collabModeLabel
          ? `<div class="meta">${m.teacherName ? '建议对接 ' + YB.esc(m.teacherName) : ''}${m.teacherName && m.collabModeLabel ? ' · ' : ''}${m.collabModeLabel ? YB.esc(m.collabModeLabel) : ''}</div>`
          : '';
        return `<div class="inbox-card" data-match="${YB.esc(m.id)}">
              <h4><span class="score">${YB.pct(m.score)}</span> ${YB.esc(m.title)}
                <span class="status-chip">${YB.esc(m.statusZh || '')}</span></h4>
              ${metaLine}
              ${whoLine}
              ${snip}
              ${actions}
            </div>`;
      })
      .join('');
  },
  bindInboxCardActions(container, opts) {
    opts = opts || {};
    const roleHint = opts.roleHint || 'enterprise';
    const note = opts.note || (roleHint === 'research' ? '科研办事窗回应' : '企业办事窗操作');
    if (!container) return;
    container.querySelectorAll('.btn-sheet').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.sheet;
        const card = btn.closest('[data-match]');
        const mid = (card && card.getAttribute('data-match')) || id;
        const row =
          (opts.recent || []).find((x) => x.id === mid) ||
          (opts.getRecent && opts.getRecent().find((x) => x.id === mid));
        YB.openMatchSheet(id, {
          roleHint,
          busyText: '正在打开一页纸…',
          preview: row && row.sheetPreview,
          sheetPreview: row && row.sheetPreview,
        });
      };
    });
    container.querySelectorAll('.btn-act').forEach((btn) => {
      btn.onclick = async () => {
        try {
          YB.busy(true, '正在提交…');
          const r = await YB.api('/portal/my-deals/' + btn.dataset.id + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: btn.dataset.act, note }),
            busy: false,
          });
          if (r.softBlock) {
            if (confirm((r.message || '清单未齐') + '\n仍要强制继续？')) {
              await YB.api('/portal/my-deals/' + btn.dataset.id + '/action', {
                method: 'POST',
                body: JSON.stringify({ action: btn.dataset.act, force: true, note: '强制确认' }),
                busy: false,
              });
            } else {
              YB.busy(false);
              return;
            }
          }
          YB.busy(false);
          YB.toast('已更新，正在刷新收件箱…', 'ok', 1800);
          if (typeof opts.onChanged === 'function') await opts.onChanged();
          else if (typeof opts.refresh === 'function') await opts.refresh();
        } catch (e) {
          try { YB.busy(false); } catch (_) {}
          YB.toast(e.message || '操作失败', 'err');
        }
      };
    });
  },
  /**
   * M58/M60：增量刷新收件箱 DOM（不 location.reload）
   * state: { knownIds, since, cursor, recent }
   */
  async refreshInboxIncremental(container, state, opts) {
    opts = opts || {};
    state = state || { knownIds: [], since: null, cursor: null, recent: [] };
    const roleHint = opts.roleHint || 'enterprise';
    try {
      const delta = await YB.fetchInboxDelta({
        cursor: state.cursor || null,
        since: state.cursor ? null : state.since,
        knownIds: state.knownIds || (state.recent || []).map((m) => m.id),
      });
      if (!delta || !delta.ok) return state;
      const byId = new Map((state.recent || []).map((m) => [String(m.id), m]));
      for (const m of delta.updated || []) byId.set(String(m.id), m);
      for (const m of delta.added || []) byId.set(String(m.id), m);
      for (const id of delta.removedIds || []) byId.delete(String(id));
      // 若 delta 给了完整 recentCount 且有新增，用 home 顺序：added 在前拼
      let next = [...byId.values()];
      if ((delta.added || []).length || (delta.updated || []).length) {
        // 稳定：新增在前
        const addedIds = new Set((delta.added || []).map((m) => String(m.id)));
        next.sort((a, b) => {
          const aa = addedIds.has(String(a.id)) ? 0 : 1;
          const bb = addedIds.has(String(b.id)) ? 0 : 1;
          if (aa !== bb) return aa - bb;
          return (Number(b.score) || 0) - (Number(a.score) || 0);
        });
      }
      state.recent = next.slice(0, 12);
      state.knownIds = state.recent.map((m) => m.id);
      state.since = delta.latestAt || state.since || new Date().toISOString();
      state.cursor = delta.nextCursor || delta.cursor || state.cursor || null;
      if (container) {
        container.innerHTML = YB.renderInboxCardsHtml(state.recent, {
          roleHint,
          emptyHtml: opts.emptyHtml,
        });
        YB.bindInboxCardActions(container, {
          roleHint,
          recent: state.recent,
          getRecent: () => state.recent,
          onChanged: async () => {
            await YB.refreshInboxIncremental(container, state, opts);
            if (typeof opts.onKpi === 'function' && delta.kpis) opts.onKpi(delta.kpis);
          },
          refresh: async () => YB.refreshInboxIncremental(container, state, { ...opts, forceToast: false }),
        });
      }
      if (delta.cache === 'NOT_MODIFIED' || delta.cache === 'HIT') {
        try { YB.busy(false); } catch (_) {}
        if (opts.forceToast) YB.toast(delta.busyClearZh || delta.tipZh || '收件箱无变化', 'ok', 1600);
      } else if (opts.forceToast || (delta.added && delta.added.length)) {
        YB.toast(delta.tipZh || delta.busyClearZh || '收件箱已更新', 'ok', 2200);
      }
      try { YB.busy(false); } catch (_) {}
      if (typeof opts.onKpi === 'function' && delta.kpis) opts.onKpi(delta.kpis);
      return state;
    } catch (e) {
      try { YB.busy(false); } catch (_) {}
      if (!opts.quiet) YB.toast(e.message || '收件箱刷新失败', 'err');
      return state;
    }
  },
  /** 可见时短轮询收件箱增量（匹配跑完后企业/科研页自动补卡） */
  startInboxDeltaPoll(container, state, opts) {
    opts = opts || {};
    const everyMs = Math.max(2500, Number(opts.everyMs || 5000));
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(tick, everyMs);
        return;
      }
      try {
        await YB.refreshInboxIncremental(container, state, { ...opts, forceToast: false, quiet: true });
      } catch (_) {}
      if (!stopped) timer = setTimeout(tick, everyMs);
    };
    let timer = setTimeout(tick, opts.immediate ? 400 : everyMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  },
  async requireShell(allowed) {
    if (!YB.token) {
      location.href = '/';
      return null;
    }
    let me;
    try {
      me = await YB.api('/auth/me');
    } catch (_) {
      location.href = '/';
      return null;
    }
    if (!me.ok || !me.user) {
      location.href = '/';
      return null;
    }
    const shell = me.shell || me.user.shell;
    if (allowed && !allowed.includes(shell)) {
      location.replace(me.homePath || me.user.homePath || '/');
      return null;
    }
    return me;
  },
  logout: async () => {
    try {
      await YB.api('/auth/logout', { method: 'POST', body: '{}' });
    } catch (_) {}
    localStorage.removeItem('yanqi_token');
    localStorage.removeItem('yanqi_api_key');
    location.href = '/';
  },
  pct(score) {
    if (score == null) return '-';
    const n = Number(score);
    return (n <= 1 ? n * 100 : n).toFixed(0) + '分';
  },
  esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  },
  async switchDemo(login) {
    const r = await YB.api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: login, password: 'yanqi123' }),
    });
    if (!r.ok || !r.token) throw new Error(r.message || '切换失败');
    localStorage.setItem('yanqi_token', r.token);
    YB.token = r.token;
    location.href = r.homePath || '/';
  },
  mountTopMeta(el, me, home) {
    if (!el) return;
    const orgName = home?.org?.name || (me.shell === 'ops' ? '平台运营' : me.shell === 'broker' ? '技术经理人' : me.shell === 'guest' ? '园区观察' : '未绑单位');
    const role = me.personaLabel || me.shell || '';
    el.innerHTML = `
      <div class="wb-meta">
        <span class="wb-org" title="当前组织">${YB.esc(orgName)}</span>
        <span class="wb-role-chip">${YB.esc(role)}</span>
        <details class="wb-demo-switch">
          <summary>切演示号</summary>
          <div class="wb-demo-menu">
            ${YB.demos
              .map(
                (d) =>
                  `<button type="button" class="ghost wb-demo-btn" data-login="${d.login}">${YB.esc(d.label)} · ${d.login}</button>`,
              )
              .join('')}
          </div>
        </details>
      </div>`;
    el.querySelectorAll('.wb-demo-btn').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await YB.switchDemo(btn.dataset.login);
        } catch (e) {
          YB.toast(e.message || '切换失败', 'err');
        }
      };
    });
  },
  renderKpis(el, kpis) {
    if (!el) return;
    el.innerHTML = (kpis || [])
      .map((k) => {
        const tone = k.tone === 'danger' ? ' danger-ish' : k.tone === 'warn' ? ' warn-ish' : k.tone === 'ok' ? ' ok-ish' : '';
        return `<div class="stat light${tone}"><div class="n">${YB.esc(k.value)}</div><div class="l">${YB.esc(k.label)}</div></div>`;
      })
      .join('');
  },
  renderTasks(el, tasks) {
    if (!el) return;
    const list = tasks || [];
    el.innerHTML =
      list
        .map(
          (t, i) =>
            `<a class="task-card${t.primary || i === 0 ? ' primary' : ''}" href="${YB.esc(t.href)}">
              <span class="task-idx">${i + 1}</span>
              <strong>${YB.esc(t.title)}</strong>
              <span class="muted">${YB.esc(t.why)}</span>
            </a>`,
        )
        .join('') || '';
  },
  renderPipeline(el, pipeline) {
    if (!el) return;
    const steps = pipeline || [];
    if (!steps.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      `<div class="pipe-track" role="list">` +
      steps
        .map(
          (s, i) =>
            `<div class="pipe-step" role="listitem">
              <div class="pipe-n">${YB.esc(s.value)}</div>
              <div class="pipe-l">${YB.esc(s.label)}</div>
              <div class="pipe-h muted">${YB.esc(s.hint || '')}</div>
              ${i < steps.length - 1 ? '<span class="pipe-arrow" aria-hidden="true">→</span>' : ''}
            </div>`,
        )
        .join('') +
      `</div>`;
  },
  renderEmpty(el, empty) {
    if (!el) return;
    if (!empty) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const cta = empty.cta;
    const ctaHtml = cta
      ? `<a class="buttonish empty-cta-primary" href="${YB.esc(cta.href)}" aria-label="${YB.esc(cta.ariaLabel || cta.label)}">${YB.esc(cta.label)}</a>`
      : '';
    const hint = empty.hintZh
      ? `<span class="empty-hint">${YB.esc(empty.hintZh)}</span>`
      : (cta ? `<span class="empty-hint">下一步只做这一件就够了</span>` : '');
    el.innerHTML = `<div class="empty-state calm primary-empty" role="status">
      <div class="empty-ico" aria-hidden="true">${YB.esc(empty.icon || '空')}</div>
      <strong>${YB.esc(empty.title)}</strong>
      <p class="muted">${YB.esc(empty.body)}</p>
      ${ctaHtml}
      ${hint}
    </div>`;
  },
  renderTrust(el, trust) {
    if (!el || !trust) return;
    const cues = trust.cues || [];
    el.innerHTML =
      cues.map((c) => `<span class="trust-pill light-trust">${YB.esc(c)}</span>`).join('') +
      (trust.noteZh ? `<span class="muted trust-note">${YB.esc(trust.noteZh)}</span>` : '');
  },
  bindSideNav() {
    document.body.classList.add('density-m40');
    document.body.classList.add('feedback-m41');
    YB.ensureFeedbackHosts();
    const links = document.querySelectorAll('.wb-side a[href^="#"], .mobile-wb-nav a[href^="#"]');
    const mark = () => {
      const hash = location.hash || '#home';
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === hash));
    };
    links.forEach((a) => a.addEventListener('click', () => setTimeout(mark, 0)));
    window.addEventListener('hashchange', mark);
    mark();
    YB.enhanceA11y(document);
  },
  ensureSheetHost() {
    let host = document.getElementById('ybSheetHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'ybSheetHost';
    host.innerHTML = `
      <div class="yb-sheet-backdrop" data-close="1" hidden></div>
      <aside class="yb-sheet" id="ybSheet" role="dialog" aria-modal="true" aria-labelledby="ybSheetTitle" hidden>
        <header class="yb-sheet-head">
          <div>
            <div class="yb-sheet-kicker" id="ybSheetKicker">匹配一页纸</div>
            <h2 id="ybSheetTitle">加载中…</h2>
          </div>
          <button type="button" class="ghost yb-sheet-x" data-close="1" aria-label="关闭">关闭</button>
        </header>
        <div class="yb-sheet-body" id="ybSheetBody"></div>
        <footer class="yb-sheet-foot" id="ybSheetFoot"></footer>
      </aside>`;
    document.body.appendChild(host);
    host.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-close')) YB.closeSheet();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') YB.closeSheet();
    });
    return host;
  },
  closeSheet() {
    const bd = document.querySelector('.yb-sheet-backdrop');
    const sh = document.getElementById('ybSheet');
    if (bd) bd.hidden = true;
    if (sh) sh.hidden = true;
    document.body.classList.remove('yb-sheet-open');
  },
  openSheetLoading(title) {
    YB.ensureSheetHost();
    document.querySelector('.yb-sheet-backdrop').hidden = false;
    const sh = document.getElementById('ybSheet');
    sh.hidden = false;
    document.body.classList.add('yb-sheet-open');
    document.getElementById('ybSheetTitle').textContent = title || '加载中…';
    document.getElementById('ybSheetBody').innerHTML = '<div class="empty-state"><p class="muted">正在生成一页纸说明…</p></div>';
    document.getElementById('ybSheetFoot').innerHTML = '';
  },
  renderOnePager(op, extra = {}) {
    if (!op) return '<div class="empty-state"><strong>暂无说明</strong><p class="muted">这条匹配还没有一页纸。</p></div>';
    const risks = (op.riskCues || [])
      .map((r) => {
        const tone = r.level === 'ok' ? 'ok' : r.level === 'danger' ? 'danger' : 'warn';
        return `<li class="sheet-cue ${tone}">${YB.esc(r.textZh || '')}</li>`;
      })
      .join('');
    const rights = (op.rightsCues || []).map((t) => `<li>${YB.esc(t)}</li>`).join('');
    const whys = (op.whyBullets || []).map((t) => `<li>${YB.esc(t)}</li>`).join('');
    const feats = (op.topFeatures || [])
      .map(
        (f) =>
          `<div class="sheet-feat"><span>${YB.esc(f.label)}</span><i style="width:${Math.min(100, Number(f.pctOfTotal) || 0)}%"></i><b>${Math.round(f.pctOfTotal || 0)}%</b></div>`,
      )
      .join('');
    const role = extra.roleHint || '';
    const forRole = (op.nextStep && op.nextStep.forRole) || {};
    const roleLine = role && forRole[role] ? forRole[role] : '';
    return `
      <div class="sheet-score-row">
        <span class="sheet-score">${YB.esc(op.scoreLabelZh || '')}</span>
        <span class="status-chip">${YB.esc(op.statusZh || '')}</span>
      </div>
      <p class="sheet-pair muted">${YB.esc(op.pairLineZh || '')}</p>
      <h3 class="sheet-h">为什么推这一对</h3>
      <ul class="sheet-list">${whys}</ul>
      ${feats ? `<div class="sheet-feats">${feats}</div>` : ''}
      <h3 class="sheet-h">风险与提示</h3>
      <ul class="sheet-list cues">${risks}</ul>
      <h3 class="sheet-h">权利与成熟度</h3>
      <ul class="sheet-list">${rights}</ul>
      <div class="sheet-next">
        <div class="sheet-next-label">建议下一步</div>
        <strong>${YB.esc(op.nextStep?.labelZh || '')}</strong>
        <p class="muted">${YB.esc(op.nextStep?.whyZh || '')}</p>
        ${roleLine ? `<p class="sheet-role-tip">${YB.esc(roleLine)}</p>` : ''}
      </div>
      <p class="muted sheet-trust">${YB.esc(op.trustNoteZh || '')}</p>
    `;
  },

  async downloadAuth(path, filename) {
    const headers = {};
    if (YB.token) headers.Authorization = 'Bearer ' + YB.token;
    const r = await fetch('/api' + path, { headers });
    if (!r.ok) {
      const text = await r.text();
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch (_) {}
      throw new Error(msg || '下载失败 ' + r.status);
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  },
  async downloadAuthPost(path, body, filename) {
    const headers = { 'Content-Type': 'application/json' };
    if (YB.token) headers.Authorization = 'Bearer ' + YB.token;
    const r = await fetch('/api' + path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    if (!r.ok) {
      const text = await r.text();
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch (_) {}
      throw new Error(msg || '下载失败 ' + r.status);
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  },
  async openMatchSheet(matchId, opts = {}) {
    if (!matchId) return;
    YB.openSheetLoading('匹配一页纸');
    // M57：收件箱投影先画骨架，再拉 slim one-pager（fields=sheet · ETag/短缓存）
    const preview = opts.preview || opts.sheetPreview || null;
    if (preview) {
      try {
        document.getElementById('ybSheetKicker').textContent = '匹配一页纸 · 首屏投影';
        document.getElementById('ybSheetTitle').textContent = preview.headlineZh || '匹配说明';
        document.getElementById('ybSheetBody').innerHTML =
          `<div class="yb-sheet-skeleton m57-skel" aria-busy="true">
            <p class="sheet-pair muted">${YB.esc(preview.pairLineZh || '')}</p>
            <p>${YB.esc(preview.reasonSnippet || '正在打开一页纸…')}</p>
            <p class="muted m55-wait-hint">正在加载完整说明（slim · 可取消关闭）…</p>
          </div>`;
      } catch (_) {}
    }
    YB.busy(true, opts.busyText || '正在打开一页纸…');
    try {
      const q =
        '?tier=' +
        encodeURIComponent(opts.tier || 'partner') +
        '&fields=sheet&slim=1';
      const data = await YB.api('/matches/' + matchId + '/one-pager' + q, {
        busy: false,
        quiet: true,
        useEtagCache: true,
        noRedirectOn401: true,
      });
      YB.busy(false);
      const op = data.onePager || data;
      const cacheTag = data.cache ? ' · ' + data.cache : '';
      const msTag = data.timingMs != null ? ' · ' + data.timingMs + 'ms' : '';
      document.getElementById('ybSheetKicker').textContent =
        '匹配一页纸 · 打开 → 行动 → 导出' + cacheTag + msTag;
      document.getElementById('ybSheetTitle').textContent = op.headlineZh || '匹配说明';
      document.getElementById('ybSheetBody').innerHTML = YB.renderOnePager(op, { roleHint: opts.roleHint });
      const nextLabel = (op.nextStep && op.nextStep.labelZh) || '记下建议下一步';
      const foot = document.getElementById('ybSheetFoot');
      foot.classList.add('m40-foot');
      foot.innerHTML = `
        <div class="yb-sheet-act-row">
          <button type="button" class="yb-sheet-primary" id="ybSheetPrimary" aria-label="记下建议下一步：${YB.esc(nextLabel)}">${YB.esc(nextLabel)}</button>
          <button type="button" class="ghost" id="ybSheetPdf" aria-label="下载一页纸 PDF">导出 PDF</button>
        </div>
        <details class="yb-sheet-more">
          <summary>更多（分享 / 打印 / 单独打开）</summary>
          <div class="yb-sheet-act-row">
            <button type="button" class="ghost" id="ybSheetShare" aria-label="生成合作方分享链接">分享合作方</button>
            <button type="button" class="ghost" id="ybSheetPrint" aria-label="打印一页纸">打印</button>
            <a class="buttonish ghost" href="/match-sheet.html?id=${encodeURIComponent(matchId)}&tier=full" target="_blank" rel="noopener" aria-label="在新标签打开完整一页纸">单独打开</a>
            <button type="button" class="ghost" data-close="1" aria-label="关闭一页纸">关闭</button>
          </div>
        </details>
        <span class="muted sheet-foot-note">${YB.esc(op.footerZh || '先看懂为什么对得上，再导出或分享。')}</span>`;
      const roleQ = (opts.roleHint ? '?role=' + encodeURIComponent(opts.roleHint) + '&' : '?') + 'tier=full';
      const primary = document.getElementById('ybSheetPrimary');
      if (primary) {
        primary.onclick = () => {
          const tip = (op.nextStep && (op.nextStep.whyZh || op.nextStep.labelZh)) || nextLabel;
          try {
            sessionStorage.setItem('yanqi_last_next_' + matchId, tip);
          } catch (_) {}
          YB.toast('已记下下一步：' + tip, 'ok', 4000);
        };
      }
      const pdfBtn = document.getElementById('ybSheetPdf');
      if (pdfBtn) {
        pdfBtn.onclick = async () => {
          try {
            await YB.downloadAuth('/matches/' + matchId + '/one-pager/pdf' + roleQ, 'yanqi-one-pager.pdf');
          } catch (err) {
            YB.toast(err.message || 'PDF 下载失败，可点「单独打开」后打印', 'err');
          }
        };
      }
      const pr = document.getElementById('ybSheetPrint');
      if (pr) {
        pr.onclick = () => window.open('/match-sheet.html?id=' + encodeURIComponent(matchId) + '&tier=full', '_blank', 'noopener');
      }
      const sh = document.getElementById('ybSheetShare');
      if (sh) {
        sh.onclick = async () => {
          try {
            const r = await YB.api('/matches/' + matchId + '/one-pager/share', {
              method: 'POST',
              body: JSON.stringify({ tier: 'partner', expiresDays: 14 }),
            });
            if (r.readable === false || !r.urlPath) {
              YB.toast(r.noteZh || '这条还不能对外分享', 'warn');
              return;
            }
            const url = location.origin + r.urlPath;
            try { await navigator.clipboard.writeText(url); YB.toast('合作方链接已复制', 'ok'); }
            catch { prompt('复制合作方链接', url); }
          } catch (err) {
            YB.toast(err.message || '分享失败', 'err');
          }
        };
      }
    } catch (e) {
      try { YB.busy(false); } catch (_) {}
      const msg = String(e && e.message ? e.message : e || '');
      const isAuth = /401|403|登录|权限|未授权|Forbidden|Unauthorized/i.test(msg);
      document.getElementById('ybSheetTitle').textContent = isAuth ? '需要重新登录' : '加载失败';
      document.getElementById('ybSheetBody').innerHTML =
        `<div class="empty-state calm primary-empty"><strong>${
          isAuth ? '登录已失效或无权查看' : '一页纸打不开'
        }</strong><p class="muted">${YB.esc(msg || '请稍后重试')}</p>${
          isAuth
            ? '<p class="muted">请重新登录后再从收件箱点「看一页纸」。</p><a class="buttonish" href="/">去登录</a>'
            : ''
        }</div>`;
      YB.toast(
        isAuth ? ( /403/.test(msg) ? '没有权限查看该一页纸（403）' : '登录已失效，请重新登录后再看一页纸（401）' ) : msg || '一页纸打开失败',
        isAuth ? 'security' : 'err',
      );
    }
  },

  /** M40：给主 CTA / 导航补 aria；登录与办事窗共用 */
  enhanceA11y(root) {
    const scope = root || document;
    scope.querySelectorAll('button:not([aria-label]), a.buttonish:not([aria-label])').forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 40) el.setAttribute('aria-label', t);
    });
    scope.querySelectorAll('.task-card').forEach((a) => {
      if (!a.getAttribute('aria-label')) {
        const title = a.querySelector('strong');
        if (title) a.setAttribute('aria-label', '今天待办：' + title.textContent.trim());
      }
    });
  },

  /** M40：移动端剧本左右滑 / 点圆点切卡 */
  bindPlaybookDeck(gridEl, opts = {}) {
    if (!gridEl) return;
    const wrap = gridEl.closest('.playbook-deck-wrap') || gridEl.parentElement;
    if (!wrap) return;
    wrap.classList.add('playbook-deck-mode');
    let nav = wrap.querySelector('.playbook-deck-nav');
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'playbook-deck-nav';
      nav.innerHTML = `
        <button type="button" class="ghost pb-nav-btn" data-pb-dir="-1" aria-label="上一张剧本">‹</button>
        <div class="playbook-deck-dots" role="tablist" aria-label="剧本卡片"></div>
        <button type="button" class="ghost pb-nav-btn" data-pb-dir="1" aria-label="下一张剧本">›</button>`;
      wrap.insertBefore(nav, gridEl);
      const hint = document.createElement('p');
      hint.className = 'playbook-swipe-hint muted';
      hint.textContent = opts.hintZh || '左右滑切换剧本 · 点芯片记下下一步 · 复制话术';
      wrap.insertBefore(hint, gridEl);
    }
    const cards = [...gridEl.querySelectorAll('.playbook-card')];
    const dots = nav.querySelector('.playbook-deck-dots');
    let idx = 0;
    const show = (n) => {
      if (!cards.length) return;
      idx = (n + cards.length) % cards.length;
      cards.forEach((c, i) => c.classList.toggle('on', i === idx));
      dots.innerHTML = cards
        .map((_, i) => `<button type="button" class="${i === idx ? 'on' : ''}" aria-label="第 ${i + 1} 张剧本" aria-selected="${i === idx}"></button>`)
        .join('');
      dots.querySelectorAll('button').forEach((b, i) => {
        b.onclick = () => show(i);
      });
    };
    nav.querySelectorAll('[data-pb-dir]').forEach((btn) => {
      btn.onclick = () => show(idx + Number(btn.dataset.pbDir));
    });
    let startX = 0;
    gridEl.ontouchstart = (e) => {
      startX = e.changedTouches?.[0]?.clientX || 0;
    };
    gridEl.ontouchend = (e) => {
      const x = e.changedTouches?.[0]?.clientX || 0;
      const dx = x - startX;
      if (Math.abs(dx) < 48) return;
      show(idx + (dx < 0 ? 1 : -1));
    };
    show(0);
  },
};
