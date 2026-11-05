import { Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import {
  AUTH_SESSION_STATUS,
  AuthSession,
} from '../entities/auth-session.entity';

@Injectable()
export class AuthSessionRepository {
  createActive(
    fields: Pick<
      AuthSession,
      | 'actorKind'
      | 'userId'
      | 'source'
      | 'credentialGeneration'
      | 'sourceJtiHash'
      | 'sessionTokenHash'
    > & { activatedAt: Date; expiresAt: Date },
    manager: EntityManager,
  ): Promise<AuthSession> {
    return manager.save(
      manager.create(AuthSession, {
        ...fields,
        status: AUTH_SESSION_STATUS.ACTIVE,
        assertionExpiresAt: fields.activatedAt,
        verifiedAt: fields.activatedAt,
      }),
    );
  }

  createValidating(
    sourceJtiHash: string,
    assertionExpiresAt: Date,
    manager: EntityManager,
  ): Promise<AuthSession> {
    return manager.save(
      manager.create(AuthSession, {
        source: 'webview',
        status: AUTH_SESSION_STATUS.VALIDATING,
        sourceJtiHash,
        assertionExpiresAt,
      }),
    );
  }

  async markFailed(
    id: number,
    failureCode: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.update(
      AuthSession,
      { id, status: AUTH_SESSION_STATUS.VALIDATING },
      { status: AUTH_SESSION_STATUS.FAILED, failureCode },
    );
  }

  async markPending(
    id: number,
    userId: number,
    launchCodeHash: string,
    verifiedAt: Date,
    launchExpiresAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    const result = await manager.update(
      AuthSession,
      { id, status: AUTH_SESSION_STATUS.VALIDATING },
      {
        userId,
        launchCodeHash,
        verifiedAt,
        launchExpiresAt,
        status: AUTH_SESSION_STATUS.PENDING,
      },
    );
    if (result.affected !== 1)
      throw new Error('AUTH_SESSION_TRANSITION_FAILED');
  }

  findPendingForUpdate(
    launchCodeHash: string,
    now: Date,
    manager: EntityManager,
  ): Promise<AuthSession | null> {
    return manager
      .createQueryBuilder(AuthSession, 'session')
      .setLock('pessimistic_write')
      .where('session.launch_code_hash = :launchCodeHash', { launchCodeHash })
      .andWhere('session.status = :status', {
        status: AUTH_SESSION_STATUS.PENDING,
      })
      .andWhere('session.launch_expires_at > :now', { now })
      .andWhere('session.deleted_at IS NULL')
      .getOne();
  }

  save(session: AuthSession, manager: EntityManager): Promise<AuthSession> {
    return manager.save(session);
  }

  /** LEFT JOIN users：Super user 會話沒有員工列，員工狀態由呼叫端依 actorKind 判斷。 */
  findActive(
    sessionTokenHash: string,
    now: Date,
    manager: EntityManager,
  ): Promise<AuthSession | null> {
    return manager
      .createQueryBuilder(AuthSession, 'session')
      .leftJoinAndSelect('session.user', 'user')
      .where('session.session_token_hash = :sessionTokenHash', {
        sessionTokenHash,
      })
      .andWhere('session.status = :status', {
        status: AUTH_SESSION_STATUS.ACTIVE,
      })
      .andWhere('session.revoked_at IS NULL')
      .andWhere('session.expires_at > :now', { now })
      .andWhere('session.deleted_at IS NULL')
      .getOne();
  }

  /** 鎖定瀏覽器帶來的舊會話（任何狀態），供替換或登出判斷。 */
  findByTokenHashForUpdate(
    sessionTokenHash: string,
    manager: EntityManager,
  ): Promise<AuthSession | null> {
    return manager
      .createQueryBuilder(AuthSession, 'session')
      .setLock('pessimistic_write')
      .where('session.session_token_hash = :sessionTokenHash', {
        sessionTokenHash,
      })
      .getOne();
  }

  /** 撤銷已鎖定的會話；被新登入取代時同時記下 replacement。 */
  async revokeById(
    id: number,
    revokedAt: Date,
    replacementSessionId: number | null,
    manager: EntityManager,
  ): Promise<void> {
    await manager.update(
      AuthSession,
      { id },
      { status: AUTH_SESSION_STATUS.REVOKED, revokedAt, replacementSessionId },
    );
  }

  /**
   * 帳密啟用時撤銷全部 active 維護會話。呼叫端須在同一交易先鎖 singleton，新的維護會話因此無法同時建立。
   * 先以非鎖定讀取取 id 再依主鍵更新：直接用 actor_kind／status 條件更新時，InnoDB 經含 status 的
   * 次要索引先鎖索引列、再等主鍵列，會與「已鎖住舊維護會話、正要改它 status」的登出或身分切換互相等待而 deadlock。
   * 等待期間已被他人撤銷的列，由 status 條件在取得鎖後重新判斷而略過。
   */
  async revokeActiveSuperUser(
    revokedAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    const live = await manager.find(AuthSession, {
      select: { id: true },
      where: { actorKind: 'super_user', status: AUTH_SESSION_STATUS.ACTIVE },
    });
    await manager.update(
      AuthSession,
      { id: In(live.map(({ id }) => id)), status: AUTH_SESSION_STATUS.ACTIVE },
      { status: AUTH_SESSION_STATUS.REVOKED, revokedAt },
    );
  }
}
