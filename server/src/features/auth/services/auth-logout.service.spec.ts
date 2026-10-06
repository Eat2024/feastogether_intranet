import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AuthLogoutService } from './auth-logout.service';

const setup = () => {
  const verifier = { verifyToken: jest.fn().mockResolvedValue({ userId: 7 }) };
  const sessions = { revoke: jest.fn() };
  const logger = { warn: jest.fn(), error: jest.fn() };
  const service = new AuthLogoutService(
    verifier as never,
    sessions as never,
    logger as never,
  );
  return { service, verifier, sessions };
};

describe('AuthLogoutService.logout', () => {
  it('有效 session：撤銷本地 session，OAuth 停用時回 not_applicable', async () => {
    const { service, sessions } = setup();
    sessions.revoke.mockResolvedValue({
      source: 'dev',
      encryptedRefreshToken: null,
    });

    await expect(service.logout('session-jwt')).resolves.toEqual({
      localLogout: 'completed',
      upstreamLogout: 'not_applicable',
    });
    expect(sessions.revoke).toHaveBeenCalledWith(7, 'session-jwt');
  });

  it.each([
    ['無 cookie', null, undefined],
    ['JWT 過期／無效', 'bad-jwt', null],
    ['session 已不存在（重複登出）', 'session-jwt', { userId: 7 }],
  ])('%s → not_attempted，不宣稱上游完成', async (_label, token, verified) => {
    const { service, verifier, sessions } = setup();
    if (verified !== undefined)
      verifier.verifyToken.mockResolvedValue(verified);
    sessions.revoke.mockResolvedValue(null);

    await expect(service.logout(token)).resolves.toEqual({
      localLogout: 'completed',
      upstreamLogout: 'not_attempted',
    });
  });

  it('Redis 撤銷失敗 → 503 AUTH_SESSION_UNAVAILABLE', async () => {
    const { service, sessions } = setup();
    sessions.revoke.mockRejectedValue(new Error('synthetic redis down'));

    await expect(service.logout('session-jwt')).rejects.toMatchObject({
      code: AppErrorCode.AUTH_SESSION_UNAVAILABLE,
    });
  });
});
