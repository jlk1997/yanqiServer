import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ViewsService } from './views.service';
import { isOps } from '../auth/scope';

@Controller('views')
export class ViewsController {
  constructor(private views: ViewsService) {}

  @Get()
  list(@Req() req: any, @Query('scope') scope?: string) {
    return this.views.list(scope || 'matches', req.user?.uid, req.user?.tenantId || 'default');
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.views.create({
      name: body?.name,
      scope: body?.scope || 'matches',
      query: body?.query || {},
      userId: req.user?.uid || null,
      tenantId: req.user?.tenantId || 'default',
      isDefault: !!body?.isDefault,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.views.update(id, req.user?.uid, body || {}, isOps(req.user?.role) || !!req.authMeta?.hasKey);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.views.remove(id, req.user?.uid, isOps(req.user?.role) || !!req.authMeta?.hasKey);
  }
}
