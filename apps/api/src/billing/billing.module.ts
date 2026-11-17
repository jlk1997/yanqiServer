import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CommonModule, NotificationsModule],
  controllers: [BillingController],
})
export class BillingModule {}
