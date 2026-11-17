import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const STATUS_ZH: Record<string, string> = {
  stub: '待填金额',
  pending: '待财务复核',
  approved: '已核准',
  paid: '已记账（演示）',
};

function fenToYuan(fen: number) {
  return Math.round(Number(fen || 0)) / 100;
}

@Injectable()
export class CommissionsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(opts: { brokerId?: string; tenantId?: string; status?: string; from?: string; to?: string } = {}) {
    const createdAt: any = {};
    if (opts.from) {
      const d = new Date(opts.from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (opts.to) {
      const d = new Date(opts.to);
      if (!Number.isNaN(d.getTime())) {
        // inclusive end-of-day if date-only
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(opts.to).trim())) d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    return this.prisma.brokerCommission.findMany({
      where: {
        ...(opts.brokerId ? { brokerId: opts.brokerId } : {}),
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async createStub(
    body: {
      matchId: string;
      brokerId?: string;
      dealAmount?: number;
      rate?: number;
      note?: string;
      tenantId?: string;
      status?: string;
    },
    actor = 'ops',
  ) {
    const match = await this.prisma.matchResult.findUnique({ where: { id: body.matchId } });
    if (!match) throw new NotFoundException('匹配不存在');
    const brokerId = body.brokerId || match.brokerId;
    if (!brokerId) throw new BadRequestException('请先分派经纪人或指定 brokerId');
    const dealAmount = Math.max(0, Number(body.dealAmount || 0));
    const rate = Math.min(1, Math.max(0, Number(body.rate ?? 0.1)));
    const amount = Math.round(dealAmount * rate);
    const row = await this.prisma.brokerCommission.create({
      data: {
        matchId: body.matchId,
        brokerId,
        tenantId: body.tenantId || match.tenantId || 'default',
        status: body.status || 'stub',
        dealAmount,
        rate,
        amount,
        note: body.note || '分成桩：成交确认后由财务复核',
        meta: { source: 'closed_won_stub' },
      },
    });
    await this.audit.log({
      action: 'commission.stub',
      actor,
      targetType: 'BrokerCommission',
      targetId: row.id,
      meta: { matchId: body.matchId, brokerId, amount, rate },
    });
    return row;
  }

  async setStatus(id: string, status: string, actor = 'ops') {
    const allowed = ['stub', 'pending', 'approved', 'paid'];
    if (!allowed.includes(status)) throw new BadRequestException('非法状态');
    const TRANSITIONS: Record<string, string[]> = {
      stub: ['pending', 'approved'],
      pending: ['approved', 'stub'],
      approved: ['paid', 'pending'],
      paid: [], // 已记账演示态不可回退，防账本乱跳
    };
    const cur = await this.prisma.brokerCommission.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('佣金账不存在');
    if (cur.status === status) {
      return { ...cur, statusZh: STATUS_ZH[cur.status] || cur.status, idempotent: true };
    }
    const next = TRANSITIONS[cur.status] || [];
    if (!next.includes(status)) {
      throw new BadRequestException(
        `佣金不能从「${STATUS_ZH[cur.status] || cur.status}」转到「${STATUS_ZH[status] || status}」`,
      );
    }
    const row = await this.prisma.brokerCommission.update({
      where: { id },
      data: { status },
    });
    await this.audit.log({
      action: 'commission.status',
      actor,
      targetType: 'BrokerCommission',
      targetId: id,
      meta: { from: cur.status, to: status },
    });
    return { ...row, statusZh: STATUS_ZH[row.status] || row.status, from: cur.status };
  }

  /** 匹配 closed_won 时可选自动生成分成桩 */
  async maybeFromClosedWon(matchId: string, actor = 'ops') {
    return this.reconcileClosedWon(matchId, actor);
  }

  /**
   * closed_won → 佣金账本幂等入账/刷新。
   * - 无记录：建 pending 桩（金额可后填）
   * - 已有演示种子/空桩：升格为成交入账并写 reconciledAt
   * - 已核准/已记账：只补 meta，不改金额
   * 永不触发真实支付。
   */
  async reconcileClosedWon(matchId: string, actor = 'ops') {
    const match = await this.prisma.matchResult.findUnique({ where: { id: matchId } });
    if (!match?.brokerId) return null;
    const exists = await this.prisma.brokerCommission.findFirst({ where: { matchId } });
    const nowIso = new Date().toISOString();
    if (!exists) {
      const row = await this.prisma.brokerCommission.create({
        data: {
          matchId,
          brokerId: match.brokerId,
          tenantId: match.tenantId || 'default',
          status: 'pending',
          dealAmount: 0,
          rate: 0.1,
          amount: 0,
          note: '成交自动入账：金额待运营/财务填写（演示，不打款）',
          meta: {
            source: 'closed_won_reconcile',
            trigger: 'closed_won',
            reconciledAt: nowIso,
            neverCharges: true,
            auto: true,
          },
        },
      });
      await this.audit.log({
        action: 'commission.reconcile_closed_won',
        actor,
        targetType: 'BrokerCommission',
        targetId: row.id,
        meta: { matchId, created: true },
      });
      return { ...row, reconcileZh: '成交自动入账（新建）', idempotent: false };
    }
    const meta = { ...((exists.meta as any) || {}) };
    const already = meta.trigger === 'closed_won' && meta.reconciledAt;
    const nextMeta = {
      ...meta,
      source: meta.source === 'm30-demo-ledger' ? 'closed_won_reconcile_from_demo' : meta.source || 'closed_won_reconcile',
      trigger: 'closed_won',
      reconciledAt: meta.reconciledAt || nowIso,
      lastReconcileAt: nowIso,
      neverCharges: true,
    };
    let status = exists.status;
    let note = exists.note || '';
    // 空桩/演示待填 → 标成待财务复核，便于经纪人账本一眼看懂
    if (status === 'stub' || (status === 'pending' && !already && (exists.amount || 0) === 0)) {
      status = 'pending';
      if (!note.includes('成交自动入账')) {
        note = (note ? note + ' · ' : '') + '成交自动入账：待财务复核金额（演示，不打款）';
      }
    }
    const row = await this.prisma.brokerCommission.update({
      where: { id: exists.id },
      data: { status, note, meta: nextMeta },
    });
    if (!already) {
      await this.audit.log({
        action: 'commission.reconcile_closed_won',
        actor,
        targetType: 'BrokerCommission',
        targetId: row.id,
        meta: { matchId, created: false },
      });
    }
    return {
      ...row,
      reconcileZh: already ? '已对过账（幂等）' : '成交自动入账（更新）',
      idempotent: Boolean(already),
    };
  }

  /**
   * 经纪人可读对账页数据。演示金额单位：分 → 元展示。
   * 永不触发真实支付 / 出金。
   */
  async ledger(opts: { brokerId?: string; tenantId?: string; status?: string; from?: string; to?: string } = {}) {
    await this.ensureDemoLedger(opts.brokerId).catch(() => null);
    const rows = await this.list(opts);
    const byStatus: Record<string, { count: number; amountFen: number; dealFen: number }> = {};
    for (const r of rows) {
      const k = r.status || 'stub';
      if (!byStatus[k]) byStatus[k] = { count: 0, amountFen: 0, dealFen: 0 };
      byStatus[k].count += 1;
      byStatus[k].amountFen += r.amount || 0;
      byStatus[k].dealFen += r.dealAmount || 0;
    }
    const totalFen = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const approvedFen = rows.filter((r) => r.status === 'approved' || r.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0);
    const pendingFen = rows.filter((r) => r.status === 'pending' || r.status === 'stub').reduce((s, r) => s + (r.amount || 0), 0);

    // 附带匹配标题便于人读
    const matchIds = Array.from(new Set(rows.map((r) => r.matchId).filter(Boolean)));
    const matches = matchIds.length
      ? await this.prisma.matchResult.findMany({
          where: { id: { in: matchIds } },
          include: { demand: true },
        })
      : [];
    const titleById = Object.fromEntries(matches.map((m) => [m.id, m.demand?.title || '对接单']));

    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      noteZh: '佣金对账为可读演示账本，不发起支付、不打款。成交(closed_won)会自动幂等入账；「已记账」仅财务演示标记。',
      currency: 'CNY',
      summary: {
        totalCount: rows.length,
        totalYuan: fenToYuan(totalFen),
        approvedYuan: fenToYuan(approvedFen),
        pendingYuan: fenToYuan(pendingFen),
        byStatus: Object.entries(byStatus).map(([status, v]) => ({
          status,
          statusZh: STATUS_ZH[status] || status,
          count: v.count,
          amountYuan: fenToYuan(v.amountFen),
          dealYuan: fenToYuan(v.dealFen),
        })),
      },
      items: rows.map((r) => {
        const meta = (r.meta as any) || {};
        let originZh = '人工/其他';
        if (meta.trigger === 'closed_won' || String(meta.source || '').includes('closed_won')) {
          originZh = '成交自动入账';
        } else if (String(meta.source || '').includes('demo')) {
          originZh = '演示种子';
        } else if (meta.auto) {
          originZh = '系统自动';
        }
        return {
          id: r.id,
          matchId: r.matchId,
          matchTitleZh: titleById[r.matchId] || '对接单',
          brokerId: r.brokerId,
          status: r.status,
          statusZh: STATUS_ZH[r.status] || r.status,
          originZh,
          reconciledAt: meta.reconciledAt || meta.lastReconcileAt || null,
          ratePct: Math.round((r.rate || 0) * 1000) / 10,
          dealYuan: fenToYuan(r.dealAmount),
          amountYuan: fenToYuan(r.amount),
          currency: r.currency || 'CNY',
          note: r.note,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
    };
  }


  private commissionExportRoot() {
    const root = join(process.cwd(), 'exports', 'commissions');
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  private csvEscape(v: any) {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** M38：佣金账 CSV（带 BOM，Excel 可直接打开） */
  async exportLedgerCsv(opts: { brokerId?: string; tenantId?: string; status?: string; from?: string; to?: string } = {}) {
    const ledger = await this.ledger(opts);
    const headers = [
      'id',
      'matchId',
      'matchTitleZh',
      'status',
      'statusZh',
      'originZh',
      'ratePct',
      'dealYuan',
      'amountYuan',
      'currency',
      'note',
      'reconciledAt',
      'createdAt',
      'updatedAt',
    ];
    const lines = [headers.join(',')];
    for (const it of ledger.items || []) {
      lines.push(
        headers
          .map((h) => this.csvEscape((it as any)[h]))
          .join(','),
      );
    }
    const csv = '\ufeff' + lines.join('\n') + '\n';
    const root = this.commissionExportRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `broker-ledger-${(opts.brokerId || 'all').slice(0, 12)}-${stamp}.csv`;
    const filePath = join(root, fileName);
    writeFileSync(filePath, csv, 'utf8');
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      format: 'csv',
      fileName,
      filePath,
      bytes: Buffer.byteLength(csv, 'utf8'),
      csv,
      summary: ledger.summary,
      bannerZh: '佣金账导出 · 可按状态/日期筛选 · 演示不打款',
      noteZh: 'UTF-8 BOM CSV；金额单位为元。支持 status/from/to 筛选。永不发起支付。',
      filter: { status: opts.status || null, from: opts.from || null, to: opts.to || null },
      neverCharges: true,
    };
  }

  /** M38：佣金账 Excel 友好表（CSV 内容，.xls 扩展名 + Excel MIME，免第三方库） */
  async exportLedgerExcel(opts: { brokerId?: string; tenantId?: string; status?: string; from?: string; to?: string } = {}) {
    const csvOut = await this.exportLedgerCsv(opts);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `broker-ledger-${(opts.brokerId || 'all').slice(0, 12)}-${stamp}.xls`;
    const filePath = join(this.commissionExportRoot(), fileName);
    // HTML table that Excel opens reliably
    const ledger = await this.ledger(opts);
    const rows = (ledger.items || [])
      .map(
        (it) => `<tr>
<td>${it.id}</td><td>${it.matchTitleZh || ''}</td><td>${it.statusZh || it.status}</td>
<td>${it.originZh || ''}</td><td>${it.ratePct}</td><td>${it.dealYuan}</td><td>${it.amountYuan}</td>
<td>${it.currency || 'CNY'}</td><td>${(it.note || '').replace(/</g, '')}</td>
<td>${it.createdAt || ''}</td></tr>`,
      )
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<title>研企通佣金账</title></head><body>
<p><b>演示不打款</b> · 研企通经纪人佣金账导出 · Asia/Shanghai</p>
<table border="1" cellspacing="0" cellpadding="4">
<tr><th>ID</th><th>对接</th><th>状态</th><th>来源</th><th>比例%</th><th>成交额(元)</th><th>佣金(元)</th><th>币种</th><th>备注</th><th>创建时间</th></tr>
${rows}
</table>
<p>合计条目 ${ledger.summary?.totalCount || 0} · 合计佣金 ${ledger.summary?.totalYuan ?? 0} 元</p>
</body></html>`;
    writeFileSync(filePath, '\ufeff' + html, 'utf8');
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      format: 'excel-html',
      fileName,
      filePath,
      bytes: statSync(filePath).size,
      html,
      summary: ledger.summary,
      bannerZh: '佣金账 Excel 导出 · 演示不打款',
      noteZh: 'HTML 表格格式，可用 Excel / WPS 打开。永不打款。',
      neverCharges: true,
      csvFileName: csvOut.fileName,
    };
  }

  /** M38：佣金账 PDF 汇总页 */
  async exportLedgerPdf(opts: { brokerId?: string; tenantId?: string; status?: string; from?: string; to?: string } = {}) {
    const ledger = await this.ledger(opts);
    const root = this.commissionExportRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeBroker = String(opts.brokerId || 'all').replace(/[^\w.-]+/g, '_').slice(0, 16);
    const htmlPath = join(root, `broker-ledger-${safeBroker}-${stamp}.html`);
    const pdfPath = join(root, `broker-ledger-${safeBroker}-${stamp}.pdf`);
    const s = ledger.summary || ({} as any);
    const rows = (ledger.items || [])
      .map(
        (it) => `<tr>
<td>${String(it.matchTitleZh || '').replace(/</g, '')}</td>
<td>${it.statusZh || it.status}</td>
<td>${it.originZh || ''}</td>
<td style="text-align:right">${it.dealYuan}</td>
<td style="text-align:right">${it.ratePct}%</td>
<td style="text-align:right"><b>${it.amountYuan}</b></td>
<td>${String(it.createdAt || '').slice(0, 16).replace('T', ' ')}</td>
</tr>`,
      )
      .join('');
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
<title>研企通佣金账</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: "Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif; font-size: 12.5px; color:#0f172a; }
.banner { background:#fffbeb; border:1px solid #f59e0b; color:#92400e; padding:8px 10px; border-radius:8px; font-weight:700; margin-bottom:12px; }
h1 { font-size:18px; margin:0 0 8px; }
table { width:100%; border-collapse:collapse; margin-top:10px; }
th,td { border:1px solid #e2e8f0; padding:6px 8px; text-align:left; }
th { background:#f8fafc; }
.kpi { display:flex; gap:12px; margin:8px 0 4px; }
.kpi div { background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:8px 10px; }
.foot { margin-top:14px; color:#64748b; font-size:11px; border-top:1px dashed #cbd5e1; padding-top:8px; }
</style></head><body>
<div class="banner">演示不打款 · 佣金账导出仅供对账阅读 · 不会发起支付或出金</div>
<h1>经纪人佣金账</h1>
<p>导出时间：${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}（Asia/Shanghai）</p>
<div class="kpi">
  <div>条目<br/><b>${s.totalCount || 0}</b></div>
  <div>合计(元)<br/><b>${s.totalYuan ?? 0}</b></div>
  <div>已核准(元)<br/><b>${s.approvedYuan ?? 0}</b></div>
  <div>待核(元)<br/><b>${s.pendingYuan ?? 0}</b></div>
</div>
<table>
<thead><tr><th>对接</th><th>状态</th><th>来源</th><th>成交额</th><th>比例</th><th>佣金</th><th>入账时间</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">暂无记录</td></tr>'}</tbody>
</table>
<div class="foot">研企通 M38 · 支付维仍为演示骨架（无真 PSP）。本文件不可作为打款凭证。</div>
</body></html>`;
    writeFileSync(htmlPath, html, 'utf8');
    const chrome =
      process.env.CHROME_PATH ||
      (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : 'google-chrome');
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
          'file://' + htmlPath,
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
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      format: 'pdf',
      fileName: `broker-ledger-${safeBroker}-${stamp}.pdf`,
      filePath: pdfPath,
      htmlPath,
      bytes: statSync(pdfPath).size,
      summary: ledger.summary,
      bannerZh: '佣金账 PDF · 演示不打款',
      noteZh: '中文汇总 PDF；永不打款。',
      neverCharges: true,
    };
  }

  /** 若该经纪人尚无分成记录，用其已分派匹配生成 2～3 条演示账 */
  async ensureDemoLedger(brokerId?: string) {
    if (!brokerId) return { seeded: 0 };
    const existing = await this.prisma.brokerCommission.count({ where: { brokerId } });
    if (existing > 0) return { seeded: 0 };
    const matches = await this.prisma.matchResult.findMany({
      where: { brokerId },
      orderBy: { totalScore: 'desc' },
      take: 3,
    });
    if (!matches.length) return { seeded: 0 };
    const demos = [
      { dealAmount: 5000000, rate: 0.08, status: 'approved', note: '示范：已核准待记账（非真支付）' },
      { dealAmount: 3200000, rate: 0.1, status: 'pending', note: '示范：待财务复核' },
      { dealAmount: 1500000, rate: 0.1, status: 'stub', note: '示范：金额待经纪人与运营确认' },
    ];
    let n = 0;
    for (let i = 0; i < matches.length && i < demos.length; i++) {
      const d = demos[i];
      const amount = Math.round(d.dealAmount * d.rate);
      await this.prisma.brokerCommission.create({
        data: {
          matchId: matches[i].id,
          brokerId,
          tenantId: matches[i].tenantId || 'default',
          status: d.status,
          dealAmount: d.dealAmount,
          rate: d.rate,
          amount,
          note: d.note,
          meta: { source: 'm30-demo-ledger', neverCharges: true },
        },
      });
      n++;
    }
    if (n) {
      await this.audit.log({
        action: 'commission.demo_seed',
        actor: 'system-m30',
        targetType: 'BrokerCommission',
        targetId: brokerId,
        meta: { seeded: n },
      });
    }
    return { seeded: n };
  }
}
