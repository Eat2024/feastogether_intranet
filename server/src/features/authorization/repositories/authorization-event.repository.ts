import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuthorizationEvent } from '../entities/authorization-event.entity';

/** append-only；不提供修改、刪除或還原稽核。 */
@Injectable()
export class AuthorizationEventRepository {
  async append(
    event: Omit<AuthorizationEvent, 'id' | 'createdAt'>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.save(manager.create(AuthorizationEvent, event));
  }
  list(
    manager: EntityManager,
    options: { moduleKey?: string; beforeId?: number; limit?: number } = {},
  ): Promise<AuthorizationEvent[]> {
    const query = manager
      .createQueryBuilder(AuthorizationEvent, 'e')
      .orderBy('e.id', 'DESC')
      .take(options.limit ?? 20);
    if (options.moduleKey)
      query.andWhere('e.moduleKey = :moduleKey', {
        moduleKey: options.moduleKey,
      });
    if (options.beforeId)
      query.andWhere('e.id < :beforeId', { beforeId: options.beforeId });
    return query.getMany();
  }
}
