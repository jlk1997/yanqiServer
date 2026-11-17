import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get('me')
  async me(@Req() req: any) {
    const uid = req.user?.uid;
    if (!uid) return { items: [], unread: 0 };
    const [items, unread] = await Promise.all([
      this.notifications.listForUser(uid),
      this.notifications.unreadCount(uid),
    ]);
    return { items, unread };
  }

  @Post('me/read-all')
  readAll(@Req() req: any) {
    if (!req.user?.uid) return { ok: false };
    return this.notifications.markAllRead(req.user.uid);
  }

  @Post(':id/read')
  read(@Param('id') id: string, @Req() req: any) {
    return this.notifications.markRead(id, req.user?.uid);
  }

  @Post('broadcast')
  broadcast(@Body() body: { title: string; body: string; level?: string }, @Req() req: any) {
    if (req.user?.role && !['ADMIN', 'OPERATOR'].includes(req.user.role) && !req.authMeta?.hasKey) {
      return { ok: false, message: '仅运营可广播' };
    }
    return this.notifications.broadcast(body.title, body.body, body.level);
  }

  @Post('stub')
  stub(
    @Body() body: { userId?: string; email?: string; title: string; body: string; link?: string },
    @Req() req: any,
  ) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '仅运营可测通知桩' };
    }
    return this.notifications.notifyChannels(body);
  }
}
