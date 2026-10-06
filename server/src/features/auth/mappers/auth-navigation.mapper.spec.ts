import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { buildAuthNavigation } from './auth-navigation.mapper';

const group = (id: number, groupName: string): AuthGroup =>
  ({ id, groupName }) as AuthGroup;

const job = (
  id: number,
  groupId: number,
  jobKey: string,
  jobName: string,
): AuthGroupJob => ({ id, groupId, jobKey, jobName }) as AuthGroupJob;

const perm = (id: number, jobId: number, action: string): AuthJobPermission =>
  ({
    id,
    jobId,
    action,
    permissionName: `${action}-${id}`,
  }) as AuthJobPermission;

// 兩群組：g1 有 j10（perm 11/12）、g3 有 j30（perm 31）
const groups = [group(1, '報表'), group(3, '權限管理')];
const jobs = [
  job(10, 1, 'monthlyReport', '月報表'),
  job(30, 3, 'roleManagement', '角色管理'),
];
const permissions = [
  perm(11, 10, 'view'),
  perm(12, 10, 'createEdit'),
  perm(31, 30, 'view'),
];

describe('buildAuthNavigation', () => {
  it('job enabled = 該 job 任一權限 checked；group enabled = 任一 job enabled', () => {
    const nav = buildAuthNavigation(groups, jobs, permissions, new Set([11]));

    const j10 = nav.jobPermissions.find((j) => j.jobId === 10)!;
    const j30 = nav.jobPermissions.find((j) => j.jobId === 30)!;
    expect(j10.enabled).toBe(true); // perm 11 checked
    expect(j30.enabled).toBe(false); // perm 31 not checked

    expect(nav.groups.find((g) => g.groupId === 1)!.enabled).toBe(true);
    expect(nav.groups.find((g) => g.groupId === 3)!.enabled).toBe(false);
  });

  it('checked 旗標逐權限映射；jobKey/欄位帶出', () => {
    const nav = buildAuthNavigation(groups, jobs, permissions, new Set([12]));
    const j10 = nav.jobPermissions.find((j) => j.jobId === 10)!;

    expect(j10.jobKey).toBe('monthlyReport');
    expect(j10.permissions).toEqual([
      {
        permissionId: 11,
        action: 'view',
        permissionName: 'view-11',
        checked: false,
      },
      {
        permissionId: 12,
        action: 'createEdit',
        permissionName: 'createEdit-12',
        checked: true,
      },
    ]);
  });

  it('無角色（空 checkedIds）→ 全部 enabled/checked = false，但導覽結構完整', () => {
    const nav = buildAuthNavigation(groups, jobs, permissions, new Set());

    expect(nav.groups).toHaveLength(2);
    expect(nav.jobPermissions).toHaveLength(2);
    expect(nav.groups.every((g) => !g.enabled)).toBe(true);
    expect(nav.jobPermissions.every((j) => !j.enabled)).toBe(true);
    expect(
      nav.jobPermissions.every((j) => j.permissions.every((p) => !p.checked)),
    ).toBe(true);
  });
});
