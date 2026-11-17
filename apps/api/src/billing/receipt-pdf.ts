import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export type ReceiptPdfInput = {
  id: string;
  number: string;
  title: string;
  planCode: string;
  amountFen: number;
  currency: string;
  status: string;
  statusZh: string;
  issuedAt: Date | string;
  bodyMd?: string;
  tenantId?: string | null;
  userId?: string | null;
  checkoutSessionId?: string | null;
};

function yuan(fen: number) {
  return ((fen || 0) / 100).toFixed(2);
}

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function receiptRoot() {
  const root = join(process.cwd(), 'exports', 'receipts');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

/** 中文回执 HTML（政务办事回执感 · 明确演示不扣款） */
export function buildReceiptHtml(inv: ReceiptPdfInput) {
  const issued =
    inv.issuedAt instanceof Date
      ? inv.issuedAt.toISOString()
      : String(inv.issuedAt || new Date().toISOString());
  const issuedLocal = new Date(issued).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  const bodyPlain = String(inv.bodyMd || '')
    .replace(/^#+\s*/gm, '')
    .replace(/[`*_>]/g, '')
    .trim();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>研企通演示回执 ${esc(inv.number)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
    color: #0f172a; margin: 0; padding: 0; font-size: 13.5px; line-height: 1.55; }
  .sheet { border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 22px 24px 28px; }
  .banner { background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; border-radius: 8px;
    padding: 10px 12px; margin-bottom: 16px; font-weight: 600; }
  .banner small { display:block; font-weight:500; margin-top:4px; color:#a16207; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px; }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: .04em; }
  .brand span { display:block; font-size:12px; font-weight:500; color:#64748b; margin-top:2px; }
  .stamp { border: 2px solid #dc2626; color:#dc2626; border-radius: 6px; padding: 6px 10px;
    font-size: 12px; font-weight:700; transform: rotate(-6deg); opacity:.85; white-space:nowrap; }
  h1 { font-size: 17px; margin: 0 0 12px; }
  table.meta { width:100%; border-collapse: collapse; margin: 8px 0 16px; }
  table.meta th, table.meta td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align:left; vertical-align:top; }
  table.meta th { width: 28%; background:#f8fafc; color:#475569; font-weight:600; }
  .amount { font-size: 22px; font-weight: 700; color:#0f766e; }
  .body { white-space: pre-wrap; background:#f8fafc; border-radius:8px; padding:12px 14px; border:1px solid #e2e8f0; }
  .foot { margin-top: 18px; font-size: 11.5px; color:#64748b; border-top:1px dashed #cbd5e1; padding-top:10px; }
  .foot strong { color:#334155; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="banner">演示回执 · 不可报销入账 · 未发生真实收款
      <small>本文件由研企通支付试点骨架生成，不会连接微信、支付宝或银行卡，也不会产生真实扣款。</small>
    </div>
    <div class="head">
      <div class="brand">研企通<span>科研能力 / 成果与企业需求对接</span></div>
      <div class="stamp">演示专用</div>
    </div>
    <h1>电子缴费回执（试点）</h1>
    <table class="meta">
      <tr><th>回执编号</th><td>${esc(inv.number)}</td></tr>
      <tr><th>标题</th><td>${esc(inv.title || '研企通套餐')}</td></tr>
      <tr><th>套餐代码</th><td>${esc(inv.planCode)}</td></tr>
      <tr><th>金额</th><td class="amount">¥${esc(yuan(inv.amountFen))} <span style="font-size:13px;font-weight:500;color:#64748b">${esc(inv.currency || 'CNY')}</span></td></tr>
      <tr><th>状态</th><td>${esc(inv.statusZh || inv.status)}</td></tr>
      <tr><th>开具时间</th><td>${esc(issuedLocal)}（Asia/Shanghai）</td></tr>
      <tr><th>结账会话</th><td style="font-family:ui-monospace,monospace;font-size:12px">${esc(inv.checkoutSessionId || '—')}</td></tr>
      <tr><th>租户</th><td>${esc(inv.tenantId || 'default')}</td></tr>
    </table>
    <div class="body">${esc(bodyPlain || '（无附加说明）')}</div>
    <div class="foot">
      <strong>使用说明：</strong>本回执仅用于产品试点验收与界面演示，不能作为税务发票、报销凭证或对公到账证明。
      真微信 / 对公收款通道上线后，将替换为正式电子凭证链路。生成源：invoice <code>${esc(inv.id)}</code>。
    </div>
  </div>
</body>
</html>`;
}

export async function renderReceiptPdf(inv: ReceiptPdfInput): Promise<{
  ok: true;
  htmlPath: string;
  pdfPath: string;
  bytes: number;
  noteZh: string;
}> {
  const root = receiptRoot();
  const safe = String(inv.number || inv.id).replace(/[^\w.-]+/g, '_');
  const htmlPath = join(root, `${safe}.html`);
  const pdfPath = join(root, `${safe}.pdf`);
  const html = buildReceiptHtml(inv);
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
    noteZh: '中文回执 PDF（Chrome 排版打印），企业窗与运营台可下载。演示不可报销。',
  };
}
