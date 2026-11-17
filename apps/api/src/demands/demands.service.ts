import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { liveCardWhere } from '../common/record-face';
const { hashEmbed } = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

@Injectable()
export class DemandsService {
  constructor(private prisma: PrismaService) {}
  list(orgId?: string) {
    return this.prisma.demand.findMany({
      where: orgId ? { orgId } : undefined,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
  listLive() {
    return this.prisma.demand.findMany({
      where: liveCardWhere,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
  }
  get(id: string) { return this.prisma.demand.findUniqueOrThrow({ where: { id }, include: { org: true, matches: true } }); }
  async create(data: any) {
    const text = [data.title, data.problem, data.expectedOut, ...(data.industry||[])].join(' ');
    data.embedding = hashEmbed(text);
    return this.prisma.demand.create({ data });
  }
  async update(id: string, data: any) {
    if (data.title || data.problem || data.industry) {
      const cur = await this.get(id);
      const text = [data.title??cur.title, data.problem??cur.problem, data.expectedOut??cur.expectedOut, ...((data.industry??cur.industry)||[])].join(' ');
      data.embedding = hashEmbed(text);
    }
    return this.prisma.demand.update({ where: { id }, data });
  }
  remove(id: string) { return this.prisma.demand.delete({ where: { id } }); }
}
