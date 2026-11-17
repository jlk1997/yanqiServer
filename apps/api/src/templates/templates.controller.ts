import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private svc: TemplatesService) {}

  private assertOps(req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可维护模板');
    }
  }

  @Get()
  list(@Query('kind') kind?: string) {
    return this.svc.list(kind);
  }

  @Post('seed')
  seed(@Req() req: any) {
    this.assertOps(req);
    return this.svc.ensureSeed();
  }

  @Get('drafts')
  drafts(@Query('matchId') matchId?: string) {
    return this.svc.listDrafts(matchId);
  }

  @Get('drafts/:id')
  draft(@Param('id') id: string) {
    return this.svc.getDraft(id);
  }

  @Get('drafts/:id/download.md')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { draft } = await this.svc.getDraft(id);
    const code = (draft as any).template?.code || 'draft';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${code}-${id.slice(0, 8)}.md"`);
    res.send(draft.bodyMd);
  }

  @Get('context/:matchId')
  context(@Param('matchId') matchId: string) {
    return this.svc.contextFromMatch(matchId);
  }

  @Put()
  upsert(@Body() body: any, @Req() req: any) {
    this.assertOps(req);
    return this.svc.upsert(body || {}, req.user?.email || 'ops');
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    this.assertOps(req);
    return this.svc.remove(id, req.user?.email || 'ops');
  }

  @Post('generate')
  generate(@Body() body: any, @Req() req: any) {
    return this.svc.generate({
      templateId: body?.templateId,
      code: body?.code,
      matchId: body?.matchId,
      vars: body?.vars,
      actor: req.user?.email || 'ops',
    });
  }
}
