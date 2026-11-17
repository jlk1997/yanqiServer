import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export type ParkDocPdfInput = {
  id: string;
  docNo?: string | null;
  titleZh: string;
  bodyZh: string;
  directionZh?: string;
  statusZh?: string;
  counterpartyZh?: string;
  templateNameZh?: string | null;
  windowTitleZh?: string | null;
  createdAt?: string;
  updatedAt?: string;
  issuerZh?: string;
};

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parkDocRoot() {
  const root = join(process.cwd(), 'exports', 'park-docs');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

/** 仿红头公文 HTML · 横幅明确非法定公文 */
export function buildParkDocRedHeaderHtml(doc: ParkDocPdfInput) {
  const issuedLocal = new Date(doc.updatedAt || doc.createdAt || Date.now()).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
  const issuer = doc.issuerZh || '研企通园区观察台（演示）';
  const body = String(doc.bodyZh || '（正文待补）').trim();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>研企通演示公文 ${esc(doc.docNo || doc.id)}</title>
<style>
  @page { size: A4; margin: 16mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans CJK SC","Source Han Sans SC","SimSun","Songti SC","PingFang SC","Microsoft YaHei",serif;
    color: #111; margin: 0; padding: 0; font-size: 15px; line-height: 1.75; }
  .banner { background: #fff7ed; border: 1.5px solid #ea580c; color: #9a3412; border-radius: 8px;
    padding: 10px 12px; margin-bottom: 18px; font-weight: 700; font-family: "PingFang SC","Microsoft YaHei",sans-serif; font-size: 13px; }
  .banner small { display:block; font-weight:500; margin-top:4px; color:#c2410c; }
  .red-head { text-align: center; color: #b91c1c; margin: 8px 0 6px; }
  .red-head .org { font-size: 28px; font-weight: 800; letter-spacing: .18em; font-family: "SimHei","Heiti SC","PingFang SC",sans-serif; }
  .red-head .sub { font-size: 13px; color: #991b1b; margin-top: 4px; letter-spacing: .08em; }
  .line { height: 3px; background: linear-gradient(90deg,#b91c1c 0%,#b91c1c 100%); margin: 10px 0 4px; }
  .line2 { height: 1px; background: #b91c1c; margin-bottom: 16px; }
  .docno { text-align: center; font-size: 14px; margin: 10px 0 18px; color: #333; }
  h1.title { text-align: center; font-size: 20px; font-weight: 700; margin: 0 0 20px; letter-spacing: .06em; }
  .meta { font-size: 12.5px; color: #444; margin-bottom: 14px; font-family: "PingFang SC","Microsoft YaHei",sans-serif; }
  .meta span { margin-right: 14px; }
  .body { white-space: pre-wrap; text-indent: 0; min-height: 220px; }
  .body p { text-indent: 2em; margin: 0 0 .6em; }
  .stamp { margin-top: 36px; text-align: right; padding-right: 24px; }
  .stamp .who { font-size: 15px; margin-bottom: 6px; }
  .stamp .when { font-size: 13px; color: #444; }
  .seal { display:inline-block; margin-top: 8px; border: 2.5px solid #dc2626; color:#dc2626; border-radius: 50%;
    width: 86px; height: 86px; line-height: 1.2; text-align:center; font-size: 11px; font-weight:700;
    padding-top: 22px; transform: rotate(-8deg); opacity: .78; font-family: "PingFang SC","Microsoft YaHei",sans-serif; }
  .foot { margin-top: 28px; font-size: 11.5px; color:#64748b; border-top:1px dashed #cbd5e1; padding-top:10px;
    font-family: "PingFang SC","Microsoft YaHei",sans-serif; }
</style>
</head>
<body>
  <div class="banner">非法定公文 · 平台内演示套版 · 不接政务专网 / 电子签章
    <small>本文件由研企通园区公文交换骨架生成，仅供产品试点与内部讨论，不具备正式发文效力，不可作为行政依据。</small>
  </div>
  <div class="red-head">
    <div class="org">${esc(issuer)}</div>
    <div class="sub">FILE EXCHANGE DEMO · 非法定公文</div>
  </div>
  <div class="line"></div>
  <div class="line2"></div>
  <div class="docno">${esc(doc.docNo || '（待签发文号）')}</div>
  <h1 class="title">${esc(doc.titleZh || '（无标题）')}</h1>
  <div class="meta">
    <span>方向：${esc(doc.directionZh || '—')}</span>
    <span>状态：${esc(doc.statusZh || '—')}</span>
    <span>对方：${esc(doc.counterpartyZh || '—')}</span>
    ${doc.templateNameZh ? `<span>模板：${esc(doc.templateNameZh)}</span>` : ''}
    ${doc.windowTitleZh ? `<span>征集窗：${esc(doc.windowTitleZh)}</span>` : ''}
  </div>
  <div class="body">${esc(body).split(/\n+/).map((line) => `<p>${line || '&nbsp;'}</p>`).join('')}</div>
  <div class="stamp">
    <div class="who">${esc(issuer)}</div>
    <div class="when">${esc(issuedLocal)}（Asia/Shanghai）</div>
    <div class="seal">演示<br/>专用章</div>
  </div>
  <div class="foot">生成源：park-doc <code>${esc(doc.id)}</code> · 真政务专网与电子签章仍延后。横幅「非法定公文」不可删除。</div>
</body>
</html>`;
}

export async function renderParkDocPdf(doc: ParkDocPdfInput): Promise<{
  ok: true;
  htmlPath: string;
  pdfPath: string;
  bytes: number;
  noteZh: string;
}> {
  const root = parkDocRoot();
  const safe = String(doc.docNo || doc.id)
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .slice(0, 80);
  const htmlPath = join(root, `${safe}.html`);
  const pdfPath = join(root, `${safe}.pdf`);
  const html = buildParkDocRedHeaderHtml(doc);
  writeFileSync(htmlPath, html, 'utf8');

  const chrome =
    process.env.CHROME_PATH ||
    (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : 'google-chrome');
  const fileUrl = 'file://' + htmlPath;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--print-to-pdf=${pdfPath}`,
        '--no-pdf-header-footer',
        fileUrl,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 && existsSync(pdfPath) && statSync(pdfPath).size > 500) resolve();
      else reject(new Error(err.slice(0, 400) || `chrome exit ${code}`));
    });
  });
  return {
    ok: true,
    htmlPath,
    pdfPath,
    bytes: statSync(pdfPath).size,
    noteZh: '红头套版 PDF（演示）：含「非法定公文」横幅，不接专网、无电子签章。',
  };
}
