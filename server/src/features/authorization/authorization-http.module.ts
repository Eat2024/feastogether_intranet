import { AuthorizationEventsController } from './controllers/authorization-events.controller';
import { AuthorizationRolesController } from './controllers/authorization-roles.controller';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizationModule } from './authorization.module';
import { AuthorizationGuard } from './guards/authorization.guard';
import { CurrentAuthorizationController } from './controllers/current-authorization.controller';

/** 只在 HTTP process 安裝能力 guard 與路由。 */
@Module({
  imports: [AuthorizationModule],
  controllers: [
    CurrentAuthorizationController,
    AuthorizationRolesController,
    AuthorizationEventsController,
  ],
  providers: [
    AuthorizationGuard,
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
})
export class AuthorizationHttpModule {}
