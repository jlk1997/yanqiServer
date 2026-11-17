/** 研企通白标：拉 /api/public/branding 注入 CSS 变量与品牌文案 */
(async function applyYanqiBranding() {
  try {
    const r = await fetch('/api/public/branding');
    const j = await r.json();
    const b = j.branding || j || {};
    const color = b.primaryColor || '#3d8bfd';
    const name = b.productName || '研企通';
    const tag = b.tagline || '';
    const logo = b.logoUrl || '';
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--brand', color);
    document.documentElement.style.setProperty('--primary', color);
    const logos = document.querySelectorAll('.logo, [data-brand-name]');
    logos.forEach((el) => {
      if (logo && el.classList.contains('logo')) {
        el.innerHTML = `<img src="${logo}" alt="" style="height:28px;vertical-align:middle;margin-right:8px;border-radius:6px" onerror="this.remove()" /><span data-brand-name>${name}</span>`;
      } else if (el.hasAttribute('data-brand-name') || el.classList.contains('logo')) {
        el.textContent = name;
      }
    });
    document.querySelectorAll('[data-brand-tag]').forEach((el) => {
      if (tag) el.textContent = tag;
    });
    document.querySelectorAll('.sub[data-brand-sub], .brand .sub').forEach((el, i) => {
      if (i === 0 && tag) el.textContent = tag;
    });
    if (document.title && document.title.includes('研企通')) {
      document.title = document.title.replace(/研企通/g, name);
    }
    window.__yanqiBrand = b;
    document.dispatchEvent(new CustomEvent('yanqi:branding', { detail: b }));
  } catch (e) {
    console.warn('branding', e);
  }
})();
