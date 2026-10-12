import { OauthLoginService } from './oauth-login.service';

describe('OauthLoginService', () => {
  it('OAuth callback 發 session，不需要 authorization cache', async () => {
    const config = { encryptionKey: Buffer.alloc(32) };
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
    const sessions = { issue: jest.fn().mockResolvedValue('local-jwt') };
    const auth = {
      buildSession: jest.fn().mockReturnValue({ user: { id: 7 } }),
    };
    const service = new OauthLoginService(
      config as never,
      client as never,
      transactions as never,
      identities as never,
      sessions as never,
      auth as never,
    );

    await expect(
      service.getAccessTokenAndUserInfo(
        { state: 'state', code: 'code' },
        'browser-token',
      ),
    ).resolves.toMatchObject({
      accessToken: 'local-jwt',
      session: { user: { id: 7 } },
      redirectTo: '/documents',
    });
    expect(sessions.issue).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ source: 'oauth' }),
    );
  });
});
