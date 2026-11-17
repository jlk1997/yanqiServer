import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { OrgType } from '@prisma/client';
import { assertCanMutateOrg, scopedOrgId, tenantFilter, assertCanAccessOrgRecord, isOps } from '../auth/scope';
import { cardLive, publicOrg, stripVector, viewerKind } from '../common/record-face';

@Controller('orgs')
export class OrgsController {
  constructor(private svc: OrgsService) {}

  @Get()
  list(@Req() req: any, @Query('type') type?: OrgType, @Query('search') search?: string) {
    const kind = viewerKind(req);
    const tf = tenantFilter(req);
    if (kind === 'broker') return this.svc.listPublic(tf.tenantId);
    const orgId = scopedOrgId(req, undefined);
    return this.svc.list({ type, search, orgId, tenantId: tf.tenantId });
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const row = await this.svc.get(id);
    const kind = viewerKind(req);
    if (kind === 'broker') {
      if (!cardLive(row)) throw new NotFoundException('组织不存在');
      return publicOrg(row);
    }
    assertCanAccessOrgRecord(req, row.id);
    return kind === 'ops' ? row : stripVector(row);
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    if (!isOps(req.user?.role) && !req.authMeta?.hasKey) {
      throw new ForbiddenException('机构请走门户注册/认领；运营后台才可直接建组织');
    }
    if (!body.tenantId) body.tenantId = 'default';
    return this.svc.create(body);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    assertCanMutateOrg(req, id);
    return this.svc.update(id, body);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    if (!isOps(req.user?.role) && !req.authMeta?.hasKey) {
      throw new ForbiddenException('仅运营可删除组织');
    }
    return this.svc.remove(id);
  }
}
