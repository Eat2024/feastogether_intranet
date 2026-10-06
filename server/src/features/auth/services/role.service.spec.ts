import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  AUDIT_ACTION,
  AUDIT_COLLECTION_ID,
  AUDIT_ENTITY,
} from '#app/features/auth/auth.constants';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthRolePermission } from '#app/features/auth/entities/auth-role-permission.entity';
import { PermissionRepository } from '#app/features/auth/repositories/permission.repository';
import { RoleUserRepository } from '#app/features/auth/repositories/role-user.repository';
import { RoleRepository } from '#app/features/auth/repositories/role.repository';
import { RoleService } from './role.service';

/** 可鏈式呼叫的 QueryBuilder mock。 */
const qb = (over: { many?: unknown[]; one?: unknown } = {}) => {
  const chain: Record<string, jest.Mock> = {};
  ['innerJoin', 'where', 'andWhere', 'select', 'addSelect', 'groupBy'].forEach(
    (m) => (chain[m] = jest.fn(() => chain)),
  );
  chain.getRawMany = jest.fn().mockResolvedValue(over.many ?? []);
  chain.getRawOne = jest.fn().mockResolvedValue(over.one ?? null);
  return chain;
};

/** repo mock：明寫簽章讓回值是 unknown 而非 any，否則 any 會外溢到 manager 各方法。 */
const repoMock = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  // 收 alias 參數（真實 Repository.createQueryBuilder(alias) 會帶）
  createQueryBuilder: jest.fn((_alias?: string) => qb()),
});

/**
 * EntityManager 的最小 mock 形狀。刻意不用 any——否則 any 會沿著
 * repoFor → manager.save.mock.calls 一路擴散到每一條斷言。
 */
interface ManagerMock {
  create: (
    entity: unknown,
    data: Record<string, unknown>,
  ) => Record<string, unknown>;
  save: jest.Mock;
  delete: jest.Mock;
  softRemove: jest.Mock;
  find: (entity: unknown, options?: unknown) => unknown;
  findOne: (entity: unknown, options?: unknown) => unknown;
  count: (entity: unknown, options?: unknown) => unknown;
  createQueryBuilder: (entity: unknown, alias: string) => unknown;
  transaction: (cb: (m: ManagerMock) => unknown) => unknown;
}

const setup = () => {
  const repos = new Map<
    unknown,
    ReturnType<typeof repoMock> & { manager: ManagerMock }
  >();
  const repoFor = (entity: unknown) => {
    if (!repos.has(entity)) {
      repos.set(entity, {
        ...repoMock(),
        get manager() {
          return manager;
        },
      });
    }
    return repos.get(entity)!;
  };
  const manager: ManagerMock = {
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    save: jest.fn((entity: { id?: number }) => {
      if (Array.isArray(entity)) return Promise.resolve(entity);
      if (entity.id === undefined) entity.id = 99;
      return Promise.resolve(entity);
    }),
    delete: jest.fn().mockResolvedValue({}),
    softRemove: jest.fn().mockResolvedValue({}),
    // repoMock 的方法是 jest.fn()（回值 any）；在這層一次收成 unknown，
    // 後面的斷言就不會整串沾到 any。
    find: (entity: unknown, options?: unknown) =>
      repoFor(entity).find(options) as unknown,
    findOne: (entity: unknown, options?: unknown) =>
      repoFor(entity).findOne(options) as unknown,
    count: (entity: unknown, options?: unknown) =>
      repoFor(entity).count(options) as unknown,
    createQueryBuilder: (entity: unknown, alias: string) =>
      repoFor(entity).createQueryBuilder(alias) as unknown,
    transaction: (cb: (m: ManagerMock) => unknown) => cb(manager),
  };
  const auditLog = { recordHistory: jest.fn().mockResolvedValue(undefined) };
  const authorization = {
    refreshRoleUsers: jest.fn().mockResolvedValue(undefined),
  };
  const db = {
    authRole: repoFor(AuthRole),
    authUser: repoFor(AuthUser),
    authGroup: repoFor(AuthGroup),
    authGroupJob: repoFor(AuthGroupJob),
    authJobPermission: repoFor(AuthJobPermission),
    authRolePermission: repoFor(AuthRolePermission),
  };
  const service = new RoleService(
    new RoleRepository(db as never),
    new RoleUserRepository(db as never),
    new PermissionRepository(db as never),
    auditLog as never,
    authorization as never,
  );
  return { service, repoFor, manager, auditLog, authorization };
};

const adminRole = {
  id: 1,
  roleCode: 'ADMIN',
  roleName: '系統管理員',
  isAdmin: true,
};
const normalRole = {
  id: 2,
  roleCode: 'ROLE_A',
  roleName: '門市',
  isAdmin: false,
};

describe('RoleService', () => {
  describe('create', () => {
    it('後端自動產生 ROLE_ 開頭 roleCode、非 admin，並寫 role_created 稽核', async () => {
      const { service, repoFor, manager, auditLog } = setup();
      repoFor(AuthRole).createQueryBuilder = jest.fn(() =>
        qb({ one: { max: '2' } }),
      );

      const result = await service.create({ roleName: '新角色' });

      const [saved] = manager.save.mock.calls[0] as [
        { roleCode: string; isAdmin: boolean; sortOrder: number },
      ];
      expect(saved.roleCode).toMatch(/^ROLE_[0-9A-F]{12}$/);
      expect(saved.isAdmin).toBe(false);
      expect(saved.sortOrder).toBe(3);
      expect(result.createdRoleId).toBe(99);
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_CREATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: 99,
          afterSnapshot: expect.objectContaining({
            roleName: '新角色',
          }) as Record<string, unknown>,
        }),
        manager,
      );
    });

    it('指派不存在 / 停用權限 → INVALID_PERMISSION_IDS 並列出無效 id', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).createQueryBuilder = jest.fn(() =>
        qb({ one: { max: '0' } }),
      );
      // 僅 id=1 有效；要求 [1,2] → 2 無效
      repoFor(AuthJobPermission).createQueryBuilder = jest.fn(() =>
        qb({ many: [{ id: 1 }] }),
      );

      await expect(
        service.create({ roleName: 'x', permissionIds: [1, 2] }),
      ).rejects.toMatchObject({ code: AppErrorCode.INVALID_PERMISSION_IDS });
    });

    it('新增與啟用中角色同名 → DUPLICATE_ROLE_NAME', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest.fn().mockResolvedValue({ id: 5 });
      await expect(service.create({ roleName: '門市' })).rejects.toMatchObject({
        code: AppErrorCode.DUPLICATE_ROLE_NAME,
      });
    });
  });

  describe('rename', () => {
    it('ADMIN 不可更名 → ADMIN_ROLE_LOCKED', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest.fn().mockResolvedValue(adminRole);
      await expect(service.rename(1, { roleName: 'x' })).rejects.toMatchObject({
        code: AppErrorCode.ADMIN_ROLE_LOCKED,
      });
    });

    it('一般角色改名 → 寫 role_updated 稽核（含 before/after）', async () => {
      const { service, repoFor, auditLog } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      await service.rename(2, { roleName: '新名' });
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_UPDATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: 2,
          beforeSnapshot: { roleName: '門市' },
          afterSnapshot: { roleName: '新名' },
        }),
        expect.anything(),
      );
    });

    it('角色不存在 → ROLE_NOT_FOUND', async () => {
      const { service } = setup();
      await expect(service.rename(99, { roleName: 'x' })).rejects.toMatchObject(
        {
          code: AppErrorCode.ROLE_NOT_FOUND,
        },
      );
    });

    it('改名為其他啟用中角色已用的名稱 → DUPLICATE_ROLE_NAME', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValueOnce({ ...normalRole }) // loadActiveRole（依 id）
        .mockResolvedValueOnce({ id: 5 }); // 重名查詢（依 name）回另一筆
      await expect(
        service.rename(2, { roleName: '主廚' }),
      ).rejects.toMatchObject({ code: AppErrorCode.DUPLICATE_ROLE_NAME });
    });

    it('改名為自己現有名稱（同一筆）→ 允許不報重複', async () => {
      const { service, repoFor, auditLog } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValueOnce({ ...normalRole }) // loadActiveRole
        .mockResolvedValueOnce({ id: 2 }); // 同名查回自己 → excludeRoleId 排除
      await service.rename(2, { roleName: '門市' });
      expect(auditLog.recordHistory).toHaveBeenCalled();
    });
  });

  describe('setPermissions', () => {
    it('ADMIN 清空權限 → ADMIN_ROLE_LOCKED', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest.fn().mockResolvedValue(adminRole);
      await expect(
        service.setPermissions(1, { permissionIds: [] }),
      ).rejects.toMatchObject({ code: AppErrorCode.ADMIN_ROLE_LOCKED });
    });

    it('一般角色整組覆蓋 → 先刪後插並寫 role_permissions_updated', async () => {
      const { service, repoFor, manager, auditLog, authorization } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      repoFor(AuthJobPermission).createQueryBuilder = jest.fn(() =>
        qb({ many: [{ id: 1 }, { id: 2 }] }),
      );
      repoFor(AuthRolePermission).find = jest.fn().mockResolvedValue([]);

      const result = await service.setPermissions(2, { permissionIds: [1, 2] });

      expect(manager.delete).toHaveBeenCalledWith(AuthRolePermission, {
        roleId: 2,
      });
      expect(result).toEqual({ id: 2, permissionIds: [1, 2] });
      expect(authorization.refreshRoleUsers).toHaveBeenCalledWith(2);
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_PERMISSIONS_UPDATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: 2,
          beforeSnapshot: { permissionIds: [] },
          afterSnapshot: { permissionIds: [1, 2] },
        }),
        expect.anything(),
      );
    });

    it('相同集合、順序不同 → 稽核快照一律升冪（避免假異動）', async () => {
      const { service, repoFor, auditLog } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      repoFor(AuthJobPermission).createQueryBuilder = jest.fn(() =>
        qb({ many: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
      );
      // DB 現有權限以非排序順序回傳
      repoFor(AuthRolePermission).find = jest
        .fn()
        .mockResolvedValue([
          { permissionId: 3 },
          { permissionId: 1 },
          { permissionId: 2 },
        ]);

      await service.setPermissions(2, { permissionIds: [2, 1, 3] });

      // before / after 皆排序後相同 → 下游 buildChanges 視為無異動
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeSnapshot: { permissionIds: [1, 2, 3] },
          afterSnapshot: { permissionIds: [1, 2, 3] },
        }),
        expect.anything(),
      );
    });

    it('transaction rollback 時不更新 permission cache', async () => {
      const { service, repoFor, manager, authorization } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      repoFor(AuthJobPermission).createQueryBuilder = jest.fn(() =>
        qb({ many: [{ id: 1 }] }),
      );
      repoFor(AuthRolePermission).find = jest.fn().mockResolvedValue([]);
      manager.delete.mockRejectedValueOnce(new Error('synthetic rollback'));

      await expect(
        service.setPermissions(2, { permissionIds: [1] }),
      ).rejects.toThrow('synthetic rollback');
      expect(authorization.refreshRoleUsers).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('ADMIN 不可刪除 → ADMIN_ROLE_LOCKED', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest.fn().mockResolvedValue(adminRole);
      await expect(service.softDelete(1)).rejects.toMatchObject({
        code: AppErrorCode.ADMIN_ROLE_LOCKED,
      });
    });

    it('仍有使用者綁定 → ROLE_HAS_USERS（409）', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      repoFor(AuthUser).count = jest.fn().mockResolvedValue(3);
      await expect(service.softDelete(2)).rejects.toMatchObject({
        code: AppErrorCode.ROLE_HAS_USERS,
      });
    });

    it('無綁定 → softRemove 並寫 role_deleted', async () => {
      const { service, repoFor, manager, auditLog } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      repoFor(AuthUser).count = jest.fn().mockResolvedValue(0);
      await service.softDelete(2);
      expect(manager.softRemove).toHaveBeenCalled();
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_DELETED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: 2,
          beforeSnapshot: { roleName: '門市', roleCode: 'ROLE_A' },
        }),
        expect.anything(),
      );
    });
  });

  describe('reorder', () => {
    // 兩筆一般角色（不同名，避免誤觸批次內重名）。
    const twoRoles = () => [
      { ...normalRole, id: 2, roleName: '門市', sortOrder: 1 },
      {
        ...normalRole,
        id: 3,
        roleCode: 'ROLE_B',
        roleName: '主廚',
        sortOrder: 2,
      },
    ];

    it('純排序（名稱不變）→ 只寫集合層級稽核，不寫個別改名', async () => {
      const { service, repoFor, auditLog } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue(twoRoles());

      await service.reorder({
        roles: [
          { roleId: 3, roleName: '主廚' },
          { roleId: 2, roleName: '門市' },
        ],
      });

      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_REORDERED,
          entityType: AUDIT_ENTITY.ROLE_COLLECTION,
          entityId: AUDIT_COLLECTION_ID.ALL,
          beforeSnapshot: { roleIds: [2, 3] },
          afterSnapshot: { roleIds: [3, 2] },
        }),
        expect.anything(),
      );
      // 名稱皆未變 → 僅一筆（排序）稽核
      expect(auditLog.recordHistory).toHaveBeenCalledTimes(1);
    });

    it('一併改名 → 除排序外對改名角色寫 ROLE_UPDATED（含 before/after）', async () => {
      const { service, repoFor, auditLog } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue(twoRoles());

      await service.reorder({
        roles: [
          { roleId: 2, roleName: '門市' },
          { roleId: 3, roleName: '新主廚' },
        ],
      });

      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_UPDATED,
          entityType: AUDIT_ENTITY.ROLE,
          entityId: 3,
          beforeSnapshot: { roleName: '主廚' },
          afterSnapshot: { roleName: '新主廚' },
        }),
        expect.anything(),
      );
    });

    it('改 ADMIN 名稱 → ADMIN_ROLE_LOCKED', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue([
        { ...adminRole, id: 1, roleName: '系統管理員', sortOrder: 1 },
        { ...normalRole, id: 2, roleName: '門市', sortOrder: 2 },
      ]);
      await expect(
        service.reorder({
          roles: [
            { roleId: 1, roleName: '改不得' },
            { roleId: 2, roleName: '門市' },
          ],
        }),
      ).rejects.toMatchObject({ code: AppErrorCode.ADMIN_ROLE_LOCKED });
    });

    it('ADMIN 名稱不變、僅換位置 → 通過並更新排序', async () => {
      const { service, repoFor, auditLog } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue([
        { ...adminRole, id: 1, roleName: '系統管理員', sortOrder: 1 },
        { ...normalRole, id: 2, roleName: '門市', sortOrder: 2 },
      ]);
      await service.reorder({
        roles: [
          { roleId: 2, roleName: '門市' },
          { roleId: 1, roleName: '系統管理員' },
        ],
      });
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTION.ROLE_REORDERED }),
        expect.anything(),
      );
    });

    it('批次內兩角色同名 → DUPLICATE_ROLE_NAME', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue(twoRoles());
      await expect(
        service.reorder({
          roles: [
            { roleId: 2, roleName: '相同' },
            { roleId: 3, roleName: '相同' },
          ],
        }),
      ).rejects.toMatchObject({ code: AppErrorCode.DUPLICATE_ROLE_NAME });
    });

    it('兩角色互換名稱 → 成功，各寫一筆 ROLE_UPDATED（不誤判重名）', async () => {
      const { service, repoFor, auditLog } = setup();
      // twoRoles：id2='門市'、id3='主廚'；互換後最終名稱集合仍唯一。
      repoFor(AuthRole).find = jest.fn().mockResolvedValue(twoRoles());

      await service.reorder({
        roles: [
          { roleId: 2, roleName: '主廚' },
          { roleId: 3, roleName: '門市' },
        ],
      });

      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_UPDATED,
          entityId: 2,
          beforeSnapshot: { roleName: '門市' },
          afterSnapshot: { roleName: '主廚' },
        }),
        expect.anything(),
      );
      expect(auditLog.recordHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.ROLE_UPDATED,
          entityId: 3,
          beforeSnapshot: { roleName: '主廚' },
          afterSnapshot: { roleName: '門市' },
        }),
        expect.anything(),
      );
    });

    it('清單缺角色（涵蓋不完整）→ INVALID_REQUEST', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue(twoRoles());
      await expect(
        service.reorder({ roles: [{ roleId: 2, roleName: '門市' }] }),
      ).rejects.toMatchObject({ code: AppErrorCode.INVALID_REQUEST });
    });

    it('清單含重複 roleId → INVALID_REQUEST（service 自守，不依賴 DTO）', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).find = jest.fn().mockResolvedValue(twoRoles());
      // 名稱刻意不同，隔離出「roleId 重複」路徑（否則會先被批次內重名擋下）。
      await expect(
        service.reorder({
          roles: [
            { roleId: 2, roleName: '門市' },
            { roleId: 2, roleName: '主廚' },
          ],
        }),
      ).rejects.toMatchObject({ code: AppErrorCode.INVALID_REQUEST });
    });
  });

  describe('查詢', () => {
    it('list 帶出每角色 userCount', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).find = jest
        .fn()
        .mockResolvedValue([{ ...normalRole, sortOrder: 1 }]);
      repoFor(AuthUser).createQueryBuilder = jest.fn(() =>
        qb({ many: [{ roleId: 2, cnt: '4' }] }),
      );
      const list = await service.list();
      expect(list[0]).toMatchObject({ id: 2, userCount: 4 });
    });

    it('getRoleUsers 每筆補 lastLoginAt / isActive（含已停用帳號）', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      const login = new Date('2026-07-06T14:43:13.000Z');
      repoFor(AuthUser).find = jest.fn().mockResolvedValue([
        {
          id: 12,
          personEmpid: 'EMP-001',
          personName: '陳測試',
          departmentName: 'IT部',
          titleName: '資深專案管理師',
          lastLoginAt: login,
          isActive: true,
        },
        {
          id: 13,
          personEmpid: 'EMP-002',
          personName: '未登入者',
          departmentName: null,
          titleName: null,
          lastLoginAt: undefined,
          isActive: false,
        },
      ]);

      const usersList = await service.getRoleUsers(2);

      expect(usersList[0]).toEqual({
        id: 12,
        empId: 'EMP-001',
        name: '陳測試',
        roleName: '門市',
        departmentName: 'IT部',
        titleName: '資深專案管理師',
        lastLoginAt: login,
        isActive: true,
      });
      // 已停用帳號仍出現，isActive:false、未登入 lastLoginAt:null
      expect(usersList[1]).toMatchObject({
        id: 13,
        roleName: '門市',
        isActive: false,
        lastLoginAt: null,
      });
    });

    it('getPermissionMatrix 組出三層結構並標記 checked', async () => {
      const { service, repoFor } = setup();
      repoFor(AuthRole).findOne = jest
        .fn()
        .mockResolvedValue({ ...normalRole });
      repoFor(AuthGroup).find = jest
        .fn()
        .mockResolvedValue([{ id: 10, groupName: 'G' } as AuthGroup]);
      repoFor(AuthGroupJob).find = jest
        .fn()
        .mockResolvedValue([
          { id: 20, groupId: 10, jobName: 'J' } as AuthGroupJob,
        ]);
      repoFor(AuthJobPermission).find = jest.fn().mockResolvedValue([
        {
          id: 30,
          jobId: 20,
          action: 'view',
          permissionName: 'v',
        } as AuthJobPermission,
      ]);
      repoFor(AuthRolePermission).find = jest
        .fn()
        .mockResolvedValue([{ permissionId: 30 } as AuthRolePermission]);

      const matrix = await service.getPermissionMatrix(2);
      expect(matrix.groups[0].jobs[0].permissions[0]).toMatchObject({
        permissionId: 30,
        checked: true,
      });
    });
  });
});
