import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '#app/app.module';
import {
  configureApp,
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
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
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
