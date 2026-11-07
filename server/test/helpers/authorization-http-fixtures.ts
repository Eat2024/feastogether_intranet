import { createHash, randomBytes } from 'node:crypto';
import { type Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type DataSource } from 'typeorm';
import { AuthorizationHttpModule } from '#app/features/authorization/authorization-http.module';
import { AuthorizationModule } from '#app/features/authorization/authorization.module';
import { SuperUserAccessModule } from '#app/features/auth/super-user-access.module';
import { SessionService } from '#app/features/auth/services/session.service';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import {
  type Actor,
  type EmployeeSessionSource,
} from '#app/features/auth/auth.types';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { LoggingModule } from '#app/infrastructure/logging/logging.module';
import { FrameworkModule } from '#app/framework/framework.module';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import {
  configureApp,
  createFastifyAdapter,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';

/** 真 Fastify、SessionService 與全域 auth/authorization guards；不需業務 queue 或 Portal。 */
export async function createAuthorizationHttpApp(
  db: DataSource,
  controllers: Type[] = [],
): Promise<NestFastifyApplication> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      FrameworkModule,
      LoggingModule,
      MysqlModule,
      SuperUserAccessModule,
      AuthorizationModule,
      AuthorizationHttpModule,
    ],
    controllers,
    providers: [
      SessionService,
      AuthGuard,
      { provide: APP_GUARD, useExisting: AuthGuard },
    ],
  })
    .overrideProvider(MYSQL_MAIN)
    .useValue(db)
    .compile();
  const app = module.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(),
    { bodyParser: false, logger: false },
  );
  configureApp(app);
  await registerFastifyPlugins(app);
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** 合成已建立的真 MySQL session，明確區分 OAuth/WebView；不冒充登入入口驗收。 */
export async function createAuthorizationSession(
  app: NestFastifyApplication,
  actor: Actor,
  source: EmployeeSessionSource = 'webview',
) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await app.get(MysqlService).transaction((manager) =>
    app.get(AuthSessionRepository).createActive(
      {
        actorKind: actor.kind,
        userId: actor.kind === 'employee' ? actor.userId : null,
        source: actor.kind === 'employee' ? source : 'super_user',
        credentialGeneration: actor.kind === 'super_user' ? 1 : null,
        sourceJtiHash: createHash('sha256')
          .update(randomBytes(32))
          .digest('hex'),
        sessionTokenHash: createHash('sha256').update(token).digest('hex'),
        activatedAt: now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
      manager,
    ),
  );
  return `${AUTH_COOKIE_NAME}=${token}`;
}
