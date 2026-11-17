import { Module } from '@nestjs/common';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { TeamInviteService } from './team-invite.service';
import { TeamInviteController } from './team-invite.controller';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [PlansModule],
  controllers: [InviteController, TeamInviteController],
  providers: [InviteService, TeamInviteService],
  exports: [InviteService, TeamInviteService],
})
export class InviteModule {}
