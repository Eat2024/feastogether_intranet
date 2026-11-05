import { OauthLoginService } from './oauth-login.service';

describe('OauthLoginService', () => {
  it('OAuth callback 以 source=oauth 替換瀏覽器目前會話，不需要 authorization cache', async () => {
    const client = {
      exchangeCode: jest.fn().mockResolvedValue({
        accessToken: 'provider-at',
        refreshToken: 'provider-rt',
        sub: 'provider-sub',
      }),
      fetchUserInfo: jest.fn().mockResolvedValue({
        userNumber: '00123',
        name: '王小明',
      }),
    };
    const transactions = {
      claim: jest.fn().mockResolvedValue({
        challenge: {},
        redirectTo: '/documents',
      }),
    };
    const user = { id: 7, empid: '00123', name: '王小明' };
    const identities = { resolve: jest.fn().mockResolvedValue(user) };
    const sessions = {
      replace: jest.fn().mockResolvedValue({
        token: 'local-token',
        expiresAt: new Date('2026-01-01T08:00:00Z'),
      }),
    };
    const service = new OauthLoginService(
      client as never,
      transactions as never,
      identities as never,
      sessions as never,
    );

    await expect(
      service.getAccessTokenAndUserInfo(
        { state: 'state', code: 'code' },
        'browser-token',
        'current-token',
      ),
    ).resolves.toMatchObject({
      accessToken: 'local-token',
      session: { actor: { kind: 'employee', userId: 7 }, user: { id: 7 } },
      redirectTo: '/documents',
    });
    expect(sessions.replace).toHaveBeenCalledWith('current-token', {
      kind: 'employee',
      userId: 7,
      source: 'oauth',
    });
  });
});
