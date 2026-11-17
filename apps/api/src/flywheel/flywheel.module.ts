import { Module } from '@nestjs/common';
import { FlywheelService } from './flywheel.service';
import { FlywheelController } from './flywheel.controller';
import { QualityModule } from '../quality/quality.module';
import { ReportsModule } from '../reports/reports.module';
import { JobsModule } from '../jobs/jobs.module';
import { MatchesModule } from '../matches/matches.module';
import { IngestModule } from '../ingest/ingest.module';

@Module({
  imports: [QualityModule, ReportsModule, JobsModule, MatchesModule, IngestModule],
  controllers: [FlywheelController],
  providers: [FlywheelService],
  exports: [FlywheelService],
})
export class FlywheelModule {}
