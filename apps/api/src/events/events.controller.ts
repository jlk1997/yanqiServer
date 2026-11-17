import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private events: EventsService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.events.list(tenantId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.events.get(id);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户不能创建路演活动' };
    }
    return this.events.create(body || {}, req?.user?.email || 'ops');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户不能改路演活动' };
    }
    return this.events.update(id, body || {}, req?.user?.email || 'ops');
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户不能删除路演活动' };
    }
    return this.events.remove(id, req?.user?.email || 'ops');
  }
}
