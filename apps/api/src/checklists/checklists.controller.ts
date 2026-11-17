import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ChecklistsService, CHECKLIST_TEMPLATE } from './checklists.service';

@Controller('checklists')
export class ChecklistsController {
  constructor(private svc: ChecklistsService) {}

  @Get('template')
  template() {
    return { ok: true, items: CHECKLIST_TEMPLATE };
  }

  @Get('by-match/:matchId')
  byMatch(@Param('matchId') matchId: string) {
    return this.svc.summary(matchId);
  }

  @Post('by-match/:matchId/ensure')
  ensure(@Param('matchId') matchId: string) {
    return this.svc.ensureForMatch(matchId);
  }

  @Post('by-match/:matchId/items/:code')
  setItem(
    @Param('matchId') matchId: string,
    @Param('code') code: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const actor = req.user?.email || body?.actor || 'ops';
    return this.svc.setItem(matchId, code, { ...body, actor });
  }

  @Get('by-match/:matchId/gate-intent')
  gate(@Param('matchId') matchId: string, @Query('force') force?: string) {
    return this.svc.gateIntent(matchId, force === '1' || force === 'true');
  }
}
