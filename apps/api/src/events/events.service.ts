import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(tenantId?: string) {
    return this.prisma.roadshowEvent.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { eventDate: 'desc' },
      take: 100,
    });
  }

  async get(id: string) {
    const row = await this.prisma.roadshowEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('活动不存在');
    const orgs = row.orgIds?.length
      ? await this.prisma.organization.findMany({
          where: { id: { in: row.orgIds } },
          select: { id: true, name: true, type: true, region: true },
        })
      : [];
    const matches = row.matchIds?.length
      ? await this.prisma.matchResult.findMany({
          where: { id: { in: row.matchIds } },
          include: {
            demand: { select: { title: true } },
            capability: { select: { title: true } },
            outcome: { select: { title: true } },
          },
        })
      : [];
    return { ...row, orgs, matches };
  }

  async create(
    body: {
      title: string;
      description?: string;
      eventDate: string;
      location?: string;
      tenantId?: string;
      orgIds?: string[];
      matchIds?: string[];
      hostOrgId?: string;
      contactNote?: string;
      status?: string;
    },
    actor = 'ops',
  ) {
    if (!body.title?.trim()) throw new BadRequestException('标题必填');
    if (!body.eventDate) throw new BadRequestException('活动日期必填');
    const row = await this.prisma.roadshowEvent.create({
      data: {
        title: body.title.trim(),
        description: body.description || null,
        eventDate: new Date(body.eventDate),
        location: body.location || null,
        tenantId: body.tenantId || 'default',
        orgIds: body.orgIds || [],
        matchIds: body.matchIds || [],
        hostOrgId: body.hostOrgId || null,
        contactNote: body.contactNote || null,
        status: body.status || 'draft',
      },
    });
    await this.audit.log({
      action: 'roadshow.create',
      actor,
      targetType: 'RoadshowEvent',
      targetId: row.id,
      meta: { title: row.title, eventDate: row.eventDate },
    });
    return row;
  }

  async update(id: string, body: any, actor = 'ops') {
    const data: any = {};
    for (const k of [
      'title',
      'description',
      'location',
      'status',
      'contactNote',
      'hostOrgId',
      'orgIds',
      'matchIds',
      'tenantId',
    ]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.eventDate) data.eventDate = new Date(body.eventDate);
    const row = await this.prisma.roadshowEvent.update({ where: { id }, data });
    await this.audit.log({
      action: 'roadshow.update',
      actor,
      targetType: 'RoadshowEvent',
      targetId: id,
      meta: { status: row.status },
    });
    return row;
  }

  async remove(id: string, actor = 'ops') {
    await this.prisma.roadshowEvent.delete({ where: { id } });
    await this.audit.log({
      action: 'roadshow.delete',
      actor,
      targetType: 'RoadshowEvent',
      targetId: id,
    });
    return { ok: true };
  }
}
