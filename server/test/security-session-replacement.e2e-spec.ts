import { createPrivateKey, randomBytes, randomUUID, sign } from 'node:crypto';
import request, { type Response } from 'supertest';
import { DataSource } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import {
  AUTH_COOKIE_NAME,
  OAUTH_TX_COOKIE_NAME,
} from '#app/features/auth/auth.constants';
import { AuthSecurityEventRepository } from '#app/features/auth/repositories/auth-security-event.repository';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { OauthClient } from '#app/infrastructure/http-client/oauth/oauth.client';
import { apiData, apiError } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  createSyntheticPortal,
  type SyntheticPortal,
} from './synthetic-portal.helper';

/** setup-e2e.ts 以合成值覆寫的 Super user 帳密。 */
const ACCOUNT = 'e2e-super-user';
const PASSWORD = 'e2e-synthetic-super-user-password';
const ORIGIN = 'http://localhost:3000';
const EMPID = 'SSR001';
const OTHER_EMPID = 'SSR002';
// 限流計數存 Redis 且跨回合存活；每次登入用不同 client IP，避免互相消耗額度。
const newIp = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::27`;

interface SessionRow {
  id: number;
  actor_kind: string;
  source: string;
  user_id: number | null;
  status: string;
  replacement_session_id: number | null;
}

interface SessionView {
  actor: { kind: string; userId?: number };
  user: { empId: string } | null;
}

/**
 * OAuth／WebView／Super user 三種入口共用同一個瀏覽器會話（027-05）：成功切換只留下新身分，
 * 失敗保留原身分；登出只撤目前會話。上游 OIDC 以替身取代，員工資料來自合成 Portal。
 */
describe('三入口共用會話替換', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let portal: SyntheticPortal;
  let entryKey: string;
  const oauth = {
    userNumber: EMPID,
    exchangeCode: jest.fn(() =>
      Promise.resolve({ accessToken: 'synthetic-provider-token', sub: 'sub' }),
    ),
  };

  const setCookies = (response: Response): string[] =>
    ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const sessionCookie = (response: Response) =>
    setCookies(response).find((value) =>
      value.startsWith(`${AUTH_COOKIE_NAME}=`),
    );
  const tokenOf = (response: Response) => {
    const cookie = sessionCookie(response);
    if (!cookie) throw new Error('缺少登入 cookie');
    return /^[^=]+=([^;]*)/.exec(cookie)![1];
  };
  const withSession = (token?: string) =>
    token ? `${AUTH_COOKIE_NAME}=${token}` : undefined;
  /** 失敗時一併顯示回應本文，看得出是哪一層拒絕。 */
  const expectStatus = async (
    pending: PromiseLike<Response>,
    status: number,
  ) => {
    const response = await pending;
    expect({ status: response.status, body: response.text }).toMatchObject({
      status,
    });
    return response;
  };

  const current = (token: string) =>
    request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', withSession(token)!);
  const row = async (token: string) =>
    (
      await db.query<SessionRow[]>(
        `SELECT id, actor_kind, source, user_id, status, replacement_session_id
          FROM auth_sessions WHERE session_token_hash = SHA2(?, 256)`,
        [token],
      )
    )[0];
  const pendingStatus = async (code: string) =>
    (
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM auth_sessions WHERE launch_code_hash = SHA2(?, 256)',
        [code],
      )
    )[0]?.status;

  /** WebView launch：只驗主平台 JWT 並回一次性 code，不碰瀏覽器目前會話。 */
  const launch = async (empid = EMPID, token?: string) => {
    const req = request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`);
    const cookie = withSession(token);
    if (cookie) req.set('Cookie', cookie);
    const response = await req.expect(201);
    expect(setCookies(response)).toEqual([]);
    return new URL(
      apiData<{ launchUrl: string }>(response).launchUrl,
    ).searchParams.get('code')!;
  };
  const activate = (code: string, token?: string) => {
    const req = request(ctx.server).post('/api/auth/session').type('form');
    const cookie = withSession(token);
    if (cookie) req.set('Cookie', cookie);
    return req.send({ code });
  };
  const webview = async (token?: string, empid = EMPID) =>
    activate(await launch(empid), token);

  const oauthLogin = async (token?: string) => {
    const ip = newIp();
    const started = await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({})
      .expect(200);
    const state = new URL(
      apiData<{ authorizationUrl: string }>(started).authorizationUrl,
    ).searchParams.get('state');
    const tx = setCookies(started)[0].split(';')[0];
    return request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .set('Cookie', [tx, withSession(token)].filter(Boolean).join('; '))
      .send({ state, code: 'synthetic-code' });
  };

  const superLogin = (token?: string, password = PASSWORD) => {
    const req = request(ctx.server)
      .post(`/api/auth/super-user-entries/${entryKey}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', newIp());
    const cookie = withSession(token);
    if (cookie) req.set('Cookie', cookie);
    return req.send({ account: ACCOUNT, password });
  };

  const logout = (token?: string) => {
    const req = request(ctx.server)
      .delete('/api/auth/session')
      .set('Origin', ORIGIN);
    const cookie = withSession(token);
    if (cookie) req.set('Cookie', cookie);
    return req;
  };

  beforeAll(async () => {
    portal = await createSyntheticPortal();
    await portal.insertPeople(
      [EMPID, OTHER_EMPID].map((empid) => ({
        person_empid: empid,
        person_name: '合成切換員工',
        person_status: 1,
        department_id: 'SSR027',
        department_name: '合成切換部門',
      })),
    );
    ctx = await createSecurityE2eApp(
      (builder) =>
        builder.overrideProvider(OauthClient).useValue({
          createLoginChallenge: () => ({
            state: randomUUID(),
            nonce: randomUUID(),
          }),
          buildAuthorizationUrl: ({ state }: { state: string }) =>
            Promise.resolve(
              `https://auth.example.test/authorize?state=${state}`,
            ),
          exchangeCode: () => oauth.exchangeCode(),
          fetchUserInfo: () =>
            Promise.resolve({
              sub: 'sub',
              userNumber: oauth.userNumber,
              name: '合成切換員工',
            }),
        }),
      null,
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    entryKey = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO super_user_access (id, entry_key, entry_generation, rotated_at, period_start_at,
        active_credential_fingerprint, credential_generation, credential_activated_at)
        VALUES (1, ?, 1, NOW(6), NOW(6), ?, 1, NOW(6))`,
      [entryKey, ctx.app.get(SuperUserConfigService).fingerprint],
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    oauth.exchangeCode.mockClear();
  });

  afterAll(async () => {
    if (ctx) {
      // 安全事件以 FK 指向會話與員工、被替換的舊會話以 FK 指向新會話：依序解除後才能刪。
      const users = 'SELECT id FROM users WHERE empid IN (?)';
      const empids = [EMPID, OTHER_EMPID];
      const owned = `s.actor_kind = 'super_user' OR s.user_id IN (${users})`;
      await db.query(
        `DELETE e FROM auth_security_events e LEFT JOIN auth_sessions s ON s.id = e.session_id
          WHERE e.actor_kind IN ('super_user', 'anonymous') OR e.actor_user_id IN (${users}) OR ${owned}`,
        [empids, empids],
      );
      await db.query(
        `UPDATE auth_sessions s SET s.replacement_session_id = NULL WHERE ${owned}`,
        [empids],
      );
      await db.query(`DELETE s FROM auth_sessions s WHERE ${owned}`, [empids]);
      await db.query('DELETE FROM users WHERE empid IN (?)', [empids]);
      await db.query('DELETE FROM super_user_access');
      await closeSecurityE2eApp(ctx);
    }
    await portal?.drop();
  });

  it('OAuth 與 WebView 對同員編對應同一本地員工，來源分別記為 oauth／webview', async () => {
    const viaWebview = tokenOf(await expectStatus(webview(), 303));
    const viaOauth = tokenOf(await expectStatus(oauthLogin(), 200));
    const fromWebview = apiData<SessionView>(
      await current(viaWebview).expect(200),
    );
    const fromOauth = apiData<SessionView>(await current(viaOauth).expect(200));
    expect(fromOauth.actor).toEqual(fromWebview.actor);
    expect(fromOauth.user?.empId).toBe(EMPID);
    expect(await row(viaWebview)).toMatchObject({ source: 'webview' });
    expect(await row(viaOauth)).toMatchObject({ source: 'oauth' });
  });

  it('employee→super_user→employee 雙向切換：每次只留新身分，舊 cookie 重放 401，另一瀏覽器不受影響', async () => {
    const otherBrowser = tokenOf(await webview(undefined, OTHER_EMPID));
    const viaWebview = tokenOf(await expectStatus(webview(), 303));
    const superFromWebview = tokenOf(await superLogin(viaWebview).expect(201));
    const viaOauth = tokenOf(
      await expectStatus(oauthLogin(superFromWebview), 200),
    );
    const superFromOauth = tokenOf(await superLogin(viaOauth).expect(201));
    const backToWebview = await expectStatus(webview(superFromOauth), 303);
    expect(backToWebview.headers.location).toBe('/');
    const latest = tokenOf(backToWebview);

    for (const replaced of [
      viaWebview,
      superFromWebview,
      viaOauth,
      superFromOauth,
    ])
      await current(replaced).expect(401);
    expect(
      apiData<SessionView>(await current(latest).expect(200)).user?.empId,
    ).toBe(EMPID);
    expect(
      apiData<SessionView>(await current(otherBrowser).expect(200)).user?.empId,
    ).toBe(OTHER_EMPID);

    const chain = [
      viaWebview,
      superFromWebview,
      viaOauth,
      superFromOauth,
      latest,
    ];
    const rows = await Promise.all(chain.map(row));
    expect(
      rows.map(({ actor_kind, source, status }) => [
        actor_kind,
        source,
        status,
      ]),
    ).toEqual([
      ['employee', 'webview', 'revoked'],
      ['super_user', 'super_user', 'revoked'],
      ['employee', 'oauth', 'revoked'],
      ['super_user', 'super_user', 'revoked'],
      ['employee', 'webview', 'active'],
    ]);
    // 每個舊會話都連結到取代它的下一個會話。
    expect(rows.slice(0, -1).map((r) => r.replacement_session_id)).toEqual(
      rows.slice(1).map((r) => r.id),
    );
    const events = await db.query<
      Array<{ event_type: string; actor_kind: string; session_id: number }>
    >(
      `SELECT event_type, actor_kind, session_id FROM auth_security_events
        WHERE session_id IN (?) ORDER BY id`,
      [rows.map((r) => r.id)],
    );
    expect(events.map((e) => [e.event_type, e.actor_kind])).toEqual([
      ['login.succeeded', 'employee'],
      ['session.replaced', 'employee'],
      ['login.succeeded', 'super_user'],
      ['session.replaced', 'super_user'],
      ['login.succeeded', 'employee'],
      ['session.replaced', 'employee'],
      ['login.succeeded', 'super_user'],
      ['session.replaced', 'super_user'],
      ['login.succeeded', 'employee'],
    ]);

    // 已被取代的舊 cookie 不能再用來登入任何入口。
    const replay = await expectStatus(oauthLogin(viaWebview), 409);
    expect(apiError(replay).code).toBe(AppErrorCode.AUTH_SESSION_REPLACED);
    expect(sessionCookie(replay)).toBeUndefined();
    const replayWebview = await expectStatus(webview(viaOauth), 409);
    expect(sessionCookie(replayWebview)).toBeUndefined();
  });

  it('WebView launch 與 bridge GET 不改瀏覽器身分；只有 activation 替換', async () => {
    const superToken = tokenOf(await superLogin().expect(201));
    const before = await row(superToken);
    const code = await launch(EMPID, superToken);
    const bridge = await request(ctx.server)
      .get(`/api/auth/webview?code=${code}`)
      .set('Cookie', withSession(superToken)!)
      .expect(200);
    expect(setCookies(bridge)).toEqual([]);
    expect(await row(superToken)).toEqual(before);
    expect(
      apiData<SessionView>(await current(superToken).expect(200)).actor.kind,
    ).toBe('super_user');

    const activated = await activate(code, superToken).expect(303);
    await current(superToken).expect(401);
    expect(
      apiData<SessionView>(await current(tokenOf(activated)).expect(200)).actor
        .kind,
    ).toBe('employee');
  });

  it.each([
    {
      case: 'WebView 與 Super user',
      first: (token: string) => webview(token),
      second: (token: string) => superLogin(token),
    },
    {
      case: 'OAuth 與 WebView',
      first: (token: string) => oauthLogin(token),
      second: (token: string) => webview(token),
    },
  ])(
    '$case 帶同一舊 cookie 並發：只有一筆成功，另一筆 409 且沒有 Set-Cookie',
    async ({ first, second }) => {
      const old = tokenOf(await expectStatus(webview(), 303));
      const responses = await Promise.all([first(old), second(old)]);
      const winners = responses.filter((r) => r.status < 400);
      const losers = responses.filter((r) => r.status >= 400);
      expect(winners).toHaveLength(1);
      expect(losers.map((r) => r.status)).toEqual([409]);
      expect(setCookies(losers[0])).toEqual([]);
      const winner = await row(tokenOf(winners[0]));
      expect(await row(old)).toMatchObject({
        status: 'revoked',
        replacement_session_id: winner.id,
      });
      await current(old).expect(401);
      await current(tokenOf(winners[0])).expect(200);
    },
  );

  it('並發落敗的 WebView 啟動碼不被消耗；替換交易失敗 rollback 也保留啟動碼與原會話', async () => {
    const old = tokenOf(await expectStatus(webview(), 303));
    const code = await launch();
    const real = new AuthSecurityEventRepository();
    jest
      .spyOn(ctx.app.get(AuthSecurityEventRepository), 'append')
      .mockImplementation((event, manager) =>
        event.eventType === 'login.succeeded'
          ? Promise.reject(new Error('合成事件寫入失敗'))
          : real.append(event, manager),
      );
    const failed = await activate(code, old).expect(503);
    expect(setCookies(failed)).toEqual([]);
    expect(await pendingStatus(code)).toBe('pending');
    expect(await row(old)).toMatchObject({
      status: 'active',
      replacement_session_id: null,
    });
    await current(old).expect(200);

    jest.restoreAllMocks();
    const activated = await activate(code, old).expect(303);
    expect(await pendingStatus(code)).toBe('active');
    await current(old).expect(401);
    await current(tokenOf(activated)).expect(200);
  });

  it.each<{ case: string; attempt: (token: string) => Promise<Response> }>([
    {
      case: 'OAuth 上游交換失敗',
      attempt: async (token) => {
        oauth.exchangeCode.mockRejectedValueOnce(
          new AppException(...AppErrors.OAUTH_RESPONSE_INVALID),
        );
        return expectStatus(oauthLogin(token), 401);
      },
    },
    {
      case: 'OAuth 員工資料來源失敗',
      attempt: async (token) => {
        await portal.query('RENAME TABLE sys_person TO sys_person_revoked');
        try {
          return await expectStatus(oauthLogin(token), 502);
        } finally {
          await portal.query('RENAME TABLE sys_person_revoked TO sys_person');
        }
      },
    },
    {
      case: 'OAuth 替換交易寫入失敗',
      attempt: async (token) => {
        jest
          .spyOn(ctx.app.get(AuthSecurityEventRepository), 'append')
          .mockRejectedValue(new Error('合成事件寫入失敗'));
        return expectStatus(oauthLogin(token), 503);
      },
    },
    {
      case: 'WebView 啟動碼無效',
      attempt: (token) => activate('A'.repeat(43), token).expect(401),
    },
    {
      case: 'Super user 帳密錯誤（KDF 後拒絕）',
      attempt: (token) => superLogin(token, 'wrong-password').expect(401),
    },
  ])('$case：不設 cookie、不撤原會話', async ({ attempt }) => {
    const old = tokenOf(await expectStatus(webview(), 303));
    const response = await attempt(old);
    expect(sessionCookie(response)).toBeUndefined();
    jest.restoreAllMocks();
    expect(await row(old)).toMatchObject({
      status: 'active',
      replacement_session_id: null,
    });
    await current(old).expect(200);
  });

  it('過期或已登出的舊 cookie 不擋新登入，也不被標成已替換', async () => {
    const expired = tokenOf(await expectStatus(webview(), 303));
    await db.query(
      'UPDATE auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE session_token_hash = SHA2(?, 256)',
      [expired],
    );
    const loggedOut = tokenOf(await expectStatus(webview(), 303));
    await logout(loggedOut).expect(200);

    for (const old of [expired, loggedOut]) {
      const before = await row(old);
      const next = tokenOf(await expectStatus(oauthLogin(old), 200));
      expect(await row(old)).toEqual(before);
      expect(before.replacement_session_id).toBeNull();
      await current(next).expect(200);
    }
  });

  it('登出只撤目前會話：不恢復先前身分、不影響另一瀏覽器；兩把 cookie 以寫入時屬性清除，缺 cookie 冪等', async () => {
    const otherBrowser = tokenOf(await webview(undefined, OTHER_EMPID));
    const employee = tokenOf(await expectStatus(webview(), 303));
    const superToken = tokenOf(await superLogin(employee).expect(201));

    const response = await logout(superToken).expect(200);
    expect(apiData(response)).toEqual({ localLogout: 'completed' });
    const cleared = setCookies(response);
    for (const name of [AUTH_COOKIE_NAME, OAUTH_TX_COOKIE_NAME]) {
      const cookie = cleared.find((value) => value.startsWith(`${name}=;`));
      expect(cookie).toEqual(expect.stringContaining('Max-Age=0'));
      expect(cookie).toEqual(expect.stringContaining('Path=/'));
      expect(cookie).toEqual(expect.stringContaining('HttpOnly'));
      expect(cookie).toEqual(expect.stringContaining('SameSite=Lax'));
    }
    expect(await row(superToken)).toMatchObject({
      status: 'revoked',
      replacement_session_id: null,
    });
    await current(superToken).expect(401);
    await current(employee).expect(401);
    await current(otherBrowser).expect(200);

    await logout(superToken).expect(200);
    const anonymous = await logout().expect(200);
    expect(sessionCookie(anonymous)).toEqual(
      expect.stringContaining('Max-Age=0'),
    );
  });

  it('登出撤銷失敗回 503 時不清 cookie，會話仍有效可重試', async () => {
    const token = tokenOf(await expectStatus(webview(), 303));
    jest
      .spyOn(ctx.app.get(AuthSecurityEventRepository), 'append')
      .mockRejectedValue(new Error('合成事件寫入失敗'));
    const failed = await logout(token).expect(503);
    expect(setCookies(failed)).toEqual([]);
    jest.restoreAllMocks();
    await current(token).expect(200);
    await logout(token).expect(200);
    await current(token).expect(401);
  });
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
