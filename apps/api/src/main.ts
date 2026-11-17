import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { applyChannelEmailAliases } from './mail/mail.service';

async function bootstrap() {
  applyChannelEmailAliases();
  const max = Number(process.env.WAF_MAX_BODY_BYTES || 2_000_000);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
    rawBody: false,
  });
  app.useBodyParser('json', { limit: max });
  app.useBodyParser('urlencoded', { limit: max, extended: true });
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  // 运维台静态页也可挂在同端口
  const webPublic = join(__dirname, '..', '..', 'web', 'public');
  app.useStaticAssets(webPublic, { prefix: '/' });
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT || 3100);
  await app.listen(port);
  console.log(`研企通 API 已启动: http://127.0.0.1:${port}`);
  console.log(`登录入口: http://127.0.0.1:${port}/  运营台: /ops.html`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，开始优雅退出…`);
    const timer = setTimeout(() => {
      console.error('优雅退出超时，强制结束');
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 12_000));
    try {
      await app.close();
      clearTimeout(timer);
      console.log('已关闭 HTTP 与资源');
      process.exit(0);
    } catch (e) {
      console.error('关闭失败', e);
      clearTimeout(timer);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
bootstrap();
