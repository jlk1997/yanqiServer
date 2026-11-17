import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantsController } from './tenants.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  providers: [TenantsService, TenantLifecycleService],
  controllers: [TenantsController],
  exports: [TenantsService, TenantLifecycleService],
})
export class TenantsModule {}
