import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { VectorService } from './vector.service';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { CsrfMiddleware } from './csrf.middleware';
import { TenantHostMiddleware } from './tenant-host.middleware';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService, VectorService, RateLimitMiddleware, CsrfMiddleware, TenantHostMiddleware],
  exports: [AuditService, VectorService, RateLimitMiddleware, CsrfMiddleware, TenantHostMiddleware],
})
export class CommonModule {}
