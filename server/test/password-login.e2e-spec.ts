import { randomBytes, randomUUID } from 'node:crypto';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
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
import { PortalConfig } from '#app/infrastructure/portal/portal.config';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import {
  createSyntheticPortal,
  startUnresponsivePortal,
  type SyntheticPerson,
  type SyntheticPortal,
  type UnresponsivePortal,
} from './synthetic-portal.helper';

const freshIp = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;

/** 饗賓人只驗證密碼；員工資料查詢一律走 Portal，任何 GET（hr/staff_lookup）都不該發生。 */
function createUpstream() {
  return {
    post: jest.fn(
      (_path: string, body: { account_id: string; password: string }) =>
        body.password === 'synthetic-password'
          ? Promise.resolve({
              token: 'synthetic-upstream-token',
              user: { person_empid: body.account_id },
            })
          : Promise.reject(new FeastogetherApiError(401, null, '上游驗證失敗')),
    ),
    get: jest.fn(),
  };
}

async function startApp(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<NestFastifyApplication> {
  const module = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app = module.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(),
    { bodyParser: false },
  );
  configureApp(app);
  await registerFastifyPlugins(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function loginWith(
  app: NestFastifyApplication,
  empId: string,
  password: string,
  origin: string | undefined = 'http://localhost:3000',
  clientIp = freshIp(),
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-forwarded-for': clientIp, ...(origin ? { origin } : {}) },
    payload: { empId, password },
  });
}

/** Portal 錯誤（mysql2 訊息、err.sql）不得帶出 Portal 主機、帳號或資料庫名稱。 */
function expectNoPortalDetails(body: string, config: PortalConfig) {
  for (const value of [config.host, config.user, config.database]) {
    expect(body).not.toContain(value);
  }
}

/** 上游 HTTP 使用合成資料；員工資料來自合成 Portal；正式登入路由、資格檢查、MySQL session、Redis 限流均實際執行。 */
describe('帳密登入 HTTP 整合', () => {
  let app: NestFastifyApplication;
  let db: DataSource;
  let portal: SyntheticPortal;
  const empId = 'E2EPASSWORD';
  const rejectedEmpids: string[] = [];
  const documentIds: number[] = [];
  const ip = freshIp();
  const upstream = createUpstream();

  const setStaff = (fields: Partial<SyntheticPerson>) =>
    portal.query('UPDATE sys_person SET ? WHERE person_empid = ?', [
      fields,
      empId,
    ]);

  beforeAll(async () => {
    portal = await createSyntheticPortal();
    await portal.insertPeople([
      {
        person_empid: empId,
        person_name: '帳密測試員工',
        person_status: 1,
        department_id: 'PW017A',
        department_name: '合成登入部門',
      },
    ]);
    app = await startApp((builder) =>
      builder.overrideProvider(FeastogetherClient).useValue(upstream),
    );
    db = app.get<DataSource>(MYSQL_MAIN);
  });

  afterAll(async () => {
    if (app) {
      if (documentIds.length)
        await db.manager.delete(EsignDocument, { id: In(documentIds) });
      await db.query(
        'DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
        [empId],
      );
      await db.query('DELETE FROM users WHERE empid IN (?)', [
        [empId, ...rejectedEmpids],
      ]);
      await app.close();
    }
    await portal?.drop();
  });

  const login = (
    password: string,
    origin: string | undefined = 'http://localhost:3000',
    employee = empId,
    clientIp = ip,
  ) => loginWith(app, employee, password, origin, clientIp);

  it('錯誤密碼回 401，無 cookie，也不查 Portal', async () => {
    const lookup = jest.spyOn(
      app.get(PortalDirectoryService),
      'findEmployeesByEmpid',
    );
    const response = await login('wrong');
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    expect(response.body).toContain('INVALID_CREDENTIALS');
    lookup.mockRestore();
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

  it.each([
    { person_status: 0, personStatus: '試用' },
    { person_status: 1, personStatus: '正式' },
  ])(
    'Portal 狀態 $person_status：登入成功，本機員工資料照現行規則更新',
    async ({ person_status, personStatus }) => {
      await setStaff({
        person_name: ' 帳密測試員工 ',
        person_status,
        title: '合成職稱',
      });
      expect(
        (await loginWith(app, empId, 'synthetic-password')).statusCode,
      ).toBe(200);
      expect(
        await db.manager.findOneByOrFail(User, { empid: empId }),
      ).toMatchObject({
        name: '帳密測試員工',
        personStatus,
        departmentCode: 'PW017A',
        departmentName: '合成登入部門',
        titleName: '合成職稱',
        departmentId: null,
      });
      expect(upstream.get).not.toHaveBeenCalled();
    },
  );

  it.each<{ case: string; empid: string; rows: SyntheticPerson[] }>([
    { case: '查無', empid: 'E2EPWNONE', rows: [] },
    {
      case: '同員編兩筆在職',
      empid: 'E2EPWDUP',
      rows: [
        { person_empid: 'E2EPWDUP', person_name: '合成甲', person_status: 1 },
        { person_empid: 'E2EPWDUP', person_name: '合成乙', person_status: 0 },
      ],
    },
    {
      case: '密碼通過但 Portal 已非在職',
      empid: 'E2EPWLEFT',
      rows: [
        {
          person_empid: 'E2EPWLEFT',
          person_name: '合成離職',
          person_status: 2,
        },
      ],
    },
    {
      case: '員編只差大小寫',
      empid: 'E2EPWCASE',
      rows: [
        {
          person_empid: 'e2epwcase',
          person_name: '合成小寫',
          person_status: 1,
        },
      ],
    },
    {
      case: '員編只差尾端空白',
      empid: 'E2EPWPAD',
      rows: [
        {
          person_empid: 'E2EPWPAD ',
          person_name: '合成空白',
          person_status: 1,
        },
      ],
    },
    {
      case: '姓名空白',
      empid: 'E2EPWNONAME',
      rows: [
        { person_empid: 'E2EPWNONAME', person_name: ' ', person_status: 1 },
      ],
    },
    {
      case: '部門代碼含非法字元',
      empid: 'E2EPWBADDEP',
      rows: [
        {
          person_empid: 'E2EPWBADDEP',
          person_name: '合成部門',
          person_status: 1,
          department_id: 'D 01',
        },
      ],
    },
  ])(
    '$case：回 AUTH_EXCHANGE_FAILED，不寫入本機也不發 session',
    async ({ empid, rows }) => {
      rejectedEmpids.push(empid);
      await portal.insertPeople(rows);
      const response = await loginWith(app, empid, 'synthetic-password');
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: 'AUTH_EXCHANGE_FAILED', message: '無法完成登入交換' },
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await db.manager.countBy(User, { empid })).toBe(0);
      expect(upstream.get).not.toHaveBeenCalled();
    },
  );

  it('可信部門新增、調職與缺值清空；舊 session 後續查 DB 新部門，Portal 失敗不核發 session', async () => {
    const enter = () =>
      login('synthetic-password', 'http://localhost:3000', empId, freshIp());
    await setStaff({
      department_id: 'PW017A',
      department_name: '合成登入部門',
    });
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
    await setStaff({ department_id: 'PW017B' });
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
    // 權限被收回：mysql2 錯誤訊息含 Portal 資料庫名稱，err.sql 含員編。
    await portal.query('RENAME TABLE sys_person TO sys_person_revoked');
    let failed: Awaited<ReturnType<typeof enter>>;
    try {
      failed = await enter();
    } finally {
      await portal.query('RENAME TABLE sys_person_revoked TO sys_person');
    }
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({
      error: { code: 'STAFF_LOOKUP_FAILED', message: '系統有錯，請詢問IT部門' },
    });
    expectNoPortalDetails(failed.body, app.get(PortalConfig));
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
    await setStaff({ department_id: '', department_name: '' });
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
    expect(upstream.get).not.toHaveBeenCalled();
  });

  it('Portal 姓名無法解碼（U+FFFD）時回 STAFF_LOOKUP_FAILED，不核發 session、不寫本機', async () => {
    const enter = () =>
      login('synthetic-password', 'http://localhost:3000', empId, freshIp());
    expect((await enter()).statusCode).toBe(200);
    const before = await db.manager.findOneByOrFail(User, { empid: empId });
    const sessions = await db.query<Array<{ total: number }>>(
      'SELECT COUNT(*) total FROM auth_sessions WHERE user_id=?',
      [before.id],
    );

    await setStaff({ person_name: '帳密�員工' });
    let failed: Awaited<ReturnType<typeof enter>>;
    try {
      failed = await enter();
    } finally {
      await setStaff({ person_name: '帳密測試員工' });
    }

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({
      error: { code: 'STAFF_LOOKUP_FAILED', message: '系統有錯，請詢問IT部門' },
    });
    expect(failed.headers['set-cookie']).toBeUndefined();
    expect(await db.manager.findOneByOrFail(User, { id: before.id })).toEqual(
      before,
    );
    expect(
      await db.query(
        'SELECT COUNT(*) total FROM auth_sessions WHERE user_id=?',
        [before.id],
      ),
    ).toEqual(sessions);
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

describe('帳密登入：Portal 不回應', () => {
  let app: NestFastifyApplication;
  let db: DataSource;
  let unresponsive: UnresponsivePortal;
  const empId = 'E2EPWSTALE';
  const upstream = createUpstream();

  beforeAll(async () => {
    unresponsive = await startUnresponsivePortal();
    app = await startApp((builder) =>
      builder
        .overrideProvider(FeastogetherClient)
        .useValue(upstream)
        .overrideProvider(PortalConfig)
        .useValue(unresponsive.config),
    );
    db = app.get<DataSource>(MYSQL_MAIN);
  });

  afterAll(async () => {
    await unresponsive?.close();
    if (app) {
      await db.query('DELETE FROM users WHERE empid = ?', [empId]);
      await app.close();
    }
  });

  it('15 秒內回 STAFF_LOOKUP_FAILED，不改查饗賓人，也不用本機舊資料放行', async () => {
    await db.manager.insert(User, {
      empid: empId,
      name: '本機舊資料',
      isActive: true,
    });
    const startedAt = Date.now();
    const response = await loginWith(app, empId, 'synthetic-password');
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'STAFF_LOOKUP_FAILED', message: '系統有錯，請詢問IT部門' },
    });
    expectNoPortalDetails(response.body, unresponsive.config);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(upstream.get).not.toHaveBeenCalled();
    const [sessions] = await db.query<Array<{ total: number }>>(
      'SELECT COUNT(*) total FROM auth_sessions a JOIN users u ON u.id = a.user_id WHERE u.empid = ?',
      [empId],
    );
    expect(Number(sessions.total)).toBe(0);
  }, 20_000);
});
