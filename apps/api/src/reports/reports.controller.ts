import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get()
  list(@Query('take') take?: string) {
    return this.reports.list(take ? Number(take) : 40);
  }

  @Get('providers')
  providers() {
    return this.reports.providers();
  }

  @Get('versions/:familyKey')
  versions(@Param('familyKey') familyKey: string) {
    return this.reports.versions(decodeURIComponent(familyKey));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.reports.get(id);
  }

  @Post('generate')
  generate(
    @Body() body: { scope: string; targetId?: string; provider?: string },
    @Req() req: any,
  ) {
    return this.reports.generate({
      scope: body.scope,
      targetId: body.targetId,
      authorId: req.user?.uid,
      provider: body.provider,
    });
  }
}
