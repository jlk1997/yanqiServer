import { Body, Controller, Post, Req } from '@nestjs/common';
import { InviteService } from './invite.service';
import { clientIp } from '../common/rate-limit';

@Controller('public/invite')
export class InviteController {
  constructor(private svc: InviteService) {}

  @Post('claim')
  claim(@Body() body: any, @Req() req: any) {
    return this.svc.claim(body || {}, clientIp(req));
  }
}
