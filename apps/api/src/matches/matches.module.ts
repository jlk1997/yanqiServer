import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { FeedbackModule } from '../feedback/feedback.module';
import { QualityBadgesModule } from '../quality-badges/quality-badges.module';
import { OutreachModule } from '../outreach/outreach.module';

@Module({
  imports: [FeedbackModule, QualityBadgesModule, OutreachModule],
  controllers: [MatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
