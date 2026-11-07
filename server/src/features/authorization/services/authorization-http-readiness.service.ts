import {
  Injectable,
  type OnApplicationBootstrap,
  type Type,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
  AuthorizationReadinessService,
  validateAuthorizationRoutes,
} from './authorization-readiness.service';

/** Nest 完成路由註冊後、listen 接受流量前驗證所有 controller。 */
@Injectable()
export class AuthorizationHttpReadiness implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly readiness: AuthorizationReadinessService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    validateAuthorizationRoutes(
      this.discovery
        .getControllers()
        .flatMap((wrapper) => (wrapper.metatype ? [wrapper.metatype] : []))
        .filter((controller): controller is Type => 'prototype' in controller),
    );
    await this.readiness.assertReady();
  }
}
