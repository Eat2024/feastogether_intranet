import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthRolePermission } from '#app/features/auth/entities/auth-role-permission.entity';

@Injectable()
export class PermissionRepository {
  constructor(private readonly db: MysqlEntityService) {}

  listActiveGroups(): Promise<AuthGroup[]> {
    return this.db.authGroup.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  listActiveJobs(): Promise<AuthGroupJob[]> {
    return this.db.authGroupJob.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  listPermissions(): Promise<AuthJobPermission[]> {
    return this.db.authJobPermission.find({
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  async invalidPermissionIds(
    permissionIds: number[],
    manager?: EntityManager,
  ): Promise<number[]> {
    if (permissionIds.length === 0) return [];
    const queryBuilder = manager
      ? manager.createQueryBuilder(AuthJobPermission, 'jp')
      : this.db.authJobPermission.createQueryBuilder('jp');
    const rows = await queryBuilder
      .innerJoin(
        AuthGroupJob,
        'gj',
        'gj.id = jp.jobId AND gj.isActive = 1 AND gj.deletedAt IS NULL',
      )
      .innerJoin(
        AuthGroup,
        'g',
        'g.id = gj.groupId AND g.isActive = 1 AND g.deletedAt IS NULL',
      )
      .where('jp.id IN (:...ids)', { ids: permissionIds })
      .select('jp.id', 'id')
      .getRawMany<{ id: number }>();

    const validIds = new Set(rows.map((row) => Number(row.id)));
    return permissionIds.filter((id) => !validIds.has(id));
  }

  currentPermissionIds(
    roleId: number,
    manager?: EntityManager,
  ): Promise<AuthRolePermission[]> {
    return manager
      ? manager.find(AuthRolePermission, { where: { roleId } })
      : this.db.authRolePermission.find({ where: { roleId } });
  }

  async currentPermissionIdSet(
    roleId: number,
    manager?: EntityManager,
  ): Promise<Set<number>> {
    const rows = await this.currentPermissionIds(roleId, manager);
    return new Set(rows.map((row) => Number(row.permissionId)));
  }

  async overwriteRolePermissions(
    roleId: number,
    permissionIds: number[],
    manager: EntityManager,
  ): Promise<void> {
    await manager.delete(AuthRolePermission, { roleId });
    if (permissionIds.length === 0) return;
    const rows = permissionIds.map((permissionId) =>
      manager.create(AuthRolePermission, { roleId, permissionId }),
    );
    await manager.save(rows);
  }
}
