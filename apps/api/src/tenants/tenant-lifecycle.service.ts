import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { createHash, randomBytes } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// archiver v8：命名导出 ZipArchive
const { ZipArchive, Archiver } = require('archiver');
function createZipArchive(options?: any) {
  if (ZipArchive) return new ZipArchive(options || { zlib: { level: 9 } });
  return new Archiver('zip', options || { zlib: { level: 9 } });
}

@Injectable()
export class TenantLifecycleService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private exportRoot() {
    const root = join(process.cwd(), 'exports', 'tenants');
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  async requestExport(tenantId: string, actorEmail: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    if (tenant.deletedAt) throw new BadRequestException('租户已软删除，无法导出');

    const job = await this.prisma.tenantExportJob.create({
      data: {
        tenantId,
        status: 'running',
        actorEmail,
        meta: { phase: 'collecting' },
      },
    });

    try {
      const data = await this.collectTenantData(tenantId);
      const fileName = `tenant-${tenant.code || tenantId}-${Date.now()}.zip`;
      const filePath = join(this.exportRoot(), fileName);

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath);
        const archive = createZipArchive({ zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', reject);
        archive.pipe(output);
        archive.append(JSON.stringify(data.manifest, null, 2), { name: 'manifest.json' });
        archive.append(JSON.stringify(data.organizations, null, 2), { name: 'organizations.json' });
        archive.append(JSON.stringify(data.capabilities, null, 2), { name: 'capabilities.json' });
        archive.append(JSON.stringify(data.outcomes, null, 2), { name: 'outcomes.json' });
        archive.append(JSON.stringify(data.demands, null, 2), { name: 'demands.json' });
        archive.append(JSON.stringify(data.matches, null, 2), { name: 'matches.json' });
        archive.append(JSON.stringify(data.users, null, 2), { name: 'users.json' });
        archive.append(JSON.stringify(data.reports, null, 2), { name: 'reports.json' });
        archive.append(JSON.stringify(data.checkoutSessions, null, 2), { name: 'checkout_sessions.json' });
        archive.append(
          `# 研企通租户数据导出\n\n租户：${tenant.name}（${tenant.id}）\n导出时间：${new Date().toISOString()}\n操作人：${actorEmail}\n\n本包用于个保法/GDPR 风格的数据可携。口令哈希已脱敏。\n`,
          { name: 'README.md' },
        );
        archive.finalize();
      });

      const stat = require('fs').statSync(filePath);
      const ready = await this.prisma.tenantExportJob.update({
        where: { id: job.id },
        data: {
          status: 'ready',
          filePath,
          fileSize: stat.size,
          readyAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          meta: { orgCount: data.organizations.length, fileName },
        },
      });
      await this.audit.log({
        action: 'tenant.export.ready',
        actor: actorEmail,
        targetType: 'Tenant',
        targetId: tenantId,
        meta: { jobId: job.id, fileSize: stat.size },
      });
      return ready;
    } catch (e: any) {
      await this.prisma.tenantExportJob.update({
        where: { id: job.id },
        data: { status: 'failed', error: String(e?.message || e) },
      });
      await this.audit.log({
        action: 'tenant.export.failed',
        actor: actorEmail,
        targetType: 'Tenant',
        targetId: tenantId,
        meta: { error: String(e?.message || e) },
      });
      throw e;
    }
  }

  private async collectTenantData(tenantId: string) {
    const orgs = await this.prisma.organization.findMany({ where: { tenantId } });
    const orgIds = orgs.map((o) => o.id);
    const [capabilities, outcomes, demands, users, matches, reports, checkoutSessions, branding] =
      await Promise.all([
        orgIds.length
          ? this.prisma.capability.findMany({ where: { orgId: { in: orgIds } } })
          : Promise.resolve([]),
        orgIds.length
          ? this.prisma.outcome.findMany({ where: { orgId: { in: orgIds } } })
          : Promise.resolve([]),
        orgIds.length
          ? this.prisma.demand.findMany({ where: { orgId: { in: orgIds } } })
          : Promise.resolve([]),
        this.prisma.user.findMany({
          where: { tenantId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            orgId: true,
            planCode: true,
            active: true,
            createdAt: true,
          },
        }),
        this.prisma.matchResult.findMany({ where: { tenantId }, take: 5000 }),
        this.prisma.analysisReport.findMany({ take: 200, orderBy: { createdAt: 'desc' } }),
        this.prisma.checkoutSession.findMany({ where: { tenantId } }),
        this.prisma.tenantBranding.findUnique({ where: { tenantId } }),
      ]);

    return {
      manifest: {
        tenantId,
        exportedAt: new Date().toISOString(),
        counts: {
          organizations: orgs.length,
          capabilities: capabilities.length,
          outcomes: outcomes.length,
          demands: demands.length,
          users: users.length,
          matches: matches.length,
        },
        branding,
      },
      organizations: orgs,
      capabilities,
      outcomes,
      demands,
      users,
      matches,
      reports,
      checkoutSessions,
    };
  }

  listExports(tenantId: string) {
    return this.prisma.tenantExportJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async getExportFile(jobId: string) {
    const job = await this.prisma.tenantExportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('导出任务不存在');
    if (job.status !== 'ready' || !job.filePath) throw new BadRequestException('导出尚未就绪');
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('导出已过期，请重新申请');
    }
    if (!existsSync(job.filePath)) throw new NotFoundException('导出文件丢失');
    return job;
  }

  /** 软删除：停用 + 生成确认令牌，24h 内可硬删 */
  async softDelete(tenantId: string, actorEmail: string) {
    if (tenantId === 'default') throw new ForbiddenException('默认租户不可删除');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    const token = randomBytes(24).toString('hex');
    const row = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        active: false,
        deletedAt: new Date(),
        deleteRequestedAt: new Date(),
        deleteConfirmToken: token,
        deleteConfirmExpires: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await this.audit.log({
      action: 'tenant.soft_delete',
      actor: actorEmail,
      targetType: 'Tenant',
      targetId: tenantId,
      meta: { code: tenant.code },
    });
    return {
      ok: true,
      tenant: { id: row.id, code: row.code, deletedAt: row.deletedAt },
      confirmToken: token,
      note: '已软删除。硬删除需在 24 小时内用 confirmToken 调用 hard-delete。请先导出数据。',
    };
  }

  async hardDelete(tenantId: string, confirmToken: string, actorEmail: string) {
    if (tenantId === 'default') throw new ForbiddenException('默认租户不可硬删除');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    if (!tenant.deletedAt) throw new BadRequestException('请先软删除');
    if (!tenant.deleteConfirmToken || tenant.deleteConfirmToken !== confirmToken) {
      throw new ForbiddenException('确认令牌无效');
    }
    if (tenant.deleteConfirmExpires && tenant.deleteConfirmExpires.getTime() < Date.now()) {
      throw new BadRequestException('确认令牌已过期，请重新软删除');
    }

    // 删除租户行级数据（组织级联能力/成果/需求）
    const orgs = await this.prisma.organization.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    await this.prisma.matchResult.deleteMany({ where: { tenantId } });
    if (orgIds.length) {
      await this.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    await this.prisma.user.deleteMany({ where: { tenantId, role: { not: 'ADMIN' as any } } });
    await this.prisma.checkoutSession.deleteMany({ where: { tenantId } });
    await this.prisma.crawlSchedule.deleteMany({ where: { tenantId } });
    await this.prisma.tenantExportJob.deleteMany({ where: { tenantId } });
    await this.prisma.tenantBranding.deleteMany({ where: { tenantId } });
    await this.prisma.tenant.delete({ where: { id: tenantId } });

    await this.audit.log({
      action: 'tenant.hard_delete',
      actor: actorEmail,
      targetType: 'Tenant',
      targetId: tenantId,
      meta: { code: tenant.code, orgCount: orgIds.length },
    });
    return { ok: true, message: '租户及其行级数据已硬删除', tenantId, orgCount: orgIds.length };
  }

  async restoreSoftDeleted(tenantId: string, actorEmail: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    if (!tenant.deletedAt) return { ok: true, message: '未处于软删状态', tenant };
    const row = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        active: true,
        deletedAt: null,
        deleteRequestedAt: null,
        deleteConfirmToken: null,
        deleteConfirmExpires: null,
      },
    });
    await this.audit.log({
      action: 'tenant.restore',
      actor: actorEmail,
      targetType: 'Tenant',
      targetId: tenantId,
    });
    return { ok: true, tenant: row };
  }

  /** 生成 DNS TXT 挑战 */
  async startDomainVerify(tenantId: string, actorEmail: string) {
    const branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!branding) throw new NotFoundException('白标不存在');
    if (!branding.customDomain) throw new BadRequestException('请先设置自定义域名');
    const token = randomBytes(16).toString('hex');
    const challenge = `yanqi-verify=${token}`;
    const row = await this.prisma.tenantBranding.update({
      where: { tenantId },
      data: {
        domainVerifyToken: token,
        domainChallenge: challenge,
        domainStatus: 'verifying',
        domainVerifiedAt: null,
      },
    });
    await this.audit.log({
      action: 'tenant.domain.challenge',
      actor: actorEmail,
      targetType: 'TenantBranding',
      targetId: row.id,
      meta: { domain: branding.customDomain, challenge },
    });
    return {
      ok: true,
      domain: branding.customDomain,
      recordType: 'TXT',
      host: `_yanqi-verify.${branding.customDomain}`,
      value: challenge,
      note: '请在域名 DNS 添加 TXT 记录。演示环境可点「模拟验域通过」。',
      branding: row,
    };
  }

  /** 模拟验域通过（无真实 DNS 查询） */
  async simulateDomainVerify(tenantId: string, actorEmail: string, body?: { pretendFound?: boolean }) {
    const branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!branding) throw new NotFoundException('白标不存在');
    if (!branding.domainVerifyToken) throw new BadRequestException('请先生成挑战记录');
    const found = body?.pretendFound !== false;
    if (!found) {
      const failed = await this.prisma.tenantBranding.update({
        where: { tenantId },
        data: { domainStatus: 'failed' },
      });
      await this.audit.log({
        action: 'tenant.domain.verify_failed',
        actor: actorEmail,
        targetType: 'TenantBranding',
        targetId: failed.id,
        meta: { stub: true },
      });
      return { ok: false, message: '模拟：未找到 TXT 记录', branding: failed };
    }
    const row = await this.prisma.tenantBranding.update({
      where: { tenantId },
      data: {
        domainStatus: 'active',
        domainVerifiedAt: new Date(),
      },
    });
    await this.audit.log({
      action: 'tenant.domain.verify_ok',
      actor: actorEmail,
      targetType: 'TenantBranding',
      targetId: row.id,
      meta: { stub: true, domain: row.customDomain },
    });
    return {
      ok: true,
      mode: 'simulate',
      message: '模拟验域通过（未真实查询 DNS）。生产需接 DNS API / dig。',
      branding: row,
    };
  }
}
