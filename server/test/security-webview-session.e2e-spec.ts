import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData, apiError } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface LaunchView {
  launchUrl: string;
}

describe('WebView session security', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  const lookupEligibleStaff = jest.fn((empid: string) =>
    Promise.resolve({
      person_empid: empid,
      person_name: '安全測試員工',
      person_status: 1,
      person_status_name: '正式',
      department_id: null,
      department_name: null,
      title: null,
    }),
  );

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
      `DELETE a FROM auth_sessions a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE u.empid LIKE 'SEC002%' OR a.user_id IS NULL`,
    );
    await db.query("DELETE FROM users WHERE empid LIKE 'SEC002%'");
    await closeSecurityE2eApp(ctx);
  });

  it('偽造簽章在 FGAPI 與 User 查詢前拒絕，錯誤不洩漏細節', async () => {
    const otherKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    }).privateKey;
    const response = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt('SEC00201', otherKey)}`)
      .expect(401);
    expect(apiError(response)).toEqual({
      code: 'AUTH_EXCHANGE_FAILED',
      message: '無法完成登入交換',
    });
    expect(lookupEligibleStaff).not.toHaveBeenCalled();
  });

  it('query、body 或 cookie 中的 JWT 不會被當作 launch credential', async () => {
    const token = createLaunchJwt('SEC00202');
    await request(ctx.server)
      .post(`/api/auth/webview-launches?token=${token}`)
      .expect(401);
    await request(ctx.server)
      .post('/api/auth/webview-launches')
      .send({ token })
      .expect(401);
    await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Cookie', `token=${token}`)
      .expect(401);
  });

  it('相同 jti 並發最多一個 launch，GET 重整不消耗 code', async () => {
    const token = createLaunchJwt('SEC00203');
    const responses = await Promise.all([
      request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${token}`),
      request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${token}`),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 401,
    ]);
    const success = responses.find((response) => response.status === 201)!;
    const launch = apiData<LaunchView>(success);
    const url = new URL(launch.launchUrl);
    await request(ctx.server).get(`${url.pathname}${url.search}`).expect(200);
    await request(ctx.server).get(`${url.pathname}${url.search}`).expect(200);
    expect(await statusFor('SEC00203')).toBe('pending');
  });

  it('同一 code 並發最多一個 303，且 redirect 固定為首頁', async () => {
    const launch = await newLaunch('SEC00204');
    const code = new URL(launch.launchUrl).searchParams.get('code')!;
    const responses = await Promise.all([
      request(ctx.server).post('/api/auth/session').type('form').send({ code }),
      request(ctx.server).post('/api/auth/session').type('form').send({ code }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      303, 401,
    ]);
    expect(
      responses.find((response) => response.status === 303)?.headers.location,
    ).toBe('/');
  });

  it('同員編的不同 JWT 並發只建立一筆 User', async () => {
    const empid = 'SEC00206';
    const responses = await Promise.all([
      request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${createLaunchJwt(empid)}`),
      request(ctx.server)
        .post('/api/auth/webview-launches')
        .set('Authorization', `Bearer ${createLaunchJwt(empid)}`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const rows = await db.query<Array<{ total: number }>>(
      'SELECT COUNT(*) total FROM users WHERE empid = ?',
      [empid],
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });

  it('過期 code 與額外 redirect 欄位皆不建立 cookie', async () => {
    const launch = await newLaunch('SEC00205');
    const code = new URL(launch.launchUrl).searchParams.get('code')!;
    await db.query(
      `UPDATE auth_sessions a JOIN users u ON u.id = a.user_id
        SET a.launch_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE u.empid = ?`,
      ['SEC00205'],
    );
    const expired = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(401);
    expect(expired.headers['set-cookie']).toBeUndefined();

    const extra = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code, redirect: 'https://attacker.example' })
      .expect(400);
    expect(extra.headers['set-cookie']).toBeUndefined();
  });

  async function newLaunch(empid: string): Promise<LaunchView> {
    const response = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);
    return apiData<LaunchView>(response);
  }

  async function statusFor(empid: string): Promise<string> {
    const rows = await db.query<Array<{ status: string }>>(
      `SELECT a.status FROM auth_sessions a
        JOIN users u ON u.id = a.user_id WHERE u.empid = ?`,
      [empid],
    );
    return rows[0]?.status ?? '';
  }
});

function createLaunchJwt(empid: string, overrideKey?: KeyObject): string {
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
  const privateKey =
    overrideKey ??
    createPrivateKey(
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
