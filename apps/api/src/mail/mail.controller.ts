import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { MailService } from './mail.service';

@Controller('mail')
export class MailController {
  constructor(private mail: MailService) {}

  @Get('smtp/status')
  status() {
    return { ok: true, smtp: this.mail.getCachedHealth() };
  }

  @Post('smtp/verify')
  async verify(@Req() req: any) {
    const actor = req.user?.email || req.user?.uid || 'ops';
    const smtp = await this.mail.verifySmtp(actor);
    return {
      ok: smtp.reachable === true,
      smtp,
      message: smtp.reachable ? 'SMTP 握手成功' : smtp.lastErrorZh || 'SMTP 不可达',
    };
  }

  @Post('smtp/self-test')
  async selfTest(@Req() req: any, @Body() body: { confirmLive?: boolean }) {
    const actor = req.user?.email || req.user?.uid || 'ops';
    return this.mail.sendSelfTest(actor, body?.confirmLive === true);
  }

  @Get('templates')
  templates() {
    return { ok: true, items: this.mail.listTemplates() };
  }

  @Post('templates/preview')
  preview(@Body() body: { kind?: string; vars?: Record<string, string> }) {
    const kind = body?.kind || 'match_ready';
    return this.mail.previewTemplate(kind, body?.vars || {});
  }

  @Post('templates/apply-to-lead')
  apply(@Req() req: any, @Body() body: { leadId: string; kind?: string; vars?: Record<string, string> }) {
    const actor = req.user?.email || req.user?.uid || 'ops';
    return this.mail.applyTemplateToLead(body.leadId, body?.kind || 'match_ready', body?.vars || {}, actor);
  }
}
