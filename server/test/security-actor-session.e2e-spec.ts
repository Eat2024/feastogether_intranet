import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import type { IssuedSession } from '#app/features/auth/auth.types';
import { AuthSecurityEventRepository } from '#app/features/auth/repositories/auth-security-event.repository';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import { SessionService } from '#app/features/auth/services/session.service';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { apiData, apiError, type InsertResult } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface SessionRow {
  id: number;
  actor_kind: string;
  user_id: number | null;
  status: string;
  credential_generation: number | null;
  replacement_session_id: number | null;
}

const employee = (userId: number) =>
  ({ kind: 'employee', userId, source: 'webview' }) as const;
const superUser = { kind: 'super_user' } as const;
const staleToken = () => randomBytes(32).toString('base64url');

/** 共用會話對真實 MySQL 的 LEFT JOIN、鎖序、rollback 與並行替換行為。 */
describe('Actor-aware shared session', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let sessions: SessionService;
  const userIds: Record<string, number> = {};

  const sessionRow = async (token: string) => {
    const rows = await db.query<SessionRow[]>(
      'SELECT id, actor_kind, user_id, status, credential_generation, replacement_session_id FROM auth_sessions WHERE session_token_hash = SHA2(?, 256)',
      [token],
    );
    return rows[0];
  };
  const sessionCount = async () =>
    Number(
      (
        await db.query<Array<{ count: string }>>(
          "SELECT COUNT(*) count FROM auth_sessions WHERE actor_kind = 'super_user' OR user_id IN (?)",
          [Object.values(userIds)],
        )
      )[0].count,
    );
  const getSession = (token: string) =>
    request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);

  beforeAll(async () => {
    ctx = await createSecurityE2eApp(undefined, null);
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    sessions = ctx.app.get(SessionService);
    for (const empid of ['SAS001', 'SAS002', 'SAS003']) {
      const result = await db.query<InsertResult>(
        "INSERT INTO users (empid, name) VALUES (?, '合成員工')",
        [empid],
      );
      userIds[empid] = result.insertId;
    }
    await db.query(
      `INSERT INTO super_user_access (id, entry_key, entry_generation, rotated_at, period_start_at,
        active_credential_fingerprint, credential_generation, credential_activated_at)
        VALUES (1, ?, 1, NOW(6), NOW(6), ?, 1, NOW(6))`,
      [
        randomBytes(32).toString('base64url'),
        ctx.app.get(SuperUserConfigService).fingerprint,
      ],
    );
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (ctx) {
      const ids = Object.values(userIds);
      const owned = "s.actor_kind = 'super_user' OR s.user_id IN (?)";
      await db.query(
        `DELETE e FROM auth_security_events e LEFT JOIN auth_sessions s ON s.id = e.session_id
          WHERE e.actor_user_id IN (?) OR ${owned}`,
        [ids, ids],
      );
      await db.query(
        `UPDATE auth_sessions s SET s.replacement_session_id = NULL WHERE ${owned}`,
        [ids],
      );
      await db.query(`DELETE s FROM auth_sessions s WHERE ${owned}`, [ids]);
      await db.query("DELETE FROM users WHERE empid LIKE 'SAS%'");
      await db.query('DELETE FROM super_user_access');
      await closeSecurityE2eApp(ctx);
    }
  });

  // 放第一個：表內尚無 token 時，REPEATABLE READ 的 gap lock 必定覆蓋兩筆新 token，可穩定重現 deadlock。
  it('兩個帶不存在 cookie 的登入都鎖定查詢後才插入，仍不 deadlock', async () => {
    const real = new AuthSessionRepository();
    let arrived = 0;
    let release!: () => void;
    const bothLocked = new Promise<void>((resolve) => (release = resolve));
    jest
      .spyOn(ctx.app.get(AuthSessionRepository), 'findByTokenHashForUpdate')
      .mockImplementation(async (hash, manager) => {
        const row = await real.findByTokenHashForUpdate(hash, manager);
        if (++arrived === 2) release();
        await bothLocked;
        return row;
      });

    const results = await Promise.allSettled([
      sessions.replace(staleToken(), employee(userIds.SAS001)),
      sessions.replace(staleToken(), employee(userIds.SAS001)),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
  });

  it('員工會話沿用原 user 回應並新增 actor；Super user 會話不帶員工 FK，也不進員工 guard', async () => {
    const employeeSession = await sessions.replace(
      null,
      employee(userIds.SAS001),
    );
    const response = await getSession(employeeSession.token).expect(200);
    expect(apiData(response)).toEqual({
      actor: { kind: 'employee', userId: userIds.SAS001 },
      user: expect.objectContaining({
        id: userIds.SAS001,
        empId: 'SAS001',
      }) as unknown,
      expiresAt: employeeSession.expiresAt.toISOString(),
    });

    const superSession = await sessions.replace(null, superUser);
    expect(await sessionRow(superSession.token)).toMatchObject({
      actor_kind: 'super_user',
      user_id: null,
      credential_generation: 1,
    });
    await expect(sessions.authenticate(superSession.token)).resolves.toEqual({
      actor: { kind: 'super_user' },
      user: null,
      expiresAt: superSession.expiresAt,
    });
    // 員工 guard 尚未開放 Super user（後續 ticket 以明確 allow metadata 接入）。
    await getSession(superSession.token).expect(401);
  });

  it('停用或 soft-deleted 員工的會話以 LEFT JOIN 查出後拒絕', async () => {
    const inactive = await sessions.replace(null, employee(userIds.SAS002));
    const deleted = await sessions.replace(null, employee(userIds.SAS003));
    await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [
      userIds.SAS002,
    ]);
    await db.query('UPDATE users SET deleted_at = NOW(6) WHERE id = ?', [
      userIds.SAS003,
    ]);
    try {
      await expect(sessions.authenticate(inactive.token)).resolves.toBeNull();
      await expect(sessions.authenticate(deleted.token)).resolves.toBeNull();
      await getSession(inactive.token).expect(401);
    } finally {
      await db.query(
        'UPDATE users SET is_active = 1, deleted_at = NULL WHERE id IN (?)',
        [[userIds.SAS002, userIds.SAS003]],
      );
    }
  });

  it('每次驗證都讀 DB 版本：版本失配拒絕；本機設定不是啟用版本或入口已 soft-delete 時回 503', async () => {
    const { token } = await sessions.replace(null, superUser);
    try {
      await db.query('UPDATE super_user_access SET credential_generation = 2');
      await expect(sessions.authenticate(token)).resolves.toBeNull();

      await db.query(
        'UPDATE super_user_access SET credential_generation = 1, active_credential_fingerprint = ?',
        ['0'.repeat(64)],
      );
      await expect(sessions.authenticate(token)).rejects.toMatchObject({
        code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      });
      const response = await getSession(token).expect(503);
      expect(apiError(response).code).toBe(
        AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      );

      await db.query(
        'UPDATE super_user_access SET active_credential_fingerprint = ?, deleted_at = NOW(6)',
        [ctx.app.get(SuperUserConfigService).fingerprint],
      );
      await expect(sessions.replace(null, superUser)).rejects.toMatchObject({
        code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      });
    } finally {
      await db.query(
        'UPDATE super_user_access SET credential_generation = 1, active_credential_fingerprint = ?, deleted_at = NULL',
        [ctx.app.get(SuperUserConfigService).fingerprint],
      );
    }
    await expect(sessions.authenticate(token)).resolves.toMatchObject({
      actor: { kind: 'super_user' },
    });
  });

  it('同一舊 token 並行替換時只有一筆成功，另一筆回 409', async () => {
    const old = await sessions.replace(null, employee(userIds.SAS001));
    const results = await Promise.allSettled([
      sessions.replace(old.token, superUser),
      sessions.replace(old.token, employee(userIds.SAS001)),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<IssuedSession> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected.map((result) => result.reason as unknown)).toEqual([
      expect.objectContaining({ code: AppErrorCode.AUTH_SESSION_REPLACED }),
    ]);
    const winner = await sessionRow(fulfilled[0].value.token);
    expect(await sessionRow(old.token)).toMatchObject({
      status: 'revoked',
      replacement_session_id: winner.id,
    });
    await expect(sessions.authenticate(old.token)).resolves.toBeNull();
  });

  it('替換交易任一步失敗時 rollback：沒有新會話，舊會話仍有效且未被連結', async () => {
    const old = await sessions.replace(null, employee(userIds.SAS001));
    const before = await sessionCount();
    const real = new AuthSecurityEventRepository();
    jest
      .spyOn(ctx.app.get(AuthSecurityEventRepository), 'append')
      .mockImplementation((event, manager) =>
        event.eventType === 'login.succeeded'
          ? Promise.reject(new Error('合成事件寫入失敗'))
          : real.append(event, manager),
      );

    await expect(sessions.replace(old.token, superUser)).rejects.toMatchObject({
      code: AppErrorCode.AUTH_DB_UNAVAILABLE,
    });

    expect(await sessionCount()).toBe(before);
    expect(await sessionRow(old.token)).toMatchObject({
      status: 'active',
      replacement_session_id: null,
    });
    await getSession(old.token).expect(200);
  });

  it('登出撤銷並記事件；安全事件依 id 倒序分頁，最多 100 筆', async () => {
    const { token } = await sessions.replace(null, superUser);
    const session = await sessionRow(token);
    await sessions.revoke(token);

    expect(await sessionRow(token)).toMatchObject({
      status: 'revoked',
      replacement_session_id: null,
    });
    await expect(sessions.authenticate(token)).resolves.toBeNull();

    const repository = ctx.app.get(AuthSecurityEventRepository);
    const manager = db.manager;
    const [latest, previous] = await repository.list({ limit: 2 }, manager);
    expect(latest).toMatchObject({
      eventType: 'session.revoked',
      actorKind: 'super_user',
      actorUserId: null,
      sessionId: session.id,
      outcomeCode: 'logout',
      credentialGeneration: 1,
    });
    expect(previous).toMatchObject({
      eventType: 'login.succeeded',
      sessionId: session.id,
    });
    const page = await repository.list(
      { limit: 1, beforeId: latest.id },
      manager,
    );
    expect(page.map((event) => event.id)).toEqual([previous.id]);
    await expect(repository.list({ limit: 101 }, manager)).rejects.toThrow(
      RangeError,
    );
  });
});
