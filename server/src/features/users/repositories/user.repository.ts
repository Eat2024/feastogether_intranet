import { Injectable } from '@nestjs/common';
import { In, type DeepPartial, type EntityManager } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  findById(id: number, manager: EntityManager): Promise<User | null> {
    return manager.findOne(User, { where: { id }, withDeleted: true });
  }

  /** 包含軟刪除帳號，讓呼叫端統一判斷是否可指定為簽署人。 */
  findByIds(ids: number[], manager: EntityManager): Promise<User[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return manager.find(User, { where: { id: In(ids) }, withDeleted: true });
  }

  findByEmpid(empid: string, manager: EntityManager): Promise<User | null> {
    return manager.findOne(User, { where: { empid }, withDeleted: true });
  }

  findByEmpidForUpdate(
    empid: string,
    manager: EntityManager,
  ): Promise<User | null> {
    return manager
      .createQueryBuilder(User, 'user')
      .withDeleted()
      .setLock('pessimistic_write')
      .where('user.empid = :empid', { empid })
      .getOne();
  }

  create(fields: DeepPartial<User>, manager: EntityManager): User {
    return manager.create(User, fields);
  }

  save(user: User, manager: EntityManager): Promise<User> {
    return manager.save(user);
  }

  async restore(id: number, manager: EntityManager): Promise<void> {
    await manager.restore(User, { id });
  }

  findActiveCandidates(query: string | undefined, manager: EntityManager) {
    const builder = manager
      .createQueryBuilder(User, 'user')
      .where('user.is_active = :active', { active: true })
      .andWhere('user.deleted_at IS NULL')
      .orderBy('user.empid', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .take(50);
    const normalized = query?.trim();
    if (normalized) {
      builder.andWhere('(user.empid LIKE :query OR user.name LIKE :query)', {
        query: `%${normalized.replace(/[\\%_]/g, '\\$&')}%`,
      });
    }
    return builder.getMany();
  }
}
