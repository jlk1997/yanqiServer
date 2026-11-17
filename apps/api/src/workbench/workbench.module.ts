import { Module } from '@nestjs/common';
import { WorkbenchController } from './workbench.controller';
import { WorkbenchService } from './workbench.service';
import { BrokersModule } from '../brokers/brokers.module';
import { ObserveModule } from '../observe/observe.module';
import { ParkModule } from '../park/park.module';
import { CommissionsModule } from '../commissions/commissions.module';

@Module({
  imports: [BrokersModule, ObserveModule, ParkModule, CommissionsModule],
  controllers: [WorkbenchController],
  providers: [WorkbenchService],
})
export class WorkbenchModule {}
