import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { basename } from 'path';
import { TenantsService, DEFAULT_TENANT_ID } from './tenants.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class TenantsController {
  constructor(
    private tenants: TenantsService,
    private life: TenantLifecycleService,
    private prisma: PrismaService,
  ) {}

  @Get('public/branding')
  async branding(@Query('tenantId') tenantId?: string, @Query('host') host?: string, @Req() req?: any) {
    const h = host || (req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').toString().split(':')[0];
    if (h) {
      const hit = await this.prisma.tenantBranding.findFirst({ where: { customDomain: h.toLowerCase() } });
      if (hit) return hit;
    }
    const tid = tenantId || req?.resolvedTenantId || DEFAULT_TENANT_ID;
    return this.tenants.branding(tid);
  }

  @Get('public/resolve-host')
  async resolveHost(@Query('host') host?: string, @Req() req?: any) {
    const h = (host || req?.headers?.host || '').toString().split(':')[0].toLowerCase();
    if (!h) return { tenantId: 'default', host: null, via: 'empty' };
    const byDomain = await this.prisma.tenantBranding.findFirst({
      where: { customDomain: h },
      include: { tenant: true },
    });
    if (byDomain) {
      return {
        tenantId: byDomain.tenantId,
        host: h,
        via: 'customDomain',
        branding: byDomain,
        domainStatus: byDomain.domainStatus,
        note: '生产需把域名 CNAME 到平台入口；开发可在 /etc/hosts 写 127.0.0.1 your.domain',
      };
    }
    const m = /^([a-z0-9_-]+)\.(yanqi\.local|localhost)$/.exec(h);
    if (m) {
      const t = await this.prisma.tenant.findUnique({ where: { code: m[1] }, include: { branding: true } });
      if (t) return { tenantId: t.id, host: h, via: 'subdomain', tenant: t };
    }
    return {
      tenantId: req?.resolvedTenantId || 'default',
      host: h,
      via: 'default',
      note: '未匹配自定义域名。开发示例：echo "127.0.0.1 demo.yanqi.local" | sudo tee -a /etc/hosts',
    };
  }

  @Get('tenants')
  list() {
    return this.tenants.list();
  }

  @Get('tenants/:id')
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Get('tenants/:id/quotas')
  quotas(@Param('id') id: string) {
    return this.tenants.effectiveQuotas(id);
  }

  @Post('tenants')
  create(@Body() body: any, @Req() req: any) {
    return this.tenants.createTenant(body || {}, req?.user?.email || 'ops');
  }

  @Patch('tenants/:id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.tenants.updateTenant(id, body || {}, req?.user?.email || 'ops');
  }

  @Patch('tenants/:id/branding')
  brandingUpdate(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.tenants.updateBranding(id, body || {}, req?.user?.email || 'ops');
  }

  // —— 数据导出 / 删除 ——
  @Post('tenants/:id/export')
  exportData(@Param('id') id: string, @Req() req: any) {
    return this.life.requestExport(id, req?.user?.email || 'ops');
  }

  @Get('tenants/:id/exports')
  listExports(@Param('id') id: string) {
    return this.life.listExports(id);
  }

  @Get('tenants/exports/:jobId/download')
  async downloadExport(@Param('jobId') jobId: string, @Res({ passthrough: true }) res: any) {
    const job = await this.life.getExportFile(jobId);
    const name = basename(job.filePath!);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    return new StreamableFile(createReadStream(job.filePath!));
  }

  @Post('tenants/:id/soft-delete')
  softDelete(@Param('id') id: string, @Req() req: any) {
    return this.life.softDelete(id, req?.user?.email || 'ops');
  }

  @Post('tenants/:id/hard-delete')
  hardDelete(
    @Param('id') id: string,
    @Body() body: { confirmToken?: string },
    @Req() req: any,
  ) {
    if (!body?.confirmToken) throw new BadRequestException('缺少 confirmToken');
    return this.life.hardDelete(id, body.confirmToken, req?.user?.email || 'ops');
  }

  @Post('tenants/:id/restore')
  restore(@Param('id') id: string, @Req() req: any) {
    return this.life.restoreSoftDeleted(id, req?.user?.email || 'ops');
  }

  // —— 域名验域 ——
  @Post('tenants/:id/domain/challenge')
  domainChallenge(@Param('id') id: string, @Req() req: any) {
    return this.life.startDomainVerify(id, req?.user?.email || 'ops');
  }

  @Post('tenants/:id/domain/verify-simulate')
  domainVerifySim(
    @Param('id') id: string,
    @Body() body: { pretendFound?: boolean },
    @Req() req: any,
  ) {
    return this.life.simulateDomainVerify(id, req?.user?.email || 'ops', body || {});
  }
}
