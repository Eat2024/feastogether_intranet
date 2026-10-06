import { AUTH_TOKEN_TTL_SECONDS } from '#app/features/auth/auth.constants';
import { AuthSessionService, parseSessionRecord } from './auth-session.service';

/** 模擬 ConfigService：只回傳指定的環境變數。 */
const configOf = (env: Record<string, string> = {}) => ({
  get: (key: string) => env[key],
});

describe('parseSessionRecord', () => {
  it('version=3 統一登入 session：原樣解析加密後的 refresh token', () => {
    const raw = JSON.stringify({
      version: 3,
      source: 'oauth',
      encryptedRefreshToken: 'v1.iv.ct.tag',
    });

    expect(parseSessionRecord(raw)).toEqual({
      source: 'oauth',
      encryptedRefreshToken: 'v1.iv.ct.tag',
    });
  });

  it('version=3 未帶 source（加入開發者登入前簽發）→ 視為統一登入', () => {
    expect(
      parseSessionRecord('{"version":3,"encryptedRefreshToken":"enc"}'),
    ).toEqual({ source: 'oauth', encryptedRefreshToken: 'enc' });
  });

  it('開發者登入 session → source=dev', () => {
    expect(
      parseSessionRecord(
        '{"version":3,"source":"dev","encryptedRefreshToken":null}',
      ),
    ).toEqual({ source: 'dev', encryptedRefreshToken: null });
  });

  it('refresh token 非字串 → 視為 null（登出時回報 unconfirmed）', () => {
    expect(
      parseSessionRecord('{"version":3,"encryptedRefreshToken":123}'),
    ).toEqual({ source: 'oauth', encryptedRefreshToken: null });
  });

  it.each([
    ['舊帳密 session（無 version）', '{"feastogetherToken":"ft-token"}'],
    ['舊本地管理員 session（無 version）', '{"feastogetherToken":null}'],
    [
      'v2 session（含已移除的登入來源）',
      '{"version":2,"source":"password","feastogetherToken":"ft"}',
    ],
    ['未知版本', '{"version":99}'],
    ['非 JSON', 'not-json'],
    ['非物件', '"string"'],
    ['null', null],
  ])('%s → null（視為無效 session）', (_label, raw) => {
    expect(parseSessionRecord(raw)).toBeNull();
  });
});

describe('AuthSessionService', () => {
  const setup = (env: Record<string, string> = {}) => {
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-a') };
    const redis = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      getDel: jest.fn(),
    };
    const service = new AuthSessionService(
      jwt as never,
      redis as never,
      configOf(env) as never,
    );
    return { service, jwt, redis };
  };

  it('issue：JWT sub 為本地 user id、jti 隨機、固定 24h TTL、Redis 值帶 version 與來源', async () => {
    const { service, jwt, redis } = setup();

    const token = await service.issue(7, {
      source: 'oauth',
      encryptedRefreshToken: 'enc',
    });

    expect(token).toBe('jwt-a');
    const [payload, options] = jwt.signAsync.mock.calls[0] as [
      { sub: string; jti: string },
      { expiresIn: number },
    ];
    expect(payload.sub).toBe('7');
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(options.expiresIn).toBe(AUTH_TOKEN_TTL_SECONDS);
    expect(redis.set).toHaveBeenCalledWith(
      'auth:7:jwt-a',
      JSON.stringify({
        version: 3,
        source: 'oauth',
        encryptedRefreshToken: 'enc',
      }),
      AUTH_TOKEN_TTL_SECONDS,
    );
  });

  it('issue：Redis 寫入失敗即拋出，不回 token', async () => {
    const { service, redis } = setup();
    redis.set.mockRejectedValue(new Error('synthetic redis down'));

    await expect(
      service.issue(7, { source: 'dev', encryptedRefreshToken: null }),
    ).rejects.toThrow('synthetic redis down');
  });

  it('read：開發者登入 session 只在 DEVMOD 開放時有效', async () => {
    const dev = '{"version":3,"source":"dev","encryptedRefreshToken":null}';
    const on = setup({ DEVMOD: 'true' });
    on.redis.get.mockResolvedValue(dev);
    await expect(on.service.read(7, 'jwt-a')).resolves.toEqual({
      source: 'dev',
      encryptedRefreshToken: null,
    });

    const off = setup();
    off.redis.get.mockResolvedValue(dev);
    await expect(off.service.read(7, 'jwt-a')).resolves.toBeNull();

    const prod = setup({ DEVMOD: 'true', NODE_ENV: 'production' });
    prod.redis.get.mockResolvedValue(dev);
    await expect(prod.service.read(7, 'jwt-a')).resolves.toBeNull();
  });

  it('revoke：以 GETDEL 原子取出，回傳解析後的 record；不存在回 null', async () => {
    const { service, redis } = setup();
    redis.getDel
      .mockResolvedValueOnce(
        '{"version":3,"source":"oauth","encryptedRefreshToken":"enc"}',
      )
      .mockResolvedValueOnce(null);

    await expect(service.revoke(7, 'jwt-a')).resolves.toEqual({
      source: 'oauth',
      encryptedRefreshToken: 'enc',
    });
    await expect(service.revoke(7, 'jwt-a')).resolves.toBeNull();
    expect(redis.getDel).toHaveBeenCalledWith('auth:7:jwt-a');
  });
});
