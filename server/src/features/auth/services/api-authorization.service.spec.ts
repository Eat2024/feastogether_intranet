import { DataSource } from 'typeorm';
import {
  AuthorizationCacheService,
  AuthorizationSnapshot,
} from './authorization-cache.service';
import { ApiAuthorizationService } from './api-authorization.service';

describe('ApiAuthorizationService', () => {
  const snapshot: AuthorizationSnapshot = {
    userId: 7,
    roleId: 3,
    userActive: true,
    roleActive: true,
    isAdmin: false,
    permissions: ['report.view', 'report.edit'],
  };

  const setup = () => {
    const query = jest.fn();
    const cache = {
      get: jest.fn(),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(true),
    };
    const roleUsers = { findByRoleId: jest.fn() };
    return {
      service: new ApiAuthorizationService(
        { query } as unknown as DataSource,
        cache as unknown as AuthorizationCacheService,
        roleUsers as never,
      ),
      query,
      cache,
      roleUsers,
    };
  };

  it('cache hit 直接判斷權限，不查 MySQL', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValue(snapshot);

    await expect(service.hasPermission(7, 'report.view')).resolves.toBe(true);
    await expect(service.hasPermission(7, 'unknown')).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('refreshUser 只在快取存在時重查 DB 並更新完整 snapshot', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValueOnce(snapshot);
    cache.update.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce([
      {
        user_id: 7,
        role_id: 4,
        user_active: 1,
        role_active: 1,
        is_admin: 0,
        permission_key: 'report.approve',
      },
    ]);

    await service.refreshUser(7);

    expect(cache.update).toHaveBeenCalledWith({
      ...snapshot,
      roleId: 4,
      permissions: ['report.approve'],
    });
  });

  it('refreshUser 在快取不存在時不查 DB、不建立快取', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValueOnce(null);

    await service.refreshUser(7);

    expect(query).not.toHaveBeenCalled();
    expect(cache.update).not.toHaveBeenCalled();
    expect(cache.create).not.toHaveBeenCalled();
  });

  it('refreshRoleUsers 只處理該角色明確綁定的使用者', async () => {
    const { service, cache, query, roleUsers } = setup();
    roleUsers.findByRoleId.mockResolvedValueOnce([{ id: 7 }, { id: 8 }]);
    cache.get.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(null);
    cache.update.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce([
      {
        user_id: 7,
        role_id: 3,
        user_active: 1,
        role_active: 1,
        is_admin: 0,
        permission_key: 'report.view',
      },
    ]);

    await service.refreshRoleUsers(3);

    expect(roleUsers.findByRoleId).toHaveBeenCalledWith(3);
    expect(query).toHaveBeenCalledTimes(1);
    expect(cache.update).toHaveBeenCalledTimes(1);
  });

  it('admin cache hit 直接放行', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValue({
      ...snapshot,
      isAdmin: true,
      permissions: [],
    });

    await expect(service.hasPermission(7, 'unknown')).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('空 permissions 是合法 hit 且拒絕權限，不查 MySQL', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValue({ ...snapshot, permissions: [] });

    await expect(service.hasPermission(7, 'report.view')).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('hasAnyPermission 維持 OR 語意且只讀一次 snapshot', async () => {
    const { service, cache } = setup();
    cache.get.mockResolvedValue(snapshot);

    await expect(
      service.hasAnyPermission(7, ['unknown', 'report.edit']),
    ).resolves.toBe(true);
    expect(cache.get).toHaveBeenCalledTimes(1);
  });

  it('cache miss 以單一 MySQL query 載入完整 snapshot 並建立快取', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValue(null);
    cache.create.mockResolvedValue(undefined);
    query.mockResolvedValue([
      {
        user_id: 7,
        role_id: 3,
        user_active: 1,
        role_active: 1,
        is_admin: 0,
        permission_key: 'report.view',
      },
      {
        user_id: 7,
        role_id: 3,
        user_active: 1,
        role_active: 1,
        is_admin: 0,
        permission_key: 'report.edit',
      },
    ]);

    await expect(service.hasPermission(7, 'report.edit')).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(cache.create).toHaveBeenCalledWith(snapshot);
  });

  it('無角色使用者補建合法空權限 snapshot', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValue(null);
    query.mockResolvedValue([
      {
        user_id: 7,
        role_id: null,
        user_active: 1,
        role_active: 0,
        is_admin: 0,
        permission_key: null,
      },
    ]);

    await expect(service.isActiveUser(7)).resolves.toBe(false);
    expect(cache.create).toHaveBeenCalledWith({
      ...snapshot,
      roleId: null,
      roleActive: false,
      permissions: [],
    });
  });

  it('Redis error 不查 MySQL且直接拒絕流程', async () => {
    const { service, cache, query } = setup();
    cache.get.mockRejectedValue(new Error('synthetic redis failure'));

    await expect(service.hasPermission(7, 'report.view')).rejects.toThrow(
      'synthetic redis failure',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('查無使用者時拒絕且不建立快取', async () => {
    const { service, cache, query } = setup();
    cache.get.mockResolvedValue(null);
    query.mockResolvedValue([]);

    await expect(service.isActiveUser(404)).resolves.toBe(false);
    expect(cache.create).not.toHaveBeenCalled();
  });
});
