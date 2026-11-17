import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { FeedbackService } from './feedback.service';

@Controller('feedback')
export class FeedbackController {
  constructor(private feedback: FeedbackService) {}

  @Get('weights')
  weights() {
    return this.feedback.getWeights();
  }

  @Get()
  list() {
    return this.feedback.list();
  }

  @Get('matches/:id')
  forMatch(@Param('id') id: string) {
    return this.feedback.forMatch(id);
  }

  @Post('matches/:id')
  submit(
    @Param('id') id: string,
    @Body() body: { useful?: boolean; comment?: string; kind?: string; source?: string },
    @Req() req: any,
  ) {
    return this.feedback.submit({
      matchId: id,
      useful: Boolean(body.useful),
      comment: body.comment,
      userId: req.user?.uid,
      kind: body.kind || 'thumbs',
      source: body.source || (req.user?.role === 'ORG_USER' ? 'portal' : 'ops'),
    });
  }

  @Post('matches/:id/rescore-preview')
  rescorePreview(@Param('id') id: string) {
    return this.feedback.rescoreMatch(id);
  }
}
