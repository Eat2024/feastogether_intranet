import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  createFastifyAdapter,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import type { E2eServer } from './api-response.helper';

export interface SecurityE2eContext {
  app: NestFastifyApplication;
  server: E2eServer;
}

export async function createSecurityE2eApp(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
): Promise<SecurityE2eContext> {
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  // 與正式環境相同的 trustProxy，限流測試才能以 X-Forwarded-For 隔離 client IP
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(),
    { bodyParser: false },
  );
  configureApp(app);
  await registerFastifyPlugins(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    server: app.getHttpAdapter().getInstance().server,
  };
}

export async function closeSecurityE2eApp(
  ctx: SecurityE2eContext,
): Promise<void> {
  await ctx.app.close();
}
