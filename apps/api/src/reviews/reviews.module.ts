import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { CommonModule } from '../common/common.module';
import { QualityBadgesModule } from '../quality-badges/quality-badges.module';

@Module({
  imports: [CommonModule, QualityBadgesModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
