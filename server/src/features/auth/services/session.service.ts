import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { WEBVIEW_SESSION_TTL_SECONDS } from '../auth.constants';
import type {
  Actor,
  AuthenticatedSession,
  IssuedSession,
  SessionTarget,
} from '../auth.types';
import {
  AUTH_SESSION_STATUS,
  type AuthSession,
} from '../entities/auth-session.entity';
import type { SuperUserAccess } from '../entities/super-user-access.entity';
import { AuthSessionRepository } from '../repositories/auth-session.repository';
import { SuperUserAccessRepository } from '../repositories/super-user-access.repository';
import { isCurrentSuperUserEntry } from '../helpers/super-user-entry';
import { AuthSecurityEventService } from './auth-security-event.service';
import { SuperUserConfigService } from './super-user-config.service';

/**
 * OAuth、WebView 與 Super user 三種入口共用的 MySQL opaque session：驗證、原子替換、登出。
 * 會話固定 8 小時不滑動；維護會話每次都重新讀取 DB 版本，不快取。
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly sessions: AuthSessionRepository,
    private readonly access: SuperUserAccessRepository,
    private readonly superUserConfig: SuperUserConfigService,
    private readonly events: AuthSecurityEventService,
  ) {}

  /** 回 null 代表會話不存在、過期、撤銷、員工停用或維護版本已失效。 */
  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    if (!isOpaqueCredential(token)) return null;
    const manager = this.mysql.getManager();
    const session = await this.withDatabase(() =>
      this.sessions.findActive(digest(token), new Date(), manager),
    );
    if (!session) return null;
    // 查詢條件與 CHECK 已保證有效會話有到期時間。
    const expiresAt = session.expiresAt!;
    if (session.actorKind === 'employee') {
      // soft-deleted 員工不會被 JOIN 帶出；停用員工在此拒絕。
      if (!session.user?.isActive) return null;
      return {
        actor: { kind: 'employee', userId: Number(session.userId) },
        user: session.user,
        expiresAt,
      };
    }
    const access = await this.withDatabase(() => this.access.find(manager));
    const generation = this.activeCredentialGeneration(access);
    if (Number(session.credentialGeneration) !== generation) return null;
    return { actor: { kind: 'super_user' }, user: null, expiresAt };
  }

  /**
   * 讓新身分成為瀏覽器目前會話，並在同一交易撤銷瀏覽器帶來的仍有效舊會話。鎖序固定為
   * 維護 singleton（新身分是 Super user 時）→ 舊會話 → 新會話或待啟用的 WebView 列。失敗整筆 rollback、
   * 保留舊會話與未用過的啟動碼；入口已在鎖定前輪換時回 404；舊會話已被其他登入取代時回 409。
   * token 原值只在 commit 後回傳。
   */
  async replace(
    currentToken: string | null,
    target: SessionTarget,
  ): Promise<IssuedSession> {
    const token = createCredential();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + WEBVIEW_SESSION_TTL_SECONDS * 1000,
    );
    await this.inTransaction(async (manager) => {
      const credentialGeneration =
        target.kind === 'super_user'
          ? this.lockSuperUserGeneration(
              await this.access.findForUpdate(manager),
              target.entryKey,
            )
          : null;
      const previous =
        currentToken && isOpaqueCredential(currentToken)
          ? await this.sessions.findByTokenHashForUpdate(
              digest(currentToken),
              manager,
            )
          : null;
      if (previous?.replacementSessionId) {
        throw new AppException(...AppErrors.AUTH_SESSION_REPLACED);
      }
      const created =
        target.kind === 'webview_launch'
          ? await this.activateLaunch(
              target.launchCode,
              token,
              now,
              expiresAt,
              manager,
            )
          : await this.sessions.createActive(
              {
                actorKind: target.kind,
                userId: target.kind === 'employee' ? target.userId : null,
                source:
                  target.kind === 'employee' ? target.source : 'super_user',
                credentialGeneration,
                // 本地簽發沒有上游 JWT；以獨立隨機值滿足來源摘要唯一性。
                sourceJtiHash: digest(`local\0${createCredential()}`),
                sessionTokenHash: digest(token),
                activatedAt: now,
                expiresAt,
              },
              manager,
            );
      if (previous && isLive(previous, now)) {
        await this.sessions.revokeById(previous.id, now, created.id, manager);
        await this.events.append(
          {
            type: 'session.replaced',
            actor: actorOf(previous),
            outcome: 'replaced',
            sessionId: previous.id,
            credentialGeneration: previous.credentialGeneration,
          },
          manager,
        );
      }
      await this.events.append(
        {
          type: 'login.succeeded',
          actor: actorOf(created),
          outcome: 'succeeded',
          sessionId: created.id,
          credentialGeneration,
        },
        manager,
      );
    });
    return { token, expiresAt };
  }

  /** 登出：撤銷目前仍有效的會話；缺 cookie、無效或已撤銷都視為完成，不恢復任何先前身分。 */
  async revoke(token: string | null): Promise<void> {
    if (!token || !isOpaqueCredential(token)) return;
    const now = new Date();
    await this.inTransaction(async (manager) => {
      const session = await this.sessions.findByTokenHashForUpdate(
        digest(token),
        manager,
      );
      if (!session || !isLive(session, now)) return;
      await this.sessions.revokeById(session.id, now, null, manager);
      await this.events.append(
        {
          type: 'session.revoked',
          actor: actorOf(session),
          outcome: 'logout',
          sessionId: session.id,
          credentialGeneration: session.credentialGeneration,
        },
        manager,
      );
    });
  }

  /**
   * 一次性啟動碼只能用一次：鎖定未過期的待啟用列並就地轉為 active（員工由 launch 時寫入）。
   * 無效、過期或已用過都回 401。
   */
  private async activateLaunch(
    launchCode: string,
    token: string,
    now: Date,
    expiresAt: Date,
    manager: EntityManager,
  ): Promise<AuthSession> {
    const pending = await this.sessions.findPendingForUpdate(
      digest(launchCode),
      now,
      manager,
    );
    if (!pending) throw new AppException(...AppErrors.AUTH_EXCHANGE_FAILED);
    pending.status = AUTH_SESSION_STATUS.ACTIVE;
    pending.sessionTokenHash = digest(token);
    pending.activatedAt = now;
    pending.expiresAt = expiresAt;
    return this.sessions.save(pending, manager);
  }

  private lockSuperUserGeneration(
    access: SuperUserAccess | null,
    entryKey: string,
  ): number {
    const generation = this.activeCredentialGeneration(access);
    if (!isCurrentSuperUserEntry(entryKey, access!.entryKey)) {
      throw new AppException(...AppErrors.HTTP_NOT_FOUND);
    }
    return generation;
  }

  /** 本機設定須等於 DB 已啟用版本；入口未初始化或設定不符時維護身分暫停，不揭露差異。 */
  private activeCredentialGeneration(access: SuperUserAccess | null): number {
    if (
      access?.activeCredentialFingerprint !== this.superUserConfig.fingerprint
    ) {
      throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
    }
    return Number(access.credentialGeneration);
  }

  /**
   * READ COMMITTED：找不到舊 token 的鎖定查詢在 REPEATABLE READ 會取得 gap lock，
   * 兩個帶過期 cookie 的登入同時插入新列時可重現 deadlock；RC 只鎖既有列。
   */
  private async inTransaction(
    run: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    await this.withDatabase(() =>
      this.mysql.transaction(run, 'READ COMMITTED'),
    );
  }

  private async withDatabase<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(...AppErrors.AUTH_DB_UNAVAILABLE);
    }
  }
}

/** CHECK 保證 active 一定有到期時間。 */
function isLive(session: AuthSession, now: Date): boolean {
  return (
    session.status === AUTH_SESSION_STATUS.ACTIVE && session.expiresAt! > now
  );
}

function actorOf(session: AuthSession): Actor {
  return session.actorKind === 'employee'
    ? { kind: 'employee', userId: Number(session.userId) }
    : { kind: 'super_user' };
}

function createCredential(): string {
  return randomBytes(32).toString('base64url');
}

function isOpaqueCredential(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
