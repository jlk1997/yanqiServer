import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { viewerKind } from './record-face';

@Injectable()
export class OpsOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (viewerKind(req) !== 'ops') {
      throw new ForbiddenException('采集、清洗和质检只对运营开放');
    }
    return true;
  }
}
