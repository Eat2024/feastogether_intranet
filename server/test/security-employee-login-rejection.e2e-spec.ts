import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import request, { type Response } from 'supertest';
import { DataSource } from 'typeorm';
import { AuthSecurityEventRepository } from '#app/features/auth/repositories/auth-security-event.repository';
import { User } from '#app/features/users/entities/user.entity';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { apiData, apiError } from './api-response.helper';
import { employeeSessionCookie } from './employee-session.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import * as oidcStub from './stubs/openid-client.stub';
import {
  createSyntheticPortal,
  type SyntheticPortal,
} from './synthetic-portal.helper';

const ORIGIN = 'http://localhost:3000';
const LAUNCH_ISSUER = 'e2e-main-platform';
/** Portal 可登入、本機帳號正常：瀏覽器原本的登入者，也用來產生有效啟動碼。 */
const ACTIVE = 'SER001';
/** Portal 已非在職。 */
const LEFT = 'SER002';
/** Portal 可登入，本機帳號停用。 */
const DISABLED = 'SER003';
/** Portal 可登入，本機帳號已刪除。 */
const DELETED = 'SER004';
const EMPIDS = [ACTIVE, LEFT, DISABLED, DELETED];
// 限流計數存 Redis 且跨回合存活；每次 OAuth 登入用不同 client IP。
const newIp = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::28`;

interface EventRow {
  event_type: string;
  actor_kind: string;
  actor_user_id: number | null;
  session_id: number | null;
  outcome_code: string;
  request_id: string | null;
}

/**
 * 員工入口被本系統規則拒絕時的安全紀錄（027-05 後續）：上游身分已驗證才寫匿名
 * login.rejected／employee_ineligible；還沒通過信任關卡的失敗與系統故障不寫事件表。
 * 上游 OIDC 以 openid-client 替身取代，員工資料來自合成 Portal。
 */
describe('員工入口拒絕的安全紀錄', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let portal: SyntheticPortal;
  let startEventId: number;
  /** 瀏覽器原本的員工會話 cookie，每個案例重建。 */
  let original: string;
  const launchKey = createPrivateKey(
    Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString(
      'utf8',
    ),
  );
  const jtis: string[] = [];

  const setCookies = (response: Response): string[] =>
    ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const current = (cookie: string) =>
    request(ctx.server).get('/api/auth/session').set('Cookie', cookie);
  const lastEventId = async () =>
    Number(
      (
        await db.query<Array<{ id: string | null }>>(
          'SELECT MAX(id) id FROM auth_security_events',
        )
      )[0].id ?? 0,
    );
  /** 執行一次登入嘗試並取回期間新增的安全事件；e2e runInBand，期間沒有其他寫入者。 */
  const attempt = async (run: () => Promise<Response>) => {
    const before = await lastEventId();
    const response = await run();
    const events = await db.query<EventRow[]>(
      `SELECT event_type, actor_kind, actor_user_id, session_id, outcome_code, request_id
        FROM auth_security_events WHERE id > ? ORDER BY id`,
      [before],
    );
    return { response, events };
  };
  /** 拒絕不撤瀏覽器原會話、不發也不清任何 cookie。 */
  const expectBrowserUntouched = async (response: Response) => {
    expect(setCookies(response)).toEqual([]);
    await current(original).expect(200);
  };

  const upstreamUserNumber = (userNumber: string) =>
    oidcStub.fetchUserInfo.mockResolvedValue(
      oidcStub.userInfoOf({ userNumber }),
    );
  const oauthCallback = async (
    cookie: string,
    body: (state: string) => object = (state) => ({
      state,
      code: 'synthetic-code',
    }),
  ) => {
    const ip = newIp();
    const started = await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({})
      .expect(200);
    const state = new URL(
      apiData<{ authorizationUrl: string }>(started).authorizationUrl,
    ).searchParams.get('state')!;
    const tx = setCookies(started)[0].split(';')[0];
    return request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .set('Cookie', `${tx}; ${cookie}`)
      .send(body(state));
  };

  const launchJwt = (empid: string, key: KeyObject = launchKey) => {
    const jti = randomUUID();
    jtis.push(jti);
    return { jti, token: createLaunchJwt(empid, jti, key) };
  };
  const launch = (token: string, cookie?: string) => {
    const req = request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${token}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const launchCode = async () =>
    new URL(
      apiData<{ launchUrl: string }>(
        await launch(launchJwt(ACTIVE).token).expect(201),
      ).launchUrl,
    ).searchParams.get('code')!;
  const activate = (code: string, cookie?: string) => {
    const req = request(ctx.server).post('/api/auth/session').type('form');
    return (cookie ? req.set('Cookie', cookie) : req).send({ code });
  };
  const claimStatus = async (jti: string) =>
    (
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM auth_sessions WHERE source_jti_hash = ?',
        [sha256(`${LAUNCH_ISSUER}\0${jti}`)],
      )
    )[0]?.status;
  const withoutPortal = async (run: () => Promise<Response>) => {
    await portal.query('RENAME TABLE sys_person TO sys_person_revoked');
    try {
      return await run();
    } finally {
      await portal.query('RENAME TABLE sys_person_revoked TO sys_person');
    }
  };

  beforeAll(async () => {
    portal = await createSyntheticPortal();
    await portal.insertPeople([
      { person_empid: ACTIVE, person_name: '合成在職', person_status: 1 },
      { person_empid: LEFT, person_name: '合成離職', person_status: 3 },
      { person_empid: DISABLED, person_name: '合成停用', person_status: 1 },
      { person_empid: DELETED, person_name: '合成刪除', person_status: 1 },
    ]);
    ctx = await createSecurityE2eApp(undefined, null);
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    startEventId = await lastEventId();
    await db.manager.insert(User, [
      { empid: ACTIVE, name: '合成在職', isActive: true },
      { empid: DISABLED, name: '合成停用', isActive: false },
      {
        empid: DELETED,
        name: '合成刪除',
        isActive: true,
        deletedAt: new Date(),
      },
    ]);
  });

  beforeEach(async () => {
    oidcStub.resetOidcStub();
    upstreamUserNumber(ACTIVE);
    const { id } = await db.manager.findOneByOrFail(User, { empid: ACTIVE });
    original = await employeeSessionCookie(ctx.app, id);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (ctx) {
      // 安全事件以 FK 指向會話與員工，須先刪；本檔沒有替換會話，不需解除 replacement 連結。
      const users = 'SELECT id FROM users WHERE empid IN (?)';
      await db.query(
        `DELETE FROM auth_security_events
          WHERE (id > ? AND actor_kind = 'anonymous') OR actor_user_id IN (${users})`,
        [startEventId, EMPIDS],
      );
      await db.query(
        `DELETE FROM auth_sessions WHERE user_id IN (${users}) OR source_jti_hash IN (?)`,
        [EMPIDS, jtis.map((jti) => sha256(`${LAUNCH_ISSUER}\0${jti}`))],
      );
      await db.query('DELETE FROM users WHERE empid IN (?)', [EMPIDS]);
      await closeSecurityE2eApp(ctx);
    }
    await portal?.drop();
  });

  describe('上游身分已驗證、被本系統拒絕：寫一筆 login.rejected', () => {
    it.each<{
      case: string;
      run: () => Promise<Response>;
      status: number;
      code: string;
    }>([
      {
        case: 'OAuth 缺員編',
        // 空字串的 employee_number 由 OauthClient 正規化為 null。
        run: () => {
          upstreamUserNumber('');
          return oauthCallback(original);
        },
        status: 401,
        code: 'OAUTH_RESPONSE_INVALID',
      },
      {
        case: 'OAuth Portal 判定不可登入',
        run: () => {
          upstreamUserNumber(LEFT);
          return oauthCallback(original);
        },
        status: 401,
        code: 'AUTH_EXCHANGE_FAILED',
      },
      {
        case: 'OAuth 本機帳號停用',
        run: () => {
          upstreamUserNumber(DISABLED);
          return oauthCallback(original);
        },
        status: 403,
        code: 'ACCOUNT_DISABLED',
      },
      {
        case: 'OAuth 本機帳號已刪除',
        run: () => {
          upstreamUserNumber(DELETED);
          return oauthCallback(original);
        },
        status: 403,
        code: 'ACCOUNT_DISABLED',
      },
      {
        case: 'WebView Portal 判定不可登入',
        run: () => launch(launchJwt(LEFT).token, original),
        status: 401,
        code: 'AUTH_EXCHANGE_FAILED',
      },
      {
        case: 'WebView 本機帳號停用',
        run: () => launch(launchJwt(DISABLED).token, original),
        status: 401,
        code: 'AUTH_EXCHANGE_FAILED',
      },
      {
        case: 'WebView 本機帳號已刪除',
        run: () => launch(launchJwt(DELETED).token, original),
        status: 401,
        code: 'AUTH_EXCHANGE_FAILED',
      },
    ])(
      '$case：匿名 employee_ineligible，原回應不變',
      async ({ run, status, code }) => {
        const { response, events } = await attempt(run);
        expect(response.status).toBe(status);
        expect(apiError(response).code).toBe(code);
        expect(events).toEqual([
          {
            event_type: 'login.rejected',
            actor_kind: 'anonymous',
            actor_user_id: null,
            session_id: null,
            outcome_code: 'employee_ineligible',
            request_id: response.headers['x-request-id'],
          },
        ]);
        await expectBrowserUntouched(response);
      },
    );

    it('OAuth：事件寫入失敗回 503，不設 cookie、不撤原會話', async () => {
      upstreamUserNumber(LEFT);
      jest
        .spyOn(ctx.app.get(AuthSecurityEventRepository), 'append')
        .mockRejectedValue(new Error('合成事件寫入失敗'));
      const { response, events } = await attempt(() => oauthCallback(original));
      expect(response.status).toBe(503);
      expect(apiError(response).code).toBe('AUTH_DB_UNAVAILABLE');
      expect(events).toEqual([]);
      jest.restoreAllMocks();
      await expectBrowserUntouched(response);
    });

    it('WebView：事件寫入失敗回 503，jti 仍先標為失敗', async () => {
      const { jti, token } = launchJwt(LEFT);
      jest
        .spyOn(ctx.app.get(AuthSecurityEventRepository), 'append')
        .mockRejectedValue(new Error('合成事件寫入失敗'));
      const { response, events } = await attempt(() => launch(token, original));
      expect(response.status).toBe(503);
      expect(apiError(response).code).toBe('AUTH_DB_UNAVAILABLE');
      expect(events).toEqual([]);
      expect(await claimStatus(jti)).toBe('failed');
      jest.restoreAllMocks();
      await expectBrowserUntouched(response);
    });
  });

  describe('未通過信任關卡或系統故障：不寫事件表', () => {
    it.each<{ case: string; run: () => Promise<Response>; status: number }>([
      {
        case: 'OAuth 取消',
        run: () =>
          oauthCallback(original, (state) => ({
            state,
            error: 'access_denied',
          })),
        status: 400,
      },
      {
        case: 'OAuth 缺 code',
        run: () => oauthCallback(original, (state) => ({ state })),
        status: 400,
      },
      {
        case: 'OAuth 交易無效',
        run: () =>
          oauthCallback(original, () => ({
            state: randomUUID(),
            code: 'synthetic-code',
          })),
        status: 400,
      },
      {
        case: 'OAuth token 驗證失敗',
        run: () => {
          oidcStub.authorizationCodeGrant.mockRejectedValueOnce(
            new oidcStub.ResponseBodyError('invalid_grant'),
          );
          return oauthCallback(original);
        },
        status: 401,
      },
      {
        case: 'OAuth Portal 查詢失敗',
        run: () => withoutPortal(() => oauthCallback(original)),
        status: 502,
      },
      {
        case: 'WebView JWT 簽章錯誤',
        run: () =>
          launch(
            launchJwt(
              ACTIVE,
              generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
            ).token,
            original,
          ),
        status: 401,
      },
      {
        case: 'WebView JWT 重放',
        run: async () => {
          const { token } = launchJwt(ACTIVE);
          await launch(token).expect(201);
          return launch(token, original);
        },
        status: 401,
      },
      {
        case: 'WebView Portal 查詢失敗',
        run: () =>
          withoutPortal(() => launch(launchJwt(ACTIVE).token, original)),
        status: 502,
      },
    ])('$case', async ({ run, status }) => {
      const { response, events } = await attempt(run);
      expect(response.status).toBe(status);
      expect(events).toEqual([]);
      await expectBrowserUntouched(response);
    });

    it.each<{ case: string; prepare: () => Promise<string> }>([
      {
        case: '無效',
        prepare: () => Promise.resolve(randomBytes(32).toString('base64url')),
      },
      {
        case: '過期',
        prepare: async () => {
          const code = await launchCode();
          await db.query(
            `UPDATE auth_sessions SET launch_expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND)
              WHERE launch_code_hash = SHA2(?, 256)`,
            [code],
          );
          return code;
        },
      },
      {
        case: '已用過',
        prepare: async () => {
          const code = await launchCode();
          await activate(code).expect(303);
          return code;
        },
      },
    ])(
      'WebView 啟動碼$case：只記 auth.launch_code_rejected，log 不含啟動碼、cookie 與員編',
      async ({ prepare }) => {
        const code = await prepare();
        const info = jest.spyOn(ctx.app.get(AppLoggerService), 'info');
        const { response, events } = await attempt(() =>
          activate(code, original),
        );
        expect(response.status).toBe(401);
        expect(events).toEqual([]);
        await expectBrowserUntouched(response);
        const logs = info.mock.calls.map(([entry]) => entry);
        expect(logs).toContainEqual(
          expect.objectContaining({ event: 'auth.launch_code_rejected' }),
        );
        const logged = JSON.stringify(logs);
        for (const secret of [code, original.split('=')[1], ACTIVE]) {
          expect(logged).not.toContain(secret);
        }
      },
    );
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createLaunchJwt(empid: string, jti: string, key: KeyObject): string {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' });
  const payload = encoded({
    iss: LAUNCH_ISSUER,
    aud: 'e2e-esign',
    sub: empid,
    jti,
    iat: now,
    nbf: now,
    exp: now + 120,
  });
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    key,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
