import { AuthSessionVerifierService } from './auth-session-verifier.service';

describe('AuthSessionVerifierService', () => {
  const setup = () => {
    const manager = {};
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: '7' }) };
    const redis = {
      get: jest.fn().mockResolvedValue(
        JSON.stringify({
          version: 3,
          source: 'oauth',
          encryptedRefreshToken: 'encrypted',
        }),
      ),
      deleteByPattern: jest.fn(),
    };
    const logger = { warn: jest.fn() };
    const config = { get: jest.fn() };
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: 7,
        isActive: true,
        deletedAt: null,
      }),
    };
    const mysql = { getManager: jest.fn().mockReturnValue(manager) };
    return {
      service: new AuthSessionVerifierService(
        jwt as never,
        redis as never,
        logger as never,
        config as never,
        users as never,
        mysql as never,
      ),
      jwt,
      redis,
      users,
      manager,
    };
  };

  it('JWT + Redis 成功後仍查 User 狀態', async () => {
    const { service, users, manager } = setup();
    await expect(service.verifySessionToken('token-1')).resolves.toEqual({
      userId: 7,
      token: 'token-1',
    });
    expect(users.findById).toHaveBeenCalledWith(7, manager);
  });

  it.each([
    [null],
    [{ id: 7, isActive: false, deletedAt: null }],
    [{ id: 7, isActive: true, deletedAt: new Date() }],
  ])('User 不存在、停用或 soft-deleted 時 fail closed：%p', async (user) => {
    const { service, users } = setup();
    users.findById.mockResolvedValue(user);
    await expect(service.verifySessionToken('token-1')).resolves.toBeNull();
  });

  it('User 查詢失敗時 fail closed', async () => {
    const { service, users } = setup();
    users.findById.mockRejectedValue(new Error('db unavailable'));
    await expect(service.verifySessionToken('token-1')).resolves.toBeNull();
  });

  it('verifyToken 不查 Redis 或 User，供 logout 解析已停用帳號', async () => {
    const { service, redis, users } = setup();
    await expect(service.verifyToken('token-1')).resolves.toEqual({
      userId: 7,
    });
    expect(redis.get).not.toHaveBeenCalled();
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('無效 JWT fail closed', async () => {
    const { service, jwt } = setup();
    jwt.verifyAsync.mockRejectedValue(new Error('invalid'));
    await expect(service.verify('bad')).resolves.toBeNull();
  });
});
