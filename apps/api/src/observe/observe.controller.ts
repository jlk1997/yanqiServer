import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ObserveService } from './observe.service';

@Controller('observe')
export class ObserveController {
  constructor(private svc: ObserveService) {}

  /** 园区/政务观察板（登录用户可读；公开广场也可间接用） */
  @Get('park')
  park() {
    return this.svc.getParkBoard();
  }

  /** 运营维护政策/热度文案（CMS-lite） */
  @Put('park')
  save(@Body() body: any, @Req() req: any) {
    this.svc.assertOps(req);
    return this.svc.savePolicies(body || {}, req.user?.email || req.user?.uid || 'ops');
  }
}
