import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  findById(id: number, manager: EntityManager): Promise<User | null> {
    return manager.findOne(User, { where: { id }, withDeleted: true });
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
}
