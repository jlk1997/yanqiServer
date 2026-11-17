import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { OpsOnlyGuard } from '../common/ops-only.guard';

@Controller('ingest')
@UseGuards(OpsOnlyGuard)
export class IngestController {
  constructor(private svc: IngestService) {}

  @Get('sources')
  sources() {
    return this.svc.listSources();
  }

  @Post('sources/ensure')
  ensure() {
    return this.svc.ensureSources();
  }

  @Get('batches')
  batches(@Query('take') take?: string) {
    return this.svc.listBatches(Math.min(100, Math.max(1, Number(take) || 30)));
  }

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('desk')
  desk() {
    return this.svc.desk();
  }

  @Post('rejudge')
  rejudge() {
    return this.svc.rejudge();
  }

  @Get('coverage')
  coverage() {
    return this.svc.latestCoverage();
  }

  @Post('coverage/recompute')
  recompute() {
    return this.svc.recomputeCoverage();
  }

  @Get('evidence')
  evidence(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.svc.evidenceFor(entityType, entityId);
  }

  @Post('documents')
  documents(@Body() body: any) {
    return this.svc.acceptDocuments({ sourceCode: body?.sourceCode, documents: body?.documents || [] });
  }

  @Post('pipeline/run')
  run() {
    return this.svc.runPending();
  }

  @Post('publish')
  publish(@Body() body: { entityType: string; entityId: string; status: string }) {
    return this.svc.setPublish(body?.entityType, body?.entityId, body?.status);
  }

  @Post('slices/resume')
  resumeSlice(@Body() body: { key?: string }) {
    return this.svc.resumeSlice(String(body?.key || ''));
  }

  @Post('persons/merge')
  merge(@Body() body: { keepId: string; dropId: string }) {
    return this.svc.mergePersons(body?.keepId, body?.dropId);
  }

  @Get('raw/:id')
  raw(@Param('id') id: string) {
    return this.svc.rawHidden(id);
  }
}
