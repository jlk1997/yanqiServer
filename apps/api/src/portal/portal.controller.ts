import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { PortalService } from './portal.service';
import { verifyToken } from '../auth/token';

function uidOf(req: any): string | null {
  if (req.user?.uid) return req.user.uid;
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const payload = verifyToken(auth.slice(7));
    if (payload) {
      req.user = payload;
      return payload.uid;
    }
  }
  const cookie = req.headers?.cookie || '';
  const m = /yanqi_token=([^;]+)/.exec(cookie);
  if (m) {
    const payload = verifyToken(decodeURIComponent(m[1]));
    if (payload) {
      req.user = payload;
      return payload.uid;
    }
  }
  return null;
}

@Controller()
export class PortalController {
  constructor(private portal: PortalService) {}

  @Get('public/home')
  home() {
    return this.portal.publicHome();
  }

  @Get('public/outcomes')
  outcomes(@Query('q') q?: string) {
    return this.portal.publicOutcomes(q);
  }

  @Get('public/demands')
  demands(@Query('q') q?: string) {
    return this.portal.publicDemands(q);
  }

  @Get('public/capabilities')
  capabilities(@Query('q') q?: string) {
    return this.portal.publicCapabilities(q);
  }

  @Get('public/matches')
  matches(@Query('q') q?: string) {
    return this.portal.publicMatches(q);
  }

  @Get('portal/workspace')
  workspace(@Req() req: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录门户' };
    return this.portal.workspace(uid);
  }

  @Post('portal/claim-org')
  claim(@Req() req: any, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.claimOrg(uid, body || {});
  }

  @Patch('portal/my-org')
  patchOrg(@Req() req: any, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.updateMyOrg(uid, body || {});
  }

  @Post('portal/capabilities')
  createCap(@Req() req: any, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.createCapability(uid, body);
  }

  @Patch('portal/capabilities/:id')
  updateCap(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.updateCapability(uid, id, body);
  }

  @Delete('portal/capabilities/:id')
  delCap(@Req() req: any, @Param('id') id: string) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.removeCapability(uid, id);
  }

  @Post('portal/outcomes')
  createOut(@Req() req: any, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.createOutcome(uid, body);
  }

  @Patch('portal/outcomes/:id')
  updateOut(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.updateOutcome(uid, id, body);
  }

  @Delete('portal/outcomes/:id')
  delOut(@Req() req: any, @Param('id') id: string) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.removeOutcome(uid, id);
  }

  @Post('portal/demands')
  createDem(@Req() req: any, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.createDemand(uid, body);
  }

  @Post('portal/demands/parse-one-line')
  parseOneLine(@Req() req: any, @Body() body: { text?: string }) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.parseOneLineDemand(body?.text || '');
  }

  @Post('portal/demands/publish-one-line')
  publishOneLine(@Req() req: any, @Body() body: { text?: string; force?: boolean }) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.publishOneLineDemand(uid, body?.text || '', { force: Boolean(body?.force) });
  }

  @Patch('portal/demands/:id')
  updateDem(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.updateDemand(uid, id, body);
  }

  @Delete('portal/demands/:id')
  delDem(@Req() req: any, @Param('id') id: string) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.removeDemand(uid, id);
  }

  @Get('portal/matches/:id/timeline')
  matchTimeline(@Req() req: any, @Param('id') id: string) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.matchTimeline(uid, id);
  }

  @Get('portal/usage')
  usage(@Req() req: any) {
    const uid = req.user?.uid;
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.myUsage(uid);
  }

  @Get('portal/my-deals')
  myDeals(@Req() req: any) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.myDeals(uid);
  }

  @Post('portal/my-deals/:id/action')
  dealAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { action: string; note?: string; force?: boolean },
  ) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.orgDealAction(uid, id, body?.action, body?.note, Boolean(body?.force));
  }

  @Post('portal/my-deals/:id/move')
  moveDeal(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { toColumn: string; note?: string; force?: boolean },
  ) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.moveDealColumn(uid, id, body?.toColumn, body?.note, Boolean(body?.force));
  }

  @Get('portal/my-deals/:id/checklist')
  dealChecklist(@Req() req: any, @Param('id') id: string) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.dealChecklist(uid, id);
  }

  @Post('portal/my-deals/:id/checklist/:code')
  toggleChecklist(
    @Req() req: any,
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() body: { done?: boolean; note?: string },
  ) {
    const uid = uidOf(req);
    if (!uid) return { ok: false, message: '请先登录' };
    return this.portal.toggleDealChecklist(uid, id, code, body || {});
  }

  @Post('portal/validate/demand')
  validateDem(@Body() body: any) {
    try {
      return { ok: true, data: this.portal.validateDemand(body || {}) };
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e) };
    }
  }

  @Post('portal/validate/capability')
  validateCap(@Body() body: any) {
    try {
      return { ok: true, data: this.portal.validateCapability(body || {}) };
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e) };
    }
  }

  @Post('portal/validate/outcome')
  validateOut(@Body() body: any) {
    try {
      return { ok: true, data: this.portal.validateOutcome(body || {}) };
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e) };
    }
  }
}

