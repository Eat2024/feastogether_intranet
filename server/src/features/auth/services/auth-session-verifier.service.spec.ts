import { JwtService } from '@nestjs/jwt';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { AuthSessionVerifierService } from './auth-session-verifier.service';

/** 模擬 ConfigService：只回傳指定的環境變數。 */
const configOf = (env: Record<string, string> = {}) => ({
  get: (key: string) => env[key],
});

describe('AuthSessionVerifierService', () => {
  const setup = (env: Record<string, string> = {}) => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: '7' }) };
    const redis = {
      get: jest
        .fn()
        .mockResolvedValue('{"version":3,"encryptedRefreshToken":"enc"}'),
    };
    const logger = { warn: jest.fn() };
    return {
      service: new AuthSessionVerifierService(
        jwt as unknown as JwtService,
        redis as unknown as RedisService,
        logger as unknown as AppLoggerService,
        configOf(env) as never,
      ),
      jwt,
      redis,
      logger,
    };
  };

  it('有效 JWT 與 Redis session 回傳 userId', async () => {
    const { service, redis } = setup();
    await expect(service.verify('token-1')).resolves.toEqual({ userId: 7 });
    expect(redis.get).toHaveBeenCalledWith('auth:7:token-1');
  });

  it('verifySessionToken 將有效 session 轉成含 token 的身分', async () => {
    const { service } = setup();
    await expect(service.verifySessionToken('token-1')).resolves.toEqual({
      userId: 7,
      token: 'token-1',
    });
  });

  it('verifySessionToken 缺 token 時直接回 null', async () => {
    const { service, jwt, redis } = setup();
    await expect(service.verifySessionToken(null)).resolves.toBeNull();
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('JWT 無效時回 null 並記去敏感 log', async () => {
    const { service, jwt, logger } = setup();
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await expect(service.verify('bad-token')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.jwt_verify_failed' }),
    );
  });

  it('JWT verifier 拋出非 Error 值時仍安全記錄並拒絕', async () => {
    const { service, jwt, logger } = setup();
    jwt.verifyAsync.mockRejectedValueOnce('invalid-token');

    await expect(service.verifyToken('bad-token')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { reason: 'invalid-token' },
      }),
    );
  });

  it('session revoked 時回 null', async () => {
    const { service, redis } = setup();
    redis.get.mockResolvedValueOnce(null);
    await expect(service.verify('token-1')).resolves.toBeNull();
  });

  it('開發者登入 session：DEVMOD 開放時有效，關閉後即失效', async () => {
    const devSession =
      '{"version":3,"source":"dev","encryptedRefreshToken":null}';
    const on = setup({ DEVMOD: 'true' });
    on.redis.get.mockResolvedValueOnce(devSession);
    await expect(on.service.verify('token-1')).resolves.toEqual({ userId: 7 });

    const off = setup();
    off.redis.get.mockResolvedValueOnce(devSession);
    await expect(off.service.verify('token-1')).resolves.toBeNull();
  });

  it('Redis 有值但為舊格式（已移除的登入方式）→ null', async () => {
    const { service, redis } = setup();
    redis.get.mockResolvedValueOnce('{"feastogetherToken":"ft"}');

    await expect(service.verify('token-1')).resolves.toBeNull();
  });

  it('Redis 讀取失敗時 fail closed 回 null', async () => {
    const { service, redis, logger } = setup();
    redis.get.mockRejectedValueOnce(new Error('synthetic disconnect'));

    await expect(service.verify('token-1')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.session_lookup_failed' }),
    );
  });

  it.each([{ sub: 'abc' }, { sub: '0' }, { sub: '-1' }, { sub: '1.5' }])(
    'JWT sub 非正整數時不查 Redis：%o',
    async (payload) => {
      const { service, jwt, redis } = setup();
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      await expect(service.verifyToken('token-1')).resolves.toBeNull();
      expect(redis.get).not.toHaveBeenCalled();
    },
  );
});
