import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { LineageService } from './lineage.service';
import { OpsOnlyGuard } from '../common/ops-only.guard';

@Controller('lineage')
@UseGuards(OpsOnlyGuard)
export class LineageController {
  constructor(private svc: LineageService) {}

  @Get('match/:id')
  match(@Param('id') id: string) {
    return this.svc.forMatch(id);
  }

  @Get('card')
  card(@Query('kind') kind: string, @Query('id') id: string) {
    return this.svc.forCard(kind, id);
  }
}
