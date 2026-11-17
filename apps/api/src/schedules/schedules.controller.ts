import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SchedulesService } from './schedules.service';

@Controller('schedules')
export class SchedulesController {
  constructor(private schedules: SchedulesService) {}

  @Get()
  list() {
    return this.schedules.list();
  }

  @Post()
  upsert(@Body() body: any) {
    return this.schedules.upsert(body);
  }

  @Post(':id/run')
  run(@Param('id') id: string) {
    return this.schedules.runOne(id);
  }

  @Post('reload')
  reload() {
    return this.schedules.reloadAll().then(() => ({ ok: true }));
  }
}
