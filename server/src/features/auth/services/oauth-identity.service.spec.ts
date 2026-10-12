import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OauthIdentityService } from './oauth-identity.service';

describe('OauthIdentityService', () => {
  const manager = {} as never;
  const setup = () => {
    const repo = {
      findUserByEmpIdForUpdate: jest.fn(),
      createUser: jest.fn(),
      saveUser: jest.fn(),
    };
    const logger = { info: jest.fn() };
    const mysql = {
      transaction: jest.fn((run: (value: never) => unknown) => run(manager)),
    };
    return {
      service: new OauthIdentityService(
        repo as never,
        logger as never,
        mysql as never,
      ),
      repo,
      logger,
      mysql,
    };
  };

  const profile = {
    sub: 'provider-sub',
    userNumber: '00123',
    name: '王小明',
  };

  it('以 empid 建立 User，不持久化 oauth_sub 或角色資料', async () => {
    const { service, repo } = setup();
    repo.findUserByEmpIdForUpdate.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({ id: 9, empid: '00123' });

    await expect(service.resolve(profile)).resolves.toMatchObject({ id: 9 });
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ empid: '00123', name: '王小明' }),
      manager,
    );
    expect(repo.createUser.mock.calls[0][0]).not.toHaveProperty('oauthSub');
    expect(repo.createUser.mock.calls[0][0]).not.toHaveProperty('roleId');
  });

  it('缺員編時拒絕', async () => {
    const { service } = setup();
    await expect(
      service.resolve({ ...profile, userNumber: null }),
    ).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_RESPONSE_INVALID,
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it.each([
    [{ isActive: false, deletedAt: null }],
    [{ isActive: true, deletedAt: new Date() }],
  ])('停用或 soft-deleted User 拒絕：%p', async (state) => {
    const { service, repo } = setup();
    repo.findUserByEmpIdForUpdate.mockResolvedValue({
      id: 9,
      empid: '00123',
      name: '舊姓名',
      ...state,
    });
    await expect(service.resolve(profile)).rejects.toMatchObject({
      code: AppErrorCode.ACCOUNT_DISABLED,
    });
  });

  it('既有 User 只更新受信任姓名與 last_login_at', async () => {
    const { service, repo } = setup();
    const user = {
      id: 9,
      empid: '00123',
      name: '舊姓名',
      isActive: true,
      deletedAt: null,
    };
    repo.findUserByEmpIdForUpdate.mockResolvedValue(user);
    repo.saveUser.mockImplementation((value) => value);

    await service.resolve(profile);
    expect(user.name).toBe('王小明');
    expect(user).toHaveProperty('lastLoginAt');
    expect(user).not.toHaveProperty('oauthSub');
  });

  it('並發唯一鍵衝突後重跑交易並重讀 User', async () => {
    const { service, repo, mysql } = setup();
    mysql.transaction
      .mockRejectedValueOnce({ driverError: { code: 'ER_DUP_ENTRY' } })
      .mockImplementationOnce((run: (value: never) => unknown) => run(manager));
    repo.findUserByEmpIdForUpdate.mockResolvedValue({
      id: 9,
      empid: '00123',
      name: '王小明',
      isActive: true,
      deletedAt: null,
    });
    repo.saveUser.mockImplementation((value) => value);

    await expect(service.resolve(profile)).resolves.toMatchObject({ id: 9 });
    expect(mysql.transaction).toHaveBeenCalledTimes(2);
  });
});
