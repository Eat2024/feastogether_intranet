import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import type { Actor } from '#app/features/auth/auth.types';
import type { PermissionKey } from '../authorization.catalog';
import { AuthorizationResolverService } from './authorization-resolver.service';

/** Guard 與業務交易共用，業務呼叫必須傳入本次交易 manager。 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly resolver: AuthorizationResolverService) {}
  async requirePermissions(
    actor: Actor,
    permissions: readonly PermissionKey[],
    manager?: EntityManager,
    mode: 'all' | 'any' = 'all',
  ): Promise<void> {
    const view = await this.resolver.resolve(actor, manager);
    const granted = new Set(
      view.modules.flatMap((module) => module.permissions),
    );
    if (
      !permissions.length ||
      !(mode === 'all'
        ? permissions.every((key) => granted.has(key))
        : permissions.some((key) => granted.has(key)))
    )
      throw new AppException(...AppErrors.AUTHORIZATION_DENIED);
  }
  async requireSuperUser(actor: Actor, manager?: EntityManager): Promise<void> {
    if (actor.kind !== 'super_user')
      throw new AppException(...AppErrors.AUTHORIZATION_DENIED);
    await this.requirePermissions(
      actor,
      ['platform.authorization.manage'],
      manager,
    );
  }
}
