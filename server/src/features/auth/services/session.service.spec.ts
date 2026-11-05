import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import type { AuthSecurityEvent } from '../entities/auth-security-event.entity';
import type { AuthSession } from '../entities/auth-session.entity';
import { AuthSecurityEventService } from './auth-security-event.service';
import { SessionService } from './session.service';

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const FINGERPRINT = 'f'.repeat(64);
const ENTRY = 'E'.repeat(43);
const T0 = new Date('2026-11-02T01:00:00Z');

interface FakeUser {
  id: number;
  empid: string;
  isActive: boolean;
  deletedAt: Date | null;
}

/**
 * 以記憶體模擬 auth_sessions／super_user_access／auth_security_events 與交易：
 * transaction 失敗時還原快照，等同 MySQL rollback。只模擬 SessionService 依賴的查詢語意。
 */
function setup() {
  let state = {
    sessions: [] as AuthSession[],
    access: {
      id: 1,
      entryKey: ENTRY,
      activeCredentialFingerprint: FINGERPRINT,
      credentialGeneration: 1,
    } as {
      entryKey: string;
      activeCredentialFingerprint: string;
      credentialGeneration: number;
    } | null,
    events: [] as Array<Partial<AuthSecurityEvent>>,
  };
  const users = new Map<number, FakeUser>([
    [7, { id: 7, empid: '00123', isActive: true, deletedAt: null }],
  ]);
  const locks: string[] = [];
  const failures: { findActive?: Error; eventType?: string } = {};
  const manager = {};

  const mysql = {
    getManager: () => manager,
    transaction: async (run: (m: object) => Promise<void>) => {
      const snapshot = structuredClone(state);
      try {
        await run(manager);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };
  const sessions = {
    findActive: (hash: string, now: Date) => {
      if (failures.findActive) return Promise.reject(failures.findActive);
      const row = state.sessions.find(
        (session) =>
          session.sessionTokenHash === hash &&
          session.status === 'active' &&
          !session.revokedAt &&
          session.expiresAt! > now,
      );
      if (!row) return Promise.resolve(null);
      // LEFT JOIN users：soft-deleted 員工不會被帶出。
      const user = row.userId ? users.get(Number(row.userId)) : undefined;
      return Promise.resolve({
        ...row,
        user: user && !user.deletedAt ? user : null,
      });
    },
    findByTokenHashForUpdate: (hash: string) => {
      locks.push('session');
      return Promise.resolve(
        state.sessions.find((session) => session.sessionTokenHash === hash) ??
          null,
      );
    },
    createActive: (fields: Partial<AuthSession>) => {
      locks.push('insert');
      const row = {
        ...fields,
        id: state.sessions.length + 1,
        status: 'active',
        revokedAt: null,
        replacementSessionId: null,
      } as AuthSession;
      state.sessions.push(row);
      return Promise.resolve(row);
    },
    revokeById: (
      id: number,
      revokedAt: Date,
      replacementSessionId: number | null,
    ) => {
      const row = state.sessions.find((session) => session.id === id)!;
      Object.assign(row, {
        status: 'revoked',
        revokedAt,
        replacementSessionId,
      });
      return Promise.resolve();
    },
  };
  const access = {
    find: () => Promise.resolve(state.access),
    findForUpdate: () => {
      locks.push('access');
      return Promise.resolve(state.access);
    },
  };
  const eventRepository = {
    append: (event: Partial<AuthSecurityEvent>) => {
      if (event.eventType === failures.eventType) {
        return Promise.reject(new Error('事件寫入失敗'));
      }
      state.events.push(event);
      return Promise.resolve();
    },
  };
  const events = new AuthSecurityEventService(
    mysql as never,
    eventRepository as never,
    { isActive: () => false } as never,
    { warn: jest.fn() } as never,
  );
  const service = new SessionService(
    mysql as never,
    sessions as never,
    access as never,
    { fingerprint: FINGERPRINT } as never,
    events,
  );
  return {
    service,
    users,
    locks,
    failures,
    get state() {
      return state;
    },
  };
}

const employee = { kind: 'employee', userId: 7, source: 'webview' } as const;
const superUser = { kind: 'super_user', entryKey: ENTRY } as const;

describe('SessionService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('員工會話帶 actor 與 users 列；固定八小時，期間驗證不延長', async () => {
    const { service } = setup();
    const issued = await service.replace(null, employee);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toEqual(new Date(T0.getTime() + EIGHT_HOURS_MS));
    await expect(service.authenticate(issued.token)).resolves.toMatchObject({
      actor: { kind: 'employee', userId: 7 },
      user: { empid: '00123' },
      expiresAt: issued.expiresAt,
    });

    jest.setSystemTime(T0.getTime() + EIGHT_HOURS_MS - 1);
    await expect(service.authenticate(issued.token)).resolves.toMatchObject({
      expiresAt: issued.expiresAt,
    });
    jest.setSystemTime(T0.getTime() + EIGHT_HOURS_MS);
    await expect(service.authenticate(issued.token)).resolves.toBeNull();
  });

  it('格式不符或不存在的 token 視為未登入', async () => {
    const { service } = setup();
    await expect(service.authenticate('not-a-token')).resolves.toBeNull();
    await expect(service.authenticate('a'.repeat(43))).resolves.toBeNull();
  });

  it.each([
    ['停用', (user: FakeUser) => (user.isActive = false)],
    ['soft-deleted', (user: FakeUser) => (user.deletedAt = new Date())],
  ])('員工%s後既有會話立即失效', async (_label, change) => {
    const { service, users } = setup();
    const { token } = await service.replace(null, employee);
    change(users.get(7)!);
    await expect(service.authenticate(token)).resolves.toBeNull();
  });

  it('登出撤銷目前會話並記事件；重複登出、缺 cookie 都視為完成', async () => {
    const context = setup();
    const { token } = await context.service.replace(null, employee);

    await context.service.revoke(token);
    await expect(context.service.authenticate(token)).resolves.toBeNull();
    await expect(context.service.revoke(token)).resolves.toBeUndefined();
    await expect(context.service.revoke(null)).resolves.toBeUndefined();
    await expect(
      context.service.revoke('a'.repeat(43)),
    ).resolves.toBeUndefined();
    expect(
      context.state.events.filter(
        (event) => event.eventType === 'session.revoked',
      ),
    ).toEqual([
      expect.objectContaining({
        actorKind: 'employee',
        actorUserId: 7,
        sessionId: 1,
        outcomeCode: 'logout',
      }),
    ]);
  });

  it('Super user 會話沒有員工 FK；每次驗證都比對 DB 目前版本，不快取', async () => {
    const context = setup();
    const { token } = await context.service.replace(null, superUser);

    expect(context.state.sessions[0]).toMatchObject({
      actorKind: 'super_user',
      userId: null,
      source: 'super_user',
      credentialGeneration: 1,
    });
    await expect(context.service.authenticate(token)).resolves.toEqual({
      actor: { kind: 'super_user' },
      user: null,
      expiresAt: new Date(T0.getTime() + EIGHT_HOURS_MS),
    });

    context.state.access!.credentialGeneration = 2;
    await expect(context.service.authenticate(token)).resolves.toBeNull();
  });

  it('本機帳密設定不是 DB 啟用版本或入口未初始化時，維護身分回 503 且不簽發', async () => {
    const context = setup();
    const { token } = await context.service.replace(null, superUser);
    const unavailable = {
      code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    };

    context.state.access!.activeCredentialFingerprint = 'e'.repeat(64);
    await expect(context.service.authenticate(token)).rejects.toMatchObject(
      unavailable,
    );
    await expect(
      context.service.replace(null, superUser),
    ).rejects.toMatchObject(unavailable);

    context.state.access = null;
    await expect(
      context.service.replace(null, superUser),
    ).rejects.toMatchObject(unavailable);
    expect(context.state.sessions).toHaveLength(1);
  });

  it('Super user 在鎖定 singleton 後重驗入口：輪換已先 commit 時舊入口回 404，原會話不動', async () => {
    const context = setup();
    const old = await context.service.replace(null, employee);
    context.state.access!.entryKey = 'N'.repeat(43);

    await expect(
      context.service.replace(old.token, superUser),
    ).rejects.toMatchObject({
      code: AppErrorCode.NOT_FOUND,
      status: HttpStatus.NOT_FOUND,
    });
    expect(context.state.sessions).toHaveLength(1);
    await expect(
      context.service.authenticate(old.token),
    ).resolves.toMatchObject({ actor: { kind: 'employee', userId: 7 } });
  });

  it('替換時同交易撤舊、連結 replacement 並記事件；鎖序為 singleton → 舊會話 → 新會話', async () => {
    const context = setup();
    const old = await context.service.replace(null, employee);
    context.locks.length = 0;

    const next = await context.service.replace(old.token, superUser);

    expect(context.locks).toEqual(['access', 'session', 'insert']);
    await expect(context.service.authenticate(old.token)).resolves.toBeNull();
    await expect(
      context.service.authenticate(next.token),
    ).resolves.toMatchObject({ actor: { kind: 'super_user' } });
    expect(context.state.sessions[0]).toMatchObject({
      status: 'revoked',
      replacementSessionId: 2,
    });
    expect(
      context.state.events.map((event) => [
        event.eventType,
        event.actorKind,
        event.sessionId,
      ]),
    ).toEqual([
      ['login.succeeded', 'employee', 1],
      ['session.replaced', 'employee', 1],
      ['login.succeeded', 'super_user', 2],
    ]);
  });

  it('替換中途失敗整筆 rollback：舊會話仍有效、沒有新會話，也不交出 token', async () => {
    const context = setup();
    const old = await context.service.replace(null, employee);
    context.failures.eventType = 'login.succeeded';

    await expect(
      context.service.replace(old.token, superUser),
    ).rejects.toMatchObject({ code: AppErrorCode.AUTH_DB_UNAVAILABLE });

    await expect(
      context.service.authenticate(old.token),
    ).resolves.toMatchObject({ actor: { kind: 'employee', userId: 7 } });
    expect(context.state.sessions).toHaveLength(1);
    expect(context.state.sessions[0].replacementSessionId).toBeNull();
  });

  it('已被替換的舊 token 再登入回 409，不建立新會話', async () => {
    const context = setup();
    const old = await context.service.replace(null, employee);
    await context.service.replace(old.token, employee);

    await expect(
      context.service.replace(old.token, superUser),
    ).rejects.toMatchObject({
      code: AppErrorCode.AUTH_SESSION_REPLACED,
      status: HttpStatus.CONFLICT,
    });
    expect(context.state.sessions).toHaveLength(2);
  });

  it('帶已登出或過期的 cookie 登入時簽新會話，不改動舊列', async () => {
    const context = setup();
    const loggedOut = await context.service.replace(null, employee);
    await context.service.revoke(loggedOut.token);
    const expired = await context.service.replace(null, employee);
    jest.setSystemTime(T0.getTime() + EIGHT_HOURS_MS);

    await context.service.replace(loggedOut.token, employee);
    await context.service.replace(expired.token, superUser);

    expect(
      context.state.sessions.map((session) => [
        session.status,
        session.replacementSessionId,
      ]),
    ).toEqual([
      ['revoked', null],
      ['active', null],
      ['active', null],
      ['active', null],
    ]);
  });

  it('DB 查詢失敗明確回 503，不當成未登入', async () => {
    const context = setup();
    context.failures.findActive = new Error('db down');
    await expect(
      context.service.authenticate('a'.repeat(43)),
    ).rejects.toMatchObject({
      code: AppErrorCode.AUTH_DB_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
