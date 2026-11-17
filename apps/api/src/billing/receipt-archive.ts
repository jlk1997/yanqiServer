import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { buildReceiptHtml, renderReceiptPdf, receiptRoot } from './receipt-pdf';

const { ZipArchive, Archiver } = require('archiver');

function createZipArchive(options?: any) {
  if (ZipArchive) return new ZipArchive(options || { zlib: { level: 9 } });
  return new Archiver('zip', options || { zlib: { level: 9 } });
}

export type ArchiveInvoice = {
  id: string;
  number: string;
  title?: string | null;
  planCode: string;
  amount: number;
  currency: string;
  status: string;
  issuedAt: Date;
  bodyMd?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  checkoutSessionId?: string | null;
};

function archiveRoot() {
  const root = join(process.cwd(), 'exports', 'receipt-archives');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function yuan(fen: number) {
  return ((fen || 0) / 100).toFixed(2);
}

function statusZh(st: string) {
  return (
    {
      pending: '待支付（演示）',
      paid: '已模拟支付',
      issued: '已开票（演示）',
      paid_stub: '演示已付',
      void: '作废',
    } as Record<string, string>
  )[st] || st;
}

/** 批量把已付演示回执打成 ZIP：每份 PDF + meta.json + 总清单 */
export async function buildReceiptArchiveZip(
  invoices: ArchiveInvoice[],
  opts: { actor: string; scope: string; tenantId?: string | null },
) {
  if (!invoices.length) {
    throw new Error('没有可归档的已付回执');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `receipts-${opts.scope}-${stamp}.zip`;
  const filePath = join(archiveRoot(), fileName);
  const entries: any[] = [];

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = createZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);

    (async () => {
      try {
        for (const inv of invoices) {
          const input = {
            id: inv.id,
            number: inv.number,
            title: inv.title || '研企通套餐',
            planCode: inv.planCode,
            amountFen: inv.amount,
            currency: inv.currency,
            status: inv.status,
            statusZh: statusZh(inv.status),
            issuedAt: inv.issuedAt,
            bodyMd: inv.bodyMd || '',
            tenantId: inv.tenantId || null,
            userId: inv.userId || null,
            checkoutSessionId: inv.checkoutSessionId || null,
          };
          const pdf = await renderReceiptPdf(input);
          const folder = inv.number.replace(/[^A-Za-z0-9_-]/g, '_');
          const pdfBuf = readFileSync(pdf.pdfPath);
          const meta = {
            id: inv.id,
            number: inv.number,
            title: inv.title,
            planCode: inv.planCode,
            amountYuan: yuan(inv.amount),
            amountFen: inv.amount,
            currency: inv.currency,
            status: inv.status,
            statusZh: statusZh(inv.status),
            issuedAt: inv.issuedAt,
            tenantId: inv.tenantId,
            userId: inv.userId,
            checkoutSessionId: inv.checkoutSessionId,
            bannerZh: '演示回执 · 不可报销入账 · 未发生真实收款',
            chargesRealMoney: false,
            pdfBytes: pdfBuf.length,
            sha256: createHash('sha256').update(pdfBuf).digest('hex'),
          };
          archive.append(pdfBuf, { name: `${folder}/${inv.number}.pdf` });
          archive.append(JSON.stringify(meta, null, 2), { name: `${folder}/${inv.number}.meta.json` });
          archive.append(buildReceiptHtml(input), { name: `${folder}/${inv.number}.html` });
          entries.push({ id: inv.id, number: inv.number, amountYuan: yuan(inv.amount), folder });
        }
        const manifest = {
          wave: 'M36-broker-hall-tpl-edit-ops-cards',
          generatedAt: new Date().toISOString(),
          actor: opts.actor,
          scope: opts.scope,
          tenantId: opts.tenantId || null,
          chargesRealMoney: false,
          bannerZh: '演示回执 ZIP 归档：仅含试点骨架 PDF/元数据，不可用于报销或税务申报。',
          count: entries.length,
          entries,
        };
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
        archive.append(
          [
            '# 研企通 · 演示回执归档包',
            '',
            `- 生成时间：${manifest.generatedAt}`,
            `- 操作人：${opts.actor}`,
            `- 范围：${opts.scope}`,
            `- 份数：${entries.length}`,
            '',
            '本包全部为**演示不扣款**回执。不可报销、不可入账、未发生真实收款。',
            '真 PSP / 税务电子发票仍延后。',
            '',
          ].join('\n'),
          { name: 'README.md' },
        );
        archive.finalize();
      } catch (e) {
        reject(e);
      }
    })();
  });

  const stat = require('fs').statSync(filePath);
  // touch receipt root so ops can see sibling exports
  if (!existsSync(receiptRoot())) mkdirSync(receiptRoot(), { recursive: true });
  writeFileSync(
    join(archiveRoot(), `${fileName}.json`),
    JSON.stringify({ fileName, bytes: stat.size, count: entries.length, at: new Date().toISOString() }, null, 2),
  );
  return { filePath, fileName, bytes: stat.size, count: entries.length, entries };
}
