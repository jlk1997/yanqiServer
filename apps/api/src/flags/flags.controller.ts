import { Body, Controller, ForbiddenException, Get, Post, Query, Req } from '@nestjs/common';
import { FlagsService } from './flags.service';
import { FLAG_DEFAULTS, FLAG_KEYS } from './flags.defaults';

@Controller('flags')
export class FlagsController {
  constructor(private flags: FlagsService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.flags.listResolved(tenantId || 'default');
  }

  @Get('defaults')
  defaultsDoc() {
    return {
      ok: true,
      keys: FLAG_KEYS,
      defaults: FLAG_DEFAULTS,
      noteZh:
        '默认全开。改全局用 POST /api/flags/global；租户覆盖用 POST /api/flags/tenant。文档见 docs/功能开关-M16.md。',
    };
  }

  @Post('global')
  async setGlobal(
    @Body() body: { key: string; enabled: boolean; note?: string },
    @Req() req: any,
  ) {
    if (req.user?.role && req.user.role !== 'ADMIN' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅超管可改全局开关');
    }
    const row = await this.flags.setGlobal(body.key, Boolean(body.enabled), body.note);
    return { ok: true, row };
  }

  @Post('tenant')
  async setTenant(
    @Body() body: { tenantId?: string; key: string; enabled: boolean },
    @Req() req: any,
  ) {
    const role = req.user?.role;
    if (!req.authMeta?.hasKey && role !== 'ADMIN' && role !== 'OPERATOR' && role !== 'TENANT_ADMIN') {
      throw new ForbiddenException('无权改租户开关');
    }
    const tid = body.tenantId || req.user?.tenantId || 'default';
    if (role === 'TENANT_ADMIN' && tid !== (req.user?.tenantId || 'default') && !req.authMeta?.hasKey) {
      throw new ForbiddenException('机构管理员只能改本租户');
    }
    const row = await this.flags.setTenant(tid, body.key, Boolean(body.enabled));
    return { ok: true, tenantId: row.id, features: row.features };
  }

  @Post('tenant/clear')
  async clear(@Body() body: { tenantId?: string; key: string }, @Req() req: any) {
    if (req.user?.role && req.user.role !== 'ADMIN' && req.user.role !== 'OPERATOR' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可清除租户覆盖');
    }
    const row = await this.flags.clearTenantOverride(body.tenantId || 'default', body.key);
    return { ok: true, features: row.features };
  }
}
