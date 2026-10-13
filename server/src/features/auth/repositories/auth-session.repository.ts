import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  AUTH_SESSION_STATUS,
  AuthSession,
} from '../entities/auth-session.entity';

@Injectable()
export class AuthSessionRepository {
  createActive(
    userId: number,
    sourceJtiHash: string,
    sessionTokenHash: string,
    activatedAt: Date,
    expiresAt: Date,
    manager: EntityManager,
  ): Promise<AuthSession> {
    return manager.save(
      manager.create(AuthSession, {
        userId,
        source: 'webview',
        status: AUTH_SESSION_STATUS.ACTIVE,
        sourceJtiHash,
        assertionExpiresAt: activatedAt,
        verifiedAt: activatedAt,
        activatedAt,
        expiresAt,
        sessionTokenHash,
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

  findActive(
    sessionTokenHash: string,
    now: Date,
    manager: EntityManager,
  ): Promise<AuthSession | null> {
    return manager
      .createQueryBuilder(AuthSession, 'session')
      .innerJoinAndSelect('session.user', 'user')
      .where('session.session_token_hash = :sessionTokenHash', {
        sessionTokenHash,
      })
      .andWhere('session.status = :status', {
        status: AUTH_SESSION_STATUS.ACTIVE,
      })
      .andWhere('session.revoked_at IS NULL')
      .andWhere('session.expires_at > :now', { now })
      .andWhere('session.deleted_at IS NULL')
      .andWhere('user.deleted_at IS NULL')
      .andWhere('user.is_active = :isActive', { isActive: true })
      .getOne();
  }

  async revoke(
    sessionTokenHash: string,
    now: Date,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(AuthSession)
      .set({ status: AUTH_SESSION_STATUS.REVOKED, revokedAt: now })
      .where('session_token_hash = :sessionTokenHash', { sessionTokenHash })
      .andWhere('status = :status', { status: AUTH_SESSION_STATUS.ACTIVE })
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > :now', { now })
      .execute();
    return result.affected === 1;
  }
}
