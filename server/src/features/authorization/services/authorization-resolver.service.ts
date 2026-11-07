import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import type { Actor } from '#app/features/auth/auth.types';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  AUTHORIZATION_PERMISSIONS,
  BASELINE_PERMISSIONS,
} from '../authorization.catalog';
import type { AuthorizationViewDto } from '../dto/authorization-view.dto';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import { AuthorizationCatalogService } from './authorization-catalog.service';

export interface PermissionGrant {
  moduleKey: string;
  permissionKey: string;
}
/** 有效關聯仍須與程式目錄精確相交；名稱及未知 grant 不能提升能力。 */
export function effectivePermissionModules(
  actor: Actor,
  grants: readonly PermissionGrant[],
): AuthorizationViewDto['modules'] {
  const selected =
    actor.kind === 'super_user'
      ? AUTHORIZATION_PERMISSIONS
      : AUTHORIZATION_PERMISSIONS.filter(
          (permission) =>
            BASELINE_PERMISSIONS.includes(permission.permissionKey) ||
            (permission.assignable &&
              grants.some(
                (grant) =>
                  grant.moduleKey === permission.moduleKey &&
                  grant.permissionKey === permission.permissionKey,
              )),
        );
  const modules = new Map<string, Set<string>>();
  for (const permission of selected) {
    const keys = modules.get(permission.moduleKey) ?? new Set<string>();
    keys.add(permission.permissionKey);
    modules.set(permission.moduleKey, keys);
  }
  return [...modules.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleKey, keys]) => ({ moduleKey, permissions: [...keys].sort() }));
}

@Injectable()
export class AuthorizationResolverService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly repository: AuthorizationRepository,
    private readonly users: UserRepository,
    private readonly catalog: AuthorizationCatalogService,
  ) {}

  /** 每次讀取 DB；交易內用 current read，不採 cookie、Redis 或上次請求的能力。 */
  async resolve(
    actor: Actor,
    manager: EntityManager = this.mysql.getManager(),
  ): Promise<AuthorizationViewDto> {
    return (await this.resolveState(actor, manager)).view;
  }

  private async resolveState(
    actor: Actor,
    manager: EntityManager,
  ): Promise<{ view: AuthorizationViewDto; grants: PermissionGrant[] }> {
    try {
      if (actor.kind === 'employee') {
        if (!Number.isSafeInteger(actor.userId) || actor.userId < 1)
          throw new AppException(...AppErrors.AUTH_IDENTITY_INVALID);
        const user = manager.queryRunner?.isTransactionActive
          ? await this.users.findByIdForShare(actor.userId, manager)
          : await this.users.findById(actor.userId, manager);
        if (!user || !user.isActive || user.deletedAt)
          throw new AppException(...AppErrors.ACCOUNT_DISABLED);
      }
      await this.catalog.assertReady(manager);
      const grants =
        actor.kind === 'employee'
          ? await this.repository.effectiveGrants(actor.userId, manager)
          : [];
      const view: AuthorizationViewDto = {
        actor:
          actor.kind === 'employee'
            ? { kind: 'employee', userId: actor.userId }
            : { kind: 'super_user', displayName: 'Super user' },
        modules: effectivePermissionModules(actor, grants),
      };
      return { view, grants };
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
    }
  }

  async userPermissions(userId: number) {
    const { view, grants } = await this.resolveState(
      { kind: 'employee', userId },
      this.mysql.getManager(),
    );
    const baseline = effectivePermissionModules(
      { kind: 'employee', userId },
      [],
    );
    return {
      ...view,
      sources: {
        baseline,
        explicit: view.modules
          .map((module) => ({
            ...module,
            permissions: module.permissions.filter((key) =>
              grants.some(
                (grant) =>
                  grant.moduleKey === module.moduleKey &&
                  grant.permissionKey === key,
              ),
            ),
          }))
          .filter((module) => module.permissions.length > 0),
      },
    };
  }
}
