import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { OutcomesService } from './outcomes.service';
import { assertCanAccessOrgRecord, assertCanMutateOrg, scopedOrgId } from '../auth/scope';
import { cardLive, publicCard, stripVector, viewerKind } from '../common/record-face';

@Controller('outcomes')
export class OutcomesController {
  constructor(private svc: OutcomesService) {}
  @Get()
  list(@Req() req: any, @Query('orgId') orgId?: string) {
    const kind = viewerKind(req);
    if (kind === 'broker') return this.svc.listLive().then((rows) => rows.map(publicCard));
    const rows = this.svc.list(scopedOrgId(req, orgId));
    if (kind === 'ops') return rows;
    return rows.then((list) => list.map(stripVector));
  }
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const row = await this.svc.get(id);
    const kind = viewerKind(req);
    if (kind === 'broker') {
      if (!cardLive(row)) throw new NotFoundException('档案不存在');
      return publicCard(row);
    }
    assertCanAccessOrgRecord(req, row.orgId);
    return kind === 'ops' ? row : stripVector(row);
  }
  @Post()
  create(@Req() req: any, @Body() body: any) {
    const orgId = scopedOrgId(req, body.orgId);
    assertCanMutateOrg(req, orgId!);
    return this.svc.create({ ...body, orgId });
  }
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const cur = await this.svc.get(id);
    assertCanMutateOrg(req, cur.orgId);
    return this.svc.update(id, body);
  }
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const cur = await this.svc.get(id);
    assertCanMutateOrg(req, cur.orgId);
    return this.svc.remove(id);
  }
}
