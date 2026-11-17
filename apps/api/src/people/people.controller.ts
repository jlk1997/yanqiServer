import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { PeopleService } from './people.service';
import { assertCanAccessOrgRecord, assertCanMutateOrg, scopedOrgId } from '../auth/scope';
import { stripVector, viewerKind } from '../common/record-face';

@Controller('people')
export class PeopleController {
  constructor(private svc: PeopleService) {}
  @Get()
  list(@Req() req: any, @Query('orgId') orgId?: string) {
    const kind = viewerKind(req);
    if (kind === 'broker') return this.svc.listForBroker(req.user?.uid);
    const rows = this.svc.list(scopedOrgId(req, orgId));
    if (kind === 'ops') return rows;
    return rows.then((list) => list.map(stripVector));
  }
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const kind = viewerKind(req);
    if (kind === 'broker') return this.svc.getForBroker(req.user?.uid, id);
    const row = await this.svc.get(id);
    assertCanAccessOrgRecord(req, row.orgId);
    return kind === 'ops' ? row : stripVector(row);
  }
  @Post()
  create(@Req() req: any, @Body() body: any) {
    const orgId = scopedOrgId(req, body.orgId);
    if (orgId) assertCanMutateOrg(req, orgId);
    return this.svc.create({ ...body, orgId });
  }
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const cur = await this.svc.get(id);
    if (cur.orgId) assertCanMutateOrg(req, cur.orgId);
    return this.svc.update(id, body);
  }
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const cur = await this.svc.get(id);
    if (cur.orgId) assertCanMutateOrg(req, cur.orgId);
    return this.svc.remove(id);
  }
}
