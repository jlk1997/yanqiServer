import { Module } from '@nestjs/common';
import { ObserveController } from './observe.controller';
import { ObserveService } from './observe.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [ObserveController],
  providers: [ObserveService],
  exports: [ObserveService],
})
export class ObserveModule {}
