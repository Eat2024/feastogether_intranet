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
    const hr = {
      lookupEligibleStaff: jest.fn().mockResolvedValue({
        department_id: '001a_B-02',
        department_name: '合成部門',
      }),
    };
    const mysql = {
      transaction: jest.fn((run: (value: never) => unknown) => run(manager)),
    };
    return {
      service: new OauthIdentityService(
        repo,
        logger as never,
        mysql as never,
        hr as never,
      ),
      repo,
      hr,
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

  it('新增帳號先以驗證員編查 HR 並保存可信部門，不使用 profile 欄位', async () => {
    const { service, repo, hr } = setup();
    repo.findUserByEmpIdForUpdate.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({ id: 9, empid: '00123' });
    const untrustedExtra = { ...profile, departmentCode: 'FORGED' };
    await service.resolve(untrustedExtra);
    expect(hr.lookupEligibleStaff).toHaveBeenCalledWith('00123');
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentCode: '001a_B-02',
        departmentName: '合成部門',
      }),
      manager,
    );
  });

  it.each([null, undefined, '', '  '])(
    'HR 缺部門 %p 寫入 NULL 清除舊值',
    async (code) => {
      const { service, repo, hr } = setup();
      repo.findUserByEmpIdForUpdate.mockResolvedValue({
        id: 9,
        empid: '00123',
        name: '舊姓名',
        isActive: true,
        deletedAt: null,
        departmentId: 42,
        departmentCode: 'OLD',
        departmentName: '舊部門',
      });
      hr.lookupEligibleStaff.mockResolvedValue({
        department_id: code,
        department_name: null,
      });
      await service.resolve(profile);
      expect(repo.saveUser).toHaveBeenCalledWith(
        expect.objectContaining({
          departmentId: 42,
          departmentCode: null,
          departmentName: null,
        }),
        manager,
      );
    },
  );

  it('重新登入更新可信部門，保留代碼大小寫與前導零', async () => {
    const { service, repo } = setup();
    repo.findUserByEmpIdForUpdate.mockResolvedValue({
      id: 9,
      empid: '00123',
      name: '舊姓名',
      isActive: true,
      deletedAt: null,
      departmentCode: 'OLD',
      departmentName: '舊部門',
    });
    await service.resolve(profile);
    expect(repo.saveUser).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentCode: '001a_B-02',
        departmentName: '合成部門',
      }),
      manager,
    );
  });

  it('HR 上游失敗原樣拒絕且不開資料庫交易', async () => {
    const { service, hr, mysql, repo } = setup();
    const failure = new Error('合成上游失敗');
    hr.lookupEligibleStaff.mockRejectedValue(failure);
    repo.createUser.mockResolvedValue({ id: 9, empid: '00123' });
    await expect(service.resolve(profile)).rejects.toBe(failure);
    expect(mysql.transaction).not.toHaveBeenCalled();
    expect(repo.createUser).not.toHaveBeenCalled();
    expect(repo.saveUser).not.toHaveBeenCalled();
  });

  it('缺員編時拒絕', async () => {
    const { service, hr } = setup();
    await expect(
      service.resolve({ ...profile, userNumber: null }),
    ).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_RESPONSE_INVALID,
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(hr.lookupEligibleStaff).not.toHaveBeenCalled();
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
