import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { validationExceptionFactory } from '#app/common/errors/validation-exception.factory';
import { AppModule } from '#app/app.module';
import { AppEnvironment } from '#app/config/app.environment';
import { ExceptionHandler } from '#app/framework/filters/exception.handler';
import { HttpAccessLogInterceptor } from '#app/framework/interceptors/http-access-log.interceptor';
import { ResponseInterceptor } from '#app/framework/interceptors/response.interceptor';

/**
 * Fastify 插件註冊（安全標頭 / cookie 驗證 token / multipart）。
 * main bootstrap 與 e2e 測試 app MUST 共用本函式——只在 main.ts 註冊會使測試環境
 * req.cookies 為 undefined、登入身分掛不上。
 */
export async function registerFastifyPlugins(
  app: NestFastifyApplication,
): Promise<void> {
  registerSecurityHeaders(app);
  await app.register(fastifyCookie);
  // 單檔上限 10MB、一次最多 15 個檔案 part
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 15 },
  });
}

/**
 * 全域安全標頭。零依賴，以 onRequest hook 設定最小集合：nosniff 阻 MIME sniffing、
 * X-Frame-Options: DENY 阻點擊劫持。HSTS 交由反向代理，不在應用層設定。
 */
function registerSecurityHeaders(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (_req, reply, done) => {
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    done();
  });
}

/**
 * Fastify adapter（main 與需要正式 proxy 語意的 e2e 共用）。
 *
 * 只信任前面 1 層反向代理，取其填的 client IP；不用 true（會信任整條 XFF → IP 可偽造）。
 * 若日後代理層數改變，調整此數字。
 *
 * 抽成具名函式而非在 createApp 內就地 new：速率限制若以 client IP 為單位，
 * 而 `req.ip` 的解析結果完全取決於此設定；e2e 若自行 `new FastifyAdapter()`
 * （無 trustProxy），測到的就不是正式環境的行為。
 */
export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({ trustProxy: 1 });
}

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  return app;
}

export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(app.get(ExceptionHandler));

  // HTTP access log 在外層（回應端最後作用，記到 ResponseInterceptor 套用固定格式後的回應）
  app.useGlobalInterceptors(
    app.get(HttpAccessLogInterceptor),
    new ResponseInterceptor(),
  );
}

/** 啟動 HTTP server 並設定連線逾時。 */
export async function listen(
  app: NestFastifyApplication,
  config: ConfigService,
): Promise<void> {
  const port = config.get<string | number>('PORT') ?? 3001;
  await app.listen(port, '0.0.0.0');

  const server = app.getHttpAdapter().getInstance().server;
  server.keepAliveTimeout = 60 * 1000; // 60s；保持 keep-alive TCP 連線的時間上限。
  server.headersTimeout = 65 * 1000; // 65s；等待完整 headers 傳送完成的時間上限。
}

export function configureCors(
  app: NestFastifyApplication,
  config: ConfigService,
): void {
  const corsOrigin =
    config.get<string>('CORS_ORIGIN') || 'http://localhost:3000';
  app.enableCors({
    origin: [corsOrigin],
    credentials: true,
  });
}

export function configureSwagger(
  app: NestFastifyApplication,
  configService: ConfigService,
): void {
  if (configService.get<string>('NODE_ENV') === AppEnvironment.Production)
    return;

  const config = new DocumentBuilder()
    .setTitle('API 文件')
    .setDescription('這是自動生成的 Swagger API 文件')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, document);
}
