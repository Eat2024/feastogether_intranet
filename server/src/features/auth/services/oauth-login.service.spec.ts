import { randomBytes } from 'crypto';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { decryptSecret } from '#app/features/auth/helpers/secret-crypto';
import { OauthLoginService } from './oauth-login.service';

const KEY = randomBytes(32);
const setup = () => {
  const config = { encryptionKey: KEY };
  const challenge = { state: 'st', nonce: 'nc' };
  const client = {
    createLoginChallenge: jest.fn(() => challenge),
    buildAuthorizationUrl: jest
      .fn()
      .mockResolvedValue('https://auth.example.com/authorize?state=st'),
    exchangeCode: jest.fn().mockResolvedValue({
      sub: 'sub-A',
      accessToken: 'at',
      refreshToken: 'rt-plain',
    }),
    fetchUserInfo: jest.fn().mockResolvedValue({
      sub: 'sub-A',
      employeeNumber: 'SYN0001',
      name: '測試員一號',
      email: null,
    }),
  };
  const transactions = {
    start: jest.fn().mockResolvedValue('browser-token'),
    claim: jest.fn().mockResolvedValue({ challenge, redirectTo: '/orders' }),
  };
  const user = { id: 7, personEmpid: 'SYN0001', isActive: true };
  const identities = { resolve: jest.fn().mockResolvedValue(user) };
  const sessions = { issue: jest.fn().mockResolvedValue('session-jwt') };
  const authorization = {
    rememberUser: jest.fn().mockResolvedValue(undefined),
  };
  const authService = {
    buildSession: jest.fn().mockResolvedValue({ user: { id: 7 } }),
  };
  const service = new OauthLoginService(
    config as never,
    client as never,
    transactions as never,
    identities as never,
    sessions as never,
    authorization as never,
    authService as never,
  );
  return {
    service,
    client,
    transactions,
    identities,
    sessions,
    authorization,
    authService,
    challenge,
  };
};

describe('OauthLoginService.start', () => {
  it('先組授權網址再存交易；redirectTo 經 sanitize；回 cookie 綁定值', async () => {
    const { service, client, transactions, challenge } = setup();

    const result = await service.start('https://evil.example.com/');

    expect(result).toEqual({
      authorizationUrl: 'https://auth.example.com/authorize?state=st',
      browserToken: 'browser-token',
    });
    expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(challenge);
    expect(transactions.start).toHaveBeenCalledWith(challenge, '/');
  });

  it('上游 Discovery 失敗 → 不存交易', async () => {
    const { service, client, transactions } = setup();
    client.buildAuthorizationUrl.mockRejectedValue(new Error('down'));

    await expect(service.start(undefined)).rejects.toThrow('down');
    expect(transactions.start).not.toHaveBeenCalled();
  });
});

describe('OauthLoginService.getAccessTokenAndUserInfo', () => {
  const dto = { state: 'st', code: 'code-1' };

  it('成功：領交易 → 換 token → UserInfo（以 ID token sub 核對）→ 配對 → 發 oauth session（RT 加密）', async () => {
    const {
      service,
      client,
      identities,
      sessions,
      authorization,
      authService,
      challenge,
    } = setup();

    const result = await service.getAccessTokenAndUserInfo(
      dto,
      'browser-token',
    );

    expect(result.accessToken).toBe('session-jwt');
    expect(result.redirectTo).toBe('/orders');
    expect(client.exchangeCode).toHaveBeenCalledWith(
      { code: 'code-1', state: 'st', iss: undefined },
      challenge,
    );
    expect(client.fetchUserInfo).toHaveBeenCalledWith('at', 'sub-A');
    expect(identities.resolve).toHaveBeenCalledWith({
      sub: 'sub-A',
      employeeNumber: 'SYN0001',
      name: '測試員一號',
    });
    const [userId, record] = sessions.issue.mock.calls[0] as [
      number,
      { source: string; encryptedRefreshToken: string },
    ];
    expect(userId).toBe(7);
    expect(record.source).toBe('oauth');
    expect(record.encryptedRefreshToken).not.toContain('rt-plain');
    expect(decryptSecret(record.encryptedRefreshToken, KEY)).toBe('rt-plain');
    expect(authorization.rememberUser).toHaveBeenCalledWith(7);
    expect(authService.buildSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
  });

  it('上游回 error → 先消耗交易再回 400 OAUTH_LOGIN_CANCELLED，不換 token', async () => {
    const { service, client, transactions } = setup();

    await expect(
      service.getAccessTokenAndUserInfo(
        { state: 'st', error: 'access_denied' },
        'browser-token',
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.OAUTH_LOGIN_CANCELLED });
    expect(transactions.claim).toHaveBeenCalledWith('st', 'browser-token');
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it('交易無效 → 400，不換 token', async () => {
    const { service, client, transactions } = setup();
    transactions.claim.mockRejectedValue(
      Object.assign(new Error('invalid'), {
        code: AppErrorCode.OAUTH_TRANSACTION_INVALID,
      }),
    );

    await expect(
      service.getAccessTokenAndUserInfo(dto, null),
    ).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_TRANSACTION_INVALID,
    });
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it('上游未簽發 refresh token → 503 OAUTH_UNAVAILABLE，不查 UserInfo、不建連結、不發 session', async () => {
    const { service, client, identities, sessions } = setup();
    client.exchangeCode.mockResolvedValue({
      sub: 'sub-A',
      accessToken: 'at',
      refreshToken: null,
    });

    await expect(
      service.getAccessTokenAndUserInfo(dto, 'browser-token'),
    ).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_UNAVAILABLE,
    });
    expect(client.fetchUserInfo).not.toHaveBeenCalled();
    expect(identities.resolve).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('配對失敗（例如帳號已停用）→ 原樣拋出，不發 session', async () => {
    const { service, identities, sessions } = setup();
    const conflict = Object.assign(new Error('disabled'), {
      code: AppErrorCode.ACCOUNT_DISABLED,
    });
    identities.resolve.mockRejectedValue(conflict);

    await expect(
      service.getAccessTokenAndUserInfo(dto, 'browser-token'),
    ).rejects.toBe(conflict);
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('Redis 發 session 失敗 → 拋出，不建立授權快照', async () => {
    const { service, sessions, authorization } = setup();
    sessions.issue.mockRejectedValue(new Error('synthetic redis down'));

    await expect(
      service.getAccessTokenAndUserInfo(dto, 'browser-token'),
    ).rejects.toThrow('synthetic redis down');
    expect(authorization.rememberUser).not.toHaveBeenCalled();
  });
});
