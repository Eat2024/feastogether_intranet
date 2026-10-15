import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  createFastifyAdapter,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import {
  FeastogetherApiError,
  FeastogetherClient,
} from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';

/** 上游 HTTP 使用合成資料；正式登入路由、資格檢查、MySQL session、Redis 限流均實際執行。 */
describe('帳密登入 HTTP 整合', () => {
  let app: NestFastifyApplication;
  let db: DataSource;
  const empId = 'E2EPASSWORD';
  const ip = `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
  const upstream = {
    post: jest.fn(
      (_path: string, body: { account_id: string; password: string }) =>
        body.password === 'synthetic-password'
          ? Promise.resolve({
              token: 'synthetic-upstream-token',
              user: { person_empid: body.account_id },
            })
          : Promise.reject(new FeastogetherApiError(401, null, '上游驗證失敗')),
    ),
    get: jest.fn(() =>
      Promise.resolve([
        {
          person_empid: empId,
          person_name: '帳密測試員工',
          person_status: 1,
          person_status_name: '正式',
          department_id: null,
          department_name: null,
          title: null,
        },
      ]),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FeastogetherClient)
      .useValue(upstream)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
      { bodyParser: false },
    );
    configureApp(app);
    await registerFastifyPlugins(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get<DataSource>(MYSQL_MAIN);
  });

  afterAll(async () => {
    if (!app) return;
    await db.query(
      'DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
      [empId],
    );
    await db.query('DELETE FROM users WHERE empid = ?', [empId]);
    await app.close();
  });

  const login = (
    password: string,
    origin: string | undefined = 'http://localhost:3000',
    employee = empId,
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': ip, ...(origin ? { origin } : {}) },
      payload: { empId: employee, password },
    });

  it('錯誤密碼回 401，無 cookie，也不觸發員工查詢', async () => {
    const response = await login('wrong');
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(upstream.get).not.toHaveBeenCalled();
    expect(response.body).toContain('INVALID_CREDENTIALS');
  });

  it('成功登入建立 HttpOnly session，期限到後回 401', async () => {
    const response = await login(
      'synthetic-password',
      'http://localhost:3000',
      ` ${empId} `,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('synthetic-password');
    expect(response.body).not.toContain('synthetic-upstream-token');
    const cookies = response.headers['set-cookie'];
    const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
    if (typeof cookie !== 'string') throw new Error('缺少登入 cookie');
    expect(cookie).toContain('FT_ESIGN_SESSION=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=28800');
    const headers = { cookie: cookie.split(';')[0] };
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers }))
        .statusCode,
    ).toBe(200);
    await db.query(
      'UPDATE auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
      [empId],
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers }))
        .statusCode,
    ).toBe(401);
  });

  it('拒絕空密碼與跨站／缺少 Origin 的登入', async () => {
    expect((await login('')).statusCode).toBe(400);
    expect(
      (await login('synthetic-password', 'https://evil.test')).statusCode,
    ).toBe(403);
    // 傳入空字串不送 Origin。
    expect((await login('synthetic-password', '')).statusCode).toBe(403);
  });

  it('過多帳密嘗試回 429 且不再呼叫上游', async () => {
    for (let attempt = 0; attempt < 10; attempt++) await login('wrong');
    const calls = upstream.post.mock.calls.length;
    const response = await login('wrong');
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(upstream.post.mock.calls).toHaveLength(calls);
  });
});
