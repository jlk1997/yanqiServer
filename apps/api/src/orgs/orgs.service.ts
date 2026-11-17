import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrgType, Prisma } from '@prisma/client';
import { liveCardWhere } from '../common/record-face';

@Injectable()
export class OrgsService {
  constructor(private prisma: PrismaService) {}
  list(q?: { type?: OrgType; search?: string; orgId?: string; tenantId?: string }) {
    const where: Prisma.OrganizationWhereInput = {};
    if (q?.type) where.type = q.type;
    if (q?.search) where.name = { contains: q.search, mode: 'insensitive' };
    if (q?.orgId) where.id = q.orgId;
    if (q?.tenantId) where.tenantId = q.tenantId;
    return this.prisma.organization.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { capabilities: true, outcomes: true, demands: true, people: true } } },
    });
  }
  async listPublic(tenantId?: string) {
    const rows = await this.prisma.organization.findMany({
      where: { ...liveCardWhere, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, name: true, type: true, region: true, summaryPublic: true, publishStatus: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      region: row.region,
      summary: row.summaryPublic || null,
      publishStatus: row.publishStatus,
    }));
  }
  get(id: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id },
      include: { capabilities: true, outcomes: true, demands: true, people: true },
    });
  }
  create(data: Prisma.OrganizationCreateInput) {
    return this.prisma.organization.create({ data });
  }
  update(id: string, data: Prisma.OrganizationUpdateInput) {
    return this.prisma.organization.update({ where: { id }, data });
  }
  remove(id: string) {
    return this.prisma.organization.delete({ where: { id } });
  }
}
