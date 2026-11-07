import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { isDuplicateEntryError } from '#app/features/auth/repositories/oauth-identity.repository';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import { AuthorizationRole } from '../entities/authorization-role.entity';
import {
  AUTHORIZATION_MODULES,
  AUTHORIZATION_PERMISSIONS,
  validateRolePermissions,
} from '../authorization.catalog';
import { AuthorizationAuditService } from './authorization-audit.service';
import { AuthorizationCatalogService } from './authorization-catalog.service';
import {
  AuthorizationManagementService,
  type AuthorizationManagementContext,
} from './authorization-management.service';
import {
  authorizationInput,
  authorizationIdString,
  AuthorizationModuleParamsDto,
  AuthorizationRoleParamsDto,
  AuthorizationPageDto,
  parseAuthorizationId,
} from '../dto/authorization-query.dto';
import {
  CreateRoleDto,
  UpdateRoleDto,
  SetRolePermissionsDto,
  DeleteRoleDto,
  type AuthorizationRoleDto,
} from '../dto/role-management.dto';

@Injectable()
export class AuthorizationRoleService {
  constructor(
    private readonly management: AuthorizationManagementService,
    private readonly repository: AuthorizationRepository,
    private readonly catalog: AuthorizationCatalogService,
    private readonly audit: AuthorizationAuditService,
  ) {}
  private module(moduleKey: unknown): string {
    const input = authorizationInput(AuthorizationModuleParamsDto, {
      moduleKey,
    });
    if (!AUTHORIZATION_MODULES.some((m) => m.moduleKey === input.moduleKey))
      throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
    return input.moduleKey;
  }
  async modules(context: AuthorizationManagementContext) {
    return this.management.read(context, () =>
      AUTHORIZATION_MODULES.map((m) => ({
        moduleKey: m.moduleKey,
        name: m.moduleName,
      })),
    );
  }
  async permissions(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
  ) {
    return this.management.read(context, () => {
      const key = this.module(moduleKey);
      return AUTHORIZATION_PERMISSIONS.filter((p) => p.moduleKey === key).map(
        (p) => ({
          moduleKey: p.moduleKey,
          permissionKey: p.permissionKey,
          name: p.permissionName,
          assignable: p.assignable,
        }),
      );
    });
  }
  async list(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    query: unknown = {},
  ) {
    return this.management.read(context, async (manager) => {
      const key = this.module(moduleKey);
      const page = authorizationInput(AuthorizationPageDto, query);
      const roles = await this.repository.listRoles(
        key,
        page.limit + 1,
        page.beforeId ? parseAuthorizationId(page.beforeId) : undefined,
        manager,
      );
      const items = await this.views(roles.slice(0, page.limit), manager);
      return {
        items,
        nextCursor:
          roles.length > page.limit ? (items.at(-1)?.id ?? null) : null,
      };
    });
  }
  async detail(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    roleId: unknown,
  ) {
    return this.management.read(context, async (manager) => {
      const input = authorizationInput(AuthorizationRoleParamsDto, {
        moduleKey,
        roleId,
      });
      this.module(input.moduleKey);
      const role = await this.repository.findRole(
        input.moduleKey,
        parseAuthorizationId(input.roleId),
        manager,
      );
      if (!role)
        throw new AppException(...AppErrors.AUTHORIZATION_RESOURCE_NOT_FOUND);
      return (await this.views([role], manager))[0];
    });
  }
  async create(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    body: unknown,
  ) {
    const key = this.module(moduleKey);
    const input = authorizationInput(CreateRoleDto, body);
    if (
      !AUTHORIZATION_PERMISSIONS.some(
        (p) => p.moduleKey === key && p.assignable,
      )
    )
      throw new AppException(...AppErrors.AUTHORIZATION_PROTECTED_ROLE);
    try {
      return await this.management.transaction(
        context,
        async (manager, audit) => {
          await this.repository.roles(manager, true);
          await this.repository.permissions(manager, true);
          await this.catalog.assertReady(manager);
          const role = await this.repository.saveRole(
            manager.create(AuthorizationRole, {
              moduleKey: key,
              roleCode: `custom_${randomUUID()}`,
              roleName: input.roleName,
              isActive: true,
              isProtected: false,
              version: 1,
            }),
            manager,
          );
          const result = (await this.views([role], manager))[0];
          await this.audit.append(
            {
              context: audit,
              moduleKey: key,
              eventType: 'role.created',
              targetKind: 'role',
              targetId: role.id,
              before: null,
              after: { ...result },
            },
            manager,
          );
          return result;
        },
      );
    } catch (error) {
      if (isDuplicateEntryError(error))
        throw new AppException(...AppErrors.AUTHORIZATION_ROLE_NAME_CONFLICT);
      throw error;
    }
  }
  async update(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    roleId: unknown,
    body: unknown,
  ) {
    const input = authorizationInput(UpdateRoleDto, body);
    if (input.roleName === undefined && input.isActive === undefined)
      throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
    return this.mutate(
      context,
      moduleKey,
      roleId,
      input.expectedVersion,
      'role.updated',
      (role) => {
        const changed =
          (input.roleName !== undefined && input.roleName !== role.roleName) ||
          (input.isActive !== undefined && input.isActive !== role.isActive);
        if (input.roleName !== undefined) role.roleName = input.roleName;
        if (input.isActive !== undefined) role.isActive = input.isActive;
        return changed;
      },
    );
  }
  async setPermissions(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    roleId: unknown,
    body: unknown,
  ) {
    const input = authorizationInput(SetRolePermissionsDto, body);
    const key = this.module(moduleKey);
    if (input.permissionKeys.includes('platform.authorization.manage'))
      throw new AppException(...AppErrors.AUTHORIZATION_PROTECTED_ROLE);
    validateRolePermissions(key, input.permissionKeys);
    return this.mutate(
      context,
      key,
      roleId,
      input.expectedVersion,
      'role.permissions_updated',
      async (role, manager) => {
        const permissions = await this.repository.permissions(manager);
        const ids = permissions
          .filter(
            (p) =>
              !p.deletedAt &&
              p.moduleKey === key &&
              input.permissionKeys.includes(p.permissionKey),
          )
          .map((p) => p.id);
        return this.repository.replaceRolePermissions(role, ids, manager);
      },
    );
  }
  async delete(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    roleId: unknown,
    query: unknown,
  ): Promise<void> {
    const input = authorizationInput(DeleteRoleDto, query);
    await this.mutate(
      context,
      moduleKey,
      roleId,
      input.expectedVersion,
      'role.deleted',
      async (role, manager) => {
        if (await this.repository.roleHasAssignments(role.id, manager))
          throw new AppException(...AppErrors.AUTHORIZATION_ROLE_IN_USE);
        role.deletedAt = new Date();
        return true;
      },
    );
  }
  private async mutate(
    context: AuthorizationManagementContext,
    moduleKey: unknown,
    roleId: unknown,
    version: number,
    eventType: 'role.updated' | 'role.permissions_updated' | 'role.deleted',
    change: (
      role: AuthorizationRole,
      manager: EntityManager,
    ) => boolean | Promise<boolean>,
  ) {
    const input = authorizationInput(AuthorizationRoleParamsDto, {
      moduleKey,
      roleId,
    });
    const key = this.module(input.moduleKey);
    const id = parseAuthorizationId(input.roleId);
    try {
      return await this.management.transaction(
        context,
        async (manager, audit) => {
          // 按 ID 取得角色排他鎖，避免 catalog shared lock 升鎖造成並發死鎖。
          const roles = await this.repository.roles(manager, true);
          await this.repository.permissions(manager, true);
          await this.catalog.assertReady(manager);
          const role = roles.find(
            (r) => r.id === id && r.moduleKey === key && !r.deletedAt,
          );
          if (!role)
            throw new AppException(
              ...AppErrors.AUTHORIZATION_RESOURCE_NOT_FOUND,
            );
          if (role.isProtected)
            throw new AppException(...AppErrors.AUTHORIZATION_PROTECTED_ROLE);
          if (role.version !== version)
            throw new AppException(...AppErrors.AUTHORIZATION_VERSION_CONFLICT);
          const before = (await this.views([role], manager))[0];
          if (!(await change(role, manager))) return before;
          if (role.version === 4294967295)
            throw new AppException(...AppErrors.AUTHORIZATION_VERSION_CONFLICT);
          role.version++;
          await this.repository.saveRole(role, manager);
          const after = (await this.views([role], manager))[0];
          await this.audit.append(
            {
              context: audit,
              moduleKey: key,
              eventType,
              targetKind: 'role',
              targetId: id,
              before: { ...before },
              after: eventType === 'role.deleted' ? null : { ...after },
            },
            manager,
          );
          return after;
        },
      );
    } catch (error) {
      if (isDuplicateEntryError(error))
        throw new AppException(...AppErrors.AUTHORIZATION_ROLE_NAME_CONFLICT);
      throw error;
    }
  }
  private async views(
    roles: AuthorizationRole[],
    manager: EntityManager,
  ): Promise<AuthorizationRoleDto[]> {
    const relations = await this.repository.rolePermissions(
      roles.map((r) => r.id),
      manager,
    );
    const permissions = await this.repository.permissions(manager);
    return roles.map((role) => ({
      id: authorizationIdString(role.id),
      moduleKey: role.moduleKey,
      roleCode: role.roleCode,
      roleName: role.roleName,
      isActive: role.isActive,
      isProtected: role.isProtected,
      version: role.version,
      permissionKeys: permissions
        .filter(
          (p) =>
            !p.deletedAt &&
            p.moduleKey === role.moduleKey &&
            relations.some(
              (r) =>
                r.roleId === role.id && r.permissionId === p.id && !r.deletedAt,
            ),
        )
        .map((p) => p.permissionKey)
        .sort(),
    }));
  }
}
