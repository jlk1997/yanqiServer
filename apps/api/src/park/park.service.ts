import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildParkDocRedHeaderHtml, renderParkDocPdf } from './park-doc-pdf';
import { AsyncMutex } from '../common/async-mutex';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

const { ZipArchive, Archiver } = require('archiver');
function createZipArchive(options?: any) {
  if (ZipArchive) return new ZipArchive(options || { zlib: { level: 9 } });
  return new Archiver('zip', options || { zlib: { level: 9 } });
}

export type WindowStatus = 'draft' | 'open' | 'closed' | 'archived';
export type ApprovalStatus = 'submitted' | 'under_review' | 'approved' | 'returned' | 'rejected' | 'published';
export type DocDirection = 'outbound' | 'inbound';
export type DocStatus = 'draft' | 'sent' | 'acked';

type Hist = { at: string; from: string | null; to: string; actor: string; noteZh?: string };

type CollectionWindow = {
  id: string;
  titleZh: string;
  region: string;
  status: WindowStatus;
  opensAt?: string;
  closesAt?: string;
  noteZh?: string;
  createdAt: string;
  updatedAt: string;
};

type ApprovalItem = {
  id: string;
  windowId: string;
  titleZh: string;
  orgAlias: string;
  demandId?: string | null;
  status: ApprovalStatus;
  summaryZh?: string;
  reviewerNote?: string;
  history: Hist[];
  /** 已发布到脱敏案例池的 CaseStudy id */
  caseId?: string | null;
  casePublishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type DeliveryAck = {
  id: string;
  at: string;
  actor: string;
  /** demo_channel | simulated_outbox | manual */
  channel: string;
  status: 'recorded' | 'simulated_sent' | 'simulated_acked';
  noteZh?: string;
  liveNetwork: false;
};

type ParkDoc = {
  id: string;
  direction: DocDirection;
  titleZh: string;
  bodyZh: string;
  counterpartyZh: string;
  status: DocStatus;
  history: Hist[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  /** 文号，如 研园〔2026〕12号 */
  docNo?: string | null;
  templateId?: string | null;
  templateNameZh?: string | null;
  /** 关联征集窗 */
  windowId?: string | null;
  windowTitleZh?: string | null;
  /** M39：投递回执骨架（不接真专网） */
  deliveryAcks?: DeliveryAck[];
};

type DocTemplate = {
  id: string;
  nameZh: string;
  direction: DocDirection;
  /** 文号规则：支持 {YYYY} {YY} {SEQ} {SEQ3} */
  docNoRule: string;
  titleHintZh?: string;
  bodyHintZh?: string;
  active?: boolean;
};

type DocsPack = {
  version: number;
  updatedAt?: string;
  items: ParkDoc[];
  templates: DocTemplate[];
  /** 按年递增序号，用于文号 */
  seqByYear: Record<string, number>;
};

type Pack = {
  version: number;
  updatedAt?: string;
  windows: CollectionWindow[];
  approvals: ApprovalItem[];
};

const WINDOW_TRANSITIONS: Record<WindowStatus, WindowStatus[]> = {
  draft: ['open', 'archived'],
  open: ['closed', 'archived'],
  closed: ['open', 'archived'],
  archived: [],
};

const APPROVAL_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  submitted: ['under_review', 'rejected'],
  under_review: ['approved', 'returned', 'rejected'],
  returned: ['submitted', 'under_review'],
  approved: ['published'],
  rejected: [],
  published: [],
};

const WINDOW_ZH: Record<WindowStatus, string> = {
  draft: '草稿',
  open: '征集中',
  closed: '已截止',
  archived: '已归档',
};

const APPROVAL_ZH: Record<ApprovalStatus, string> = {
  submitted: '已提交',
  under_review: '园区初审中',
  approved: '已通过',
  returned: '退回补件',
  rejected: '未通过',
  published: '已公示',
};

const DOC_TRANSITIONS: Record<DocStatus, DocStatus[]> = {
  draft: ['sent'],
  sent: ['acked'],
  acked: [],
};

const DOC_ZH: Record<DocStatus, string> = {
  draft: '草稿',
  sent: '已发出',
  acked: '已签收',
};

const DOC_DIR_ZH: Record<DocDirection, string> = {
  outbound: '发出（园区→对方）',
  inbound: '收文（对方→园区）',
};

function nid(prefix: string) {
  return `${prefix}-${randomBytes(5).toString('hex')}`;
}

@Injectable()
export class ParkService {
  private dataPath = join(process.cwd(), '.data', 'park-approvals.json');
  private fixturePath = join(process.cwd(), 'fixtures', 'park-approvals.json');
  private docsPath = join(process.cwd(), '.data', 'park-docs.json');
  private docsFixturePath = join(process.cwd(), 'fixtures', 'park-docs.json');
  /** 防 await 间隙丢写：园区板 / 公文板各一把锁 */
  private boardMutex = new AsyncMutex();
  private docsMutex = new AsyncMutex();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private readRaw(): Pack {
    const prefer = existsSync(this.dataPath) ? this.dataPath : this.fixturePath;
    try {
      const raw = JSON.parse(readFileSync(prefer, 'utf8'));
      if (!Array.isArray(raw.windows)) raw.windows = [];
      if (!Array.isArray(raw.approvals)) raw.approvals = [];
      return raw as Pack;
    } catch {
      return { version: 1, windows: [], approvals: [] };
    }
  }

  private writeRaw(pack: Pack) {
    const dir = join(process.cwd(), '.data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    pack.updatedAt = new Date().toISOString();
    pack.version = (Number(pack.version) || 0) + 1;
    // 原子替换：先写临时文件再 rename，降低半截 JSON 风险
    const tmp = this.dataPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(pack, null, 2), 'utf8');
    renameSync(tmp, this.dataPath);
  }

  /** 确保演示窗与审批单存在（幂等） */
  ensureSeed() {
    const pack = this.readRaw();
    if (!pack.windows.length) {
      const fixture = existsSync(this.fixturePath)
        ? (JSON.parse(readFileSync(this.fixturePath, 'utf8')) as Pack)
        : null;
      if (fixture?.windows?.length) {
        pack.windows = fixture.windows;
        pack.approvals = fixture.approvals || [];
        this.writeRaw(pack);
      }
    }
    return pack;
  }

  board() {
    const pack = this.ensureSeed();
    const counts = {
      windowsOpen: pack.windows.filter((w) => w.status === 'open').length,
      windowsTotal: pack.windows.length,
      submitted: pack.approvals.filter((a) => a.status === 'submitted').length,
      underReview: pack.approvals.filter((a) => a.status === 'under_review').length,
      approved: pack.approvals.filter((a) => a.status === 'approved').length,
      published: pack.approvals.filter((a) => a.status === 'published').length,
      returned: pack.approvals.filter((a) => a.status === 'returned').length,
      rejected: pack.approvals.filter((a) => a.status === 'rejected').length,
    };
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      noteZh: '园区征集窗 + 审批状态机。已通过单可一键进案例审核台（默认待审）；通过公示后观察台可见。不替代正式政务审批系统。',
      source: existsSync(this.dataPath) ? 'runtime' : 'fixture',
      updatedAt: pack.updatedAt || null,
      counts,
      windowStatusZh: WINDOW_ZH,
      approvalStatusZh: APPROVAL_ZH,
      windowTransitions: WINDOW_TRANSITIONS,
      approvalTransitions: APPROVAL_TRANSITIONS,
      windows: pack.windows.map((w) => ({
        ...w,
        statusZh: WINDOW_ZH[w.status] || w.status,
        nextStatuses: WINDOW_TRANSITIONS[w.status] || [],
      })),
      approvals: pack.approvals
        .slice()
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .map((a) => ({
          ...a,
          statusZh: APPROVAL_ZH[a.status] || a.status,
          nextStatuses: APPROVAL_TRANSITIONS[a.status] || [],
          nextLabels: (APPROVAL_TRANSITIONS[a.status] || []).map((s) => ({
            status: s,
            labelZh: APPROVAL_ZH[s],
          })),
          canPublishCase: ['approved', 'published'].includes(a.status),
          casePublished: Boolean(a.caseId),
          caseActionZh: a.caseId
            ? '已进案例池'
            : ['approved', 'published'].includes(a.status)
              ? '一键进案例审核台'
              : null,
        })),
    };
  }

  createWindow(
    body: { titleZh: string; region?: string; noteZh?: string; opensAt?: string; closesAt?: string; status?: WindowStatus },
    actor: string,
  ) {
    if (!body?.titleZh?.trim()) throw new BadRequestException('请填写征集窗标题');
    const pack = this.ensureSeed();
    const now = new Date().toISOString();
    const row: CollectionWindow = {
      id: nid('win'),
      titleZh: body.titleZh.trim(),
      region: body.region?.trim() || '示范园区',
      status: body.status && WINDOW_TRANSITIONS[body.status] ? body.status : 'draft',
      opensAt: body.opensAt,
      closesAt: body.closesAt,
      noteZh: body.noteZh || '',
      createdAt: now,
      updatedAt: now,
    };
    pack.windows.unshift(row);
    this.writeRaw(pack);
    void this.audit.log({
      action: 'park.window.create',
      actor,
      targetType: 'ParkWindow',
      targetId: row.id,
      meta: { titleZh: row.titleZh, status: row.status },
    });
    return { ok: true, window: { ...row, statusZh: WINDOW_ZH[row.status] } };
  }

  transitionWindow(id: string, to: WindowStatus, actor: string, noteZh?: string) {
    const pack = this.ensureSeed();
    const w = pack.windows.find((x) => x.id === id);
    if (!w) throw new NotFoundException('征集窗不存在');
    const allowed = WINDOW_TRANSITIONS[w.status] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`征集窗不能从「${WINDOW_ZH[w.status]}」转到「${WINDOW_ZH[to] || to}」`);
    }
    const from = w.status;
    w.status = to;
    w.updatedAt = new Date().toISOString();
    if (noteZh) w.noteZh = `${w.noteZh || ''}\n[${to}] ${noteZh}`.trim();
    this.writeRaw(pack);
    void this.audit.log({
      action: 'park.window.transition',
      actor,
      targetType: 'ParkWindow',
      targetId: id,
      meta: { from, to, noteZh },
    });
    return { ok: true, window: { ...w, statusZh: WINDOW_ZH[w.status], nextStatuses: WINDOW_TRANSITIONS[w.status] } };
  }

  createApproval(
    body: {
      windowId?: string;
      titleZh: string;
      orgAlias?: string;
      summaryZh?: string;
      demandId?: string;
    },
    actor: string,
  ) {
    if (!body?.titleZh?.trim()) throw new BadRequestException('请填写审批标题');
    const pack = this.ensureSeed();
    let windowId = body.windowId;
    if (!windowId) {
      const open = pack.windows.find((w) => w.status === 'open') || pack.windows[0];
      if (!open) throw new BadRequestException('还没有征集窗，请先由运营创建');
      windowId = open.id;
    }
    const win = pack.windows.find((w) => w.id === windowId);
    if (!win) throw new NotFoundException('征集窗不存在');
    if (win.status === 'archived') throw new BadRequestException('已归档的征集窗不能再收件');
    const now = new Date().toISOString();
    const row: ApprovalItem = {
      id: nid('appr'),
      windowId,
      titleZh: body.titleZh.trim(),
      orgAlias: body.orgAlias?.trim() || '未命名单位',
      demandId: body.demandId || null,
      status: 'submitted',
      summaryZh: body.summaryZh || '',
      reviewerNote: '',
      history: [{ at: now, from: null, to: 'submitted', actor, noteZh: '提交征集' }],
      createdAt: now,
      updatedAt: now,
    };
    pack.approvals.unshift(row);
    this.writeRaw(pack);
    void this.audit.log({
      action: 'park.approval.create',
      actor,
      targetType: 'ParkApproval',
      targetId: row.id,
      meta: { windowId, titleZh: row.titleZh },
    });
    return {
      ok: true,
      approval: {
        ...row,
        statusZh: APPROVAL_ZH[row.status],
        nextStatuses: APPROVAL_TRANSITIONS[row.status],
      },
    };
  }

  transitionApproval(id: string, to: ApprovalStatus, actor: string, noteZh?: string) {
    const pack = this.ensureSeed();
    const a = pack.approvals.find((x) => x.id === id);
    if (!a) throw new NotFoundException('审批单不存在');
    const allowed = APPROVAL_TRANSITIONS[a.status] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`审批不能从「${APPROVAL_ZH[a.status]}」转到「${APPROVAL_ZH[to] || to}」`);
    }
    const from = a.status;
    a.status = to;
    a.updatedAt = new Date().toISOString();
    if (noteZh) a.reviewerNote = noteZh;
    a.history.push({ at: a.updatedAt, from, to, actor, noteZh });
    this.writeRaw(pack);
    void this.audit.log({
      action: 'park.approval.transition',
      actor,
      targetType: 'ParkApproval',
      targetId: id,
      meta: { from, to, noteZh },
    });
    return {
      ok: true,
      approval: {
        ...a,
        statusZh: APPROVAL_ZH[a.status],
        nextStatuses: APPROVAL_TRANSITIONS[a.status] || [],
        nextLabels: (APPROVAL_TRANSITIONS[a.status] || []).map((s) => ({
          status: s,
          labelZh: APPROVAL_ZH[s],
        })),
      },
    };
  }

  /** 从真实需求补一条示范审批（运营一键） */
  async seedFromDemands(actor: string) {
    return this.boardMutex.run(async () => {
    const pack = this.ensureSeed();
    const open = pack.windows.find((w) => w.status === 'open') || pack.windows[0];
    if (!open) throw new BadRequestException('请先创建征集窗');
    const demands = await this.prisma.demand.findMany({ orderBy: { updatedAt: 'desc' }, take: 3, include: { org: true } });
    let n = 0;
    for (const d of demands) {
      if (pack.approvals.some((a) => a.demandId === d.id)) continue;
      const now = new Date().toISOString();
      pack.approvals.unshift({
        id: nid('appr'),
        windowId: open.id,
        titleZh: d.title,
        orgAlias: d.org?.name || '需求方',
        demandId: d.id,
        status: 'submitted',
        summaryZh: (String((d as any).summary || (d as any).description || (d as any).problem || '')).slice(0, 180) || '由运营从需求卡导入征集队列',
        reviewerNote: '',
        history: [{ at: now, from: null, to: 'submitted', actor, noteZh: '从需求卡导入' }],
        createdAt: now,
        updatedAt: now,
      });
      n++;
    }
    if (n) this.writeRaw(pack);
    return { ok: true, seeded: n, board: this.board() };
    });
  }

  /**
   * 审批已通过 / 已公示 → 一键写入脱敏案例审核台（幂等）。
   * M32 默认 pending，审核通过后观察台可见；publishNow 可直接公示。
   */
  async publishDesensitizedCase(
    approvalId: string,
    actor: string,
    opts: { publishNow?: boolean } = {},
  ) {
    return this.boardMutex.run(async () => {
    const pack = this.ensureSeed();
    const a = pack.approvals.find((x) => x.id === approvalId);
    if (!a) throw new NotFoundException('审批单不存在');
    if (!['approved', 'published'].includes(a.status)) {
      throw new BadRequestException('只有「已通过」或「已公示」的单才能进案例池');
    }
    if (a.caseId) {
      const existing = await this.prisma.caseStudy.findUnique({ where: { id: a.caseId } });
      if (existing) {
        return {
          ok: true,
          idempotent: true,
          case: existing,
          approval: { ...a, statusZh: APPROVAL_ZH[a.status], casePublished: true },
          noteZh: '本单已进过案例池，未重复发布。',
        };
      }
    }
    // 按审批 id 再查一次，防并发双写
    const recent = await this.prisma.caseStudy.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 120,
    });
    const prior = recent.find((c) => (c.meta as any)?.parkApprovalId === approvalId) || null;
    if (prior) {
      a.caseId = prior.id;
      a.casePublishedAt = (prior.publishedAt || new Date()).toISOString();
      this.writeRaw(pack);
      return {
        ok: true,
        idempotent: true,
        case: prior,
        approval: { ...a, statusZh: APPROVAL_ZH[a.status], casePublished: true },
        noteZh: '已关联既有脱敏案例。',
      };
    }

    const win = pack.windows.find((w) => w.id === a.windowId);
    const title = `【园区征集】${a.titleZh}`.slice(0, 120);
    const demandAlias = a.orgAlias || '某申报单位';
    const supplyAlias = '园区对接供给方（脱敏）';
    const summaryZh =
      (a.summaryZh || '').trim() ||
      `${demandAlias} 经「${win?.titleZh || '征集窗'}」审批通过，主题已脱敏入库，供观察台对外讲述。`;
    const detailZh = [
      `征集窗：${win?.titleZh || a.windowId}`,
      `区域：${win?.region || '示范园区'}`,
      `审批状态：${APPROVAL_ZH[a.status]}`,
      a.reviewerNote ? `审阅备注（已可公开口径）：${String(a.reviewerNote).slice(0, 200)}` : '',
      '说明：组织真名、联系人、金额均已隐去；仅保留可汇报的主题与结果。',
    ]
      .filter(Boolean)
      .join('\n');

    const asPublished = Boolean(opts?.publishNow);
    const item = await this.prisma.caseStudy.create({
      data: {
        title: shared.publicCaseText(title).slice(0, 120),
        outcome: 'success',
        summaryZh: shared.publicCaseText(summaryZh).slice(0, 500),
        detailZh: shared.publicCaseText(detailZh),
        demandAlias,
        supplyAlias,
        industryHint: win?.region || null,
        trlBand: null,
        status: asPublished ? 'published' : 'pending',
        publishedAt: asPublished ? new Date() : null,
        approvedBy: asPublished ? actor : null,
        createdBy: actor,
        meta: {
          source: 'park-approval-m32',
          parkApprovalId: approvalId,
          windowId: a.windowId,
          demandId: a.demandId || null,
          neverExposeOrgLegalName: true,
          awaitsModeration: !asPublished,
        },
      },
    });

    a.caseId = item.id;
    a.casePublishedAt = (item.publishedAt || new Date()).toISOString();
    // 直接公示时，若还在「已通过」，顺带推进到「已公示」
    if (asPublished && a.status === 'approved') {
      const from = a.status;
      a.status = 'published';
      a.updatedAt = new Date().toISOString();
      a.history.push({
        at: a.updatedAt,
        from,
        to: 'published',
        actor,
        noteZh: '脱敏案例直接公示',
      });
    }
    a.updatedAt = new Date().toISOString();
    this.writeRaw(pack);
    void this.audit.log({
      action: 'park.approval.publish_case',
      actor,
      targetType: 'ParkApproval',
      targetId: approvalId,
      meta: { caseId: item.id, status: item.status },
    });
    return {
      ok: true,
      idempotent: false,
      case: item,
      approval: {
        ...a,
        statusZh: APPROVAL_ZH[a.status],
        casePublished: true,
        canPublishCase: true,
        caseActionZh: asPublished ? '已进案例池并公示' : '已进审核台待公示',
      },
      noteZh: asPublished
        ? '已脱敏并直接公示，观察台「脱敏案例」可见。'
        : '已脱敏写入案例审核台（待审核）。请在「案例审核」通过公示后，观察台才会展示。',
    };
    });
  }


  private defaultTemplates(): DocTemplate[] {
    return [
      {
        id: 'tpl-collect-notice',
        nameZh: '征集通知函',
        direction: 'outbound',
        docNoRule: '研园〔{YYYY}〕{SEQ}号',
        titleHintZh: '关于公开征集产学研对接项目的函',
        bodyHintZh: '请各入驻企业、合作高校于征集窗期内提交技术需求或可转化成果。',
        active: true,
      },
      {
        id: 'tpl-ack-reply',
        nameZh: '收文回执函',
        direction: 'inbound',
        docNoRule: '研收〔{YYYY}〕{SEQ3}号',
        titleHintZh: '关于收到材料的回执（演示）',
        bodyHintZh: '材料已收悉，将按征集窗流程办理。',
        active: true,
      },
      {
        id: 'tpl-window-announce',
        nameZh: '征集窗启停公告',
        direction: 'outbound',
        docNoRule: '研公〔{YYYY}〕{SEQ}号',
        titleHintZh: '关于调整征集窗口期的公告',
        bodyHintZh: '现将征集窗启停安排告知如下（演示，未走专网）。',
        active: true,
      },
    ];
  }

  private readDocs(): DocsPack {
    const prefer = existsSync(this.docsPath) ? this.docsPath : this.docsFixturePath;
    try {
      const raw = JSON.parse(readFileSync(prefer, 'utf8'));
      if (!Array.isArray(raw.items)) raw.items = [];
      if (!Array.isArray(raw.templates) || !raw.templates.length) raw.templates = this.defaultTemplates();
      if (!raw.seqByYear || typeof raw.seqByYear !== 'object') raw.seqByYear = {};
      return raw as DocsPack;
    } catch {
      return { version: 2, items: [], templates: this.defaultTemplates(), seqByYear: {} };
    }
  }

  private writeDocs(pack: DocsPack) {
    const dir = join(process.cwd(), '.data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    pack.updatedAt = new Date().toISOString();
    pack.version = (Number(pack.version) || 1) + 1;
    if (!Array.isArray(pack.templates)) pack.templates = this.defaultTemplates();
    if (!pack.seqByYear) pack.seqByYear = {};
    const tmp = this.docsPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(pack, null, 2), 'utf8');
    renameSync(tmp, this.docsPath);
  }

  ensureDocsSeed() {
    const pack = this.readDocs();
    let dirty = false;
    if (!pack.items.length && existsSync(this.docsFixturePath)) {
      try {
        const fixture = JSON.parse(readFileSync(this.docsFixturePath, 'utf8'));
        if (Array.isArray(fixture.items) && fixture.items.length) {
          pack.items = fixture.items;
          dirty = true;
        }
        if (Array.isArray(fixture.templates) && fixture.templates.length) {
          pack.templates = fixture.templates;
          dirty = true;
        }
        if (fixture.seqByYear) {
          pack.seqByYear = fixture.seqByYear;
          dirty = true;
        }
      } catch {}
    }
    if (!pack.templates?.length) {
      pack.templates = this.defaultTemplates();
      dirty = true;
    }
    if (!pack.seqByYear) {
      pack.seqByYear = {};
      dirty = true;
    }
    if (dirty) this.writeDocs(pack);
    return pack;
  }

  private formatDocNo(rule: string, year: number, seq: number) {
    const yy = String(year).slice(-2);
    const seq3 = String(seq).padStart(3, '0');
    return rule
      .replace(/\{YYYY\}/g, String(year))
      .replace(/\{YY\}/g, yy)
      .replace(/\{SEQ3\}/g, seq3)
      .replace(/\{SEQ\}/g, String(seq));
  }

  private nextDocNo(pack: DocsPack, rule: string) {
    const year = new Date().getFullYear();
    const key = String(year);
    const next = (pack.seqByYear[key] || 0) + 1;
    pack.seqByYear[key] = next;
    return this.formatDocNo(rule || '研园〔{YYYY}〕{SEQ}号', year, next);
  }

  listDocTemplates() {
    const pack = this.ensureDocsSeed();
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: '公文模板可在可视化编辑器改标题/正文/文号规则；预览文号不消耗序号。建文可选模板并关联征集窗。',
      liveGovNetwork: false,
      templates: pack.templates.filter((t) => t.active !== false).map((t) => ({
        ...t,
        directionZh: DOC_DIR_ZH[t.direction] || t.direction,
        exampleDocNo: this.formatDocNo(t.docNoRule, new Date().getFullYear(), (pack.seqByYear[String(new Date().getFullYear())] || 0) + 1),
      })),
      seqByYear: pack.seqByYear,
      placeholdersZh: [
        { token: '{YYYY}', hintZh: '四位年' },
        { token: '{YY}', hintZh: '两位年' },
        { token: '{SEQ}', hintZh: '当年序号' },
        { token: '{SEQ3}', hintZh: '三位补零序号' },
      ],
      editorNoteZh: '可视化编辑保存走 POST /api/park/doc-templates；预览文号不消耗序号。',
    };
  }

  /** 文号预览：不写入 seqByYear */
  previewDocNo(rule?: string, seqHint?: number) {
    const pack = this.ensureDocsSeed();
    const year = new Date().getFullYear();
    const next = Math.max(1, Number(seqHint) || (pack.seqByYear[String(year)] || 0) + 1);
    const r = (rule || '研园〔{YYYY}〕{SEQ}号').trim();
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      rule: r,
      year,
      nextSeqPreview: next,
      exampleDocNo: this.formatDocNo(r, year, next),
      consumesSeq: false,
      noteZh: '仅预览，不会占用正式文号序号。',
    };
  }

  upsertDocTemplate(
    body: {
      id?: string;
      nameZh: string;
      direction?: DocDirection;
      docNoRule?: string;
      titleHintZh?: string;
      bodyHintZh?: string;
      active?: boolean;
    },
    actor: string,
  ) {
    if (!body?.nameZh?.trim()) throw new BadRequestException('请填写模板名称');
    const pack = this.ensureDocsSeed();
    const id = body.id?.trim() || nid('tpl');
    const existing = pack.templates.find((t) => t.id === id);
    const row: DocTemplate = {
      id,
      nameZh: body.nameZh.trim(),
      direction: body.direction === 'inbound' ? 'inbound' : 'outbound',
      docNoRule: (body.docNoRule || '研园〔{YYYY}〕{SEQ}号').trim(),
      titleHintZh: body.titleHintZh?.trim() || existing?.titleHintZh,
      bodyHintZh: body.bodyHintZh?.trim() || existing?.bodyHintZh,
      active: body.active === false ? false : true,
    };
    if (existing) {
      Object.assign(existing, row);
    } else {
      pack.templates.push(row);
    }
    this.writeDocs(pack);
    void this.audit.log({
      action: 'park.doc_template.upsert',
      actor,
      targetType: 'ParkDocTemplate',
      targetId: id,
      meta: { nameZh: row.nameZh, docNoRule: row.docNoRule },
    });
    const year = new Date().getFullYear();
    const next = (pack.seqByYear[String(year)] || 0) + 1;
    return {
      ok: true,
      template: {
        ...row,
        directionZh: DOC_DIR_ZH[row.direction] || row.direction,
        exampleDocNo: this.formatDocNo(row.docNoRule, year, next),
      },
      noteZh: existing ? '模板已更新' : '模板已创建',
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
    };
  }


  /** 园区公文交换骨架：发文/收文，状态 draft→sent→acked；不接真政务外网 */
  listDocs(filter?: { direction?: DocDirection; status?: DocStatus }) {
    const pack = this.ensureDocsSeed();
    let items = pack.items.slice();
    if (filter?.direction) items = items.filter((d) => d.direction === filter.direction);
    if (filter?.status) items = items.filter((d) => d.status === filter.status);
    items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const counts = {
      total: pack.items.length,
      draft: pack.items.filter((d) => d.status === 'draft').length,
      sent: pack.items.filter((d) => d.status === 'sent').length,
      acked: pack.items.filter((d) => d.status === 'acked').length,
      outbound: pack.items.filter((d) => d.direction === 'outbound').length,
      inbound: pack.items.filter((d) => d.direction === 'inbound').length,
    };
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: '公文交换：可批量红头 ZIP、登记投递回执；可下载红头套版 PDF（非法定公文）。只在平台内记账，不接政务专网。',
      liveGovNetwork: false,
      noteZh: '建文可选模板自动生成文号；红头批量 ZIP；投递回执仅平台内骨架，永不真投专网。真专网/签章仍延后。',
      source: existsSync(this.docsPath) ? 'runtime' : 'fixture',
      updatedAt: pack.updatedAt || null,
      counts,
      statusZh: DOC_ZH,
      directionZh: DOC_DIR_ZH,
      transitions: DOC_TRANSITIONS,
      templates: pack.templates.filter((t) => t.active !== false).map((t) => ({
        id: t.id,
        nameZh: t.nameZh,
        docNoRule: t.docNoRule,
        direction: t.direction,
      })),
      items: items.map((d) => ({
        ...d,
        statusZh: DOC_ZH[d.status] || d.status,
        directionZh: DOC_DIR_ZH[d.direction] || d.direction,
        docNo: d.docNo || null,
        windowId: d.windowId || null,
        windowTitleZh: d.windowTitleZh || null,
        templateId: d.templateId || null,
        templateNameZh: d.templateNameZh || null,
        deliveryAckCount: (d.deliveryAcks || []).length,
        latestDeliveryAck: (d.deliveryAcks || [])[(d.deliveryAcks || []).length - 1] || null,
        nextStatuses: DOC_TRANSITIONS[d.status] || [],
        nextLabels: (DOC_TRANSITIONS[d.status] || []).map((st) => ({
          status: st,
          labelZh: DOC_ZH[st],
        })),
      })),
    };
  }

  createDocDraft(
    body: {
      direction?: DocDirection;
      titleZh?: string;
      bodyZh?: string;
      counterpartyZh?: string;
      templateId?: string;
      windowId?: string;
      docNo?: string;
    },
    actor: string,
  ) {
    const pack = this.ensureDocsSeed();
    const tpl = body?.templateId ? pack.templates.find((t) => t.id === body.templateId) : null;
    const titleZh = (body?.titleZh || tpl?.titleHintZh || '').trim();
    if (!titleZh) throw new BadRequestException('请填写公文标题，或先选模板');
    const dir: DocDirection =
      body?.direction === 'inbound' || body?.direction === 'outbound'
        ? body.direction
        : tpl?.direction || 'outbound';
    let windowId: string | null = body?.windowId || null;
    let windowTitleZh: string | null = null;
    if (windowId) {
      const board = this.ensureSeed();
      const win = board.windows.find((w) => w.id === windowId);
      if (!win) throw new NotFoundException('关联的征集窗不存在');
      windowTitleZh = win.titleZh;
    }
    const docNo =
      (body?.docNo || '').trim() ||
      (tpl ? this.nextDocNo(pack, tpl.docNoRule) : this.nextDocNo(pack, '研园〔{YYYY}〕{SEQ}号'));
    const now = new Date().toISOString();
    const row: ParkDoc = {
      id: nid('doc'),
      direction: dir,
      titleZh,
      bodyZh: (body?.bodyZh || tpl?.bodyHintZh || '').trim(),
      counterpartyZh: (body?.counterpartyZh || '示范单位').trim(),
      status: 'draft',
      history: [
        {
          at: now,
          from: null,
          to: 'draft',
          actor,
          noteZh: tpl ? `按模板「${tpl.nameZh}」创建草稿` : '创建草稿',
        },
      ],
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      docNo,
      templateId: tpl?.id || null,
      templateNameZh: tpl?.nameZh || null,
      windowId,
      windowTitleZh,
      deliveryAcks: [],
    };
    pack.items.unshift(row);
    this.writeDocs(pack);
    void this.audit.log({
      action: 'park.doc.create',
      actor,
      targetType: 'ParkDoc',
      targetId: row.id,
      meta: { direction: row.direction, titleZh: row.titleZh, docNo, templateId: row.templateId, windowId },
    });
    return {
      ok: true,
      item: {
        ...row,
        statusZh: DOC_ZH.draft,
        directionZh: DOC_DIR_ZH[dir],
        nextStatuses: DOC_TRANSITIONS.draft,
      },
      noteZh: `草稿已保存，文号 ${docNo}${windowTitleZh ? ` · 关联征集窗「${windowTitleZh}」` : ''}。确认无涉密后可点「发出」；不向政务专网真投递。`,
    };
  }

  /** 给已有公文补挂 / 改挂征集窗 */
  linkDocWindow(id: string, windowId: string | null, actor: string) {
    const pack = this.ensureDocsSeed();
    const d = pack.items.find((x) => x.id === id);
    if (!d) throw new NotFoundException('公文不存在');
    let windowTitleZh: string | null = null;
    if (windowId) {
      const board = this.ensureSeed();
      const win = board.windows.find((w) => w.id === windowId);
      if (!win) throw new NotFoundException('征集窗不存在');
      windowTitleZh = win.titleZh;
    }
    d.windowId = windowId;
    d.windowTitleZh = windowTitleZh;
    d.updatedAt = new Date().toISOString();
    d.history.push({
      at: d.updatedAt,
      from: d.status,
      to: d.status,
      actor,
      noteZh: windowId ? `关联征集窗「${windowTitleZh}」` : '取消征集窗关联',
    });
    this.writeDocs(pack);
    return {
      ok: true,
      item: {
        ...d,
        statusZh: DOC_ZH[d.status],
        directionZh: DOC_DIR_ZH[d.direction],
      },
      noteZh: windowId ? `已关联征集窗「${windowTitleZh}」` : '已取消征集窗关联',
    };
  }

  transitionDoc(id: string, to: DocStatus, actor: string, noteZh?: string) {
    const pack = this.ensureDocsSeed();
    const d = pack.items.find((x) => x.id === id);
    if (!d) throw new NotFoundException('公文不存在');
    const allowed = DOC_TRANSITIONS[d.status] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`公文不能从「${DOC_ZH[d.status]}」转到「${DOC_ZH[to] || to}」`);
    }
    const from = d.status;
    d.status = to;
    d.updatedAt = new Date().toISOString();
    d.history.push({ at: d.updatedAt, from, to, actor, noteZh: noteZh || undefined });
    this.writeDocs(pack);
    void this.audit.log({
      action: 'park.doc.transition',
      actor,
      targetType: 'ParkDoc',
      targetId: id,
      meta: { from, to, noteZh },
    });
    return {
      ok: true,
      item: {
        ...d,
        statusZh: DOC_ZH[d.status],
        directionZh: DOC_DIR_ZH[d.direction],
        nextStatuses: DOC_TRANSITIONS[d.status] || [],
      },
      noteZh:
        to === 'sent'
          ? '已标记发出（平台内状态）。未连接正式公文交换网络。'
          : to === 'acked'
            ? '已标记对方签收（平台内确认）。'
            : '状态已更新。',
    };
  }

  
  /** M37：批量签发文号 / 批量标记发出（平台内骨架，不接政务专网） */
  batchDocs(
    body: { ids?: string[]; action?: 'assign_docno' | 'mark_sent'; templateId?: string; noteZh?: string },
    actor: string,
  ) {
    return this.docsMutex.run(() => this.batchDocsInner(body, actor));
  }

  private batchDocsInner(
    body: { ids?: string[]; action?: 'assign_docno' | 'mark_sent'; templateId?: string; noteZh?: string },
    actor: string,
  ) {
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
    if (!ids.length) throw new BadRequestException('请先勾选要处理的公文草稿');
    const action = body?.action === 'mark_sent' ? 'mark_sent' : body?.action === 'assign_docno' ? 'assign_docno' : null;
    if (!action) throw new BadRequestException('action 仅支持 assign_docno | mark_sent');
    const pack = this.ensureDocsSeed();
    const tpl = body?.templateId ? pack.templates.find((t) => t.id === body.templateId) : null;
    if (body?.templateId && !tpl) throw new NotFoundException('指定的文号模板不存在');
    const results: Array<{ id: string; ok: boolean; docNo?: string | null; status?: string; errorZh?: string }> = [];
    let okCount = 0;
    const now = new Date().toISOString();
    for (const id of ids) {
      const d = pack.items.find((x) => x.id === id);
      if (!d) {
        results.push({ id, ok: false, errorZh: '公文不存在' });
        continue;
      }
      if (action === 'assign_docno') {
        if (d.status !== 'draft') {
          results.push({ id, ok: false, docNo: d.docNo, status: d.status, errorZh: '只有草稿能批量签发文号' });
          continue;
        }
        const rule = tpl?.docNoRule || (d.templateId && pack.templates.find((t) => t.id === d.templateId)?.docNoRule) || '研园〔{YYYY}〕{SEQ}号';
        const prev = d.docNo;
        d.docNo = this.nextDocNo(pack, rule);
        if (tpl) {
          d.templateId = tpl.id;
          d.templateNameZh = tpl.nameZh;
        }
        d.updatedAt = now;
        d.history.push({
          at: now,
          from: d.status,
          to: d.status,
          actor,
          noteZh: body?.noteZh || (prev ? `批量换文号：${prev} → ${d.docNo}` : `批量签发文号 ${d.docNo}`),
        });
        results.push({ id, ok: true, docNo: d.docNo, status: d.status });
        okCount++;
      } else {
        // mark_sent
        if (d.status !== 'draft') {
          results.push({ id, ok: false, docNo: d.docNo, status: d.status, errorZh: '只有草稿能批量标记发出' });
          continue;
        }
        if (!d.docNo) {
          const rule = tpl?.docNoRule || (d.templateId && pack.templates.find((t) => t.id === d.templateId)?.docNoRule) || '研园〔{YYYY}〕{SEQ}号';
          d.docNo = this.nextDocNo(pack, rule);
          if (tpl) {
            d.templateId = tpl.id;
            d.templateNameZh = tpl.nameZh;
          }
        }
        const from = d.status;
        d.status = 'sent';
        d.updatedAt = now;
        d.history.push({
          at: now,
          from,
          to: 'sent',
          actor,
          noteZh: body?.noteZh || '批量标记发出（平台内，未接政务专网）',
        });
        results.push({ id, ok: true, docNo: d.docNo, status: d.status });
        okCount++;
      }
    }
    this.writeDocs(pack);
    void this.audit.log({
      action: action === 'assign_docno' ? 'park.doc.batch_assign_docno' : 'park.doc.batch_mark_sent',
      actor,
      targetType: 'ParkDocBatch',
      targetId: ids.slice(0, 8).join(','),
      meta: { action, requested: ids.length, okCount, templateId: body?.templateId || null },
    });
    const bannerZh =
      action === 'assign_docno'
        ? `已为 ${okCount}/${ids.length} 份草稿签发文号。不接政务专网，文号只在平台内记账。`
        : `已将 ${okCount}/${ids.length} 份草稿标为「已发出」。仅平台内状态，不会真投递。`;
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      action,
      liveGovNetwork: false,
      requested: ids.length,
      okCount,
      failCount: ids.length - okCount,
      bannerZh,
      noteZh: bannerZh,
      results,
    };
  }


  getDocOrThrow(id: string) {
    const pack = this.ensureDocsSeed();
    const d = pack.items.find((x) => x.id === id);
    if (!d) throw new NotFoundException('公文不存在');
    return { pack, doc: d };
  }

  /** M38：红头套版 HTML（非法定公文横幅） */
  docRedHeaderHtml(id: string) {
    const { doc } = this.getDocOrThrow(id);
    const html = buildParkDocRedHeaderHtml({
      id: doc.id,
      docNo: doc.docNo,
      titleZh: doc.titleZh,
      bodyZh: doc.bodyZh,
      directionZh: DOC_DIR_ZH[doc.direction] || doc.direction,
      statusZh: DOC_ZH[doc.status] || doc.status,
      counterpartyZh: doc.counterpartyZh,
      templateNameZh: doc.templateNameZh,
      windowTitleZh: doc.windowTitleZh,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: '非法定公文 · 平台内演示套版 · 不接政务专网 / 电子签章',
      liveGovNetwork: false,
      html,
      doc: {
        id: doc.id,
        docNo: doc.docNo || null,
        titleZh: doc.titleZh,
        status: doc.status,
        statusZh: DOC_ZH[doc.status] || doc.status,
      },
    };
  }

  /** M38：红头套版 PDF（Chrome 打印） */
  async renderDocRedHeaderPdf(id: string) {
    const { doc } = this.getDocOrThrow(id);
    const out = await renderParkDocPdf({
      id: doc.id,
      docNo: doc.docNo,
      titleZh: doc.titleZh,
      bodyZh: doc.bodyZh,
      directionZh: DOC_DIR_ZH[doc.direction] || doc.direction,
      statusZh: DOC_ZH[doc.status] || doc.status,
      counterpartyZh: doc.counterpartyZh,
      templateNameZh: doc.templateNameZh,
      windowTitleZh: doc.windowTitleZh,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    void this.audit.log({
      action: 'park.doc.redhead_pdf',
      actor: 'system',
      targetType: 'ParkDoc',
      targetId: id,
      meta: { bytes: out.bytes, docNo: doc.docNo || null },
    });
    return {
      ...out,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: '非法定公文 · 演示红头 PDF，不可作为行政依据',
      liveGovNetwork: false,
      docId: id,
      docNo: doc.docNo || null,
      titleZh: doc.titleZh,
    };
  }


  /** M39：登记公文投递回执（骨架，不接真专网） */
  recordDeliveryAck(
    id: string,
    body: { channel?: string; status?: DeliveryAck['status']; noteZh?: string } = {},
    actor: string,
  ) {
    const { pack, doc } = this.getDocOrThrow(id);
    const channel = (body.channel || 'demo_channel').slice(0, 40);
    const status = (['recorded', 'simulated_sent', 'simulated_acked'] as const).includes(body.status as any)
      ? (body.status as DeliveryAck['status'])
      : 'recorded';
    const ack: DeliveryAck = {
      id: 'ack_' + randomBytes(4).toString('hex'),
      at: new Date().toISOString(),
      actor,
      channel,
      status,
      noteZh: (body.noteZh || '').trim() || '平台内登记投递回执（演示，未真投专网）',
      liveNetwork: false,
    };
    if (!doc.deliveryAcks) doc.deliveryAcks = [];
    doc.deliveryAcks.push(ack);
    doc.updatedAt = ack.at;
    doc.history.push({
      at: ack.at,
      from: doc.status,
      to: doc.status,
      actor,
      noteZh: `投递回执：${ack.status} · ${ack.channel}`,
    });
    this.writeDocs(pack);
    void this.audit.log({
      action: 'park.doc.delivery_ack',
      actor,
      targetType: 'ParkDoc',
      targetId: id,
      meta: { ackId: ack.id, channel, status, liveNetwork: false },
    });
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      liveGovNetwork: false,
      bannerZh: '已登记投递回执（演示骨架 · 不接政务专网）',
      noteZh: '回执只写在平台台账里，不会发到任何外部公文网。',
      item: doc,
      ack,
    };
  }

  listDeliveryAcks(id: string) {
    const { doc } = this.getDocOrThrow(id);
    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      liveGovNetwork: false,
      docId: id,
      docNo: doc.docNo || null,
      titleZh: doc.titleZh,
      bannerZh: '投递回执台账 · 非真专网投递',
      items: doc.deliveryAcks || [],
      count: (doc.deliveryAcks || []).length,
    };
  }

  /** M39/M42：红头批量套版 ZIP（docsMutex 串行，防并发乱序） */
  async renderRedheadZip(ids: string[], actor = 'park') {
    return this.docsMutex.run(() => this.renderRedheadZipInner(ids, actor));
  }

  private async renderRedheadZipInner(ids: string[], actor = 'park') {
    const uniq = Array.from(new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (!uniq.length) throw new BadRequestException('请先勾选要套红头的公文');
    if (uniq.length > 30) throw new BadRequestException('单次最多 30 份红头 PDF');
    const root = join(process.cwd(), 'exports', 'park-docs');
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `park-redhead-batch-${stamp}.zip`;
    const filePath = join(root, fileName);
    const entries: any[] = [];
    const errors: any[] = [];

    for (const id of uniq) {
      try {
        const out = await this.renderDocRedHeaderPdf(id);
        const safe = String(out.docNo || id)
          .replace(/[^A-Za-z0-9._\u4e00-\u9fa5-]+/g, '_')
          .replace(/_+/g, '_')
          .slice(0, 50) || id.slice(0, 12);
        entries.push({
          id,
          docNo: out.docNo || null,
          titleZh: out.titleZh,
          pdfPath: out.pdfPath,
          zipName: `redhead-${safe}.pdf`,
          bytes: out.bytes,
        });
      } catch (e: any) {
        errors.push({ id, error: (e?.message || String(e)).slice(0, 200) });
      }
    }
    if (!entries.length) {
      throw new BadRequestException('没有成功生成的红头 PDF：' + (errors[0]?.error || ''));
    }

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(filePath);
      const archive = createZipArchive({ zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      (async () => {
        try {
          for (const e of entries) {
            archive.file(e.pdfPath, { name: e.zipName });
          }
          const manifest = {
            wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
            bannerZh: '非法定公文 · 批量红头套版 ZIP · 不接政务专网',
            liveGovNetwork: false,
            generatedAt: new Date().toISOString(),
            actor,
            count: entries.length,
            errors,
            items: entries.map(({ id, docNo, titleZh, zipName, bytes }) => ({
              id,
              docNo,
              titleZh,
              zipName,
              bytes,
            })),
          };
          archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
          archive.append(
            '研企通红头批量套版（非法定公文）\\n不接政务专网 / 电子签章\\n仅供平台内演示阅读\\n',
            { name: 'README.txt' },
          );
          await archive.finalize();
        } catch (err) {
          reject(err);
        }
      })();
    });

    void this.audit.log({
      action: 'park.doc.redhead_zip',
      actor,
      targetType: 'ParkDocBatch',
      targetId: entries.map((e) => e.id).join(',').slice(0, 120),
      meta: { count: entries.length, errors: errors.length, fileName },
    });

    return {
      ok: true,
      wave: 'M39-playbook-sync-redhead-zip-ledger-filter-ack',
      bannerZh: `已打包 ${entries.length} 份红头 PDF（非法定公文）`,
      liveGovNetwork: false,
      fileName,
      filePath,
      bytes: statSync(filePath).size,
      count: entries.length,
      errorCount: errors.length,
      errors,
      items: entries.map(({ id, docNo, titleZh, zipName, bytes }) => ({ id, docNo, titleZh, zipName, bytes })),
      noteZh: 'ZIP 内含各份红头 PDF + manifest.json；不可作为行政依据。',
    };
  }

  assertCanMutate(req: any, kind: 'window' | 'approval' | 'review' | 'docs') {
    const role = req?.user?.role;
    const hasKey = req?.authMeta?.hasKey;
    if (hasKey || role === 'ADMIN' || role === 'OPERATOR') return;
    // 园区观察账号（guest / 无 ORG）可推进审批审阅，不可建窗
    if (kind === 'review' && (role === 'ORG_USER' || role === 'OPS_VIEWER' || !role)) {
      // park shell users are often ORG_USER or a guest persona — check email/persona via shell later
    }
    if (kind === 'docs') {
      // 园区壳可维护公文草稿/发出/签收台账（不接真专网）
      if (role === 'BROKER') throw new ForbiddenException('经纪人不能操作园区公文台账');
      return;
    }
    if (kind === 'window' && !hasKey && role !== 'ADMIN' && role !== 'OPERATOR') {
      throw new ForbiddenException('仅运营可管理征集窗');
    }
    if (kind === 'approval' && role === 'BROKER' && !hasKey) {
      throw new ForbiddenException('经纪人不能创建园区审批单');
    }
  }

  /** 园区壳可做的审阅动作（不改窗、不建窗） */
  parkMayReview(to: ApprovalStatus) {
    return ['under_review', 'approved', 'returned', 'rejected', 'published'].includes(to);
  }
}
