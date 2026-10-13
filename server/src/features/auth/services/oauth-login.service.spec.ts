import { OauthLoginService } from './oauth-login.service';

describe('OauthLoginService', () => {
  it('OAuth callback 發 session，不需要 authorization cache', async () => {
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
    const auth = {
      issueSession: jest.fn().mockResolvedValue({
        token: 'local-token',
        expiresAt: new Date('2026-01-01T08:00:00Z'),
      }),
      buildSession: jest.fn().mockReturnValue({ user: { id: 7 } }),
    };
    const service = new OauthLoginService(
      client as never,
      transactions as never,
      identities as never,
      auth as never,
    );

    await expect(
      service.getAccessTokenAndUserInfo(
        { state: 'state', code: 'code' },
        'browser-token',
      ),
    ).resolves.toMatchObject({
      accessToken: 'local-token',
      session: { user: { id: 7 } },
      redirectTo: '/documents',
    });
    expect(auth.issueSession).toHaveBeenCalledWith(7);
  });
});
