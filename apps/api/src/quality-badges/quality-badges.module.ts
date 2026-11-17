import { Module } from '@nestjs/common';
import { QualityBadgesService } from './quality-badges.service';
import { QualityBadgesController } from './quality-badges.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [QualityBadgesController],
  providers: [QualityBadgesService],
  exports: [QualityBadgesService],
})
export class QualityBadgesModule {}
