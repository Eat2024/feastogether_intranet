import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { SuperUserAccess } from '../entities/super-user-access.entity';
import { isDuplicateEntryError } from './oauth-identity.repository';

const SINGLETON_ID = 1;

export type NewSuperUserAccess = Omit<
  SuperUserAccess,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** 維護入口 singleton；只讀未 soft-delete 的列，不提供刪除。 */
@Injectable()
export class SuperUserAccessRepository {
  find(manager: EntityManager): Promise<SuperUserAccess | null> {
    return manager.findOneBy(SuperUserAccess, { id: SINGLETON_ID });
  }

  /** 涉及維護身分的交易一律先鎖這一列，再鎖會話列。 */
  findForUpdate(manager: EntityManager): Promise<SuperUserAccess | null> {
    return manager
      .createQueryBuilder(SuperUserAccess, 'access')
      .setLock('pessimistic_write')
      .where('access.id = :id', { id: SINGLETON_ID })
      .getOne();
  }

  /**
   * 以固定 PK 仲裁首次建立。列已存在（包括並發中先 commit 的另一方）時回 false，不覆寫。
   * 用 INSERT 而非 save：save 遇到既有 PK 會改成 UPDATE。
   */
  async insertIfAbsent(
    access: NewSuperUserAccess,
    manager: EntityManager,
  ): Promise<boolean> {
    try {
      await manager.insert(SuperUserAccess, { ...access, id: SINGLETON_ID });
      return true;
    } catch (error) {
      if (isDuplicateEntryError(error)) return false;
      throw error;
    }
  }

  /** 更新已鎖定的 singleton；save 一併維護 updated_at。 */
  async save(access: SuperUserAccess, manager: EntityManager): Promise<void> {
    await manager.save(access);
  }
}
