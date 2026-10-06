import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';

@Injectable()
export class RoleUserRepository {
  constructor(private readonly db: MysqlEntityService) {}

  /**
   * 綁定此角色的全部使用者（含已停用，軟刪由 @DeleteDateColumn 自動排除）。
   * 供角色使用者清單以 isActive 標示啟用狀態（US3）；停用帳號仍須顯示以利稽核。
   */
  findByRoleId(roleId: number): Promise<AuthUser[]> {
    return this.db.authUser.find({
      where: { roleId },
      order: { id: 'ASC' },
    });
  }

  countActiveByRoleId(
    roleId: number,
    manager?: EntityManager,
  ): Promise<number> {
    return manager
      ? manager.count(AuthUser, { where: { roleId, isActive: true } })
      : this.db.authUser.count({ where: { roleId, isActive: true } });
  }

  async countActiveByRole(): Promise<Map<number, number>> {
    const rows = await this.db.authUser
      .createQueryBuilder('u')
      .select('u.roleId', 'roleId')
      .addSelect('COUNT(*)', 'cnt')
      .where('u.isActive = 1')
      .andWhere('u.roleId IS NOT NULL')
      .groupBy('u.roleId')
      .getRawMany<{ roleId: number; cnt: string }>();
    return new Map(rows.map((row) => [Number(row.roleId), Number(row.cnt)]));
  }
}
