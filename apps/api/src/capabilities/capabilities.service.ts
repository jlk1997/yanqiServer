import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { liveCardWhere } from '../common/record-face';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hashEmbed } = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

@Injectable()
export class CapabilitiesService {
  constructor(private prisma: PrismaService) {}
  list(orgId?: string) {
    return this.prisma.capability.findMany({
      where: orgId ? { orgId } : undefined,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
  listLive() {
    return this.prisma.capability.findMany({
      where: liveCardWhere,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
  }
  get(id: string) { return this.prisma.capability.findUniqueOrThrow({ where: { id }, include: { org: true } }); }
  async create(data: any) {
    const text = [data.title, data.summary, ...(data.keywords||[]), ...(data.disciplines||[])].join(' ');
    data.embedding = hashEmbed(text);
    return this.prisma.capability.create({ data });
  }
  async update(id: string, data: any) {
    if (data.title || data.summary || data.keywords || data.disciplines) {
      const cur = await this.get(id);
      const text = [data.title??cur.title, data.summary??cur.summary, ...((data.keywords??cur.keywords)||[]), ...((data.disciplines??cur.disciplines)||[])].join(' ');
      data.embedding = hashEmbed(text);
    }
    return this.prisma.capability.update({ where: { id }, data });
  }
  remove(id: string) { return this.prisma.capability.delete({ where: { id } }); }
}
