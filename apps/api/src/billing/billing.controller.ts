import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, createReadStream } from 'fs';
import { join } from 'path';
import { buildReceiptHtml, renderReceiptPdf } from './receipt-pdf';
import { buildReceiptArchiveZip } from './receipt-archive';

/** 支付桩：checkout session + webhook + 对账/发票；默认免费档，不真收款 */
@Controller('billing')
export class BillingController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  private invoiceRoot() {
    const root = join(process.cwd(), 'exports', 'invoices');
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  @Post('checkout')
  async checkout(
    @Body() body: { planCode?: string; tenantId?: string },
    @Req() req: any,
  ) {
    const planCode = body.planCode || 'org_pro';
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new BadRequestException('套餐不存在');
    const uid = req.user?.uid;
    if (!uid) throw new BadRequestException('请先登录');
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BadRequestException('用户不存在');

    if (plan.priceMonthly === 0 && planCode === 'free') {
      await this.prisma.user.update({ where: { id: uid }, data: { planCode: 'free' } });
      await this.prisma.subscription.create({
        data: {
          userId: uid,
          planId: plan.id,
          status: 'active',
          billing: 'free',
          meta: { note: '切回免费档' },
        },
      });
      return {
        ok: true,
        mode: 'free',
        message: '已切回免费档（无需支付）',
        plan,
      };
    }

    const stubToken = randomBytes(16).toString('hex');
    const session = await this.prisma.checkoutSession.create({
      data: {
        userId: uid,
        tenantId: body.tenantId || user.tenantId || 'default',
        planCode,
        status: 'pending',
        amount: plan.priceMonthly || 0,
        currency: 'CNY',
        stubToken,
        meta: { stub: true, note: '演示收银台，未发生真实支付' },
      },
    });

    const base = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3100';
    await this.audit.log({
      action: 'billing.checkout.create',
      actor: user.email,
      targetType: 'CheckoutSession',
      targetId: session.id,
      meta: { planCode, amount: session.amount },
    });

    return {
      ok: true,
      mode: 'stub_checkout',
      message: '已创建演示结账会话。调用 webhook 或 simulate-pay 完成升级（不真扣款）。',
      session: {
        id: session.id,
        planCode,
        amount: session.amount,
        currency: session.currency,
        status: session.status,
        checkoutUrl: `${base}/portal.html#pricing?checkout=${session.id}&token=${stubToken}`,
        stubToken,
      },
      plan,
    };
  }

  @Get('checkout/:id')
  async getSession(@Param('id') id: string, @Req() req: any) {
    const s = await this.prisma.checkoutSession.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('结账会话不存在');
    const role = req?.user?.role;
    const uid = req?.user?.uid;
    const hasKey = Boolean(req?.authMeta?.hasKey);
    const isOps = hasKey || role === 'ADMIN' || role === 'OPERATOR';
    const isOwner = uid && uid === s.userId;
    const tokenQ = String(req?.query?.token || req?.query?.stubToken || '');
    const tokenOk = tokenQ && tokenQ === s.stubToken;
    if (!isOps && !isOwner && !tokenOk) {
      // 未授权：只返回公开状态，绝不回 stubToken
      return {
        id: s.id,
        status: s.status,
        planCode: s.planCode,
        amount: s.amount,
        currency: s.currency,
        paidAt: s.paidAt,
        createdAt: s.createdAt,
        stubToken: undefined,
        redacted: true,
        messageZh: '请登录本人账号或携带结账令牌查看完整会话',
      };
    }
    return s;
  }

  @Post('checkout/:id/simulate-pay')
  async simulatePay(@Param('id') id: string, @Body() body: { stubToken?: string }, @Req() req: any) {
    const s = await this.prisma.checkoutSession.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('结账会话不存在');
    if (s.status === 'paid') {
      const { stubToken: _t, ...safe } = s as any;
      return { ok: true, message: '已支付过', session: { ...safe, stubToken: undefined }, idempotent: true };
    }
    const role = req?.user?.role;
    const uid = req?.user?.uid;
    const hasKey = Boolean(req?.authMeta?.hasKey);
    const isOps = hasKey || role === 'ADMIN' || role === 'OPERATOR';
    const isOwner = uid && uid === s.userId;
    const tokenOk = body?.stubToken && body.stubToken === s.stubToken;
    if (!isOps && !isOwner && !tokenOk) {
      throw new ForbiddenException('无权完成此结账：请登录本人账号或提供正确 stubToken');
    }
    if (body?.stubToken && body.stubToken !== s.stubToken) {
      throw new BadRequestException('stubToken 不匹配');
    }
    return this.markPaid(s);
  }

  @Post('webhook')
  async webhook(
    @Body()
    body: {
      sessionId?: string;
      stubToken?: string;
      event?: string;
      secret?: string;
    },
  ) {
    const secret = process.env.BILLING_WEBHOOK_SECRET;
    if (secret && body.secret !== secret) {
      throw new BadRequestException('webhook secret 无效');
    }
    if (!body.sessionId) throw new BadRequestException('缺少 sessionId');
    const s = await this.prisma.checkoutSession.findUnique({ where: { id: body.sessionId } });
    if (!s) throw new BadRequestException('结账会话不存在');
    if (body.stubToken && body.stubToken !== s.stubToken) {
      throw new BadRequestException('stubToken 不匹配');
    }
    if (body.event && body.event !== 'checkout.paid' && body.event !== 'payment.succeeded') {
      return { ok: true, ignored: true, event: body.event };
    }
    return this.markPaid(s);
  }

  /** 对账报告：汇总 CheckoutSession 桩 */
  @Get('reconcile')
  async reconcile(@Query('tenantId') tenantId?: string, @Req() req?: any) {
    const role = req?.user?.role;
    const hasKey = Boolean(req?.authMeta?.hasKey);
    if (!hasKey && role !== 'ADMIN' && role !== 'OPERATOR' && role !== 'OPS_VIEWER') {
      throw new ForbiddenException('仅运营可查看全局对账报告');
    }
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    const sessions = await this.prisma.checkoutSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const byStatus: Record<string, { count: number; amount: number }> = {};
    for (const s of sessions) {
      if (!byStatus[s.status]) byStatus[s.status] = { count: 0, amount: 0 };
      byStatus[s.status].count += 1;
      byStatus[s.status].amount += s.amount || 0;
    }
    const paid = sessions.filter((s) => s.status === 'paid');
    const pending = sessions.filter((s) => s.status === 'pending');
    const invoices = await this.prisma.invoice.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      mode: 'stub',
      note: '演示不扣款：金额来自 CheckoutSession 试点骨架，未对接微信/支付宝/对公流水。',
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '演示不扣款 · 对账报告',
      chargesRealMoney: false,
      paymentMaturityApprox: 0.45,
      summary: {
        sessions: sessions.length,
        paidCount: paid.length,
        pendingCount: pending.length,
        paidAmountFen: paid.reduce((a, s) => a + (s.amount || 0), 0),
        pendingAmountFen: pending.reduce((a, s) => a + (s.amount || 0), 0),
        invoiceCount: invoices.length,
      },
      byStatus,
      recentPaid: paid.slice(0, 20).map((s) => ({
        id: s.id,
        planCode: s.planCode,
        amount: s.amount,
        paidAt: s.paidAt,
        tenantId: s.tenantId,
        userId: s.userId,
      })),
      invoices: invoices.slice(0, 20).map((i) => ({
        id: i.id,
        number: i.number,
        amount: i.amount,
        planCode: i.planCode,
        status: i.status,
        issuedAt: i.issuedAt,
      })),
    };
    await this.audit.log({
      action: 'billing.reconcile',
      actor: 'ops',
      targetType: 'CheckoutSession',
      meta: { tenantId: tenantId || null, paid: paid.length },
    });
    return report;
  }

  @Get('invoices')
  listInvoices(@Query('tenantId') tenantId?: string) {
    return this.prisma.invoice.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new BadRequestException('发票不存在');
    return inv;
  }

  @Get('invoices/:id/export.md')
  async exportMd(@Param('id') id: string, @Res({ passthrough: true }) res: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new BadRequestException('发票不存在');
    const path = join(this.invoiceRoot(), `${inv.number}.md`);
    writeFileSync(path, inv.bodyMd, 'utf8');
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${inv.number}.md"`,
    });
    return new StreamableFile(createReadStream(path));
  }

  /** 简易「PDF」：实为带页眉的纯文本，演示用；真 PDF 可后接 puppeteer */
  @Get('invoices/:id/export.pdf.txt')
  async exportPdfTxt(@Param('id') id: string, @Res({ passthrough: true }) res: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new BadRequestException('发票不存在');
    const text = [
      '======== 研企通电子发票（演示桩）========',
      `发票号：${inv.number}`,
      `状态：${inv.status}`,
      `套餐：${inv.planCode}`,
      `金额：${(inv.amount / 100).toFixed(2)} ${inv.currency}`,
      `开具：${inv.issuedAt.toISOString()}`,
      '----------------------------------------',
      inv.bodyMd.replace(/[#>*`]/g, ''),
      '----------------------------------------',
      '本文件为演示导出，非税务局电子发票。真支付/真发票未接。',
      '',
    ].join('\n');
    const path = join(this.invoiceRoot(), `${inv.number}.pdf.txt`);
    writeFileSync(path, text, 'utf8');
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${inv.number}.pdf.txt"`,
    });
    return new StreamableFile(createReadStream(path));
  }

  /** 手动为已支付会话补开发票 */
  @Post('checkout/:id/invoice')
  async issueInvoice(@Param('id') id: string, @Req() req: any) {
    const s = await this.prisma.checkoutSession.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('结账会话不存在');
    if (s.status !== 'paid') throw new BadRequestException('仅已支付会话可开票');
    const existing = await this.prisma.invoice.findFirst({ where: { checkoutSessionId: s.id } });
    if (existing) return { ok: true, invoice: existing, message: '已开过票' };
    const inv = await this.createInvoiceForSession(s);
    await this.audit.log({
      action: 'billing.invoice.issue',
      actor: req?.user?.email || 'ops',
      targetType: 'Invoice',
      targetId: inv.id,
      meta: { checkoutSessionId: s.id },
    });
    return { ok: true, invoice: inv };
  }


  private statusZh(st: string) {
    return (
      {
        pending: '待支付（演示）',
        paid: '已模拟支付',
        cancelled: '已取消',
        expired: '已过期',
        issued: '已开票（演示）',
        paid_stub: '演示已付',
        void: '作废',
      } as Record<string, string>
    )[st] || st;
  }

  private yuan(fen: number) {
    return ((fen || 0) / 100).toFixed(2);
  }

  /** 支付试点骨架总览：大白话标明「演示不扣款」 */
  @Get('pilot')
  async pilot() {
    const [sessions, invoices, plans] = await Promise.all([
      this.prisma.checkoutSession.count(),
      this.prisma.invoice.count(),
      this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceMonthly: 'asc' } }),
    ]);
    const paid = await this.prisma.checkoutSession.count({ where: { status: 'paid' } });
    const pending = await this.prisma.checkoutSession.count({ where: { status: 'pending' } });
    return {
      ok: true,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      mode: 'pilot_skeleton',
      livePsp: false,
      chargesRealMoney: false,
      paymentMaturityApprox: 0.45,
      bannerZh: '演示不扣款：本页账单 / 中文回执 PDF / 对账全部是试点骨架，不会连接微信、支付宝或银行卡，也不会产生真实扣款。',
      trustZh: [
        '不会请求卡号或支付密码',
        '模拟支付只改本地套餐状态',
        '发票为演示回执，不可报销入账',
        '真收款待用户提供支付通道凭证后再接',
      ],
      summary: { sessions, invoices, paid, pending },
      plans: plans.map((p) => ({
        code: p.code,
        name: p.name,
        priceYuan: this.yuan(p.priceMonthly),
        priceMonthlyFen: p.priceMonthly,
        description: p.description,
      })),
      endpoints: {
        order: 'POST /api/billing/order',
        checkout: 'POST /api/billing/checkout',
        simulatePay: 'POST /api/billing/checkout/:id/simulate-pay',
        mine: 'GET /api/billing/mine',
        bills: 'GET /api/billing/bills',
        receipt: 'GET /api/billing/receipts/:invoiceId',
        receiptPdf: 'GET /api/billing/receipts/:invoiceId/pdf',
        receiptHtml: 'GET /api/billing/receipts/:invoiceId/html',
        reminders: 'GET /api/billing/reminders',
        remindNotifyDraft: 'POST /api/billing/reminders/notify-draft',
        receiptArchive: 'POST /api/billing/receipts/archive',
        receiptArchiveFile: 'GET /api/billing/receipts/archive/file?name=',
        reconcile: 'GET /api/billing/reconcile',
      },
      noteZh: '企业办事窗与运营台可看账单、回执 PDF 与 ZIP 归档；综合成熟度里支付维诚实约 45%（无真 PSP）。',
    };
  }

  /** 创建试点订单（= checkout 别名，文案更像账单） */
  @Post('order')
  async order(
    @Body() body: { planCode?: string; tenantId?: string },
    @Req() req: any,
  ) {
    const r: any = await this.checkout(body || {}, req);
    return {
      ...r,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '演示不扣款：订单已生成，点「模拟支付」只会改状态，不会真扣钱。',
      bill: r.session
        ? {
            id: r.session.id,
            planCode: r.session.planCode,
            amountYuan: this.yuan(r.session.amount),
            currency: r.session.currency,
            status: r.session.status,
            statusZh: this.statusZh(r.session.status),
          }
        : null,
    };
  }

  /** 我的账单 / 回执（企业端） */
  @Get('mine')
  async mine(@Req() req: any) {
    const uid = req.user?.uid;
    if (!uid) throw new BadRequestException('请先登录');
    const sessions = await this.prisma.checkoutSession.findMany({
      where: { userId: uid },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { userId: uid },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      ok: true,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '演示不扣款：下列账单与回执仅用于试点对账与界面验收。',
      chargesRealMoney: false,
      bills: sessions.map((s) => ({
        id: s.id,
        planCode: s.planCode,
        amountYuan: this.yuan(s.amount),
        amountFen: s.amount,
        currency: s.currency,
        status: s.status,
        statusZh: this.statusZh(s.status),
        createdAt: s.createdAt,
        paidAt: s.paidAt,
        canSimulatePay: s.status === 'pending',
        stubToken: s.stubToken,
      })),
      receipts: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        planCode: i.planCode,
        amountYuan: this.yuan(i.amount),
        status: i.status,
        statusZh: this.statusZh(i.status),
        title: i.title,
        issuedAt: i.issuedAt,
        receiptPath: `/api/billing/receipts/${i.id}`,
        exportMd: `/api/billing/invoices/${i.id}/export.md`,
        exportPdf: `/api/billing/receipts/${i.id}/pdf`,
        exportHtml: `/api/billing/receipts/${i.id}/html`,
      })),
      noteZh: sessions.length || invoices.length ? '可点模拟支付或查看回执。' : '还没有账单。可在套餐页点升级生成演示订单。',
    };
  }

  /** 运营：账单列表（可读状态） */
  @Get('bills')
  async bills(@Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (status) where.status = status;
    const rows = await this.prisma.checkoutSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      ok: true,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '演示不扣款 · 运营对账台',
      chargesRealMoney: false,
      items: rows.map((s) => ({
        id: s.id,
        userId: s.userId,
        tenantId: s.tenantId,
        planCode: s.planCode,
        amountYuan: this.yuan(s.amount),
        amountFen: s.amount,
        currency: s.currency,
        status: s.status,
        statusZh: this.statusZh(s.status),
        createdAt: s.createdAt,
        paidAt: s.paidAt,
        canSimulatePay: s.status === 'pending',
        stubToken: s.stubToken,
      })),
      count: rows.length,
    };
  }

  /** 可读回执（发票） */
  @Get('receipts/:id')
  async receipt(@Param('id') id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new BadRequestException('回执不存在');
    return {
      ok: true,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '演示回执 · 不可报销入账 · 未发生真实收款',
      chargesRealMoney: false,
      receipt: {
        id: inv.id,
        number: inv.number,
        title: inv.title,
        planCode: inv.planCode,
        amountYuan: this.yuan(inv.amount),
        currency: inv.currency,
        status: inv.status,
        statusZh: this.statusZh(inv.status),
        issuedAt: inv.issuedAt,
        bodyMd: inv.bodyMd,
        checkoutSessionId: inv.checkoutSessionId,
        tenantId: inv.tenantId,
        userId: inv.userId,
      },
      exports: {
        md: `/api/billing/invoices/${inv.id}/export.md`,
        pdfTxt: `/api/billing/invoices/${inv.id}/export.pdf.txt`,
        html: `/api/billing/receipts/${inv.id}/html`,
        pdf: `/api/billing/receipts/${inv.id}/pdf`,
      },
    };
  }


  private receiptInput(inv: {
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
  }) {
    return {
      id: inv.id,
      number: inv.number,
      title: inv.title || '研企通套餐',
      planCode: inv.planCode,
      amountFen: inv.amount,
      currency: inv.currency,
      status: inv.status,
      statusZh: this.statusZh(inv.status),
      issuedAt: inv.issuedAt,
      bodyMd: inv.bodyMd || '',
      tenantId: inv.tenantId || null,
      userId: inv.userId || null,
      checkoutSessionId: inv.checkoutSessionId || null,
    };
  }

  /** 中文回执 HTML 预览 */
  @Get('receipts/:id/html')
  async receiptHtml(@Param('id') id: string, @Res({ passthrough: true }) res: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new BadRequestException('回执不存在');
    const html = buildReceiptHtml(this.receiptInput(inv));
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    return html;
  }

  /** 真排版中文回执 PDF（Chrome print-to-pdf） */
  @Get('receipts/:id/pdf')
  async receiptPdf(@Param('id') id: string, @Res({ passthrough: true }) res: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new BadRequestException('回执不存在');
    try {
      const out = await renderReceiptPdf(this.receiptInput(inv));
      await this.audit.log({
        action: 'billing.receipt.pdf',
        actor: 'user',
        targetType: 'Invoice',
        targetId: inv.id,
        meta: { bytes: out.bytes, number: inv.number },
      });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${inv.number}.pdf"`,
      });
      return new StreamableFile(createReadStream(out.pdfPath));
    } catch (e: any) {
      throw new BadRequestException('回执 PDF 生成失败：' + (e?.message || String(e)).slice(0, 200));
    }
  }

  /** 别名：发票导出正式 PDF */
  @Get('invoices/:id/export.pdf')
  async invoiceExportPdf(@Param('id') id: string, @Res({ passthrough: true }) res: any) {
    return this.receiptPdf(id, res);
  }


  private remindSla(createdAt: Date) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageHours = Math.max(0, Math.round((ageMs / 3600000) * 10) / 10);
    let urgency: 'ok' | 'soon' | 'overdue' = 'ok';
    let urgencyZh = '正常';
    let slaZh = '演示账单 · 可随时模拟支付（不扣款）';
    // 试点 SLA：超 24h 提醒升级，超 72h 标逾期（仍不真催缴）
    if (ageHours >= 72) {
      urgency = 'overdue';
      urgencyZh = '逾期关注';
      slaZh = `已挂账约 ${ageHours} 小时（≥72h）。演示不扣款，建议尽快模拟支付或忽略。`;
    } else if (ageHours >= 24) {
      urgency = 'soon';
      urgencyZh = '临近关注';
      slaZh = `已挂账约 ${ageHours} 小时（≥24h）。仍是演示账单，可写入提醒草稿。`;
    } else {
      slaZh = `已挂账约 ${ageHours} 小时。演示不扣款。`;
    }
    return { ageHours, urgency, urgencyZh, slaZh };
  }

  /** 企业未付演示账单提醒（大白话） */
  @Get('reminders')
  async reminders(@Req() req: any) {
    const uid = req.user?.uid;
    const hasKey = Boolean(req.authMeta?.hasKey);
    if (!uid && !hasKey) throw new BadRequestException('请先登录');
    const pending = await this.prisma.checkoutSession.findMany({
      where: uid ? { userId: uid, status: 'pending' } : { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: uid ? 20 : 50,
    });
    const items = pending.map((s) => {
      const sla = this.remindSla(s.createdAt);
      return {
        billId: s.id,
        planCode: s.planCode,
        amountYuan: this.yuan(s.amount),
        amountFen: s.amount,
        status: s.status,
        statusZh: this.statusZh(s.status),
        createdAt: s.createdAt,
        stubToken: s.stubToken,
        titleZh: `有一笔演示账单待处理：¥${this.yuan(s.amount)}（${s.planCode}）`,
        bodyZh:
          '这是试点骨架里的待付账单，点「模拟支付」只会改状态，不会真扣钱。也可以先忽略，不影响发需求与匹配。',
        href: '/work-enterprise.html#bills',
        canSimulatePay: true,
        ...sla,
      };
    });
    const overdueCount = items.filter((i) => i.urgency === 'overdue').length;
    const soonCount = items.filter((i) => i.urgency === 'soon').length;
    return {
      ok: true,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '演示不扣款：下列提醒带 SLA 紧急度（正常 / 临近 / 逾期关注），不是税务催缴。',
      chargesRealMoney: false,
      unpaidCount: items.length,
      overdueCount,
      soonCount,
      slaPolicyZh: '挂账≥24h 标「临近关注」；≥72h 标「逾期关注」。仅影响演示提醒优先级。',
      items,
      scope: uid ? 'mine' : 'ops_all_pending',
      noteZh: items.length
        ? uid
          ? `你有 ${items.length} 笔演示待付（临近 ${soonCount} / 逾期关注 ${overdueCount}）。可在办事窗处理或写提醒草稿。`
          : `运营视角：共 ${items.length} 笔演示待付（临近 ${soonCount} / 逾期关注 ${overdueCount}）。`
        : uid
          ? '目前没有待付演示账单。'
          : '全站暂无待付演示账单。',
      notifyDraft: 'POST /api/billing/reminders/notify-draft',
      archiveZip: 'POST /api/billing/receipts/archive',
    };
  }

  /** 把未付提醒写成站内信 + 邮件草稿桩（不真发） */
  @Post('reminders/notify-draft')
  async remindersNotifyDraft(
    @Body() body: { billId?: string },
    @Req() req: any,
  ) {
    const uid = req.user?.uid;
    if (!uid) throw new BadRequestException('请先登录');
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BadRequestException('用户不存在');
    const where: any = { userId: uid, status: 'pending' };
    if (body?.billId) where.id = body.billId;
    const bills = await this.prisma.checkoutSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: body?.billId ? 1 : 5,
    });
    if (!bills.length) {
      return {
        ok: true,
        created: 0,
        message: '没有待付演示账单，无需提醒。',
        wave: 'M36-broker-hall-tpl-edit-ops-cards',
      };
    }
    const lines = bills
      .map((b) => `· ¥${this.yuan(b.amount)} · ${b.planCode} · 账单 ${b.id.slice(0, 10)}…`)
      .join('\n');
    const title = bills.length === 1 ? '演示账单待处理（不扣款）' : `你有 ${bills.length} 笔演示账单待处理`;
    const bodyText = [
      '大白话提醒：下列是试点骨架里的待付账单，不是税务催缴。',
      '点模拟支付只会改状态，不会连微信/支付宝，也不会扣真钱。',
      '',
      lines,
      '',
      '去办事窗「账单回执」处理：/work-enterprise.html#bills',
    ].join('\n');
    const channel = await this.notifications.notifyChannels({
      userId: uid,
      email: user.email || undefined,
      title,
      body: bodyText,
      link: '/work-enterprise.html#bills',
      channels: ['in_app', 'email'],
    });
    await this.audit.log({
      action: 'billing.reminders.notify_draft',
      actor: user.email || uid,
      targetType: 'CheckoutSession',
      meta: { billIds: bills.map((b) => b.id), count: bills.length },
    });
    return {
      ok: true,
      created: bills.length,
      wave: 'M36-broker-hall-tpl-edit-ops-cards',
      bannerZh: '已写入站内提醒，并生成邮件草稿桩（默认不真发）。',
      chargesRealMoney: false,
      channel,
      noteZh: '邮件通道走 notify 桩 / JobLog；仅当 SMTP_MODE=live 且人工确认时才会真发，本接口本身不触发真发。',
    };
  }


  /** 已付回执 ZIP 归档（PDF + meta + HTML）；企业本人 / 运营可下 */
  @Post('receipts/archive')
  async archiveReceipts(
    @Body() body: { ids?: string[]; tenantId?: string },
    @Req() req: any,
  ) {
    const uid = req.user?.uid;
    const hasKey = Boolean(req.authMeta?.hasKey);
    const role = req.user?.role;
    const isOps = hasKey || role === 'ADMIN' || role === 'OPERATOR';
    if (!uid && !isOps) throw new BadRequestException('请先登录');

    const where: any = {
      status: { in: ['paid_stub', 'issued', 'paid'] },
    };
    if (body?.ids?.length) {
      where.id = { in: body.ids };
    }
    if (isOps) {
      if (body?.tenantId) where.tenantId = body.tenantId;
    } else {
      // 企业端：本人回执；若带 tenantId 且与用户租户一致也可按租户（tenant_admin 场景）
      const user = await this.prisma.user.findUnique({ where: { id: uid } });
      if (body?.tenantId && user?.tenantId && body.tenantId === user.tenantId) {
        where.tenantId = body.tenantId;
      } else {
        where.userId = uid;
      }
    }
    const invoices = await this.prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 50,
    });
    if (!invoices.length) {
      throw new BadRequestException('没有可归档的已付演示回执（请先模拟支付生成回执）');
    }
    const actor = req.user?.email || (hasKey ? 'ops-key' : uid || 'ops');
    const scope = isOps ? (body?.tenantId ? `tenant-${body.tenantId}` : 'ops-all') : `user-${uid}`;
    try {
      const out = await buildReceiptArchiveZip(invoices, {
        actor,
        scope,
        tenantId: body?.tenantId || invoices[0]?.tenantId || null,
      });
      await this.audit.log({
        action: 'billing.receipts.archive',
        actor,
        targetType: 'Invoice',
        meta: { count: out.count, fileName: out.fileName, scope },
      });
      return {
        ok: true,
        wave: 'M36-broker-hall-tpl-edit-ops-cards',
        bannerZh: '演示回执 ZIP 已生成：含 PDF、HTML 与 meta，不可报销。',
        chargesRealMoney: false,
        fileName: out.fileName,
        bytes: out.bytes,
        count: out.count,
        entries: out.entries,
        downloadPath: `/api/billing/receipts/archive/file?name=${encodeURIComponent(out.fileName)}`,
        noteZh: '点 downloadPath 下载 ZIP。最多打包 50 份。',
      };
    } catch (e: any) {
      throw new BadRequestException('回执归档失败：' + (e?.message || String(e)).slice(0, 200));
    }
  }

  /** 下载已生成的回执 ZIP（文件名须落在 exports/receipt-archives） */
  @Get('receipts/archive/file')
  async archiveFile(@Query('name') name: string, @Res({ passthrough: true }) res: any) {
    if (!name || name.includes('..') || name.includes('/') || !name.endsWith('.zip')) {
      throw new BadRequestException('非法归档文件名');
    }
    const root = join(process.cwd(), 'exports', 'receipt-archives');
    const filePath = join(root, name);
    if (!existsSync(filePath)) throw new BadRequestException('归档文件不存在，请先 POST /api/billing/receipts/archive');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    return new StreamableFile(createReadStream(filePath));
  }

  private async createInvoiceForSession(s: {
    id: string;
    userId: string;
    tenantId: string | null;
    planCode: string;
    amount: number;
    currency: string;
    paidAt: Date | null;
  }) {
    const plan = await this.prisma.plan.findUnique({ where: { code: s.planCode } });
    const number = `YQ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${randomBytes(3).toString('hex').toUpperCase()}`;
    const yuan = ((s.amount || 0) / 100).toFixed(2);
    const bodyMd = [
      `# 研企通发票（演示）`,
      '',
      `- 发票号：\`${number}\``,
      `- 套餐：${plan?.name || s.planCode}`,
      `- 金额：¥${yuan} ${s.currency}`,
      `- 结账会话：\`${s.id}\``,
      `- 支付时间：${(s.paidAt || new Date()).toISOString()}`,
      '',
      '## 说明',
      '本发票由支付桩自动生成，**未发生真实收款**，不可用于报销入账。',
      '真微信支付 / 对公转账对账上线后，将替换为正式电子发票链路。',
      '',
    ].join('\n');
    return this.prisma.invoice.create({
      data: {
        checkoutSessionId: s.id,
        tenantId: s.tenantId,
        userId: s.userId,
        number,
        planCode: s.planCode,
        amount: s.amount,
        currency: s.currency,
        status: 'paid_stub',
        title: `研企通 · ${plan?.name || s.planCode}`,
        bodyMd,
        meta: { stub: true },
      },
    });
  }

  private async markPaid(s: {
    id: string;
    userId: string;
    planCode: string;
    tenantId: string | null;
    stubToken: string;
    status: string;
    amount?: number;
    currency?: string;
  }) {
    const plan = await this.prisma.plan.findUnique({ where: { code: s.planCode } });
    if (!plan) throw new BadRequestException('套餐不存在');
    // 乐观并发：仅 pending → paid，防双击/并发重复入账
    const claimed = await this.prisma.checkoutSession.updateMany({
      where: { id: s.id, status: 'pending' },
      data: { status: 'paid', paidAt: new Date(), meta: { stub: true, paidVia: 'stub' } },
    });
    if (claimed.count === 0) {
      const cur = await this.prisma.checkoutSession.findUnique({ where: { id: s.id } });
      if (cur?.status === 'paid') {
        return {
          ok: true,
          mode: 'stub_paid',
          message: '已支付过（幂等回放，未真扣款）',
          session: cur,
          plan,
          idempotent: true,
        };
      }
      throw new BadRequestException(`结账会话状态为「${cur?.status || '未知'}」，无法支付`);
    }
    const session = await this.prisma.checkoutSession.findUniqueOrThrow({ where: { id: s.id } });
    await this.prisma.user.update({
      where: { id: s.userId },
      data: { planCode: s.planCode },
    });
    if (s.tenantId) {
      await this.prisma
        .tenant.update({
          where: { id: s.tenantId },
          data: { planCode: s.planCode },
        })
        .catch(() => null);
    }
    const existingSub = await this.prisma.subscription.findFirst({
      where: { userId: s.userId, meta: { path: ['checkoutSessionId'], equals: s.id } as any },
    }).catch(() => null);
    if (!existingSub) {
      await this.prisma.subscription.create({
        data: {
          userId: s.userId,
          planId: plan.id,
          status: 'active',
          billing: 'stub_paid',
          meta: { stub: true, checkoutSessionId: s.id, note: '演示支付成功，未真实扣款' },
        },
      });
    }
    const existingInv = await this.prisma.invoice.findFirst({ where: { checkoutSessionId: s.id } });
    const invoice = existingInv || (await this.createInvoiceForSession(session));
    await this.prisma.notification.create({
      data: {
        userId: s.userId,
        title: `已升级到「${plan.name}」（演示）`,
        body: `支付桩已确认：没有真扣款。发票号 ${invoice.number}。用户与租户套餐/配额已按新档生效。`,
        level: 'success',
        link: '/portal.html#workspace',
      },
    });
    await this.audit.log({
      action: 'billing.checkout.paid',
      actor: 'stub',
      targetType: 'CheckoutSession',
      targetId: s.id,
      meta: { planCode: s.planCode, userId: s.userId, tenantId: s.tenantId, invoiceId: invoice.id },
    });
    return {
      ok: true,
      mode: 'stub_paid',
      message: '支付成功（演示桩，未真实扣款）',
      session,
      plan,
      invoice,
    };
  }
}
