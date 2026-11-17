import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from './quota.service';

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService, private quota: QuotaService) {}

  list() {
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceMonthly: 'asc' } });
  }

  flags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async myQuota(userId: string) {
    const plan = await this.quota.planForUser(userId);
    const usage = await this.quota.usage(`user:${userId}`);
    return { plan, usage, period: this.quota.period() };
  }

  async setFlag(key: string, enabled: boolean, note?: string) {
    return this.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled, note },
      create: { key, enabled, note },
    });
  }

  metering(opts: { userId?: string; tenantId?: string }) {
    return this.quota.meteringSnapshot(opts);
  }
}
