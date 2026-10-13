import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface LaunchView {
  launchUrl: string;
  expiresAt: string;
}

describe('WebView session happy path', () => {
  const empid = 'E2E00201';
  let ctx: SecurityE2eContext;
  let db: DataSource;
  const lookupEligibleStaff = jest.fn().mockResolvedValue({
    person_empid: empid,
    person_name: '測試員工',
    person_status: 1,
    person_status_name: '正式',
    department_id: 'D001',
    department_name: '資訊部',
    title: '工程師',
  });

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        lookupEligibleStaff,
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
  });

  afterAll(async () => {
    await db.query(
      'DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
      [empid],
    );
    await db.query('DELETE FROM users WHERE empid = ?', [empid]);
    await db.query(
      "DELETE FROM hr_departments WHERE department_name = 'Spec2 保留測試部門'",
    );
    await closeSecurityE2eApp(ctx);
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
    lookupEligibleStaff.mockResolvedValueOnce({
      person_empid: empid,
      person_name: '更新後姓名',
      person_status: 0,
      person_status_name: '試用',
      department_id: 'UPSTREAM-NOT-LOCAL-ID',
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
        department_name: string;
        name: string;
        person_status: string;
        title_name: string;
      }>
    >(
      `SELECT department_id, department_name, name, person_status, title_name
        FROM users WHERE empid = ?`,
      [empid],
    );
    expect(users[0]).toMatchObject({
      department_id: departmentId,
      department_name: '更新後部門顯示',
      name: '更新後姓名',
      person_status: '試用',
      title_name: '更新後職稱',
    });
  });

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
