import { Module } from '@nestjs/common';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PlansModule } from '../plans/plans.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChecklistsModule } from '../checklists/checklists.module';
import { FlywheelModule } from '../flywheel/flywheel.module';

@Module({
  imports: [PlansModule, NotificationsModule, ChecklistsModule, FlywheelModule],
  providers: [PortalService],
  controllers: [PortalController],
})
export class PortalModule {}
