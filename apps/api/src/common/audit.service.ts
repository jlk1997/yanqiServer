import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(input: {
    action: string;
    actor?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    ip?: string | null;
    meta?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        actor: input.actor || null,
        targetType: input.targetType || null,
        targetId: input.targetId || null,
        ip: input.ip || null,
        meta: (input.meta || {}) as any,
      },
    });
  }

  recent(limit = 50) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
