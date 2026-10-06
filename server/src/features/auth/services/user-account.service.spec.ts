import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUDIT_ACTION, AUDIT_ENTITY } from '#app/features/auth/auth.constants';
import { UserAccountService } from './user-account.service';

const activeUser = () => ({
  id: 1,
  roleId: 2,
  isActive: true,
  personEmpid: 'E1',
  personName: '甲',
  description: null,
});

const setup = () => {
  const users = {
    transaction: jest.fn((cb: (m: string) => unknown) => cb('MGR')),
    findById: jest.fn(),
    findByEmpId: jest.fn(),
    findByEmpIds: jest.fn(),
    findByEmpIdsIncludingDeleted: jest.fn().mockResolvedValue([]),
    listItemsByEmpIds: jest.fn().mockResolvedValue([]),
    listItemsByRoleId: jest.fn().mockResolvedValue([]),
    save: jest.fn((u: unknown) => Promise.resolve(u)),
    listWithTotal: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    create: jest.fn((data: object) => Promise.resolve({ ...data, id: 99 })),
  };
  const roles = {
    findById: jest.fn(),
    findByIds: jest.fn().mockResolvedValue([]),
  };
  const auditLog = { recordHistory: jest.fn().mockResolvedValue(undefined) };
  const authorization = { refreshUser: jest.fn().mockResolvedValue(undefined) };
  // 034 SEC-06：停用帳號會撤 Redis session。
  const sessions = {
    revokeAllSessions: jest.fn().mockResolvedValue(0),
  };
  const hr = {
    lookupStaff: jest.fn().mockResolvedValue([
      {
        person_empid: '00115001',
        person_name: '測試員一號',
        person_status: 1,
        person_status_name: '正式',
        department_id: 'TEST01',
        department_name: '測試部門',
        title: '測試職稱',
      },
    ]),
  };
  const service = new UserAccountService(
    users as never,
    roles as never,
    auditLog as never,
    authorization as never,
    sessions as never,
    hr as never,
  );
  return { service, users, roles, auditLog, authorization, sessions, hr };
};

describe('UserAccountService', () => {
  it('員編片段向 fgapi 模糊查詢，保留本地停用狀態且不建檔', async () => {
    const { service, users, hr } = setup();
    users.findByEmpIdsIncludingDeleted.mockResolvedValue([
      { ...activeUser(), personEmpid: '00115001', isActive: false },
    ]);
    await expect(
      service.searchEmployeeOptions({ empId: '11500' }),
    ).resolves.toEqual([
      {
        empId: '00115001',
        name: '測試員一號',
        departmentName: '測試部門',
        isActive: false,
      },
    ]);
    expect(hr.lookupStaff).toHaveBeenCalledWith('11500');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('未登入同仁可於角色儲存時建檔，稽核使用新帳號 ID 且不設定登入時間', async () => {
    const { service, users, roles, auditLog, authorization, hr } = setup();
    users.findByEmpId.mockResolvedValue(null);
    roles.findById.mockResolvedValue({
      id: 2,
      roleName: '測試角色',
      isActive: true,
      isAdmin: false,
    });
    const result = await service.updateRoleAndStatus('00115001', { roleId: 2 });
    expect(hr.lookupStaff).toHaveBeenCalledWith('00115001');
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        personEmpid: '00115001',
        personName: '測試員一號',
        departmentCode: 'TEST01',
      }),
      'MGR',
    );
    expect(users.create.mock.calls[0][0]).not.toHaveProperty('lastLoginAt');
    expect(result).toMatchObject({ id: 99, role: { id: 2 } });
    expect(auditLog.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 99 }),
      'MGR',
    );
    expect(authorization.refreshUser).toHaveBeenCalledWith(99);
  });

  describe('list', () => {
    it('分頁 + 關鍵字：算出 offset 並回 users + 第一層分頁欄位', async () => {
      const { service, users } = setup();
      users.listWithTotal.mockResolvedValue({
        total: 5,
        rows: [
          {
            id: 1,
            empId: 'E1',
            name: '甲',
            departmentName: '門市A',
            lastLoginAt: null,
            personStatus: '在職',
            isActive: 1, // MySQL tinyint(1)
            roleId: 2,
            roleName: '店長',
            roleCode: 'MANAGER',
            isAdmin: 0,
          },
        ],
      });

      const res = await service.list({
        keyword: '甲',
        roleId: 2,
        page: 2,
        pageSize: 10,
      });

      expect(users.listWithTotal).toHaveBeenCalledWith(
        { keyword: '甲', roleId: 2 },
        10,
        10,
      ); // offset=(2-1)*10
      expect(res).toMatchObject({ total: 5, page: 2, pageSize: 10 });
      expect(res).not.toHaveProperty('meta');
      expect(res.users[0]).toMatchObject({
        id: 1,
        empId: 'E1',
        role: { id: 2, roleName: '店長' },
        departmentName: '門市A',
        personStatus: '在職',
        isActive: true, // tinyint 1 → boolean
        isSystemAdmin: false,
      });
    });

    it('無角色者 role 為 null、isSystemAdmin 為 false', async () => {
      const { service, users } = setup();
      users.listWithTotal.mockResolvedValue({
        total: 1,
        rows: [
          {
            id: 9,
            empId: 'E9',
            name: '乙',
            departmentName: null,
            lastLoginAt: null,
            personStatus: null,
            isActive: 0,
            roleId: null,
            roleName: null,
            roleCode: null,
            isAdmin: null,
          },
        ],
      });
      const res = await service.list({ page: 1, pageSize: 20 });
      expect(res.users[0].role).toBeNull();
      expect(res.users[0].isActive).toBe(false);
      expect(res.users[0].isSystemAdmin).toBe(false);
    });

    it('系統管理員角色（is_admin）→ isSystemAdmin 為 true', async () => {
      const { service, users } = setup();
      users.listWithTotal.mockResolvedValue({
        total: 1,
        rows: [
          {
            id: 3,
            empId: 'E3',
            name: '管',
            departmentName: null,
            lastLoginAt: null,
            personStatus: '在職',
            isActive: 1,
            roleId: 9,
            roleName: '系統管理員',
            roleCode: 'ADMIN',
            isAdmin: 1,
          },
        ],
      });
      const res = await service.list({ page: 1, pageSize: 20 });
      expect(res.users[0].isSystemAdmin).toBe(true);
    });
  });

  describe('updateRoleAndStatus — 角色', () => {
    it('覆蓋指派啟用角色 → 寫 user_role_updated（before/after）', async () => {
      const { service, users, roles, auditLog, authorization } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      roles.findById.mockResolvedValue({
        id: 5,
        roleName: '主廚',
        isActive: true,
      });

      await service.updateRoleAndStatus('E1', { roleId: 5 });

      expect(users.save).toHaveBeenCalled();
      expect(authorization.refreshUser).toHaveBeenCalledWith(1);
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.USER_ROLE_UPDATED,
          entityType: AUDIT_ENTITY.USER,
          entityId: 1,
          beforeSnapshot: { roleId: 2 },
          afterSnapshot: { roleId: 5 },
          associatedTargets: [
            { type: AUDIT_ENTITY.ROLE, id: 2 },
            { type: AUDIT_ENTITY.ROLE, id: 5 },
          ],
        }),
        'MGR',
      );
    });

    it('角色未變更時不更新 permission cache', async () => {
      const { service, users, roles, authorization } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      roles.findById.mockResolvedValue({
        id: 2,
        roleName: '原角色',
        isActive: true,
      });

      await service.updateRoleAndStatus('E1', { roleId: 2 });

      expect(authorization.refreshUser).not.toHaveBeenCalled();
    });

    it('只有 description 變更時不更新 permission cache', async () => {
      const { service, users, authorization } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());

      await service.updateRoleAndStatus('E1', { description: '合成備註' });

      expect(authorization.refreshUser).not.toHaveBeenCalled();
    });

    it('transaction rollback 時不更新 permission cache', async () => {
      const { service, users, authorization } = setup();
      users.transaction.mockRejectedValueOnce(new Error('synthetic rollback'));

      await expect(
        service.updateRoleAndStatus('E1', { roleId: 5 }),
      ).rejects.toThrow('synthetic rollback');
      expect(authorization.refreshUser).not.toHaveBeenCalled();
    });

    it('指向不存在角色 → INVALID_ROLE_ID', async () => {
      const { service, users, roles } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      roles.findById.mockResolvedValue(null);
      await expect(
        service.updateRoleAndStatus('E1', { roleId: 99 }),
      ).rejects.toMatchObject({ code: AppErrorCode.INVALID_ROLE_ID });
    });

    it('指向停用角色 → INVALID_ROLE_ID', async () => {
      const { service, users, roles } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      roles.findById.mockResolvedValue({
        id: 5,
        roleName: 'x',
        isActive: false,
      });
      await expect(
        service.updateRoleAndStatus('E1', { roleId: 5 }),
      ).rejects.toMatchObject({ code: AppErrorCode.INVALID_ROLE_ID });
    });

    it('指派系統管理員角色（is_admin）→ ADMIN_ROLE_LOCKED，且不落庫（擋提權）', async () => {
      const { service, users, roles, auditLog } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      roles.findById.mockResolvedValue({
        id: 9,
        roleName: '系統管理員',
        roleCode: 'ADMIN',
        isActive: true,
        isAdmin: true,
      });
      await expect(
        service.updateRoleAndStatus('E1', { roleId: 9 }),
      ).rejects.toMatchObject({ code: AppErrorCode.ADMIN_ROLE_LOCKED });
      expect(users.save).not.toHaveBeenCalled();
      expect(auditLog.recordHistory).not.toHaveBeenCalled();
    });

    it('以 role_code=ADMIN 指派（即使 is_admin 旗標為 false）→ 一樣擋下', async () => {
      const { service, users, roles } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      roles.findById.mockResolvedValue({
        id: 9,
        roleName: 'ADMIN',
        roleCode: 'ADMIN',
        isActive: true,
        isAdmin: false,
      });
      await expect(
        service.updateRoleAndStatus('E1', { roleId: 9 }),
      ).rejects.toMatchObject({ code: AppErrorCode.ADMIN_ROLE_LOCKED });
    });
  });

  describe('updateRoleAndStatus — 狀態', () => {
    it('停用 → 寫 user_status_updated', async () => {
      const { service, users, auditLog, authorization } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      await service.updateRoleAndStatus('E1', { isActive: false });
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.USER_STATUS_UPDATED,
          entityType: AUDIT_ENTITY.USER,
          entityId: 1,
          beforeSnapshot: { isActive: true },
          afterSnapshot: { isActive: false },
        }),
        'MGR',
      );
      expect(authorization.refreshUser).toHaveBeenCalledWith(1);
    });

    it('狀態未改變 → 不寫稽核', async () => {
      const { service, users, auditLog, authorization } = setup();
      users.findByEmpId.mockResolvedValue(activeUser());
      await service.updateRoleAndStatus('E1', { isActive: true });
      expect(auditLog.recordHistory).not.toHaveBeenCalled();
      expect(authorization.refreshUser).not.toHaveBeenCalled();
    });

    it('停用超級管理者帳號 → ADMIN_ROLE_LOCKED，不落庫（補既有單筆漏洞）', async () => {
      const { service, users, roles, auditLog } = setup();
      users.findByEmpId.mockResolvedValue(activeUser()); // isActive:true, roleId:2
      roles.findById.mockResolvedValue({
        id: 2,
        roleName: '系統管理員',
        roleCode: 'ADMIN',
        isAdmin: true,
      });
      await expect(
        service.updateRoleAndStatus('E1', { isActive: false }),
      ).rejects.toMatchObject({ code: AppErrorCode.ADMIN_ROLE_LOCKED });
      expect(auditLog.recordHistory).not.toHaveBeenCalled();
    });

    it('啟用超級管理者帳號 → 不擋（啟用不做 admin 檢查）', async () => {
      const { service, users, roles } = setup();
      users.findByEmpId.mockResolvedValue({ ...activeUser(), isActive: false });
      roles.findById.mockResolvedValue({
        id: 2,
        roleName: '系統管理員',
        roleCode: 'ADMIN',
        isAdmin: true,
      });
      await expect(
        service.updateRoleAndStatus('E1', { isActive: true }),
      ).resolves.toMatchObject({ isActive: true });
    });
  });

  describe('batchUpdateStatus', () => {
    const u = (
      empId: string,
      isActive: boolean,
      roleId: number | null = null,
    ) =>
      ({
        id: empId === 'A' ? 1 : empId === 'B' ? 2 : 9,
        personEmpid: empId,
        isActive,
        roleId,
      }) as never;

    it('一般帳號批次停用 → 各寫一筆稽核、回最新列資料', async () => {
      const { service, users, auditLog, authorization } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', true), u('B', true)]);
      users.listItemsByEmpIds.mockResolvedValue([
        { id: 1, empId: 'A', name: 'a', isActive: 0, roleId: 2, roleName: 'x' },
        { id: 2, empId: 'B', name: 'b', isActive: 0, roleId: 2, roleName: 'x' },
      ]);
      const res = await service.batchUpdateStatus({
        empIds: ['A', 'B'],
        isActive: false,
      });
      expect(res.users).toHaveLength(2);
      expect(res.users[0]).toMatchObject({ empId: 'A', isActive: false });
      expect(users.listItemsByEmpIds).toHaveBeenCalledWith(['A', 'B']);
      expect(auditLog.recordHistory).toHaveBeenCalledTimes(2);
      expect(users.save).toHaveBeenCalledTimes(2);
      expect(authorization.refreshUser).toHaveBeenCalledTimes(2);
      expect(authorization.refreshUser).toHaveBeenCalledWith(1);
      expect(authorization.refreshUser).toHaveBeenCalledWith(2);
    });

    it('含超級管理者的停用批次 → ADMIN_ROLE_LOCKED（交易拋錯 → 整批 rollback）', async () => {
      const { service, users, roles } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', true), u('ADM', true, 9)]);
      // 批次以 findByIds 一次預載角色（消 N+1）
      roles.findByIds.mockResolvedValue([
        { id: 9, roleName: '系統管理員', roleCode: 'ADMIN', isAdmin: true },
      ]);
      await expect(
        service.batchUpdateStatus({ empIds: ['A', 'ADM'], isActive: false }),
      ).rejects.toMatchObject({ code: AppErrorCode.ADMIN_ROLE_LOCKED });
      // 只查一次（不是每個 user 各查一次）
      expect(roles.findByIds).toHaveBeenCalledTimes(1);
      expect(roles.findById).not.toHaveBeenCalled();
    });

    it('含超級管理者的啟用批次 → 不擋，全部啟用', async () => {
      const { service, users } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', false), u('ADM', false, 9)]);
      const res = await service.batchUpdateStatus({
        empIds: ['A', 'ADM'],
        isActive: true,
      });
      expect(res.users).toBeDefined();
    });

    it('含查無 empId → USER_NOT_FOUND（整批 rollback）', async () => {
      const { service, users } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', true)]); // 只回一筆
      await expect(
        service.batchUpdateStatus({ empIds: ['A', 'GONE'], isActive: false }),
      ).rejects.toMatchObject({ code: AppErrorCode.USER_NOT_FOUND });
      expect(users.save).not.toHaveBeenCalled();
    });

    it('無變動者不重複寫稽核（已是目標狀態）', async () => {
      const { service, users, auditLog, authorization } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', false), u('B', true)]);
      await service.batchUpdateStatus({
        empIds: ['A', 'B'],
        isActive: false,
      });
      expect(auditLog.recordHistory).toHaveBeenCalledTimes(1); // 只有 B 變動
      expect(authorization.refreshUser).toHaveBeenCalledTimes(1);
      expect(authorization.refreshUser).toHaveBeenCalledWith(2);
    });

    it('帶 roleId → 回傳範圍改為整個角色（listItemsByRoleId）', async () => {
      const { service, users } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', true)]);
      users.listItemsByRoleId.mockResolvedValue([
        { id: 1, empId: 'A', name: 'a', isActive: 0, roleId: 7, roleName: 'x' },
        { id: 2, empId: 'C', name: 'c', isActive: 1, roleId: 7, roleName: 'x' },
      ]);
      const res = await service.batchUpdateStatus({
        empIds: ['A'],
        isActive: false,
        roleId: 7,
      });
      expect(users.listItemsByRoleId).toHaveBeenCalledWith(7);
      expect(users.listItemsByEmpIds).not.toHaveBeenCalled();
      expect(res.users.map((x) => x.empId)).toEqual(['A', 'C']); // 整個角色
    });

    it('empIds 去重後套用', async () => {
      const { service, users } = setup();
      users.findByEmpIds.mockResolvedValue([u('A', true)]);
      await service.batchUpdateStatus({
        empIds: ['A', 'A'],
        isActive: false,
      });
      expect(users.findByEmpIds).toHaveBeenCalledWith(['A'], 'MGR');
    });
  });

  describe('getDetail', () => {
    it('不存在 → USER_NOT_FOUND', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);
      await expect(service.getDetail(404)).rejects.toMatchObject({
        code: AppErrorCode.USER_NOT_FOUND,
      });
    });

    it('系統管理員 → 回應 isSystemAdmin 為 true', async () => {
      const { service, users, roles } = setup();
      users.findById.mockResolvedValue(activeUser()); // roleId:2
      roles.findById.mockResolvedValue({
        id: 2,
        roleName: '系統管理員',
        roleCode: 'ADMIN',
        isAdmin: true,
      });
      const res = await service.getDetail(1);
      expect(res.isSystemAdmin).toBe(true);
      expect(res.role).toEqual({ id: 2, roleName: '系統管理員' });
    });

    it('無角色 → isSystemAdmin 為 false', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({ ...activeUser(), roleId: null });
      const res = await service.getDetail(1);
      expect(res.isSystemAdmin).toBe(false);
      expect(res.role).toBeNull();
    });
  });
});
