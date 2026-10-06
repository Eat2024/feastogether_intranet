import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import {
  toPermissionCatalog,
  toPermissionMatrix,
  buildRoleItem,
} from './role.mapper';

const role = (over: Partial<AuthRole> = {}): AuthRole =>
  ({
    id: 5,
    roleCode: 'ROLE_X',
    roleName: '門市',
    isAdmin: false,
    isActive: true,
    sortOrder: 2,
    ...over,
  }) as AuthRole;

describe('role.mapper', () => {
  it('buildRoleItem 帶出 userCount 與 sortOrder（null 容錯）', () => {
    expect(buildRoleItem(role({ sortOrder: undefined }), 3)).toEqual({
      id: 5,
      roleName: '門市',
      roleCode: 'ROLE_X',
      isAdmin: false,
      isActive: true,
      sortOrder: null,
      userCount: 3,
    });
  });

  describe('toPermissionMatrix', () => {
    const groups = [{ id: 1, groupName: '權限管理' } as AuthGroup];
    const jobs = [
      {
        id: 10,
        groupId: 1,
        jobKey: 'roleManagement',
        jobName: '角色管理',
      } as AuthGroupJob,
    ];
    // 故意亂序，驗證 mapper 會依 ACTION_ORDER 排序
    const permissions = [
      {
        id: 102,
        jobId: 10,
        action: 'delete',
        permissionName: '刪除角色管理',
      } as AuthJobPermission,
      {
        id: 100,
        jobId: 10,
        action: 'view',
        permissionName: '查看角色管理',
      } as AuthJobPermission,
      {
        id: 101,
        jobId: 10,
        action: 'createEdit',
        permissionName: '新增或編輯角色管理',
      } as AuthJobPermission,
    ];

    it('只回該 job 實際擁有的權限，依 ACTION_ORDER 排序，套用 label / checked', () => {
      const matrix = toPermissionMatrix(
        role(),
        groups,
        jobs,
        permissions,
        new Set([101]),
      );

      expect(matrix.roleId).toBe(5);
      const perms = matrix.groups[0].jobs[0].permissions;
      // 此 job 的 DB 只有 view/createEdit/delete；printExport 不存在 → 不回傳
      // （版面要不要留空格是前端 visibility 的事，後端不送零資訊量的佔位）
      expect(perms.map((p) => p.action)).toEqual([
        'view',
        'createEdit',
        'delete',
      ]);
      expect(perms.map((p) => p.label)).toEqual(['檢視', '新增/編輯', '刪除']);
      expect(perms.some((p) => p.action === 'printExport')).toBe(false);
      // 回傳的每一筆都必有真實 permissionId——null 不再可能被送回 PUT
      expect(perms.every((p) => typeof p.permissionId === 'number')).toBe(true);
      expect(perms.find((p) => p.permissionId === 101)?.checked).toBe(true);
      expect(perms.find((p) => p.permissionId === 100)?.checked).toBe(false);
    });

    it('toPermissionCatalog 回目錄結構、含 permissionId，且不含角色 / checked 欄位', () => {
      const catalog = toPermissionCatalog(groups, jobs, permissions);
      expect(catalog).not.toHaveProperty('roleId');
      const job = catalog.groups[0].jobs[0];
      expect(job.jobKey).toBe('roleManagement');
      const perms = job.permissions;
      expect(perms.map((p) => p.action)).toEqual([
        'view',
        'createEdit',
        'delete',
      ]);
      expect(perms.map((p) => p.permissionId)).toEqual([100, 101, 102]);
      expect(perms.some((p) => 'checked' in p)).toBe(false);
    });

    it('功能無任何權限時回空陣列（不再回四個佔位）', () => {
      const matrix = toPermissionMatrix(role(), groups, jobs, [], new Set());
      expect(matrix.groups[0].jobs[0].permissions).toEqual([]);
    });

    it('ACTION_ORDER 有、但 DB 沒有對應列的 action（如 printExport）不會出現', () => {
      // 此處沒有任何 job 有 printExport 的 DB 列，故整個回應不得出現 printExport——
      // 這正是「後端不送不必要資訊」的界線。
      const matrix = toPermissionMatrix(
        role(),
        groups,
        jobs,
        permissions,
        new Set(),
      );
      const everyAction = matrix.groups.flatMap((g) =>
        g.jobs.flatMap((j) => j.permissions.map((p) => p.action)),
      );
      expect(everyAction).not.toContain('printExport');
    });
  });
});
