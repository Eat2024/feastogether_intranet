import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { SuperUserAccessRepository } from '#app/features/auth/repositories/super-user-access.repository';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import {
  AUTHORIZATION_MODULES,
  AUTHORIZATION_PERMISSIONS,
  BASELINE_PERMISSIONS,
  INITIAL_ROLES,
} from '../authorization.catalog';
import { AuthorizationRole } from '../entities/authorization-role.entity';
import { AuthorizationPermission } from '../entities/authorization-permission.entity';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import {
  AuthorizationAuditService,
  type AuthorizationAuditContext,
} from './authorization-audit.service';

/** 明確執行的目錄同步；啟動與讀取絕不呼叫 syncCatalog。 */
@Injectable()
export class AuthorizationCatalogService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly repository: AuthorizationRepository,
    private readonly audit: AuthorizationAuditService,
    private readonly access: SuperUserAccessRepository,
    private readonly config: SuperUserConfigService,
  ) {}

  /** 每次寫入先核對本機設定及 active generation，鎖 singleton 到提交，避免維護 context 過期。 */
  async syncCatalog(): Promise<{ changed: boolean }> {
    const initial = await this.access.find(this.mysql.getManager());
    if (
      !initial ||
      !this.config.fingerprint ||
      initial.activeCredentialFingerprint !== this.config.fingerprint
    )
      throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
    return this.mysql.transaction(async (manager) => {
      const current = await this.access.findForUpdate(manager);
      if (
        !current ||
        current.credentialGeneration !== initial.credentialGeneration ||
        current.activeCredentialFingerprint !== this.config.fingerprint
      )
        throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
      const context: AuthorizationAuditContext = {
        actorKind: 'operator',
        source: 'repl',
      };
      // 固定先角色後權限，最後才改關聯；同一 singleton 將並發 sync 序列化。
      const roles = await this.repository.roles(manager, true);
      const permissions = await this.repository.permissions(manager, true);
      let changed = false;
      for (const module of AUTHORIZATION_MODULES) {
        const definitions = AUTHORIZATION_PERMISSIONS.filter(
          (p) => p.moduleKey === module.moduleKey,
        );
        const before = permissions
          .filter(
            (p) =>
              !p.deletedAt &&
              p.moduleKey === module.moduleKey &&
              definitions.some(
                (d) =>
                  d.permissionKey === p.permissionKey &&
                  d.permissionName === p.permissionName,
              ),
          )
          .map((p) => p.permissionKey);
        let permissionsChanged = false;
        for (const definition of definitions) {
          let entity = permissions.find(
            (p) => p.permissionKey === definition.permissionKey,
          );
          if (!entity) {
            entity = manager.create(AuthorizationPermission, {
              moduleKey: definition.moduleKey,
              permissionKey: definition.permissionKey,
              permissionName: definition.permissionName,
            });
            await this.repository.savePermission(entity, manager);
            permissions.push(entity);
            permissionsChanged = true;
          } else if (
            entity.deletedAt ||
            entity.moduleKey !== definition.moduleKey ||
            entity.permissionName !== definition.permissionName
          ) {
            // 錯誤 scope 不能偷偷重掛既有 FK，應由維運檢查資料。
            if (entity.moduleKey !== definition.moduleKey)
              throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
            Object.assign(entity, {
              moduleKey: definition.moduleKey,
              permissionKey: definition.permissionKey,
              permissionName: definition.permissionName,
              deletedAt: null,
            });
            await this.repository.savePermission(entity, manager);
            permissionsChanged = true;
          }
        }
        if (permissionsChanged) {
          await this.audit.append(
            {
              context,
              moduleKey: module.moduleKey,
              eventType: 'catalog.synced',
              targetKind: 'catalog',
              before: { permissionKeys: before },
              after: {
                permissionKeys: definitions.map((p) => p.permissionKey),
              },
            },
            manager,
          );
          changed = true;
        }
      }
      for (const permission of permissions) {
        if (
          !permission.deletedAt &&
          !AUTHORIZATION_PERMISSIONS.some(
            (p) =>
              p.permissionKey === permission.permissionKey &&
              p.moduleKey === permission.moduleKey,
          )
        ) {
          permission.deletedAt = new Date();
          await this.repository.savePermission(permission, manager);
          await this.audit.append(
            {
              context,
              moduleKey: permission.moduleKey,
              eventType: 'catalog.synced',
              targetKind: 'catalog',
              before: { permissionKeys: [permission.permissionKey] },
              after: { permissionKeys: [] },
            },
            manager,
          );
          changed = true;
        }
      }
      for (const definition of INITIAL_ROLES) {
        let role = roles.find(
          (r) =>
            r.moduleKey === definition.moduleKey &&
            r.roleCode === definition.roleCode,
        );
        // 一般角色曾存在即不覆寫，包括 soft-delete；code 不重用。
        if (role && !definition.isProtected) continue;
        const before = role
          ? {
              roleCode: role.roleCode,
              roleName: role.roleName,
              isActive: role.isActive,
              version: role.version,
              permissionKeys: await this.keysForRole(role.id, manager),
            }
          : null;
        const fresh = !role;
        if (!role)
          role = manager.create(AuthorizationRole, {
            moduleKey: definition.moduleKey,
            roleCode: definition.roleCode,
            roleName: definition.roleName,
            isActive: true,
            version: 1,
          });
        let roleChanged =
          fresh ||
          !!role.deletedAt ||
          role.roleName !== definition.roleName ||
          !role.isActive;
        Object.assign(role, {
          roleName: definition.roleName,
          isActive: true,
          deletedAt: null,
        });
        await this.repository.saveRole(role, manager);
        const ids = permissions
          .filter(
            (p) =>
              !p.deletedAt &&
              p.moduleKey === definition.moduleKey &&
              (definition.permissionKeys as readonly string[]).includes(
                p.permissionKey,
              ),
          )
          .map((p) => p.id);
        roleChanged =
          (await this.repository.replaceRolePermissions(role, ids, manager)) ||
          roleChanged;
        if (!roleChanged) continue;
        if (!fresh) {
          role.version += 1;
          await this.repository.saveRole(role, manager);
        }
        await this.audit.append(
          {
            context,
            moduleKey: role.moduleKey,
            eventType: fresh ? 'role.created' : 'role.updated',
            targetKind: 'role',
            targetId: role.id,
            before,
            after: {
              roleCode: role.roleCode,
              roleName: role.roleName,
              isActive: role.isActive,
              version: role.version,
              permissionKeys: [...definition.permissionKeys],
            },
          },
          manager,
        );
        changed = true;
      }
      return { changed };
    }, 'READ COMMITTED');
  }

  private async keysForRole(
    roleId: number,
    manager: EntityManager,
    currentRead = false,
    loadedPermissions?: AuthorizationPermission[],
  ): Promise<string[]> {
    const relations = await this.repository.rolePermissions(
      [roleId],
      manager,
      currentRead,
    );
    const permissions =
      loadedPermissions ?? (await this.repository.permissions(manager));
    return permissions
      .filter(
        (p) =>
          !p.deletedAt &&
          relations.some((r) => !r.deletedAt && r.permissionId === p.id),
      )
      .map((p) => p.permissionKey)
      .sort();
  }

  /** 缺失、不相容或殘留目錄拒絕服務；不在讀取時修補或提供舊權限 fallback。 */
  async assertReady(
    manager: EntityManager = this.mysql.getManager(),
  ): Promise<void> {
    try {
      const currentRead = !!manager.queryRunner?.isTransactionActive;
      // 交易內使用 current read，鎖序保持 roles → permissions → relations。
      const roles = await this.repository.roles(
        manager,
        currentRead ? 'shared' : false,
      );
      const permissions = (
        await this.repository.permissions(
          manager,
          currentRead ? 'shared' : false,
        )
      ).filter((p) => !p.deletedAt);
      if (
        permissions.length !== AUTHORIZATION_PERMISSIONS.length ||
        !AUTHORIZATION_PERMISSIONS.every((d) =>
          permissions.some(
            (p) =>
              p.moduleKey === d.moduleKey &&
              p.permissionKey === d.permissionKey &&
              p.permissionName === d.permissionName,
          ),
        )
      )
        throw new Error('目錄版本不相容');
      const colleague = roles.find(
        (r) =>
          r.moduleKey === 'esign' &&
          r.roleCode === 'colleague' &&
          !r.deletedAt &&
          r.isActive,
      );
      if (!colleague) throw new Error('同仁角色缺失');
      const keys = await this.keysForRole(
        colleague.id,
        manager,
        currentRead,
        permissions,
      );
      if (
        keys.length !== BASELINE_PERMISSIONS.length ||
        BASELINE_PERMISSIONS.some((k) => !keys.includes(k))
      )
        throw new Error('同仁目錄不相容');
    } catch {
      throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
    }
  }
}
