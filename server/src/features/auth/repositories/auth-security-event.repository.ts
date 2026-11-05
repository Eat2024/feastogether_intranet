import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuthSecurityEvent } from '../entities/auth-security-event.entity';

export const AUTH_SECURITY_EVENT_PAGE_DEFAULT = 20;
export const AUTH_SECURITY_EVENT_PAGE_MAX = 100;

export type NewAuthSecurityEvent = Omit<AuthSecurityEvent, 'id' | 'createdAt'>;

/** append-only：只新增與倒序查詢，不提供 update／delete。 */
@Injectable()
export class AuthSecurityEventRepository {
  async append(
    event: NewAuthSecurityEvent,
    manager: EntityManager,
  ): Promise<void> {
    await manager.insert(AuthSecurityEvent, event);
  }

  /** 依 id 倒序分頁；beforeId 為上一頁最後一筆的 id。 */
  async list(
    options: { limit?: number; beforeId?: number },
    manager: EntityManager,
  ): Promise<AuthSecurityEvent[]> {
    const limit = options.limit ?? AUTH_SECURITY_EVENT_PAGE_DEFAULT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > AUTH_SECURITY_EVENT_PAGE_MAX
    ) {
      throw new RangeError(
        `安全事件查詢筆數須為 1～${AUTH_SECURITY_EVENT_PAGE_MAX}`,
      );
    }
    const query = manager
      .createQueryBuilder(AuthSecurityEvent, 'event')
      .orderBy('event.id', 'DESC')
      .limit(limit);
    if (options.beforeId !== undefined) {
      query.where('event.id < :beforeId', { beforeId: options.beforeId });
    }
    return await query.getMany();
  }
}
