import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { groupBy } from '#app/features/auth/mappers/group-by';

/** 登入 / me 回應中的群組摘要（enabled = 底下任一 job enabled）。 */
export interface NavGroup {
  groupId: number;
  groupName: string;
  enabled: boolean;
}

export interface NavPermission {
  permissionId: number;
  action: string;
  permissionName: string;
  checked: boolean;
}

/** 扁平的功能列（enabled = 此 user 在該 job 任一權限 checked）。 */
export interface NavJobPermission {
  groupId: number;
  jobId: number;
  jobKey: string;
  jobName: string;
  enabled: boolean;
  permissions: NavPermission[];
}

export interface AuthNavigation {
  groups: NavGroup[];
  jobPermissions: NavJobPermission[];
}

/**
 * 組登入導覽：扁平 groups + jobPermissions（對齊 docs/rbac-api-frontend.md）。
 * - jobPermissions[].enabled：此 user 在該 job 任一權限 checked。
 * - groups[].enabled：該 group 底下任一 job enabled。
 * 後端一律回完整導覽，前端依 enabled 決定顯示 / 灰掉。
 */
export function buildAuthNavigation(
  groups: AuthGroup[],
  jobs: AuthGroupJob[],
  permissions: AuthJobPermission[],
  checkedIds: ReadonlySet<number>,
): AuthNavigation {
  const permsByJob = groupBy(permissions, (p) => p.jobId);

  const jobPermissions: NavJobPermission[] = jobs.map((job) => {
    const perms = (permsByJob.get(job.id) ?? []).map((p) => ({
      permissionId: Number(p.id),
      action: p.action,
      permissionName: p.permissionName,
      checked: checkedIds.has(Number(p.id)),
    }));
    return {
      groupId: Number(job.groupId),
      jobId: Number(job.id),
      jobKey: job.jobKey,
      jobName: job.jobName,
      enabled: perms.some((p) => p.checked),
      permissions: perms,
    };
  });

  const enabledByGroup = groupBy(jobPermissions, (j) => j.groupId);
  const navGroups: NavGroup[] = groups.map((group) => ({
    groupId: Number(group.id),
    groupName: group.groupName,
    enabled: (enabledByGroup.get(Number(group.id)) ?? []).some(
      (j) => j.enabled,
    ),
  }));

  return { groups: navGroups, jobPermissions };
}
