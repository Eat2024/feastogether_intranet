import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OauthIdentityService } from './oauth-identity.service';

/**
 * OauthIdentityService 單元測：以記憶體版 repository 模擬單一交易內的查詢，
 * 驗證 D3（2026-09-20 修訂：一律以員編對照）規則。真 DB 唯一約束與併發由 security-oauth-login e2e 覆蓋。
 */
type User = {
  id: number;
  personEmpid: string;
  personName: string;
  roleId?: number;
  isActive: boolean;
  deletedAt?: Date;
  lastLoginAt?: Date;
  oauthSub?: string;
};

const setup = (users: User[] = []) => {
  const state = { users: users.map((u) => ({ ...u })) };
  const repo = {
    transaction: jest.fn(async (run: (m: unknown) => Promise<unknown>) =>
      run({}),
    ),
    findUserByEmpIdForUpdate: jest.fn((empId: string) =>
      Promise.resolve(state.users.find((u) => u.personEmpid === empId) ?? null),
    ),
    saveUser: jest.fn((user: User) => Promise.resolve(user)),
    createUser: jest.fn((fields: Partial<User>) => {
      const user = {
        id: 900 + state.users.length,
        isActive: true,
        ...fields,
      } as User;
      state.users.push(user);
      return Promise.resolve(user);
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new OauthIdentityService(repo as never, logger as never);
  return { service, repo, state, logger };
};

const profile = (
  over: Partial<{
    sub: string;
    employeeNumber: string | null;
    name: string | null;
  }> = {},
) => ({
  sub: 'sub-A',
  employeeNumber: 'SYN0001',
  name: '測試員一號',
  ...over,
});

const existingUser = (over: Partial<User> = {}): User => ({
  id: 7,
  personEmpid: 'SYN0001',
  personName: '舊姓名',
  roleId: 3,
  isActive: true,
  ...over,
});

describe('OauthIdentityService.resolve', () => {
  it('新員工：以員編建立無角色帳號並記 oauth_sub', async () => {
    const { service, repo, state } = setup();

    const user = await service.resolve(profile());

    expect(user.personEmpid).toBe('SYN0001');
    expect(user.personName).toBe('測試員一號');
    expect(user.oauthSub).toBe('sub-A');
    expect(user.roleId).toBeUndefined();
    expect(repo.createUser).toHaveBeenCalledTimes(1);
    expect(state.users).toHaveLength(1);
  });

  it('既有啟用帳號：以員編找到同一人，保留 id／角色，更新姓名、登入時間與 oauth_sub', async () => {
    const { service, repo } = setup([existingUser({ oauthSub: 'sub-OLD' })]);

    const user = await service.resolve(profile({ name: '新姓名' }));

    expect(user.id).toBe(7);
    expect(user.roleId).toBe(3);
    expect(user.personName).toBe('新姓名');
    expect(user.oauthSub).toBe('sub-A');
    expect(user.lastLoginAt).toBeInstanceOf(Date);
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('員編含前導零原樣比對，不轉數字', async () => {
    const { service } = setup([existingUser({ personEmpid: '00012' })]);

    const user = await service.resolve(profile({ employeeNumber: '00012' }));

    expect(user.id).toBe(7);
  });

  it.each([
    ['停用', existingUser({ isActive: false })],
    ['軟刪除', existingUser({ deletedAt: new Date() })],
  ])('既有帳號%s → 403 ACCOUNT_DISABLED，不建帳', async (_label, user) => {
    const { service, repo } = setup([user]);

    await expect(service.resolve(profile())).rejects.toMatchObject({
      code: AppErrorCode.ACCOUNT_DISABLED,
    });
    expect(repo.createUser).not.toHaveBeenCalled();
    expect(repo.saveUser).not.toHaveBeenCalled();
  });

  it('員編等於 seed 預建的初始管理員 → 對應到該帳號，保留 ADMIN 角色', async () => {
    const { service, repo } = setup([
      existingUser({ personEmpid: 'ADMIN001', roleId: 1 }),
    ]);

    const user = await service.resolve(profile({ employeeNumber: 'ADMIN001' }));

    expect(user).toMatchObject({ personEmpid: 'ADMIN001', roleId: 1 });
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('UserInfo 缺員編 → 401 OAUTH_RESPONSE_INVALID，不進交易', async () => {
    const { service, repo } = setup();

    await expect(
      service.resolve(profile({ employeeNumber: null })),
    ).rejects.toMatchObject({ code: AppErrorCode.OAUTH_RESPONSE_INVALID });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('UserInfo 缺姓名 → 既有帳號保留姓名；新帳號以員編頂替', async () => {
    const { service } = setup([existingUser()]);
    await expect(
      service.resolve(profile({ name: null })),
    ).resolves.toMatchObject({ personName: '舊姓名' });

    const fresh = setup();
    await expect(
      fresh.service.resolve(profile({ employeeNumber: 'NEW01', name: null })),
    ).resolves.toMatchObject({ personName: 'NEW01' });
  });

  it('唯一鍵衝突 → 整筆交易重跑一次；第二次仍衝突就拋出', async () => {
    const { service, repo } = setup();
    const duplicate = Object.assign(new Error('dup'), {
      driverError: { code: 'ER_DUP_ENTRY' },
    });
    repo.transaction
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({ id: 7 });

    await expect(service.resolve(profile())).resolves.toEqual({ id: 7 });
    expect(repo.transaction).toHaveBeenCalledTimes(2);

    repo.transaction.mockRejectedValue(duplicate);
    await expect(service.resolve(profile())).rejects.toBe(duplicate);
  });
});
