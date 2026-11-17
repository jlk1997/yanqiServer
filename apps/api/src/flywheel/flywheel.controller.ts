import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { FlywheelService } from './flywheel.service';
import { viewerKind } from '../common/record-face';

@Controller('flywheel')
export class FlywheelController {
  constructor(private svc: FlywheelService) {}

  private assertOps(req: any) {
    if (viewerKind(req) !== 'ops') {
      throw new ForbiddenException('采集、清洗和质检只对运营开放');
    }
  }

  @Get('dashboard')
  dash(@Req() req: any) {
    this.assertOps(req);
    return this.svc.dashboard();
  }

  @Post('clean')
  clean(@Body() body: any, @Req() req: any) {
    this.assertOps(req);
    return this.svc.cleanPipeline(body || {});
  }

  @Post('quality/bulk-resolve')
  bulk(@Body() body: { ids?: string[]; reject?: boolean }, @Req() req: any) {
    this.assertOps(req);
    return this.svc.bulkResolve(body?.ids || [], Boolean(body?.reject));
  }

  @Post('analyze')
  analyze(@Req() req: any) {
    this.assertOps(req);
    return this.svc.analyzeIngest(req.user?.uid);
  }

  @Post('crawl/openalex')
  crawlOa(@Body() body: any, @Req() req: any) {
    this.assertOps(req);
    return this.svc.enqueueOpenAlex(
      body?.batch !== false,
      body?.limit ? Number(body.limit) : undefined,
      Boolean(body?.fillEmpty),
    );
  }

  @Post('crawl/csv')
  crawlCsv(@Body() body: any, @Req() req: any) {
    this.assertOps(req);
    return this.svc.enqueueCsv(body?.csvPath);
  }

  @Post('crawl/demand-fixtures')
  fixtures(@Req() req: any) {
    this.assertOps(req);
    return this.svc.importDemandFixtures();
  }

  @Post('pipeline/mini')
  mini(@Req() req: any) {
    this.assertOps(req);
    return this.svc.runMiniPipeline();
  }

  @Post('parse-demand')
  parse(@Body() body: { text?: string; commit?: boolean; orgId?: string; orgName?: string }, @Req() req: any) {
    this.assertOps(req);
    if (body?.commit) {
      return this.svc.createDemandFromPaste({
        text: body.text || '',
        orgId: body.orgId,
        orgName: body.orgName,
        commit: true,
      });
    }
    return this.svc.parseDemandPaste(body?.text || '');
  }

  @Get('merge-suggestions')
  merges(@Req() req: any, @Query('take') take?: string) {
    this.assertOps(req);
    return this.svc.mergeSuggestions(take ? Number(take) : 40);
  }

  @Post('merge')
  merge(@Body() body: { kind: string; keepId: string; dropIds: string[] }, @Req() req: any) {
    this.assertOps(req);
    return this.svc.applyMerge(body?.kind, body?.keepId, body?.dropIds || []);
  }

  @Post('quarantine')
  quarantine(@Req() req: any) {
    this.assertOps(req);
    return this.svc.quarantineJunk();
  }

  @Post('reembed')
  reembed(@Body() body: { limit?: number }, @Req() req: any) {
    this.assertOps(req);
    return this.svc.reembedAfterClean(body?.limit || 80);
  }

  @Get('completeness')
  completeness(@Req() req: any, @Query('take') take?: string) {
    this.assertOps(req);
    return this.svc.completenessWizard(take ? Number(take) : 30);
  }

  @Post('import-files')
  importFiles(
    @Body()
    body: {
      files?: Array<{ name: string; content: string; format?: string }>;
      commit?: boolean;
      mapping?: Record<string, string>;
    },
    @Req() req: any,
  ) {
    this.assertOps(req);
    const tenantId = req.user?.tenantId || req.resolvedTenantId || 'default';
    return this.svc.importAuthorizedFiles(body?.files || [], {
      commit: Boolean(body?.commit),
      mapping: body?.mapping,
      tenantId,
    });
  }

  @Get('week-match-ready')
  weekReady(@Req() req: any, @Query('take') take?: string) {
    this.assertOps(req);
    return this.svc.weekMatchReady(take ? Number(take) : 40);
  }

  @Post('week-match-ready/run')
  weekRun(
    @Body()
    body: {
      demandIds?: string[];
      topN?: number;
      minScore?: number;
      enqueue?: boolean;
    },
    @Req() req: any,
  ) {
    this.assertOps(req);
    return this.svc.bulkMatchWeekReady({
      demandIds: body?.demandIds || [],
      topN: body?.topN,
      minScore: body?.minScore,
      enqueue: Boolean(body?.enqueue),
    });
  }

  @Get('week-match-ready/jobs/:id')
  weekJob(@Param('id') id: string, @Req() req: any) {
    this.assertOps(req);
    return this.svc.getBulkMatchJob(id);
  }

  @Post('week-match-ready/jobs/:id/cancel')
  weekCancel(@Param('id') id: string, @Req() req: any) {
    this.assertOps(req);
    return this.svc.cancelBulkMatchJob(id);
  }

  @Post('fill-empty/preview')
  fillPreview(@Body() body: { limit?: number }, @Req() req: any) {
    this.assertOps(req);
    const tenantId = req.user?.tenantId || req.resolvedTenantId || 'default';
    return this.svc.previewFillEmpty({ limit: body?.limit, tenantId });
  }

  @Post('fill-empty/confirm')
  fillConfirm(
    @Body() body: { outcomeIds?: string[]; applyAll?: boolean },
    @Req() req: any,
  ) {
    this.assertOps(req);
    const tenantId = req.user?.tenantId || req.resolvedTenantId || 'default';
    return this.svc.confirmFillEmpty({
      tenantId,
      outcomeIds: body?.outcomeIds,
      applyAll: Boolean(body?.applyAll) || !body?.outcomeIds?.length,
    });
  }
}
