import { BadRequestException, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ViewsService {
  constructor(private prisma: PrismaService) {}

  list(scope = 'matches', userId?: string, tenantId = 'default') {
    return this.prisma.savedView.findMany({
      where: {
        scope,
        tenantId,
        OR: [{ userId: null }, ...(userId ? [{ userId }] : [])],
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async create(opts: {
    name: string;
    scope?: string;
    query: any;
    userId?: string | null;
    tenantId?: string;
    isDefault?: boolean;
  }) {
    const name = String(opts.name || '').trim();
    if (name.length < 1) throw new BadRequestException('视图名称不能为空');
    if (opts.isDefault && opts.userId) {
      await this.prisma.savedView.updateMany({
        where: { userId: opts.userId, scope: opts.scope || 'matches' },
        data: { isDefault: false },
      });
    }
    return this.prisma.savedView.create({
      data: {
        name,
        scope: opts.scope || 'matches',
        query: opts.query || {},
        userId: opts.userId || null,
        tenantId: opts.tenantId || 'default',
        isDefault: !!opts.isDefault,
      },
    });
  }

  async update(id: string, userId: string | undefined, body: any, isOps: boolean) {
    const row = await this.prisma.savedView.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('视图不存在');
    if (row.userId && userId && row.userId !== userId && !isOps) {
      throw new ForbiddenException('只能改自己的视图');
    }
    const data: any = {};
    if (body.name != null) data.name = String(body.name).trim();
    if (body.query != null) data.query = body.query;
    if (body.isDefault != null) data.isDefault = !!body.isDefault;
    if (data.isDefault && (row.userId || userId)) {
      await this.prisma.savedView.updateMany({
        where: { userId: row.userId || userId!, scope: row.scope, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return this.prisma.savedView.update({ where: { id }, data });
  }

  async remove(id: string, userId: string | undefined, isOps: boolean) {
    const row = await this.prisma.savedView.findUnique({ where: { id } });
    if (!row) return { ok: true };
    if (row.userId && userId && row.userId !== userId && !isOps) {
      throw new ForbiddenException('只能删自己的视图');
    }
    await this.prisma.savedView.delete({ where: { id } });
    return { ok: true };
  }
}
