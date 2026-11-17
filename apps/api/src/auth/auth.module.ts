import { Module, OnModuleInit } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ApiKeyMiddleware } from './api-key.middleware';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, ApiKeyMiddleware],
  exports: [AuthService, ApiKeyMiddleware],
})
export class AuthModule implements OnModuleInit {
  constructor(private auth: AuthService) {}
  async onModuleInit() {
    try {
      await this.auth.ensureSeedUsers();
      console.log('[auth] 默认套餐与账号已就绪');
    } catch (e: any) {
      console.warn('[auth] 种子用户跳过:', e?.message || e);
    }
  }
}
