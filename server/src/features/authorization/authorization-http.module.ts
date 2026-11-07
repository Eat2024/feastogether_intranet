import { AuthorizationAssignmentsController } from './controllers/authorization-assignments.controller';
import { AuthorizationEventsController } from './controllers/authorization-events.controller';
import { AuthorizationRolesController } from './controllers/authorization-roles.controller';
import { Module } from '@nestjs/common';
import { AuthorizationHttpReadiness } from './services/authorization-http-readiness.service';
import { DiscoveryModule, APP_GUARD } from '@nestjs/core';
import { AuthorizationModule } from './authorization.module';
import { AuthorizationGuard } from './guards/authorization.guard';
import { CurrentAuthorizationController } from './controllers/current-authorization.controller';

/** 只在 HTTP process 安裝能力 guard 與路由。 */
@Module({
  imports: [AuthorizationModule, DiscoveryModule],
  controllers: [
    AuthorizationAssignmentsController,
    CurrentAuthorizationController,
    AuthorizationRolesController,
    AuthorizationEventsController,
  ],
  providers: [
    AuthorizationGuard,
    AuthorizationHttpReadiness,
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
})
export class AuthorizationHttpModule {}
