import { randomBytes } from 'node:crypto';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { DataSource } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  AUTH_COOKIE_NAME,
  AUTH_RATE_LIMIT_SHORT_LIMIT,
} from '#app/features/auth/auth.constants';
import { SuperUserAccessRepository } from '#app/features/auth/repositories/super-user-access.repository';
import { SessionService } from '#app/features/auth/services/session.service';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { apiData, apiError, type InsertResult } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

/** setup-e2e.ts 以合成值覆寫的 Super user 帳密。 */
const ACCOUNT = 'e2e-super-user';
const PASSWORD = 'e2e-synthetic-super-user-password';
const ORIGIN = 'http://localhost:3000';
const newEntry = () => randomBytes(32).toString('base64url');
// 限流計數存 Redis 且跨回合存活；每個情境用不同 client IP，避免互相消耗額度。
const newIp = () =>
  `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

interface SessionView {
  actor: { kind: string; displayName?: string };
  user: unknown;
  expiresAt: string;
}

/** 隱藏維護入口的 HTTP 契約：位置驗證、帳密登入、身分讀取／登出與失敗語意。 */
describe('Super user hidden entry (027-04)', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let entryKey: string;
  let userId: number;

  const getEntry = (key: string) =>
    request(ctx.server).get(`/api/auth/super-user-entries/${key}`);
  const login = (
    key: string,
    body: unknown,
    {
      ip = newIp(),
      cookie,
      origin = ORIGIN,
    }: { ip?: string; cookie?: string; origin?: string | null } = {},
  ) => {
    const req = request(ctx.server)
      .post(`/api/auth/super-user-entries/${key}/sessions`)
      .set('X-Forwarded-For', ip);
    if (origin) req.set('Origin', origin);
    if (cookie) req.set('Cookie', `${AUTH_COOKIE_NAME}=${cookie}`);
    return typeof body === 'string'
      ? req.set('Content-Type', 'application/json').send(body)
      : req.send(body as object);
  };
  const getSession = (token: string) =>
    request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);
  const cookieFrom = (response: Response) => {
    const header = ([] as string[]).concat(
      response.headers['set-cookie'] ?? [],
    );
    return header.find((value) => value.startsWith(`${AUTH_COOKIE_NAME}=`));
  };
  const tokenFrom = (response: Response) =>
    /^[^=]+=([^;]*)/.exec(cookieFrom(response)!)![1];
  const counts = async () =>
    db.query<Array<Record<string, string>>>(
      `SELECT (SELECT COUNT(*) FROM auth_sessions) sessions,
        (SELECT COUNT(*) FROM auth_security_events) events,
        (SELECT updated_at FROM super_user_access WHERE id = 1) updated`,
    );
  const latestEvent = async () =>
    (
      await db.query<
        Array<{ event_type: string; actor_kind: string; outcome_code: string }>
      >(
        'SELECT event_type, actor_kind, outcome_code FROM auth_security_events ORDER BY id DESC LIMIT 1',
      )
    )[0];
  const rotate = async () => {
    entryKey = newEntry();
    await db.query(
      'UPDATE super_user_access SET entry_key = ?, entry_generation = entry_generation + 1 WHERE id = 1',
      [entryKey],
    );
  };
  const employeeToken = async () =>
    (
      await ctx.app
        .get(SessionService)
        .replace(null, { kind: 'employee', userId, source: 'webview' })
    ).token;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp(undefined, null);
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    entryKey = newEntry();
    await db.query(
      `INSERT INTO super_user_access (id, entry_key, entry_generation, rotated_at, period_start_at,
        active_credential_fingerprint, credential_generation, credential_activated_at)
        VALUES (1, ?, 1, NOW(6), NOW(6), ?, 1, NOW(6))`,
      [entryKey, ctx.app.get(SuperUserConfigService).fingerprint],
    );
    const result = await db.query<InsertResult>(
      "INSERT INTO users (empid, name) VALUES ('SUA001', '合成員工')",
    );
    userId = result.insertId;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (ctx) {
      const owned = "s.actor_kind = 'super_user' OR s.user_id = ?";
      await db.query(
        `DELETE e FROM auth_security_events e LEFT JOIN auth_sessions s ON s.id = e.session_id
          WHERE e.actor_kind IN ('super_user', 'anonymous') OR e.actor_user_id = ? OR ${owned}`,
        [userId, userId],
      );
      await db.query(
        `UPDATE auth_sessions s SET s.replacement_session_id = NULL WHERE ${owned}`,
        [userId],
      );
      await db.query(`DELETE s FROM auth_sessions s WHERE ${owned}`, [userId]);
      await db.query("DELETE FROM users WHERE empid = 'SUA001'");
      await db.query('DELETE FROM super_user_access');
      await closeSecurityE2eApp(ctx);
    }
  });

  describe('GET 位置驗證', () => {
    it('目前入口回 available，no-store；不設 cookie、不寫 DB', async () => {
      const before = await counts();
      const response = await getEntry(entryKey)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(apiData(response)).toEqual({ available: true });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await counts()).toEqual(before);
    });

    it.each([
      ['不存在的入口', newEntry()],
      ['格式不符', 'short'],
      ['長度相同但含非 base64url 字元', `${'A'.repeat(42)}.`],
    ])('%s回統一 404，不設 cookie、不寫 DB', async (_label, key) => {
      const before = await counts();
      const response = await getEntry(key).expect(404);

      expect(apiError(response).code).toBe(AppErrorCode.NOT_FOUND);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(entryKey);
      expect(await counts()).toEqual(before);
    });

    it('入口尚未初始化（singleton 不存在或已 soft-delete）回 404，不建立入口', async () => {
      await db.query(
        'UPDATE super_user_access SET deleted_at = NOW(6) WHERE id = 1',
      );
      try {
        const before = await counts();
        const response = await getEntry(entryKey).expect(404);
        expect(apiError(response).code).toBe(AppErrorCode.NOT_FOUND);
        await login(entryKey, { account: ACCOUNT, password: PASSWORD }).expect(
          404,
        );
        expect(await counts()).toEqual(before);
      } finally {
        await db.query(
          'UPDATE super_user_access SET deleted_at = NULL WHERE id = 1',
        );
      }
    });

    it('DB 不可用回 503，不放行也不當成 404', async () => {
      jest
        .spyOn(ctx.app.get(SuperUserAccessRepository), 'find')
        .mockRejectedValueOnce(new Error('connection lost'));

      const response = await getEntry(entryKey).expect(503);
      expect(apiError(response).code).toBe(AppErrorCode.AUTH_DB_UNAVAILABLE);
    });
  });

  describe('POST 帳密登入', () => {
    it('正確帳密回 201 Super user 身分並設定 HttpOnly host-only cookie；不回 token、帳號或入口', async () => {
      const response = await login(entryKey, {
        account: ACCOUNT,
        password: PASSWORD,
      })
        .expect(201)
        .expect('Cache-Control', 'no-store');

      const body = apiData<SessionView>(response);
      expect(body).toEqual({
        actor: { kind: 'super_user', displayName: 'Super user' },
        user: null,
        expiresAt: expect.any(String) as unknown,
      });
      expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(
        8 * 3600 * 1000 - 60_000,
      );
      const cookie = cookieFrom(response)!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=28800/);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).not.toMatch(/Domain=/i);
      const token = tokenFrom(response);
      for (const secret of [token, ACCOUNT, entryKey]) {
        expect(JSON.stringify(response.body)).not.toContain(secret);
      }
      expect(await latestEvent()).toMatchObject({
        event_type: 'login.succeeded',
        actor_kind: 'super_user',
      });

      expect(apiData<SessionView>(await getSession(token).expect(200))).toEqual(
        body,
      );
    });

    it('帳號錯或密碼錯都回同一個 401；記匿名拒絕事件，不設 cookie、不動原員工會話', async () => {
      const employee = await employeeToken();
      const responses = [];
      for (const body of [
        { account: 'someone-else', password: PASSWORD },
        { account: ACCOUNT, password: 'wrong-password' },
        { account: ` ${ACCOUNT}`, password: PASSWORD },
      ]) {
        const response = await login(entryKey, body, {
          cookie: employee,
        }).expect(401);
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(await latestEvent()).toEqual({
          event_type: 'login.rejected',
          actor_kind: 'anonymous',
          outcome_code: 'credentials_invalid',
        });
        responses.push(apiError(response));
      }

      expect(responses).toEqual(
        Array(3).fill({
          code: AppErrorCode.AUTH_SUPER_USER_CREDENTIALS_INVALID,
          message: '帳號或密碼錯誤',
        }),
      );
      expect(
        apiData<SessionView>(await getSession(employee).expect(200)).actor,
      ).toEqual({ kind: 'employee', userId });
    });

    it('帶員工 cookie 登入成功時原子替換：舊員工會話失效；再用已被取代的舊 cookie 登入回 409', async () => {
      const employee = await employeeToken();
      const response = await login(
        entryKey,
        { account: ACCOUNT, password: PASSWORD },
        { cookie: employee },
      ).expect(201);

      await getSession(employee).expect(401);
      await getSession(tokenFrom(response)).expect(200);

      const replaced = await login(
        entryKey,
        { account: ACCOUNT, password: PASSWORD },
        { cookie: employee },
      ).expect(409);
      expect(apiError(replaced).code).toBe(AppErrorCode.AUTH_SESSION_REPLACED);
      expect(replaced.headers['set-cookie']).toBeUndefined();
    });

    it('舊入口在 GET 與 POST 都回 404；無效入口不先跑 DTO 驗證', async () => {
      const old = entryKey;
      await rotate();

      await getEntry(old).expect(404);
      const response = await login(old, {
        account: ACCOUNT,
        password: PASSWORD,
      }).expect(404);
      expect(apiError(response).code).toBe(AppErrorCode.NOT_FOUND);
      expect(response.headers['set-cookie']).toBeUndefined();
      await login(old, { unexpected: true }).expect(404);
      await login(entryKey, { account: ACCOUNT, password: PASSWORD }).expect(
        201,
      );
    });

    it('KDF 期間入口輪換先 commit：交易內重驗回 404，不簽發會話', async () => {
      const config = ctx.app.get(SuperUserConfigService);
      const verify = config.verify.bind(
        config,
      ) as SuperUserConfigService['verify'];
      jest
        .spyOn(config, 'verify')
        .mockImplementationOnce(async (account, password) => {
          const matched = await verify(account, password);
          await rotate();
          return matched;
        });
      const before = await counts();
      const stale = entryKey;

      const response = await login(stale, {
        account: ACCOUNT,
        password: PASSWORD,
      }).expect(404);

      expect(entryKey).not.toBe(stale);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await counts())[0].sessions).toBe(before[0].sessions);
    });

    it.each([
      ['缺密碼', { account: ACCOUNT }],
      ['空帳號', { account: '', password: PASSWORD }],
      ['帳號超過 128 字元', { account: 'a'.repeat(129), password: PASSWORD }],
      [
        '密碼超過 1024 UTF-8 bytes',
        { account: ACCOUNT, password: 'é'.repeat(513) },
      ],
      ['非字串', { account: ACCOUNT, password: 12345678 }],
      ['多餘欄位', { account: ACCOUNT, password: PASSWORD, remember: true }],
    ])('有效入口但%s回 400，不進 KDF', async (_label, body) => {
      const verify = jest.spyOn(ctx.app.get(SuperUserConfigService), 'verify');

      const response = await login(entryKey, body).expect(400);

      expect(apiError(response).code).toBe(AppErrorCode.INVALID_REQUEST);
      expect(verify).not.toHaveBeenCalled();
    });

    it('128 字元帳號（含 emoji）與 1024 bytes 密碼在邊界內，交給帳密驗證', async () => {
      await login(entryKey, {
        account: '😀'.repeat(128),
        password: 'é'.repeat(512),
      }).expect(401);
    });

    it('含孤立 surrogate 的密碼不造成 500，照錯帳密回 401', async () => {
      await login(
        entryKey,
        `{"account":"${ACCOUNT}","password":"\\ud800"}`,
      ).expect(401);
    });

    it.each([
      ['缺 Origin', { origin: null }],
      ['不受信任 Origin', { origin: 'https://evil.example' }],
    ])('%s回 403，不驗帳密', async (_label, options) => {
      const verify = jest.spyOn(ctx.app.get(SuperUserConfigService), 'verify');

      const response = await login(
        entryKey,
        { account: ACCOUNT, password: PASSWORD },
        options,
      ).expect(403);

      expect(apiError(response).code).toBe(AppErrorCode.CSRF_ORIGIN_REJECTED);
      expect(verify).not.toHaveBeenCalled();
    });

    it('信任 Origin 但 Sec-Fetch-Site 為跨站仍回 403（iframe 信任清單不放行跨站管理登入）', async () => {
      await login(entryKey, { account: ACCOUNT, password: PASSWORD })
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
    });

    it('同一 IP 在有效入口超過短視窗額度回 429 與 Retry-After；錯誤入口不計入', async () => {
      const ip = newIp();
      for (let i = 0; i < AUTH_RATE_LIMIT_SHORT_LIMIT; i++) {
        await login(newEntry(), {}, { ip }).expect(404);
        await login(entryKey, {}, { ip }).expect(400);
      }

      const response = await login(
        entryKey,
        { account: ACCOUNT, password: PASSWORD },
        { ip },
      ).expect(429);

      expect(apiError(response).code).toBe(AppErrorCode.REFUSE_SERVICE);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      await login(
        entryKey,
        { account: ACCOUNT, password: PASSWORD },
        { ip: newIp() },
      ).expect(201);
    });

    it('限流儲存不可用回 503，不放行', async () => {
      const storage = ctx.app.get<ThrottlerStorage>(getStorageToken(), {
        strict: false,
      });
      jest
        .spyOn(storage, 'increment')
        .mockRejectedValueOnce(new Error('redis unavailable'));

      const response = await login(entryKey, {
        account: ACCOUNT,
        password: PASSWORD,
      }).expect(503);

      expect(apiError(response).code).toBe(
        AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      );
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('Super user 會話', () => {
    it('未明確允許的員工業務端點回 403（不是登入過期）；登出後會話失效', async () => {
      const token = tokenFrom(
        await login(entryKey, { account: ACCOUNT, password: PASSWORD }).expect(
          201,
        ),
      );

      const business = await request(ctx.server)
        .get('/api/esign/documents')
        .set('Origin', ORIGIN)
        .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`)
        .expect(403);
      expect(apiError(business).code).toBe(AppErrorCode.AUTH_ACTOR_NOT_ALLOWED);

      const logout = await request(ctx.server)
        .delete('/api/auth/session')
        .set('Origin', ORIGIN)
        .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`)
        .expect(200);
      expect(apiData(logout)).toEqual({ localLogout: 'completed' });
      expect(cookieFrom(logout)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      expect(await latestEvent()).toMatchObject({
        event_type: 'session.revoked',
        actor_kind: 'super_user',
      });
      await getSession(token).expect(401);
    });
  });
});
