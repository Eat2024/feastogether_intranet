import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  AuthorizationCacheService,
  AuthorizationSnapshot,
} from './authorization-cache.service';

describe('AuthorizationCacheService', () => {
  const snapshot: AuthorizationSnapshot = {
    userId: 101,
    roleId: 7,
    userActive: true,
    roleActive: true,
    isAdmin: false,
    permissions: ['monthlyReport.view'],
  };

  const setup = () => {
    const redis = {
      get: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
    };
    const logger = { warn: jest.fn(), info: jest.fn() };
    return {
      service: new AuthorizationCacheService(
        redis as unknown as RedisService,
        logger as unknown as AppLoggerService,
      ),
      redis,
      logger,
    };
  };

  it('從 authz:user:{userId} 讀取合法 snapshot', async () => {
    const { service, redis } = setup();
    redis.get.mockResolvedValueOnce(JSON.stringify(snapshot));

    await expect(service.get(101)).resolves.toEqual(snapshot);
    expect(redis.get).toHaveBeenCalledWith('authz:user:101');
  });

  it('permissions 空陣列仍是合法 snapshot', async () => {
    const { service, redis } = setup();
    const emptyPermissions = { ...snapshot, permissions: [] };
    redis.get.mockResolvedValueOnce(JSON.stringify(emptyPermissions));

    await expect(service.get(101)).resolves.toEqual(emptyPermissions);
  });

  it('Redis miss 回傳 null', async () => {
    const { service, redis } = setup();
    redis.get.mockResolvedValueOnce(null);

    await expect(service.get(101)).resolves.toBeNull();
  });

  it('Redis error 直接拋錯，不得偽裝成 miss', async () => {
    const { service, redis } = setup();
    redis.get.mockRejectedValueOnce(
      new Error('Authorization cache is unavailable'),
    );

    await expect(service.get(101)).rejects.toThrow(
      'Authorization cache is unavailable',
    );
  });

  it('create 使用 86400 秒 TTL 與固定 key', async () => {
    const { service, redis } = setup();
    redis.set.mockResolvedValueOnce(undefined);

    await expect(service.create(snapshot)).resolves.toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith('authz:user:101', snapshot, 86400);
  });

  it('update 只更新既有快取並保留 TTL', async () => {
    const { service, redis } = setup();
    redis.update.mockResolvedValueOnce(true);

    await expect(service.update(snapshot)).resolves.toBe(true);
    expect(redis.update).toHaveBeenCalledWith('authz:user:101', snapshot);
  });

  it('不合法資料不回傳 snapshot，log 不含原值、token、個資或完整 permissions', async () => {
    const { service, redis, logger } = setup();
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        ...snapshot,
        userId: 999,
        token: 'synthetic-secret-token',
        displayName: '合成測試使用者',
      }),
    );

    await expect(service.get(101)).resolves.toBeNull();
    const logs = JSON.stringify(logger.warn.mock.calls);
    expect(logs).not.toContain('synthetic-secret-token');
    expect(logs).not.toContain('合成測試使用者');
    expect(logs).not.toContain('monthlyReport.view');
  });

  it('malformed JSON 與錯誤 userId 都視為無效快取', async () => {
    const { service, redis } = setup();
    redis.get
      .mockResolvedValueOnce('{broken-json')
      .mockResolvedValueOnce(JSON.stringify({ ...snapshot, userId: 999 }));

    await expect(service.get(101)).resolves.toBeNull();
    await expect(service.get(101)).resolves.toBeNull();
  });
});
