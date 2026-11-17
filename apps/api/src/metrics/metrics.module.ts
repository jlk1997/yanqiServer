import { Global, Module, forwardRef } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { AlertsService } from './alerts.service';
import { MailModule } from '../mail/mail.module';
import { MatchesModule } from '../matches/matches.module';

@Global()
@Module({
  imports: [MailModule, forwardRef(() => MatchesModule)],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware, AlertsService],
  exports: [MetricsService, MetricsMiddleware, AlertsService],
})
export class MetricsModule {}
