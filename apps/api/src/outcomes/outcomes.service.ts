import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { liveCardWhere } from '../common/record-face';
const { hashEmbed } = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));

@Injectable()
export class OutcomesService {
  constructor(private prisma: PrismaService) {}
  list(orgId?: string) {
    return this.prisma.outcome.findMany({
      where: orgId ? { orgId } : undefined,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
  listLive() {
    return this.prisma.outcome.findMany({
      where: liveCardWhere,
      include: { org: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
  }
  get(id: string) { return this.prisma.outcome.findUniqueOrThrow({ where: { id }, include: { org: true } }); }
  async create(data: any) {
    const text = [data.title, data.abstract, ...(data.ipcOrDisc||[])].join(' ');
    data.embedding = hashEmbed(text);
    return this.prisma.outcome.create({ data });
  }
  async update(id: string, data: any) {
    if (data.title || data.abstract || data.ipcOrDisc) {
      const cur = await this.get(id);
      const text = [data.title??cur.title, data.abstract??cur.abstract, ...((data.ipcOrDisc??cur.ipcOrDisc)||[])].join(' ');
      data.embedding = hashEmbed(text);
    }
    return this.prisma.outcome.update({ where: { id }, data });
  }
  remove(id: string) { return this.prisma.outcome.delete({ where: { id } }); }
}
