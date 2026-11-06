import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { EMPLOYEE_INELIGIBLE_EVENT } from './auth-security-event.service';
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
    const eligibleStaff = {
      lookupEligibleStaff: jest.fn().mockResolvedValue({
        department_id: '001a_B-02',
        department_name: '合成部門',
      }),
    };
    const mysql = {
      transaction: jest.fn((run: (value: never) => unknown) => run(manager)),
    };
    const events = { recordRejection: jest.fn() };
    return {
      service: new OauthIdentityService(
        repo,
        logger as never,
        mysql as never,
        eligibleStaff as never,
        events as never,
      ),
      repo,
      eligibleStaff,
      logger,
      mysql,
      events,
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

  it('新增帳號先以驗證員編查 Portal 員工資料並保存可信部門，不使用 profile 欄位', async () => {
    const { service, repo, eligibleStaff } = setup();
    repo.findUserByEmpIdForUpdate.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({ id: 9, empid: '00123' });
    const untrustedExtra = { ...profile, departmentCode: 'FORGED' };
    await service.resolve(untrustedExtra);
    expect(eligibleStaff.lookupEligibleStaff).toHaveBeenCalledWith('00123');
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentCode: '001a_B-02',
        departmentName: '合成部門',
      }),
      manager,
    );
  });

  it('HR 缺部門（EligibleStaffService 給 null）寫入 NULL 清除舊值', async () => {
    const { service, repo, eligibleStaff } = setup();
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
    eligibleStaff.lookupEligibleStaff.mockResolvedValue({
      department_id: null,
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
  });

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

  it.each([
    ['Portal 查詢失敗', new AppException(...AppErrors.STAFF_LOOKUP_FAILED)],
    ['未預期錯誤', new Error('合成上游失敗')],
  ])(
    '員工資料%s原樣拒絕、不開資料庫交易，也不記拒絕事件',
    async (_case, failure) => {
      const { service, eligibleStaff, mysql, repo, events } = setup();
      eligibleStaff.lookupEligibleStaff.mockRejectedValue(failure);
      repo.createUser.mockResolvedValue({ id: 9, empid: '00123' });
      await expect(service.resolve(profile)).rejects.toBe(failure);
      expect(mysql.transaction).not.toHaveBeenCalled();
      expect(repo.createUser).not.toHaveBeenCalled();
      expect(repo.saveUser).not.toHaveBeenCalled();
      expect(events.recordRejection).not.toHaveBeenCalled();
    },
  );

  it('Portal 判定不可登入時記匿名拒絕事件並原樣拒絕', async () => {
    const { service, eligibleStaff, events } = setup();
    const rejected = new AppException(...AppErrors.AUTH_EXCHANGE_FAILED);
    eligibleStaff.lookupEligibleStaff.mockRejectedValue(rejected);
    await expect(service.resolve(profile)).rejects.toBe(rejected);
    expect(events.recordRejection).toHaveBeenCalledWith(
      EMPLOYEE_INELIGIBLE_EVENT,
    );
  });

  it('缺員編時拒絕並記匿名拒絕事件', async () => {
    const { service, eligibleStaff, events } = setup();
    await expect(
      service.resolve({ ...profile, userNumber: null }),
    ).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_RESPONSE_INVALID,
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(eligibleStaff.lookupEligibleStaff).not.toHaveBeenCalled();
    expect(events.recordRejection).toHaveBeenCalledWith(
      EMPLOYEE_INELIGIBLE_EVENT,
    );
  });

  it.each([
    [{ isActive: false, deletedAt: null }],
    [{ isActive: true, deletedAt: new Date() }],
  ])('停用或 soft-deleted User 拒絕並記匿名拒絕事件：%p', async (state) => {
    const { service, repo, events } = setup();
    repo.findUserByEmpIdForUpdate.mockResolvedValue({
      id: 9,
      empid: '00123',
      name: '舊姓名',
      ...state,
    });
    await expect(service.resolve(profile)).rejects.toMatchObject({
      code: AppErrorCode.ACCOUNT_DISABLED,
    });
    expect(events.recordRejection).toHaveBeenCalledWith(
      EMPLOYEE_INELIGIBLE_EVENT,
    );
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
