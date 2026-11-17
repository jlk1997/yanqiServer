import { Module } from '@nestjs/common';
import { FindPeopleService } from './find-people.service';

@Module({
  providers: [FindPeopleService],
  exports: [FindPeopleService],
})
export class OutreachModule {}
