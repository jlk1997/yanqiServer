import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { matchShareBlock, publicPerson } from '../common/record-face';

function personBlocked(row: any) {
  const ext = row?.extensions && typeof row.extensions === 'object' ? row.extensions : {};
  return Boolean(ext.quarantine) || ext.source === 'demo' || ext.source === 'demo_fixture';
}

@Injectable()
export class PeopleService {
  constructor(private prisma: PrismaService) {}
  list(orgId?: string) {
    return this.prisma.person.findMany({
      where: orgId ? { orgId } : undefined,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
  get(id: string) {
    return this.prisma.person.findUniqueOrThrow({ where: { id }, include: { org: true } });
  }

  async listForBroker(brokerId: string) {
    const ids = await this.brokerPersonIds(brokerId);
    if (!ids.length) return [];
    const rows = await this.prisma.person.findMany({
      where: { id: { in: ids } },
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.filter((row) => !personBlocked(row)).map((row) => publicPerson(row, true));
  }

  async getForBroker(brokerId: string, id: string) {
    const ids = await this.brokerPersonIds(brokerId);
    if (!ids.includes(id)) throw new NotFoundException('联系人不存在');
    const row = await this.get(id);
    if (personBlocked(row)) throw new NotFoundException('联系人不存在');
    return publicPerson(row, true);
  }

  private async brokerPersonIds(brokerId: string) {
    const matches = await this.prisma.matchResult.findMany({
      where: { brokerId },
      include: {
        demand: true,
        capability: true,
        outcome: true,
      },
    });
    const ids = new Set<string>();
    for (const match of matches) {
      if (matchShareBlock(match)) continue;
      if (match.primaryPersonId) ids.add(match.primaryPersonId);
      if (match.capability?.personId) ids.add(match.capability.personId);
      if (match.outcome?.personId) ids.add(match.outcome.personId);
    }
    return [...ids];
  }
  create(data: any) {
    return this.prisma.person.create({ data });
  }
  update(id: string, data: any) {
    return this.prisma.person.update({ where: { id }, data });
  }
  remove(id: string) {
    return this.prisma.person.delete({ where: { id } });
  }
}
