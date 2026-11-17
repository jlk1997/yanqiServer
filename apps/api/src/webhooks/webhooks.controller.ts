import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

function assertOps(req: any) {
  const role = req.user?.role;
  if (req.authMeta?.hasKey) return;
  if (role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER' || role === 'TENANT_ADMIN') return;
  throw new ForbiddenException('需要运营身份');
}

function assertWriteOps(req: any) {
  const role = req.user?.role;
  if (req.authMeta?.hasKey) return;
  if (role === 'ADMIN' || role === 'OPERATOR') return;
  throw new ForbiddenException('需要管理员/运营写权限');
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private svc: WebhooksService) {}

  @Get('status')
  status() {
    return this.svc.status();
  }

  @Get('deliveries')
  list(@Query('take') take: string | undefined, @Req() req: any) {
    assertOps(req);
    return this.svc.listDeliveries(take ? Number(take) : 40);
  }

  @Get('endpoints')
  endpoints(@Req() req: any) {
    assertWriteOps(req);
    return this.svc.listEndpoints();
  }

  @Post('retry-due')
  retryDue(@Body() body: { limit?: number }, @Req() req: any) {
    assertWriteOps(req);
    return this.svc.retryDue(body?.limit ?? 10);
  }

  @Post('deliveries/:id/retry')
  retryOne(@Param('id') id: string, @Req() req: any) {
    assertWriteOps(req);
    return this.svc.retryOne(id);
  }

  @Post('self-test')
  selfTest(@Req() req: any) {
    assertWriteOps(req);
    return this.svc.selfTest();
  }

  @Post('emit')
  emit(@Body() body: { event: string; payload?: Record<string, any>; tenantId?: string }, @Req() req: any) {
    assertWriteOps(req);
    return this.svc.emit(body?.event || 'manual.test', body?.payload || {}, body?.tenantId || 'default');
  }
}
