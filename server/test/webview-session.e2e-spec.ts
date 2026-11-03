import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { User } from '#app/features/users/entities/user.entity';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { apiData, apiError } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  createSyntheticPortal,
  type SyntheticPerson,
  type SyntheticPortal,
} from './synthetic-portal.helper';

interface LaunchView {
  launchUrl: string;
  expiresAt: string;
}

describe('WebView session happy path', () => {
  const empid = 'E2E00201';
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let portal: SyntheticPortal;
  const documentIds: number[] = [];
  const rejectedEmpids: string[] = [];
  // 員工資料來自合成 Portal；饗賓人 hr/staff_lookup 不得再被呼叫。
  const feastogether = { get: jest.fn(), post: jest.fn() };

  const setStaff = (fields: Partial<SyntheticPerson>) =>
    portal.query('UPDATE sys_person SET ? WHERE person_empid = ?', [
      fields,
      empid,
    ]);

  beforeAll(async () => {
    portal = await createSyntheticPortal();
    await portal.insertPeople([
      {
        person_empid: empid,
        person_name: '測試員工',
        person_status: 1,
        department_id: 'D001',
        department_name: '資訊部',
        title: '工程師',
      },
    ]);
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherClient).useValue(feastogether),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
  });

  afterEach(() => expect(feastogether.get).not.toHaveBeenCalled());

  afterAll(async () => {
    if (ctx) {
      if (documentIds.length)
        await db.manager.delete(EsignDocument, { id: In(documentIds) });
      await db.query(
        'DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
        [empid],
      );
      await db.query('DELETE FROM users WHERE empid IN (?)', [
        [empid, ...rejectedEmpids],
      ]);
      await db.query(
        "DELETE FROM hr_departments WHERE department_name = 'Spec2 保留測試部門'",
      );
      await closeSecurityE2eApp(ctx);
    }
    await portal?.drop();
  });

  it('201 launch → 200 唯讀 bridge → 303 session → 200 current → logout', async () => {
    const launchResponse = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const launch = apiData<LaunchView>(launchResponse);
    const url = new URL(launch.launchUrl);
    const code = url.searchParams.get('code');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const before = await sessionStatus();
    const bridge = await request(ctx.server)
      .get(`${url.pathname}${url.search}`)
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(bridge.headers['set-cookie']).toBeUndefined();
    expect(bridge.text).toContain('action="/api/auth/session"');
    expect(await sessionStatus()).toEqual(before);

    const activated = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303)
      .expect('Location', '/');
    const setCookie = activated.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain('FT_ESIGN_SESSION=');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const current = await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(apiData<{ user: { empId: string } }>(current).user.empId).toBe(
      empid,
    );

    await request(ctx.server)
      .delete('/api/auth/session')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie)
      .expect(200);
    await request(ctx.server)
      .delete('/api/auth/session')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie)
      .expect(200);
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('session 到期後立即失效且不滑動延長', async () => {
    const launchResponse = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);
    const code = new URL(
      apiData<LaunchView>(launchResponse).launchUrl,
    ).searchParams.get('code');
    const activated = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    const rawCookie: unknown = activated.headers['set-cookie'];
    const cookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
    if (typeof cookie !== 'string') throw new Error('缺少 session cookie');
    await db.query(
      `UPDATE auth_sessions a JOIN users u ON u.id = a.user_id
        SET a.expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE u.empid = ? AND a.status = 'active'`,
      [empid],
    );
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('既有 User 只更新白名單欄位並保留本地 department_id', async () => {
    await db.query(
      "INSERT INTO hr_departments (department_name) VALUES ('Spec2 保留測試部門')",
    );
    const departments = await db.query<Array<{ id: number }>>(
      "SELECT id FROM hr_departments WHERE department_name = 'Spec2 保留測試部門'",
    );
    const departmentId = Number(departments[0]?.id);
    await db.query('UPDATE users SET department_id = ? WHERE empid = ?', [
      departmentId,
      empid,
    ]);
    await setStaff({
      person_name: '更新後姓名',
      person_status: 0,
      department_id: 'UP-NOTLOCAL',
      department_name: '更新後部門顯示',
      title: '更新後職稱',
    });

    await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);

    const users = await db.query<
      Array<{
        department_id: number;
        department_code: string;
        department_name: string;
        name: string;
        person_status: string;
        title_name: string;
      }>
    >(
      `SELECT department_id, department_code, department_name, name, person_status, title_name
        FROM users WHERE empid = ?`,
      [empid],
    );
    expect(users[0]).toMatchObject({
      department_id: departmentId,
      department_code: 'UP-NOTLOCAL',
      department_name: '更新後部門顯示',
      name: '更新後姓名',
      person_status: '試用',
      title_name: '更新後職稱',
    });
  });

  it('部門同步更新、缺值清空與舊 session 重新讀 DB，不更改本機部門外鍵', async () => {
    const enter = async (code: string) => {
      await setStaff({
        department_id: code,
        department_name: code ? '合成同名部門' : '',
      });
      const launch = await request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
        .expect(201);
      const exchange = new URL(
        apiData<LaunchView>(launch).launchUrl,
      ).searchParams.get('code');
      const activated = await request(ctx.server)
        .post('/api/auth/session')
        .type('form')
        .send({ code: exchange })
        .expect(303);
      const raw: unknown = activated.headers['set-cookie'];
      const cookie: unknown = Array.isArray(raw) ? raw[0] : raw;
      if (typeof cookie !== 'string') throw new Error('缺少登入 cookie');
      return cookie;
    };
    const cookie = await enter('WV017A');
    const user = await db.manager.findOneByOrFail(User, { empid });
    const localDepartmentId = user.departmentId;
    expect(user.departmentCode).toBe('WV017A');
    const docs = await db.manager.save(
      EsignDocument,
      ['WV017A', 'WV017B'].map((code) =>
        db.manager.create(EsignDocument, {
          docNumber: randomUUID(),
          title: '合成WebView部門文件',
          status: 'draft',
          createdByUserId: user.id,
          createdByDepartmentCode: code,
        }),
      ),
    );
    documentIds.push(...docs.map((doc) => doc.id));
    const visible = () =>
      request(ctx.server)
        .get('/api/esign/documents?role=dep')
        .set('Cookie', cookie);
    expect(
      apiData<Array<{ id: string }>>(await visible().expect(200)).map(
        (doc) => doc.id,
      ),
    ).toEqual([String(docs[0].id)]);
    await enter('WV017B');
    expect(
      apiData<Array<{ id: string }>>(await visible().expect(200)).map(
        (doc) => doc.id,
      ),
    ).toEqual([String(docs[1].id)]);
    await portal.query('RENAME TABLE sys_person TO sys_person_revoked');
    let failed: request.Response;
    try {
      failed = await request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
        .expect(502);
    } finally {
      await portal.query('RENAME TABLE sys_person_revoked TO sys_person');
    }
    expect(apiError(failed)).toEqual({
      code: 'STAFF_LOOKUP_FAILED',
      message: '系統有錯，請詢問IT部門',
    });
    expect(failed.headers['set-cookie']).toBeUndefined();
    expect(
      (await db.manager.findOneByOrFail(User, { id: user.id })).departmentCode,
    ).toBe('WV017B');
    await enter('');
    expect(
      await db.manager.findOneByOrFail(User, { id: user.id }),
    ).toMatchObject({
      departmentCode: null,
      departmentName: null,
      departmentId: localDepartmentId,
    });
    await visible().expect(409);
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);
  });

  it.each<{ case: string; sub: string; rows: SyntheticPerson[] }>([
    { case: '查無', sub: 'E2EWVNONE', rows: [] },
    {
      case: '同員編兩筆在職',
      sub: 'E2EWVDUP',
      rows: [
        { person_empid: 'E2EWVDUP', person_name: '合成甲', person_status: 0 },
        { person_empid: 'E2EWVDUP', person_name: '合成乙', person_status: 0 },
      ],
    },
    {
      case: 'Portal 已非在職',
      sub: 'E2EWVLEFT',
      rows: [
        {
          person_empid: 'E2EWVLEFT',
          person_name: '合成離職',
          person_status: 8,
        },
      ],
    },
    {
      case: '員編只差尾端空白',
      sub: 'E2EWVPAD',
      rows: [
        {
          person_empid: 'E2EWVPAD ',
          person_name: '合成空白',
          person_status: 1,
        },
      ],
    },
    {
      case: '姓名空白',
      sub: 'E2EWVNONAME',
      rows: [
        { person_empid: 'E2EWVNONAME', person_name: '', person_status: 1 },
      ],
    },
  ])(
    '$case：launch 回 AUTH_EXCHANGE_FAILED，不建立帳號',
    async ({ sub, rows }) => {
      rejectedEmpids.push(sub);
      await portal.insertPeople(rows);
      const response = await request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${createLaunchJwt(sub)}`)
        .expect(401);
      expect(apiError(response)).toEqual({
        code: 'AUTH_EXCHANGE_FAILED',
        message: '無法完成登入交換',
      });
      expect(await db.manager.countBy(User, { empid: sub })).toBe(0);
    },
  );

  it.each([
    { column: 'is_active', value: 0, restore: 1 },
    { column: 'deleted_at', value: new Date(), restore: null },
  ])(
    '本地 inactive／soft-deleted User 拒絕新 launch：$column',
    async (state) => {
      await db.query(`UPDATE users SET ${state.column} = ? WHERE empid = ?`, [
        state.value,
        empid,
      ]);
      try {
        await request(ctx.server)
          .post('/api/auth/webview-launches')
          .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
          .expect(401);
      } finally {
        await db.query(`UPDATE users SET ${state.column} = ? WHERE empid = ?`, [
          state.restore,
          empid,
        ]);
      }
    },
  );

  async function sessionStatus(): Promise<string> {
    const rows = await db.query<Array<{ status: string }>>(
      `SELECT a.status FROM auth_sessions a
        JOIN users u ON u.id = a.user_id WHERE u.empid = ?`,
      [empid],
    );
    return rows[0]?.status ?? '';
  }
});

function createLaunchJwt(empid: string): string {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' });
  const payload = encoded({
    iss: 'e2e-main-platform',
    aud: 'e2e-esign',
    sub: empid,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 120,
  });
  const privateKey = createPrivateKey(
    Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString(
      'utf8',
    ),
  );
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
