import { Injectable } from '@nestjs/common';
import { DeepPartial, EntityManager, In } from 'typeorm';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';

@Injectable()
export class RoleRepository {
  constructor(private readonly db: MysqlEntityService) {}

  transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>) {
    return this.db.authRole.manager.transaction(runInTransaction);
  }

  findAllOrdered(): Promise<AuthRole[]> {
    return this.db.authRole.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  findAll(manager: EntityManager): Promise<AuthRole[]> {
    return manager.find(AuthRole);
  }

  findById(roleId: number, manager?: EntityManager): Promise<AuthRole | null> {
    return manager
      ? manager.findOne(AuthRole, { where: { id: roleId } })
      : this.db.authRole.findOne({ where: { id: roleId } });
  }

  /** 依 id 陣列批次載入（供批次操作一次撈 distinct 角色，避免 N+1）；空陣列回 []。 */
  findByIds(ids: number[], manager: EntityManager): Promise<AuthRole[]> {
    if (!ids.length) return Promise.resolve([]);
    return manager.find(AuthRole, { where: { id: In(ids) } });
  }

  findIdByRoleName(
    roleName: string,
    manager?: EntityManager,
  ): Promise<Pick<AuthRole, 'id'> | null> {
    const options = { where: { roleName }, select: { id: true } };
    return manager
      ? manager.findOne(AuthRole, options)
      : this.db.authRole.findOne(options);
  }

  create(data: DeepPartial<AuthRole>, manager: EntityManager): AuthRole {
    return manager.create(AuthRole, data);
  }

  save(role: AuthRole, manager: EntityManager): Promise<AuthRole> {
    return manager.save(role);
  }

  async saveMany(roles: AuthRole[], manager: EntityManager): Promise<void> {
    await manager.save(roles);
  }

  softRemove(role: AuthRole, manager: EntityManager): Promise<AuthRole> {
    return manager.softRemove(role);
  }

  async nextSortOrder(manager: EntityManager): Promise<number> {
    const row = await manager
      .createQueryBuilder(AuthRole, 'r')
      .select('MAX(r.sortOrder)', 'max')
      .getRawOne<{ max: string | null }>();
    return (Number(row?.max) || 0) + 1;
  }
}
