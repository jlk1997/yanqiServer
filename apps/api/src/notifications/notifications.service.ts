import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  listForUser(userId: string, take = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, count: r.count };
  }

  async broadcast(title: string, body: string, level = 'info') {
    const users = await this.prisma.user.findMany({ where: { active: true }, select: { id: true } });
    if (!users.length) return { count: 0 };
    await this.prisma.notification.createMany({
      data: users.map((u) => ({ userId: u.id, title, body, level })),
    });
    return { count: users.length };
  }

  create(userId: string, title: string, body: string, link?: string, level = 'info') {
    const ops = process.env.OPS_DISPLAY_NAME || process.env.MAIL_FROM_NAME || '小蚁';
    const brandedBody = body.includes(ops) ? body : `${body}\n\n— ${ops} · 研企通`;
    return this.prisma.notification.create({
      data: { userId, title, body: brandedBody, link, level },
    });
  }

  /** 邮件/站内双通道桩：总是写站内；邮件仅记 JobLog */
  async notifyChannels(opts: {
    userId?: string;
    email?: string;
    title: string;
    body: string;
    link?: string;
    channels?: Array<'in_app' | 'email'>;
  }) {
    const channels = opts.channels || ['in_app', 'email'];
    const result: any = { in_app: null, email: null };
    if (channels.includes('in_app') && opts.userId) {
      result.in_app = await this.create(opts.userId, opts.title, opts.body, opts.link);
    }
    if (channels.includes('email')) {
      result.email = await this.prisma.jobLog.create({
        data: {
          queue: 'notify',
          jobName: 'email_stub',
          payload: {
            to: opts.email || null,
            userId: opts.userId || null,
            title: opts.title,
            body: opts.body,
            link: opts.link,
            mode: process.env.SMTP_MODE || 'draft_only',
          } as any,
          status: 'stub',
          message: opts.email
            ? `邮件通知桩（署名 小蚁/研企通）：将发给 ${opts.email}（未真发）`
            : '邮件通知桩（署名 小蚁/研企通）：无收件人，仅记日志',
        },
      });
    }
    return { ok: true, result };
  }
}
