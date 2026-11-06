import { Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { AuthorizationRole } from '../entities/authorization-role.entity';
import { AuthorizationPermission } from '../entities/authorization-permission.entity';
import { AuthorizationRolePermission } from '../entities/authorization-role-permission.entity';
import { AuthorizationUserRole } from '../entities/authorization-user-role.entity';

/** 集合讀取與關聯差異保存；交易及 users → roles → permissions 鎖序由 service 決定。 */
@Injectable()
export class AuthorizationRepository {
  roles(
    manager: EntityManager,
    lock: boolean | 'shared' = false,
  ): Promise<AuthorizationRole[]> {
    const query = manager
      .createQueryBuilder(AuthorizationRole, 'r')
      .withDeleted()
      .orderBy('r.id', 'ASC');
    if (lock)
      query.setLock(
        lock === 'shared' ? 'pessimistic_read' : 'pessimistic_write',
      );
    return query.getMany();
  }
  permissions(
    manager: EntityManager,
    lock: boolean | 'shared' = false,
  ): Promise<AuthorizationPermission[]> {
    const query = manager
      .createQueryBuilder(AuthorizationPermission, 'p')
      .withDeleted()
      .orderBy('p.id', 'ASC');
    if (lock)
      query.setLock(
        lock === 'shared' ? 'pessimistic_read' : 'pessimistic_write',
      );
    return query.getMany();
  }
  rolePermissions(
    roleIds: number[],
    manager: EntityManager,
    currentRead = false,
  ): Promise<AuthorizationRolePermission[]> {
    if (!roleIds.length) return Promise.resolve([]);
    return manager.find(AuthorizationRolePermission, {
      where: { roleId: In(roleIds) },
      withDeleted: true,
      order: { id: 'ASC' },
      ...(currentRead ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
  }
  userRoles(
    userId: number,
    manager: EntityManager,
  ): Promise<AuthorizationUserRole[]> {
    return manager.find(AuthorizationUserRole, {
      where: { userId },
      order: { roleId: 'ASC' },
    });
  }
  saveRole(
    role: AuthorizationRole,
    manager: EntityManager,
  ): Promise<AuthorizationRole> {
    return manager.save(role);
  }
  savePermission(
    permission: AuthorizationPermission,
    manager: EntityManager,
  ): Promise<AuthorizationPermission> {
    return manager.save(permission);
  }

  /** 單次集合查詢有效 grant，複合 scope 條件與 soft-delete/active 同時成立。 */
  effectiveGrants(
    userId: number,
    manager: EntityManager,
  ): Promise<Array<{ moduleKey: string; permissionKey: string }>> {
    const query = manager
      .createQueryBuilder(AuthorizationUserRole, 'ur')
      .innerJoin(
        AuthorizationRole,
        'r',
        'r.id = ur.role_id AND r.module_key = ur.module_key AND r.is_active = 1 AND r.is_protected = 0 AND r.deleted_at IS NULL',
      )
      .innerJoin(
        AuthorizationRolePermission,
        'rp',
        'rp.role_id = r.id AND rp.module_key = r.module_key AND rp.deleted_at IS NULL',
      )
      .innerJoin(
        AuthorizationPermission,
        'p',
        'p.id = rp.permission_id AND p.module_key = rp.module_key AND p.assignable = 1 AND p.deleted_at IS NULL',
      )
      .select('p.module_key', 'moduleKey')
      .addSelect('p.permission_key', 'permissionKey')
      .where('ur.user_id = :userId AND ur.deleted_at IS NULL', { userId });
    if (manager.queryRunner?.isTransactionActive)
      query.setLock('pessimistic_read');
    return query.getRawMany<{ moduleKey: string; permissionKey: string }>();
  }

  /** 只恢復或撤銷原列，不重建唯一關聯。呼叫者須先鎖定角色與權限。 */
  async replaceRolePermissions(
    role: AuthorizationRole,
    permissionIds: readonly number[],
    manager: EntityManager,
  ): Promise<boolean> {
    const relations = await this.rolePermissions([role.id], manager);
    const wanted = new Set(permissionIds);
    let changed = false;
    for (const relation of relations) {
      const active = wanted.delete(relation.permissionId);
      if (active === !relation.deletedAt) continue;
      Object.assign(relation, { deletedAt: active ? null : new Date() });
      await manager.save(relation);
      changed = true;
    }
    for (const permissionId of wanted) {
      await manager.save(
        manager.create(AuthorizationRolePermission, {
          moduleKey: role.moduleKey,
          roleId: role.id,
          permissionId,
        }),
      );
      changed = true;
    }
    return changed;
  }
  /** 員工列及角色已依序鎖定後，覆寫單一 scope 的一般角色關聯。 */
  async replaceUserRoles(
    userId: number,
    moduleKey: string,
    roleIds: readonly number[],
    manager: EntityManager,
  ): Promise<boolean> {
    const relations = await manager.find(AuthorizationUserRole, {
      where: { userId, moduleKey },
      withDeleted: true,
      order: { roleId: 'ASC' },
    });
    const wanted = new Set(roleIds);
    let changed = false;
    for (const relation of relations) {
      const active = wanted.delete(relation.roleId);
      if (active === !relation.deletedAt) continue;
      Object.assign(relation, { deletedAt: active ? null : new Date() });
      await manager.save(relation);
      changed = true;
    }
    for (const roleId of wanted) {
      await manager.save(
        manager.create(AuthorizationUserRole, { userId, moduleKey, roleId }),
      );
      changed = true;
    }
    return changed;
  }
}
