import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

/** append-only；不提供修改或刪除方法。 */
@Injectable()
export class AuditLogRepository {
  async append(log: DeepPartial<AuditLog>, manager: EntityManager): Promise<void> {
    await manager.save(manager.create(AuditLog, log));
  }

  list(
    manager: EntityManager,
    options: {
      moduleKey?: string;
      actions?: readonly string[];
      beforeId?: number;
      limit?: number;
    } = {},
  ): Promise<AuditLog[]> {
    const query = manager
      .createQueryBuilder(AuditLog, 'log')
      .orderBy('log.id', 'DESC')
      .take(options.limit ?? 20);
    if (options.moduleKey)
      query.andWhere('log.moduleKey = :moduleKey', {
        moduleKey: options.moduleKey,
      });
    if (options.actions?.length)
      query.andWhere('log.action IN (:...actions)', { actions: options.actions });
    if (options.beforeId)
      query.andWhere('log.id < :beforeId', { beforeId: options.beforeId });
    return query.getMany();
  }
}
