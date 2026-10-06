// security-oauth-login.e2e-spec.ts
// 038 饗賓 OAuth 登入／登出 e2e（認證強制模式；真 MySQL／Redis）。
//
// `openid-client` 於 Jest 內為測試替身（test/stubs/openid-client.stub.ts）：
// 協定驗簽交給套件，本檔驗證本系統這一側——登入交易一次性與瀏覽器綁定、身分配對
// （D3 規則與真唯一約束）、session 格式、登出撤銷與上游結果如實回報。
import { randomBytes } from 'crypto';
process.env.OAUTH_ISSUER = 'https://auth.example.com';
process.env.OAUTH_CLIENT_ID = 'web-client-synthetic';
process.env.OAUTH_CLIENT_SECRET = 'synthetic-client-secret';
process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback';
process.env.OAUTH_LOGOUT_URL = 'https://auth.example.com/logout';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.CORS_ORIGIN = 'http://localhost:3000';

import request from 'supertest';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  AUTH_COOKIE_NAME,
  OAUTH_LOGOUT_UNCONFIRMED_MESSAGE,
  OAUTH_TX_COOKIE_NAME,
} from '#app/features/auth/auth.constants';
import type { ApiError, ApiSuccess } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  resetSecurityFixtures,
  seedSecurityRbac,
  SECURITY_EMPIDS,
  type SecurityE2eContext,
  type SecurityIdentities,
} from './security-e2e.helper';
import * as oidcStub from './stubs/openid-client.stub';

const ORIGIN = 'http://localhost:3000';
/** 本套件合成員編前綴（沿用 helper 的 `sec-` 以便 resetSecurityFixtures 清場）。 */
const OAUTH_EMP = (suffix: string) => `sec-oauth-${suffix}`;

type Session = {
  user: { id: number; empId: string };
  role: { id: number; roleCode: string } | null;
};
type CallbackData = { session: Session; redirectTo: string };
type LogoutData = {
  localLogout: string;
  upstreamLogout: string;
  message?: string;
};

const cookieOf = (res: request.Response, name: string): string | null => {
  const header = res.headers['set-cookie'] as string[] | undefined;
  const found = (header ?? []).find((c) => c.startsWith(`${name}=`));
  if (!found) return null;
  const value = found.split(';')[0].slice(name.length + 1);
  return value === '' ? null : found.split(';')[0];
};

describe('security: OAuth login / logout (038)', () => {
  let ctx: SecurityE2eContext;
  let ids: SecurityIdentities;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    ids = await seedSecurityRbac(ctx);
  });

  afterAll(async () => {
    await resetSecurityFixtures(ctx);
    await closeSecurityE2eApp(ctx);
  });

  beforeEach(async () => {
    oidcStub.resetOidcStub();
    // 認證端點限流以 IP 計數（10 次/60 秒）；本檔多案例共用同一 loopback IP，
    // 每案例前清掉 throttler 計數（key 形狀見 @nest-lab/throttler-storage-redis）。
    await ctx.redis.deleteByPattern('{*:short}:*');
    await ctx.redis.deleteByPattern('{*:long}:*');
  });

  const start = (redirectTo?: string) =>
    request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', ORIGIN)
      .send(redirectTo === undefined ? {} : { redirectTo });

  /** 走完 start → 取 state／交易 cookie → callback；回 callback 回應。beforeCallback 可覆寫替身行為。 */
  const login = async (
    identity: Partial<oidcStub.StubIdentity> & { refreshToken?: string | null },
    options: {
      redirectTo?: string;
      error?: string;
      beforeCallback?: () => void;
    } = {},
  ) => {
    oidcStub.authorizationCodeGrant.mockResolvedValue(
      oidcStub.tokensOf(identity),
    );
    oidcStub.fetchUserInfo.mockResolvedValue(oidcStub.userInfoOf(identity));
    options.beforeCallback?.();
    const startRes = await start(options.redirectTo).expect(200);
    const authorizationUrl = (
      startRes.body as ApiSuccess<{ authorizationUrl: string }>
    ).data.authorizationUrl;
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    const txCookie = cookieOf(startRes, OAUTH_TX_COOKIE_NAME)!;
    const body = options.error
      ? { state, error: options.error }
      : { state, code: 'synthetic-code' };
    const res = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('Cookie', txCookie)
      .send(body);
    return { res, state, txCookie };
  };

  const subOf = async (empId: string) => {
    const rows: Array<{ oauth_sub: string | null }> = await ctx.ds.query(
      'SELECT oauth_sub FROM auth_users WHERE person_empid = ?',
      [empId],
    );
    return rows[0]?.oauth_sub ?? null;
  };

  const countUsers = async (empId: string) => {
    const rows: Array<{ n: number }> = await ctx.ds.query(
      'SELECT COUNT(*) AS n FROM auth_users WHERE person_empid = ?',
      [empId],
    );
    return Number(rows[0].n);
  };

  it('start：回授權網址與 HttpOnly 交易 cookie；不回 nonce', async () => {
    const res = await start('/permissionManagement').expect(200);

    const data = (res.body as ApiSuccess<{ authorizationUrl: string }>).data;
    expect(Object.keys(data)).toEqual(['authorizationUrl']);
    const url = new URL(data.authorizationUrl);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.has('code_challenge')).toBe(false);
    const setCookie = (res.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith(`${OAUTH_TX_COOKIE_NAME}=`),
    )!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('start／callback／logout：跨站 Origin → 403 CSRF_ORIGIN_REJECTED', async () => {
    for (const path of [
      '/api/auth/oauth/start',
      '/api/auth/oauth/callback',
      '/api/auth/logout',
    ]) {
      const res = await request(ctx.server)
        .post(path)
        .set('Origin', 'https://evil.example.com')
        .send({});
      expect(res.status).toBe(403);
      expect((res.body as ApiError).error.code).toBe(
        AppErrorCode.CSRF_ORIGIN_REJECTED,
      );
    }
  });

  it('新員工首次登入：建立無角色帳號，下發 HttpOnly cookie，/me 回 oauth 來源', async () => {
    const empId = OAUTH_EMP('new');
    const { res } = await login(
      { sub: 'sub-new-1', employeeNumber: empId, name: '測試新人' },
      { redirectTo: '/permissionManagement/roleManagement' },
    );

    expect(res.status).toBe(200);
    const data = (res.body as ApiSuccess<CallbackData>).data;
    expect(data.redirectTo).toBe('/permissionManagement/roleManagement');
    expect(data.session.user.empId).toBe(empId);
    expect(data.session.role).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(
      /synthetic-(access|refresh|id)-token/,
    );
    const authCookie = cookieOf(res, AUTH_COOKIE_NAME)!;
    expect(authCookie).toBeTruthy();
    // 交易 cookie 已清除
    expect(cookieOf(res, OAUTH_TX_COOKIE_NAME)).toBeNull();
    await expect(countUsers(empId)).resolves.toBe(1);
    await expect(subOf(empId)).resolves.toBe('sub-new-1');

    const me = await request(ctx.server)
      .get('/api/auth/me')
      .set('Cookie', authCookie)
      .expect(200);
    expect((me.body as ApiSuccess<Session>).data.user.empId).toBe(empId);
    // Redis 不存明文 refresh token
    const raw = await ctx.redis.get(
      `auth:${data.session.user.id}:${authCookie.slice(AUTH_COOKIE_NAME.length + 1)}`,
    );
    expect(raw).not.toContain('synthetic-refresh-token');
  });

  it('回呼重放（同 state 再送）→ 400 OAUTH_TRANSACTION_INVALID，不再發 cookie', async () => {
    const { res, state, txCookie } = await login({
      sub: 'sub-new-1',
      employeeNumber: OAUTH_EMP('new'),
    });
    expect(res.status).toBe(200);

    const replay = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('Cookie', txCookie)
      .send({ state, code: 'synthetic-code' });

    expect(replay.status).toBe(400);
    expect((replay.body as ApiError).error.code).toBe(
      AppErrorCode.OAUTH_TRANSACTION_INVALID,
    );
    expect(cookieOf(replay, AUTH_COOKIE_NAME)).toBeNull();
  });

  it('缺交易 cookie／換瀏覽器 → 400，且不消耗原交易（原瀏覽器仍可完成）', async () => {
    const startRes = await start().expect(200);
    const state = new URL(
      (startRes.body as ApiSuccess<{ authorizationUrl: string }>).data
        .authorizationUrl,
    ).searchParams.get('state')!;
    const txCookie = cookieOf(startRes, OAUTH_TX_COOKIE_NAME)!;
    oidcStub.fetchUserInfo.mockResolvedValue(
      oidcStub.userInfoOf({
        sub: 'sub-new-1',
        employeeNumber: OAUTH_EMP('new'),
      }),
    );
    oidcStub.authorizationCodeGrant.mockResolvedValue(
      oidcStub.tokensOf({ sub: 'sub-new-1' }),
    );

    const noCookie = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .send({ state, code: 'synthetic-code' });
    expect(noCookie.status).toBe(400);
    const otherBrowser = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('Cookie', `${OAUTH_TX_COOKIE_NAME}=other-browser-token`)
      .send({ state, code: 'synthetic-code' });
    expect(otherBrowser.status).toBe(400);
    expect(oidcStub.authorizationCodeGrant).not.toHaveBeenCalled();

    const ok = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('Cookie', txCookie)
      .send({ state, code: 'synthetic-code' });
    expect(ok.status).toBe(200);
  });

  it('上游回 error（使用者取消）→ 400 OAUTH_LOGIN_CANCELLED，不換 token、不發 cookie', async () => {
    const { res } = await login({}, { error: 'access_denied' });

    expect(res.status).toBe(400);
    expect((res.body as ApiError).error.code).toBe(
      AppErrorCode.OAUTH_LOGIN_CANCELLED,
    );
    expect(oidcStub.authorizationCodeGrant).not.toHaveBeenCalled();
    expect(cookieOf(res, AUTH_COOKIE_NAME)).toBeNull();
  });

  it('套件驗證失敗（簽章／nonce／state 不符）→ 401 OAUTH_RESPONSE_INVALID，不建帳', async () => {
    const empId = OAUTH_EMP('bad-sig');
    const { res } = await login(
      { sub: 'sub-bad', employeeNumber: empId },
      {
        beforeCallback: () =>
          oidcStub.authorizationCodeGrant.mockRejectedValue(
            new Error('synthetic invalid signature'),
          ),
      },
    );

    expect(res.status).toBe(401);
    expect((res.body as ApiError).error.code).toBe(
      AppErrorCode.OAUTH_RESPONSE_INVALID,
    );
    await expect(countUsers(empId)).resolves.toBe(0);
  });

  it('上游未簽發 refresh token → 503 OAUTH_UNAVAILABLE，不查 UserInfo、不建帳', async () => {
    const empId = OAUTH_EMP('no-rt');
    const { res } = await login({
      sub: 'sub-no-rt',
      employeeNumber: empId,
      refreshToken: null,
    });

    expect(res.status).toBe(503);
    expect((res.body as ApiError).error.code).toBe(
      AppErrorCode.OAUTH_UNAVAILABLE,
    );
    expect(oidcStub.fetchUserInfo).not.toHaveBeenCalled();
    await expect(countUsers(empId)).resolves.toBe(0);
  });

  it('既有有角色帳號 OAuth 登入：以員編找到同一人，保留 id／角色；換 sub 再登入仍是同一人', async () => {
    const before: Array<{ id: number; role_id: number }> = await ctx.ds.query(
      'SELECT id, role_id FROM auth_users WHERE person_empid = ?',
      [SECURITY_EMPIDS.viewer],
    );

    const first = await login({
      sub: 'sub-viewer',
      employeeNumber: SECURITY_EMPIDS.viewer,
    });
    expect(first.res.status).toBe(200);
    const session = (first.res.body as ApiSuccess<CallbackData>).data.session;
    expect(session.user.id).toBe(ids.viewerUserId);
    expect(session.role?.id).toBe(before[0].role_id);
    await expect(subOf(SECURITY_EMPIDS.viewer)).resolves.toBe('sub-viewer');

    // 第二次：上游 sub 不同、員編相同 → 仍是同一人（D3 修訂：只認員編），oauth_sub 記最近一次
    const second = await login({
      sub: 'sub-viewer-2',
      employeeNumber: SECURITY_EMPIDS.viewer,
    });
    expect(second.res.status).toBe(200);
    expect(
      (second.res.body as ApiSuccess<CallbackData>).data.session.user.id,
    ).toBe(ids.viewerUserId);
    await expect(countUsers(SECURITY_EMPIDS.viewer)).resolves.toBe(1);
    await expect(subOf(SECURITY_EMPIDS.viewer)).resolves.toBe('sub-viewer-2');
  });

  it('同 sub 帶不同員編 → 依員編對到另一個帳號，不沿用前一次的身分', async () => {
    const { res } = await login({
      sub: 'sub-viewer',
      employeeNumber: SECURITY_EMPIDS.viewerB,
    });

    expect(res.status).toBe(200);
    expect((res.body as ApiSuccess<CallbackData>).data.session.user.id).toBe(
      ids.viewerBUserId,
    );
    await expect(subOf(SECURITY_EMPIDS.viewerB)).resolves.toBe('sub-viewer');
  });

  it('停用帳號 → 403 ACCOUNT_DISABLED，不建帳', async () => {
    const { res } = await login({
      sub: 'sub-disabled',
      employeeNumber: SECURITY_EMPIDS.disabled,
    });

    expect(res.status).toBe(403);
    expect((res.body as ApiError).error.code).toBe(
      AppErrorCode.ACCOUNT_DISABLED,
    );
    await expect(subOf(SECURITY_EMPIDS.disabled)).resolves.toBeNull();
  });

  it('員編等於 SUPER_ADMIN_EMPID → 對到 seed 預建的初始管理員帳號，取得 ADMIN', async () => {
    const empId = process.env.SUPER_ADMIN_EMPID!;
    const { res } = await login({ sub: 'sub-super', employeeNumber: empId });

    expect(res.status).toBe(200);
    const data = (res.body as ApiSuccess<CallbackData>).data;
    expect(data.session.user.empId).toBe(empId);
    expect(data.session.role?.roleCode).toBe('ADMIN');
    await expect(countUsers(empId)).resolves.toBe(1);
  });

  it('UserInfo 缺員編 → 401，不建帳', async () => {
    oidcStub.fetchUserInfo.mockResolvedValue({ sub: 'sub-no-emp' });
    oidcStub.authorizationCodeGrant.mockResolvedValue(
      oidcStub.tokensOf({ sub: 'sub-no-emp' }),
    );
    const startRes = await start().expect(200);
    const state = new URL(
      (startRes.body as ApiSuccess<{ authorizationUrl: string }>).data
        .authorizationUrl,
    ).searchParams.get('state')!;

    const res = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieOf(startRes, OAUTH_TX_COOKIE_NAME)!)
      .send({ state, code: 'synthetic-code' });

    expect(res.status).toBe(401);
    expect((res.body as ApiError).error.code).toBe(
      AppErrorCode.OAUTH_RESPONSE_INVALID,
    );
  });

  describe('logout', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    afterAll(() => fetchSpy.mockRestore());
    beforeEach(() => fetchSpy.mockReset());

    const logout = (cookie?: string) => {
      const req = request(ctx.server)
        .post('/api/auth/logout')
        .set('Origin', ORIGIN);
      return cookie ? req.set('Cookie', cookie) : req;
    };

    it('OAuth 來源：本地先撤銷、以原 refresh token 呼叫上游 → confirmed；舊 cookie 隨即失效；重複登出 not_attempted', async () => {
      const { res } = await login({
        sub: 'sub-new-1',
        employeeNumber: OAUTH_EMP('new'),
        refreshToken: 'rt-for-logout',
      });
      const authCookie = cookieOf(res, AUTH_COOKIE_NAME)!;
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ status: 'logged_out' }), { status: 200 }),
      );

      const out = await logout(authCookie).expect(200);

      expect((out.body as ApiSuccess<LogoutData>).data).toEqual({
        localLogout: 'completed',
        upstreamLogout: 'confirmed',
      });
      const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe('https://auth.example.com/logout');
      expect((init.body as URLSearchParams).get('refresh_token')).toBe(
        'rt-for-logout',
      );
      expect(cookieOf(out, AUTH_COOKIE_NAME)).toBeNull();

      await request(ctx.server)
        .get('/api/auth/me')
        .set('Cookie', authCookie)
        .expect(401);

      const again = await logout(authCookie).expect(200);
      expect((again.body as ApiSuccess<LogoutData>).data.upstreamLogout).toBe(
        'not_attempted',
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('上游 503／逾時 → 本地仍登出，unconfirmed 並附固定提示；舊 cookie 失效', async () => {
      const { res } = await login({
        sub: 'sub-new-1',
        employeeNumber: OAUTH_EMP('new'),
      });
      const authCookie = cookieOf(res, AUTH_COOKIE_NAME)!;
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ error: 'logout_incomplete' }), {
          status: 503,
        }),
      );

      const out = await logout(authCookie).expect(200);

      expect((out.body as ApiSuccess<LogoutData>).data).toEqual({
        localLogout: 'completed',
        upstreamLogout: 'unconfirmed',
        message: OAUTH_LOGOUT_UNCONFIRMED_MESSAGE,
      });
      await request(ctx.server)
        .get('/api/auth/me')
        .set('Cookie', authCookie)
        .expect(401);
    });

    it('無 cookie → not_attempted；已移除登入方式的舊格式 session 一律無效，不打任何上游', async () => {
      const none = await logout().expect(200);
      expect((none.body as ApiSuccess<LogoutData>).data.upstreamLogout).toBe(
        'not_attempted',
      );

      const token = ctx.jwt.sign({ sub: String(ids.adminUserId) });
      await ctx.redis.set(
        `auth:${ids.adminUserId}:${token}`,
        JSON.stringify({ feastogetherToken: 'legacy-password-session' }),
        60,
      );
      const legacy = `${AUTH_COOKIE_NAME}=${token}`;
      await request(ctx.server)
        .get('/api/auth/me')
        .set('Cookie', legacy)
        .expect(401);
      const out = await logout(legacy).expect(200);
      expect((out.body as ApiSuccess<LogoutData>).data.upstreamLogout).toBe(
        'not_attempted',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('登出後尚未完成的登入交易（同瀏覽器）不能再建立 session', async () => {
      // 先發起一筆交易，再登出（清交易 cookie），最後嘗試用舊交易回呼
      const startRes = await start().expect(200);
      const state = new URL(
        (startRes.body as ApiSuccess<{ authorizationUrl: string }>).data
          .authorizationUrl,
      ).searchParams.get('state')!;
      const out = await logout().expect(200);
      const clearedTx = (out.headers['set-cookie'] as string[]).find((c) =>
        c.startsWith(`${OAUTH_TX_COOKIE_NAME}=`),
      )!;
      expect(clearedTx).toMatch(/Expires=Thu, 01 Jan 1970/);

      // 瀏覽器已無交易 cookie → 回呼無法綁定
      const res = await request(ctx.server)
        .post('/api/auth/oauth/callback')
        .set('Origin', ORIGIN)
        .send({ state, code: 'synthetic-code' });
      expect(res.status).toBe(400);
    });
  });
});
