import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { OrgsModule } from './orgs/orgs.module';
import { CapabilitiesModule } from './capabilities/capabilities.module';
import { OutcomesModule } from './outcomes/outcomes.module';
import { DemandsModule } from './demands/demands.module';
import { MatchesModule } from './matches/matches.module';
import { PeopleModule } from './people/people.module';
import { LeadsModule } from './leads/leads.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { InviteModule } from './invite/invite.module';
import { MailModule } from './mail/mail.module';
import { PlansModule } from './plans/plans.module';
import { ReportsModule } from './reports/reports.module';
import { SchedulesModule } from './schedules/schedules.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PortalModule } from './portal/portal.module';
import { BillingModule } from './billing/billing.module';
import { QualityModule } from './quality/quality.module';
import { FeedbackModule } from './feedback/feedback.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { BrokersModule } from './brokers/brokers.module';
import { TenantsModule } from './tenants/tenants.module';
import { ImportsModule } from './imports/imports.module';
import { EventsModule } from './events/events.module';
import { CommissionsModule } from './commissions/commissions.module';
import { ApiKeyMiddleware } from './auth/api-key.middleware';
import { RateLimitMiddleware } from './common/rate-limit.middleware';
import { CsrfMiddleware } from './common/csrf.middleware';
import { TenantHostMiddleware } from './common/tenant-host.middleware';
import { WafMiddleware } from './common/waf.middleware';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { IdempotencyMiddleware } from './common/idempotency.middleware';
import { ViewsModule } from './views/views.module';
import { SearchModule } from './search/search.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { LineageModule } from './lineage/lineage.module';
import { OpenApiModule } from './openapi/openapi.module';
import { FlagsModule } from './flags/flags.module';
import { QualityBadgesModule } from './quality-badges/quality-badges.module';
import { PlaybooksModule } from './playbooks/playbooks.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ChecklistsModule } from './checklists/checklists.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { TemplatesModule } from './templates/templates.module';
import { CasesModule } from './cases/cases.module';
import { FlywheelModule } from './flywheel/flywheel.module';
import { WorkbenchModule } from './workbench/workbench.module';
import { ObserveModule } from './observe/observe.module';
import { ParkModule } from './park/park.module';
import { IngestModule } from './ingest/ingest.module';
import { OutreachModule } from './outreach/outreach.module';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AuthModule,
    OrgsModule,
    CapabilitiesModule,
    OutcomesModule,
    DemandsModule,
    MatchesModule,
    PeopleModule,
    LeadsModule,
    JobsModule,
    AdminModule,
    InviteModule,
    MailModule,
    PlansModule,
    ReportsModule,
    SchedulesModule,
    NotificationsModule,
    PortalModule,
    BillingModule,
    QualityModule,
    FeedbackModule,
    IntegrationsModule,
    BrokersModule,
    TenantsModule,
    ImportsModule,
    EventsModule,
    CommissionsModule,
    MetricsModule,
    ViewsModule,
    SearchModule,
    WebhooksModule,
    LineageModule,
    OpenApiModule,
    FlagsModule,
    QualityBadgesModule,
    PlaybooksModule,
    ReviewsModule,
    ChecklistsModule,
    TaxonomyModule,
    TemplatesModule,
    CasesModule,
    FlywheelModule,
    WorkbenchModule,
    ObserveModule,
    ParkModule,
    IngestModule,
    OutreachModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware, WafMiddleware, TenantHostMiddleware, RateLimitMiddleware, IdempotencyMiddleware, CsrfMiddleware, ApiKeyMiddleware).forRoutes('*');
  }
}
