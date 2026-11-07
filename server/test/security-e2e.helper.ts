import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { seedAuthorizationCatalog } from './helpers/authorization-fixtures';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { SyntheticMailFixture } from './synthetic-mail-fixture.helper';
export {
  mailFixture,
  createSyntheticWorker,
} from './synthetic-mail-fixture.helper';
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
  mail?: SyntheticMailFixture;
  app: NestFastifyApplication;
  server: E2eServer;
}

export async function createSecurityE2eApp(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
  mailEmails: readonly string[] | null = [],
): Promise<SecurityE2eContext> {
  const mail =
    mailEmails === null ? undefined : new SyntheticMailFixture(mailEmails);
  const builder = override(Test.createTestingModule({ imports: [AppModule] }));
  const moduleRef = await (mail ? mail.install(builder) : builder).compile();
  // 與正式環境相同的 trustProxy，限流測試才能以 X-Forwarded-For 隔離 client IP
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(),
    { bodyParser: false },
  );
  configureApp(app);
  await registerFastifyPlugins(app);
  if (mail) await mail.seed(app.get(MysqlService));
  await seedAuthorizationCatalog(app.get(MYSQL_MAIN));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    mail,
    app,
    server: app.getHttpAdapter().getInstance().server,
  };
}

export async function closeSecurityE2eApp(
  ctx: SecurityE2eContext,
): Promise<void> {
  if (ctx.mail) await ctx.mail.cleanup(ctx.app.get(MysqlService));
  await ctx.app.close();
}
