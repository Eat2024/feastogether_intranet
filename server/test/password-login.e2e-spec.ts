import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource, In } from 'typeorm';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { User } from '#app/features/users/entities/user.entity';
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
  let departmentCode: string | null = 'PW017A';
  const documentIds: number[] = [];
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
          department_id: departmentCode,
          department_name: departmentCode ? '合成登入部門' : null,
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
    if (documentIds.length)
      await db.manager.delete(EsignDocument, { id: In(documentIds) });
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
    clientIp = ip,
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': clientIp, ...(origin ? { origin } : {}) },
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

  it('可信部門新增、調職與缺值清空；舊 session 後續查 DB 新部門，上游失敗不核發 session', async () => {
    const freshIp = () =>
      `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::17`;
    const enter = () =>
      login('synthetic-password', 'http://localhost:3000', empId, freshIp());
    departmentCode = 'PW017A';
    const original = await enter();
    expect(original.statusCode).toBe(200);
    const raw = original.headers['set-cookie'];
    const cookie = Array.isArray(raw) ? raw[0] : raw;
    if (typeof cookie !== 'string') throw new Error('缺少登入 cookie');
    const user = await db.manager.findOneByOrFail(User, { empid: empId });
    expect(user.departmentCode).toBe('PW017A');
    const docs = await db.manager.save(
      EsignDocument,
      ['PW017A', 'PW017B'].map((code) =>
        db.manager.create(EsignDocument, {
          docNumber: randomUUID(),
          title: '合成帳密部門文件',
          status: 'draft',
          createdByUserId: user.id,
          createdByDepartmentCode: code,
        }),
      ),
    );
    documentIds.push(...docs.map((doc) => doc.id));
    const visible = () =>
      app.inject({
        method: 'GET',
        url: '/api/esign/documents?role=dep',
        headers: { cookie: cookie.split(';')[0] },
      });
    const first = await visible();
    expect(first.statusCode).toBe(200);
    expect(
      first.json<{ data: Array<{ id: string }> }>().data.map((doc) => doc.id),
    ).toEqual([String(docs[0].id)]);
    departmentCode = 'PW017B';
    expect((await enter()).statusCode).toBe(200);
    const moved = await visible();
    expect(moved.statusCode).toBe(200);
    expect(
      moved.json<{ data: Array<{ id: string }> }>().data.map((doc) => doc.id),
    ).toEqual([String(docs[1].id)]);
    const sessions = await db.query<Array<{ total: number }>>(
      'SELECT COUNT(*) total FROM auth_sessions WHERE user_id=?',
      [user.id],
    );
    upstream.get.mockRejectedValueOnce(
      new FeastogetherApiError(503, null, '合成來源失敗'),
    );
    const failed = await enter();
    expect(failed.statusCode).toBe(502);
    expect(failed.headers['set-cookie']).toBeUndefined();
    expect(
      await db.query(
        'SELECT COUNT(*) total FROM auth_sessions WHERE user_id=?',
        [user.id],
      ),
    ).toEqual(sessions);
    expect(
      (await db.manager.findOneByOrFail(User, { id: user.id })).departmentCode,
    ).toBe('PW017B');
    departmentCode = null;
    expect((await enter()).statusCode).toBe(200);
    expect(
      await db.manager.findOneByOrFail(User, { id: user.id }),
    ).toMatchObject({ departmentCode: null, departmentName: null });
    expect((await visible()).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: cookie.split(';')[0] },
        })
      ).statusCode,
    ).toBe(200);
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
