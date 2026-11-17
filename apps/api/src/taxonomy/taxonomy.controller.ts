import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';

@Controller('taxonomy')
export class TaxonomyController {
  constructor(private svc: TaxonomyService) {}

  @Get()
  list(
    @Query('parent') parent?: string,
    @Query('q') q?: string,
    @Query('tree') tree?: string,
  ) {
    return this.svc.list({ parent, q, tree: tree === '1' || tree === 'true' });
  }

  @Post('seed')
  seed(@Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可触发种子');
    }
    return this.svc.ensureSeed();
  }

  @Post('tag/:kind/:id')
  tag(@Param('kind') kind: string, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      // 门户走 portal 代理；这里挡一下裸打
      throw new ForbiddenException('请从门户或运营工作台打标签');
    }
    const actor = req.user?.email || 'ops';
    return this.svc.tagCard(kind, id, body?.codes || body?.taxonomyCodes || [], actor);
  }

  @Get('search/:code')
  search(@Param('code') code: string, @Query('take') take?: string) {
    return this.svc.searchByTag(code, take ? Number(take) : 30);
  }
}
