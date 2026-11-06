import { Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { AuthorizationRole } from '../entities/authorization-role.entity';
import { AuthorizationPermission } from '../entities/authorization-permission.entity';
import { AuthorizationRolePermission } from '../entities/authorization-role-permission.entity';
import { AuthorizationUserRole } from '../entities/authorization-user-role.entity';

/** 集合讀取與關聯差異保存；交易及 users → roles → permissions 鎖序由 service 決定。 */
@Injectable()
export class AuthorizationRepository {
  roles(manager: EntityManager, lock = false): Promise<AuthorizationRole[]> {
    const query = manager
      .createQueryBuilder(AuthorizationRole, 'r')
      .withDeleted()
      .orderBy('r.id', 'ASC');
    if (lock) query.setLock('pessimistic_write');
    return query.getMany();
  }
  permissions(
    manager: EntityManager,
    lock = false,
  ): Promise<AuthorizationPermission[]> {
    const query = manager
      .createQueryBuilder(AuthorizationPermission, 'p')
      .withDeleted()
      .orderBy('p.id', 'ASC');
    if (lock) query.setLock('pessimistic_write');
    return query.getMany();
  }
  rolePermissions(
    roleIds: number[],
    manager: EntityManager,
  ): Promise<AuthorizationRolePermission[]> {
    if (!roleIds.length) return Promise.resolve([]);
    return manager.find(AuthorizationRolePermission, {
      where: { roleId: In(roleIds) },
      withDeleted: true,
      order: { id: 'ASC' },
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
