import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { QualityService } from './quality.service';
import { OpsOnlyGuard } from '../common/ops-only.guard';

@Controller('quality')
@UseGuards(OpsOnlyGuard)
export class QualityController {
  constructor(private quality: QualityService) {}

  @Post('scan')
  scan(@Req() req: any) {
    if (req.user?.role === 'ORG_USER' && !req.authMeta?.hasKey) {
      return { ok: false, message: '机构用户请联系运营跑质检' };
    }
    return this.quality.scanAll();
  }

  @Get()
  list(@Query('all') all?: string) {
    return this.quality.list({ unresolvedOnly: all !== '1' });
  }

  @Get('summary')
  summary() {
    return this.quality.summary();
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.quality.resolve(id);
  }

  @Post('bulk-resolve')
  async bulk(@Body() body: { ids?: string[]; reject?: boolean }) {
    const ids = body?.ids || [];
    let n = 0;
    for (const id of ids.slice(0, 200)) {
      try {
        await this.quality.resolve(id);
        n++;
      } catch (_) {}
    }
    return { ok: true, resolved: n, reject: Boolean(body?.reject) };
  }
}
