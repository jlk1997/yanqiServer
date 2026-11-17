import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { SearchService } from './search.service';
import { requirePerm } from '../auth/scope';

@Controller('search')
export class SearchController {
  constructor(private search: SearchService) {}

  @Get()
  async unified(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('types') types?: string,
    @Query('take') take?: string,
    @Query('published') published?: string,
  ) {
    // 机构用户也可搜（结果仍受其它接口权限约束；此处返回标题级）
    if (req.user?.role === 'OPS_VIEWER' || req.authMeta?.isOps || req.authMeta?.hasKey || req.user) {
      /* ok */
    } else {
      requirePerm(req, 'ops.read');
    }
    const typeList = (types || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const publishedOnly = published === '1' || req.user?.role === 'ORG_USER';
    return this.search.unified(q || '', typeList, Math.min(20, Number(take) || 8), publishedOnly);
  }

  @Get('taxonomy/:code')
  byTaxonomy(@Param('code') code: string, @Query('take') take?: string) {
    return this.search.byTaxonomy(code, take ? Number(take) : 20);
  }
}
