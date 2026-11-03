import { Injectable } from '@nestjs/common';
import { In, type DeepPartial, type EntityManager } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  findById(id: number, manager: EntityManager): Promise<User | null> {
    return manager.findOne(User, { where: { id }, withDeleted: true });
  }

  /** 文件建立交易先鎖員工，再建立文件，與登入同步維持相同鎖順序。 */
  findByIdForUpdate(id: number, manager: EntityManager): Promise<User | null> {
    return manager
      .createQueryBuilder(User, 'user')
      .withDeleted()
      .setLock('pessimistic_write')
      .where('user.id = :id', { id })
      .getOne();
  }

  /** 受理資格的 current read；共享鎖相容正式worker與外鍵引用，仍阻擋帳號異動。 */
  findByIdForShare(id: number, manager: EntityManager): Promise<User | null> {
    return manager
      .createQueryBuilder(User, 'user')
      .withDeleted()
      .setLock('pessimistic_read')
      .where('user.id = :id', { id })
      .getOne();
  }

  /** 包含軟刪除帳號，讓呼叫端統一判斷是否可指定為簽署人。 */
  findByIds(ids: number[], manager: EntityManager): Promise<User[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return manager.find(User, { where: { id: In(ids) }, withDeleted: true });
  }

  /** 發起／維護專用信箱讀取；固定 ID 鎖順序，避免不同名單互相反向鎖定。 */
  async findByIdsWithEmail(
    ids: number[],
    manager: EntityManager,
    lock: boolean | 'shared' = false,
  ): Promise<User[]> {
    const ordered = [...new Set(ids)].sort((a, b) => a - b);
    const result: User[] = [];
    for (let offset = 0; offset < ordered.length; offset += 500) {
      const query = manager
        .createQueryBuilder(User, 'user')
        .withDeleted()
        .addSelect('user.email')
        .where('user.id IN (:...ids)', {
          ids: ordered.slice(offset, offset + 500),
        })
        .orderBy('user.id', 'ASC');
      if (lock)
        query.setLock(
          lock === 'shared' ? 'pessimistic_read' : 'pessimistic_write',
        );
      result.push(...(await query.getMany()));
    }
    return result;
  }

  /** 信箱用途的員編查詢：SQL 候選結果仍須以完整員編精確核對。 */
  async findByEmpidsWithEmail(
    empids: string[],
    manager: EntityManager,
  ): Promise<User[]> {
    const selected = [...new Set(empids)];
    const exact = new Set(selected);
    const found = new Map<number, User>();
    for (let offset = 0; offset < selected.length; offset += 500) {
      const rows = await manager
        .createQueryBuilder(User, 'user')
        .withDeleted()
        .addSelect('user.email')
        .where('user.empid IN (:...empids)', {
          empids: selected.slice(offset, offset + 500),
        })
        .getMany();
      for (const user of rows) {
        if (exact.has(user.empid)) found.set(Number(user.id), user);
      }
    }
    return [...found.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }

  /** 白名單只取有效員工的信箱；SQL 篩選後仍精確核對完整代碼。 */
  async findMailWhitelistEmails(
    empids: readonly string[],
    departmentCodes: readonly string[],
    manager: EntityManager,
  ): Promise<string[]> {
    const emails = new Set<string>();
    for (const [field, values] of [
      ['empid', empids],
      ['departmentCode', departmentCodes],
    ] as const) {
      const selected = [...new Set(values)];
      const exact = new Set(selected);
      for (let offset = 0; offset < selected.length; offset += 500) {
        const rows = await manager
          .createQueryBuilder(User, 'user')
          .select(['user.id', 'user.empid', 'user.departmentCode'])
          .addSelect('user.email')
          .where(`user.${field} IN (:...values)`, {
            values: selected.slice(offset, offset + 500),
          })
          .andWhere('user.is_active = :active', { active: true })
          .andWhere('user.deleted_at IS NULL')
          .getMany();
        for (const user of rows) {
          const value = user[field];
          const email = user.email?.trim().toLowerCase();
          if (value && exact.has(value) && email) emails.add(email);
        }
      }
    }
    return [...emails];
  }

  findByEmpid(empid: string, manager: EntityManager): Promise<User | null> {
    return manager.findOne(User, { where: { empid }, withDeleted: true });
  }

  findByEmpids(empids: string[], manager: EntityManager): Promise<User[]> {
    if (empids.length === 0) return Promise.resolve([]);
    return manager.find(User, {
      where: { empid: In(empids) },
      withDeleted: true,
    });
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
      .addOrderBy('user.id', 'ASC');
    const normalized = query?.trim();
    if (normalized) {
      builder.andWhere('(user.empid LIKE :query OR user.name LIKE :query)', {
        query: `%${normalized.replace(/[\\%_]/g, '\\$&')}%`,
      });
    }
    return builder.getMany();
  }
}
