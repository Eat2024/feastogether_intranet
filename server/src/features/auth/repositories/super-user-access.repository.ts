import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { SuperUserAccess } from '../entities/super-user-access.entity';

const SINGLETON_ID = 1;

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
}
