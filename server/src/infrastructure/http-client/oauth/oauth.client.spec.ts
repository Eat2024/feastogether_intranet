import { randomBytes } from 'crypto';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import * as oidcStub from '../../../../test/stubs/openid-client.stub';
import { OauthClient } from './oauth.client';
import { OauthConfig } from './oauth.config';

/**
 * OauthClient 單元測：jest moduleNameMapper 已把 `openid-client` 對應到測試替身，
 * 這裡只驗「本系統怎麼呼叫套件、失敗怎麼對應錯誤碼、logout 怎麼判定確認」。
 */
const buildConfig = (override: Record<string, string> = {}) =>
  new OauthConfig({
    get: (key: string) =>
      ({
        OAUTH_ISSUER: 'https://auth.example.com',
        OAUTH_CLIENT_ID: 'web-client',
        OAUTH_CLIENT_SECRET: 'synthetic-secret',
        OAUTH_REDIRECT_URI: 'https://app.example.com/oauth/callback',
        OAUTH_LOGOUT_URL: 'https://auth.example.com/logout',
        OAUTH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        ...override,
      })[key],
  } as never);

const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };

const challenge = { state: 'st', nonce: 'nc' };

describe('OauthClient', () => {
  beforeEach(() => {
    oidcStub.resetOidcStub();
    logger.warn.mockClear();
  });

  it('buildAuthorizationUrl：固定 redirect／scope、帶 state／nonce、不帶 PKCE，Discovery 只做一次', async () => {
    const client = new OauthClient(buildConfig(), logger as never);

    const first = await client.buildAuthorizationUrl(challenge);
    await client.buildAuthorizationUrl(challenge);

    const url = new URL(first);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('nc');
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('code_challenge_method')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(oidcStub.discovery).toHaveBeenCalledTimes(1);
    // 機密 Client 採 client_secret_post；ID token 簽章檢查明確啟用。
    expect(oidcStub.ClientSecretPost).toHaveBeenCalledWith('synthetic-secret');
    const options = oidcStub.discovery.mock.calls[0][4] as {
      execute: unknown[];
      timeout: number;
    };
    expect(options.execute).toContain(oidcStub.enableNonRepudiationChecks);
    expect(options.execute).not.toContain(oidcStub.allowInsecureRequests);
    expect(options.timeout).toBe(5);
  });

  it('Discovery 失敗 → OAUTH_UNAVAILABLE(503)，且不快取失敗結果', async () => {
    oidcStub.discovery
      .mockRejectedValueOnce(new Error('synthetic network down'))
      .mockResolvedValueOnce(new oidcStub.Configuration());
    const client = new OauthClient(buildConfig(), logger as never);

    await expect(client.buildAuthorizationUrl(challenge)).rejects.toMatchObject(
      {
        code: AppErrorCode.OAUTH_UNAVAILABLE,
      },
    );
    await expect(client.buildAuthorizationUrl(challenge)).resolves.toContain(
      'https://auth.example.com/authorize',
    );
    expect(oidcStub.discovery).toHaveBeenCalledTimes(2);
  });

  it('loopback http issuer 才加 allowInsecureRequests', async () => {
    const client = new OauthClient(
      buildConfig({
        OAUTH_ISSUER: 'http://localhost:4000',
        OAUTH_LOGOUT_URL: 'http://localhost:4000/logout',
      }),
      logger as never,
    );

    await client.buildAuthorizationUrl(challenge);

    const options = oidcStub.discovery.mock.calls[0][4] as {
      execute: unknown[];
    };
    expect(options.execute).toContain(oidcStub.allowInsecureRequests);
  });

  it('exchangeCode：以固定 callback URL＋白名單參數交套件，並要求 state／nonce 與 ID token，不帶 PKCE verifier', async () => {
    const client = new OauthClient(buildConfig(), logger as never);

    const tokens = await client.exchangeCode(
      { code: 'c', state: 'st', iss: 'https://auth.example.com' },
      challenge,
    );

    expect(tokens).toEqual({
      sub: oidcStub.DEFAULT_STUB_IDENTITY.sub,
      accessToken: 'synthetic-access-token',
      refreshToken: 'synthetic-refresh-token',
    });
    const [, currentUrl, checks] = oidcStub.authorizationCodeGrant.mock
      .calls[0] as [unknown, URL, Record<string, unknown>];
    expect(currentUrl.origin + currentUrl.pathname).toBe(
      'https://app.example.com/oauth/callback',
    );
    expect(currentUrl.searchParams.get('code')).toBe('c');
    expect(currentUrl.searchParams.get('iss')).toBe('https://auth.example.com');
    expect(checks).toEqual({
      expectedState: 'st',
      expectedNonce: 'nc',
      idTokenExpected: true,
    });
  });

  it('exchangeCode：套件驗證失敗 → OAUTH_RESPONSE_INVALID(401)，log 不含 code', async () => {
    oidcStub.authorizationCodeGrant.mockRejectedValueOnce(
      new oidcStub.ResponseBodyError('invalid_grant', 'code expired'),
    );
    const client = new OauthClient(buildConfig(), logger as never);

    await expect(
      client.exchangeCode({ code: 'secret-code', state: 'st' }, challenge),
    ).rejects.toMatchObject({ code: AppErrorCode.OAUTH_RESPONSE_INVALID });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-code');
    expect(JSON.stringify(logger.warn.mock.calls)).toContain('invalid_grant');
  });

  it('fetchUserInfo：以 expectedSub 交套件核對，缺欄回 null', async () => {
    oidcStub.fetchUserInfo.mockResolvedValueOnce({ sub: 'synthetic-sub-0001' });
    const client = new OauthClient(buildConfig(), logger as never);

    const info = await client.fetchUserInfo('at', 'synthetic-sub-0001');

    expect(info).toEqual({
      sub: 'synthetic-sub-0001',
      employeeNumber: null,
      name: null,
      email: null,
    });
    expect(oidcStub.fetchUserInfo).toHaveBeenCalledWith(
      expect.anything(),
      'at',
      'synthetic-sub-0001',
    );
  });

  describe('logout', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    beforeEach(() => fetchSpy.mockReset());
    afterAll(() => fetchSpy.mockRestore());

    const respond = (status: number, body: unknown) =>
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(body), { status }),
      );

    it('200 且 status=logged_out → true；form 帶 client_id／secret／refresh_token', async () => {
      respond(200, { status: 'logged_out' });
      const client = new OauthClient(buildConfig(), logger as never);

      await expect(client.logout('rt-1')).resolves.toBe(true);

      const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe('https://auth.example.com/logout');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('manual');
      expect((init.body as URLSearchParams).toString()).toBe(
        'client_id=web-client&client_secret=synthetic-secret&refresh_token=rt-1',
      );
    });

    it.each([
      ['503', () => respond(503, { error: 'logout_incomplete' })],
      ['200 但 status 不符', () => respond(200, { status: 'pending' })],
      [
        '逾時／連線失敗',
        () => fetchSpy.mockRejectedValueOnce(new Error('synthetic timeout')),
      ],
    ])('%s → false（unconfirmed），不重試', async (_label, arrange) => {
      arrange();
      const client = new OauthClient(buildConfig(), logger as never);

      await expect(client.logout('rt-1')).resolves.toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
