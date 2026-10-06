import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  ADMIN_ROLE_CODE,
  AUDIT_COLLECTION_ID,
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '#app/features/auth/auth.constants';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { CreateRoleDto } from '#app/features/auth/dto/create-role.dto';
import { RenameRoleDto } from '#app/features/auth/dto/rename-role.dto';
import { ReorderRolesDto } from '#app/features/auth/dto/reorder-roles.dto';
import { SetRolePermissionsDto } from '#app/features/auth/dto/set-role-permissions.dto';
import {
  PermissionCatalog,
  PermissionMatrix,
  RoleListItem,
  toPermissionCatalog,
  toPermissionMatrix,
  buildRoleItem,
} from '#app/features/auth/mappers/role.mapper';
import { PermissionRepository } from '#app/features/auth/repositories/permission.repository';
import { RoleUserRepository } from '#app/features/auth/repositories/role-user.repository';
import { RoleRepository } from '#app/features/auth/repositories/role.repository';
import { AuditLogService } from './audit-log.service';
import { ApiAuthorizationService } from './api-authorization.service';

export interface RoleUser {
  id: number;
  empId: string;
  name: string;
  roleName: string;
  departmentName: string | null;
  titleName: string | null;
  lastLoginAt: Date | null;
  isActive: boolean;
}

@Injectable()
export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly roleUsers: RoleUserRepository,
    private readonly permissions: PermissionRepository,
    private readonly auditLog: AuditLogService,
    private readonly authorization: ApiAuthorizationService,
  ) {}

  async list(): Promise<RoleListItem[]> {
    const roles = await this.roles.findAllOrdered();
    const counts = await this.roleUsers.countActiveByRole();
    return roles.map((role) => buildRoleItem(role, counts.get(role.id) ?? 0));
  }

  async getPermissionCatalog(): Promise<PermissionCatalog> {
    const [groups, jobs, permissions] = await Promise.all([
      this.permissions.listActiveGroups(),
      this.permissions.listActiveJobs(),
      this.permissions.listPermissions(),
    ]);
    return toPermissionCatalog(groups, jobs, permissions);
  }

  /** 單角色三層權限層級（含 checked）。 */
  async getPermissionMatrix(roleId: number): Promise<PermissionMatrix> {
    const role = await this.loadActiveRole(undefined, roleId);
    const [groups, jobs, permissions, checkedIds] = await Promise.all([
      this.permissions.listActiveGroups(),
      this.permissions.listActiveJobs(),
      this.permissions.listPermissions(),
      this.permissions.currentPermissionIdSet(roleId),
    ]);
    return toPermissionMatrix(role, groups, jobs, permissions, checkedIds);
  }

  /** 綁定此角色的使用者清單（含已停用，以 isActive 標示，供稽核）。 */
  async getRoleUsers(roleId: number): Promise<RoleUser[]> {
    const role = await this.loadActiveRole(undefined, roleId);
    const users = await this.roleUsers.findByRoleId(roleId);
    return users.map((user) => ({
      id: Number(user.id),
      empId: user.personEmpid,
      name: user.personName,
      roleName: role.roleName,
      departmentName: user.departmentName ?? null,
      titleName: user.titleName ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
      isActive: user.isActive,
    }));
  }

  async create(
    dto: CreateRoleDto,
  ): Promise<{ createdRoleId: number; roles: RoleListItem[] }> {
    const createdRoleId = await this.roles.transaction(async (manager) => {
      await this.assertRoleNameAvailable(manager, dto.roleName);
      const role = this.roles.create(
        {
          roleCode: this.generateRoleCode(),
          roleName: dto.roleName,
          isAdmin: false,
          isActive: true,
          sortOrder: await this.roles.nextSortOrder(manager),
        },
        manager,
      );
      await this.roles.save(role, manager);

      const permissionIds = dto.permissionIds ?? [];
      if (permissionIds.length) {
        await this.validatePermissionIds(manager, permissionIds);
        await this.permissions.overwriteRolePermissions(
          role.id,
          permissionIds,
          manager,
        );
      }

      await this.auditLog.recordHistory(
        {
          action: AUDIT_ACTION.ROLE_CREATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: role.id,
          afterSnapshot: {
            roleName: role.roleName,
            roleCode: role.roleCode,
            permissionIds: sortedIds(permissionIds),
          },
        },
        manager,
      );
      return Number(role.id);
    });
    return { createdRoleId, roles: await this.list() };
  }

  /** 改名（ADMIN 拒）。 */
  async rename(
    roleId: number,
    dto: RenameRoleDto,
  ): Promise<{ roles: RoleListItem[] }> {
    await this.roles.transaction(async (manager) => {
      const role = await this.loadActiveRole(manager, roleId);
      this.assertNotAdmin(role);
      await this.assertRoleNameAvailable(manager, dto.roleName, roleId);
      const before = { roleName: role.roleName };
      role.roleName = dto.roleName;
      await this.roles.save(role, manager);
      await this.auditLog.recordHistory(
        {
          action: AUDIT_ACTION.ROLE_UPDATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: roleId,
          beforeSnapshot: before,
          afterSnapshot: { roleName: dto.roleName },
        },
        manager,
      );
    });
    return { roles: await this.list() };
  }

  /** 交易式整組覆蓋權限（ADMIN 不可清空）。 */
  async setPermissions(
    roleId: number,
    dto: SetRolePermissionsDto,
  ): Promise<{ id: number; permissionIds: number[] }> {
    await this.roles.transaction(async (manager) => {
      const role = await this.loadActiveRole(manager, roleId);
      if (this.isAdminRole(role) && dto.permissionIds.length === 0) {
        throw this.adminLocked('系統管理員角色不可清空權限');
      }
      await this.validatePermissionIds(manager, dto.permissionIds);
      const before = await this.currentPermissionIds(manager, roleId);
      await this.permissions.overwriteRolePermissions(
        roleId,
        dto.permissionIds,
        manager,
      );
      // 快照一律排序：權限集合相同、僅順序不同時不應被記成異動（DB 回傳順序無保證）。
      await this.auditLog.recordHistory(
        {
          action: AUDIT_ACTION.ROLE_PERMISSIONS_UPDATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: roleId,
          beforeSnapshot: { permissionIds: sortedIds(before) },
          afterSnapshot: { permissionIds: sortedIds(dto.permissionIds) },
        },
        manager,
      );
    });
    await this.authorization.refreshRoleUsers(roleId);
    return { id: roleId, permissionIds: dto.permissionIds };
  }

  async reorder(dto: ReorderRolesDto): Promise<{ roles: RoleListItem[] }> {
    const items = dto.roles;
    this.assertNoDuplicateNames(items);
    await this.roles.transaction(async (manager) => {
      const all = await this.roles.findAll(manager);
      this.assertReorderCoversAll(
        all,
        items.map((item) => item.roleId),
      );
      const byId = new Map(all.map((role) => [Number(role.id), role]));

      const renames: { role: AuthRole; before: string; after: string }[] = [];
      for (const item of items) {
        const role = byId.get(item.roleId)!;
        if (normalizeName(role.roleName) === normalizeName(item.roleName)) {
          continue;
        }
        if (this.isAdminRole(role)) {
          throw this.adminLocked('系統管理員角色不可更名');
        }
        renames.push({ role, before: role.roleName, after: item.roleName });
      }

      const reordered = items.map((item, index) => {
        const role = byId.get(item.roleId)!;
        role.sortOrder = index + 1;
        return role;
      });
      for (const { role, after } of renames) {
        role.roleName = after;
      }
      await this.roles.saveMany(reordered, manager);

      await this.auditLog.recordHistory(
        {
          action: AUDIT_ACTION.ROLE_REORDERED,
          entityType: AUDIT_ENTITY.ROLE_COLLECTION,
          entityId: AUDIT_COLLECTION_ID.ALL,
          beforeSnapshot: { roleIds: all.map((role) => Number(role.id)) },
          afterSnapshot: { roleIds: items.map((item) => item.roleId) },
        },
        manager,
      );
      // 改名稽核（僅名稱確實變更的角色各寫一筆，格式同 rename）。
      for (const { role, before, after } of renames) {
        await this.auditLog.recordHistory(
          {
            action: AUDIT_ACTION.ROLE_UPDATED,
            entityType: AUDIT_ENTITY.ROLE,
            entityId: Number(role.id),
            beforeSnapshot: { roleName: before },
            afterSnapshot: { roleName: after },
          },
          manager,
        );
      }
    });
    return { roles: await this.list() };
  }

  /** 軟刪角色（ADMIN 拒 / 有綁定拒）。 */
  async softDelete(roleId: number): Promise<{ success: true }> {
    await this.roles.transaction(async (manager) => {
      const role = await this.loadActiveRole(manager, roleId);
      this.assertNotAdmin(role);
      await this.assertNoBoundUsers(manager, roleId);
      await this.auditLog.recordHistory(
        {
          action: AUDIT_ACTION.ROLE_DELETED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: roleId,
          beforeSnapshot: { roleName: role.roleName, roleCode: role.roleCode },
        },
        manager,
      );
      await this.roles.softRemove(role, manager);
    });
    return { success: true };
  }

  // ─────────────────────────── 私有共用 ───────────────────────────

  /**
   * 角色名稱須唯一（限啟用中角色；軟刪除的同名角色可重用其名）。
   * findOne 受 @DeleteDateColumn 影響，自動排除 deleted_at 非空者。
   * 名稱比對採欄位 collation（utf8mb4_unicode_ci）→ 大小寫 / 尾空白視為相同。
   * ponytail: 應用層守衛，非 DB 約束；極端並發雙插入可能漏判（admin 低並發可接受）。
   *   需硬保證時改用 deleted_at 感知的 generated column + unique index。
   */
  private async assertRoleNameAvailable(
    manager: EntityManager | undefined,
    roleName: string,
    excludeRoleId?: number,
  ): Promise<void> {
    const existing = await this.roles.findIdByRoleName(roleName, manager);
    if (existing && Number(existing.id) !== excludeRoleId) {
      throw this.duplicateRoleName('角色名稱已存在');
    }
  }

  private async loadActiveRole(
    manager: EntityManager | undefined,
    roleId: number,
  ): Promise<AuthRole> {
    const role = await this.roles.findById(roleId, manager);
    if (!role) {
      throw new AppException(
        AppErrorCode.ROLE_NOT_FOUND,
        '角色不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    return role;
  }

  private isAdminRole(role: AuthRole): boolean {
    return role.roleCode === ADMIN_ROLE_CODE || role.isAdmin === true;
  }

  private assertReorderCoversAll(all: AuthRole[], roleIds: number[]): void {
    const current = new Set(all.map((role) => Number(role.id)));
    const unique = new Set(roleIds).size === roleIds.length;
    const sameSize = roleIds.length === current.size;
    const allKnown = roleIds.every((id) => current.has(id));
    if (!unique || !sameSize || !allKnown) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '排序清單必須涵蓋全部角色且不得重複或包含未知角色',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertNoDuplicateNames(items: { roleName: string }[]): void {
    const seen = new Set<string>();
    for (const { roleName } of items) {
      const key = normalizeName(roleName);
      if (seen.has(key)) {
        throw this.duplicateRoleName('角色名稱重複');
      }
      seen.add(key);
    }
  }

  private assertNotAdmin(role: AuthRole): void {
    if (this.isAdminRole(role)) {
      throw this.adminLocked('系統管理員角色不可變更或刪除');
    }
  }

  private adminLocked(message: string): AppException {
    return new AppException(
      AppErrorCode.ADMIN_ROLE_LOCKED,
      message,
      HttpStatus.FORBIDDEN,
    );
  }

  private duplicateRoleName(message: string): AppException {
    return new AppException(
      AppErrorCode.DUPLICATE_ROLE_NAME,
      message,
      HttpStatus.CONFLICT,
    );
  }

  /** 權限必須存在且其功能 / 分組皆啟用，否則列出無效 id（FR-008）。 */
  private async validatePermissionIds(
    manager: EntityManager | undefined,
    permissionIds: number[],
  ): Promise<void> {
    const invalid = await this.permissions.invalidPermissionIds(
      permissionIds,
      manager,
    );
    if (invalid.length) {
      throw new AppException(
        AppErrorCode.INVALID_PERMISSION_IDS,
        `權限不存在或已停用: ${invalid.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async currentPermissionIds(
    manager: EntityManager | undefined,
    roleId: number,
  ): Promise<number[]> {
    const rows = await this.permissions.currentPermissionIds(roleId, manager);
    return rows.map((row) => Number(row.permissionId));
  }

  private async assertNoBoundUsers(
    manager: EntityManager | undefined,
    roleId: number,
  ): Promise<void> {
    const bound = await this.roleUsers.countActiveByRoleId(roleId, manager);
    if (bound > 0) {
      throw new AppException(
        AppErrorCode.ROLE_HAS_USERS,
        '仍有使用者綁定此角色，無法刪除',
        HttpStatus.CONFLICT,
      );
    }
  }

  private generateRoleCode(): string {
    return `ROLE_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }
}

function sortedIds(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
