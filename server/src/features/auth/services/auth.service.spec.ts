import { HttpStatus } from '@nestjs/common';
import { AuthSessionService } from './auth-session.service';
import { AuthService } from './auth.service';

/**
 * AuthService 單元測（/me 與登入回應共用的 session 組裝）。
 * session 走真 AuthSessionService 搭配 mock jwt／redis，讓 session 格式判定由本檔直接覆蓋。
 */
const makeSessions = () => {
  const jwt = { signAsync: jest.fn().mockResolvedValue('synthetic-jwt') };
  const redis = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    getDel: jest.fn().mockResolvedValue(null),
  };
  return {
    sessions: new AuthSessionService(
      jwt as never,
      redis as never,
      { get: () => undefined } as never,
    ),
    redis,
  };
};

const oauthSession = JSON.stringify({
  version: 3,
  encryptedRefreshToken: 'synthetic-encrypted-rt',
});

const setup = (
  user: object | null = {
    id: 7,
    isActive: true,
    personEmpid: 'SYN001',
    personName: '合成使用者',
    roleId: 3,
  },
) => {
  const { sessions, redis } = makeSessions();
  const db = {
    authUser: { findOne: jest.fn().mockResolvedValue(user) },
    authRole: {
      findOne: jest.fn().mockResolvedValue({
        id: 3,
        roleName: '合成角色',
        roleCode: 'SYNTHETIC',
        isAdmin: false,
      }),
    },
  };
  const permissions = {
    listActiveGroups: jest.fn().mockResolvedValue([]),
    listActiveJobs: jest.fn().mockResolvedValue([]),
    listPermissions: jest.fn().mockResolvedValue([]),
    currentPermissionIdSet: jest.fn().mockResolvedValue(new Set()),
  };
  const service = new AuthService(sessions, db as never, permissions as never);
  return { service, redis, db, permissions };
};

describe('AuthService.getMe', () => {
  it('有效 session → 回 user／role／導覽', async () => {
    const { service, redis } = setup();
    redis.get.mockResolvedValue(oauthSession);

    await expect(service.getMe(7, 'session-token')).resolves.toMatchObject({
      user: { id: 7, empId: 'SYN001', name: '合成使用者' },
      role: { id: 3, roleCode: 'SYNTHETIC' },
      groups: [],
      jobPermissions: [],
    });
    expect(redis.get).toHaveBeenCalledWith('auth:7:session-token');
  });

  it('session 已撤銷（Redis 無值）→ 401', async () => {
    const { service, redis } = setup();
    redis.get.mockResolvedValue(null);

    await expect(service.getMe(7, 'session-token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it.each([
    ['舊帳密 session（v2，帶饗賓 token）', { version: 2, source: 'password' }],
    ['舊本地管理員 session（無 version）', { feastogetherToken: null }],
  ])('%s → 401（已移除的登入方式留下的 session 一律無效）', async (_n, raw) => {
    const { service, redis } = setup();
    redis.get.mockResolvedValue(JSON.stringify(raw));

    await expect(service.getMe(7, 'session-token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('使用者已停用 → 401', async () => {
    const { service, redis } = setup({
      id: 7,
      isActive: false,
      personEmpid: 'SYN001',
      personName: 'x',
    });
    redis.get.mockResolvedValue(oauthSession);

    await expect(service.getMe(7, 'session-token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('無 cookie token → 401，不查 Redis', async () => {
    const { service, redis } = setup();

    await expect(service.getMe(7, null)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('userId 非法 → 401，不查 DB／Redis', async () => {
    const { service, redis, db } = setup();

    await expect(
      service.getMe(Number.NaN, 'session-token'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(db.authUser.findOne).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });
});

describe('AuthService.buildSession', () => {
  it('無角色（首次登入）→ role=null，不查角色、權限以空集合組導覽', async () => {
    const { service, db, permissions } = setup();

    const session = await service.buildSession({
      id: 9,
      personEmpid: 'SYN009',
      personName: '新同仁',
      isActive: true,
    } as never);

    expect(session.role).toBeNull();
    expect(session.user).toMatchObject({ id: 9, empId: 'SYN009' });
    expect(db.authRole.findOne).not.toHaveBeenCalled();
    expect(permissions.currentPermissionIdSet).not.toHaveBeenCalled();
  });
});
