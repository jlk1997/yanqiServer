import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private integrations: IntegrationsService) {}

  @Get()
  list() {
    return this.integrations.list().then((rows) => rows.map((r) => this.integrations.safe(r)));
  }

  @Put(':provider')
  upsert(@Param('provider') provider: string, @Body() body: any, @Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '仅运营可改集成配置' };
    }
    return this.integrations.upsert(provider, body || {});
  }

  @Post(':provider/probe')
  probe(@Param('provider') provider: string) {
    return this.integrations.probe(provider);
  }

  @Post(':provider/dry-run')
  dryRun(@Param('provider') provider: string, @Body() body: any) {
    return this.integrations.dryRunSend(provider, body || {});
  }
}
