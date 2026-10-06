import {
  ACTION_LABEL,
  ACTION_ORDER,
  PermissionAction,
} from '#app/features/auth/auth.constants';
import { AuthGroup } from '#app/features/auth/entities/auth-group.entity';
import { AuthGroupJob } from '#app/features/auth/entities/auth-group-job.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { groupBy } from '#app/features/auth/mappers/group-by';

/** GET /api/roles 列表項。 */
export interface RoleListItem {
  id: number;
  roleName: string;
  roleCode: string;
  isAdmin: boolean;
  isActive: boolean;
  sortOrder: number | null;
  userCount: number;
}

export interface CatalogPermission {
  permissionId: number;
  action: string;
  label: string;
  permissionName: string;
}

export interface CatalogJob {
  jobId: number;
  /** 功能鍵，例 roleManagement（穩定識別，前端請以此對應而非 jobName）。 */
  jobKey: string;
  jobName: string;
  permissions: CatalogPermission[];
}

export interface CatalogGroup {
  groupId: number;
  groupName: string;
  jobs: CatalogJob[];
}

/** GET /api/roles/permissions：全權限目錄（分組 → 功能 → 權限，含 permissionId），供建立角色時取值。 */
export interface PermissionCatalog {
  groups: CatalogGroup[];
}

export interface MatrixPermission extends CatalogPermission {
  /** 此角色是否已被授予此權限。 */
  checked: boolean;
}

export interface MatrixJob {
  jobId: number;
  jobKey: string;
  jobName: string;
  permissions: MatrixPermission[];
}

export interface MatrixGroup {
  groupId: number;
  groupName: string;
  jobs: MatrixJob[];
}

export interface PermissionMatrix extends PermissionCatalog {
  roleId: number;
  roleName: string;
  isAdmin: boolean;
  groups: MatrixGroup[];
}

export function buildRoleItem(role: AuthRole, userCount: number): RoleListItem {
  return {
    id: Number(role.id),
    roleName: role.roleName,
    roleCode: role.roleCode,
    isAdmin: role.isAdmin,
    isActive: role.isActive,
    sortOrder: role.sortOrder ?? null,
    userCount,
  };
}

/**
 * 組三層權限目錄：分組 → 功能 → 權限（不含角色 / checked）。
 *
 * **每個 job 只回它實際擁有的權限**（DB 有對應列者），依 `ACTION_ORDER` 排序。
 * 早期版本一律回滿 `ACTION_ORDER` 全部欄位、以 `available: false` 表示「此 job 無此功能」，
 * 但那些條目 `permissionId` 為 null、`permissionName` 為空字串——零資訊量卻要前端自行辨識，
 * 且 `permissionId: null` 有機會被誤送回 `PUT /roles/:id/permissions`。
 * 版面上哪一格該留空是**前端**的職責（`configs/permissionActions.ts` 的 visibility），
 * 後端只負責回報「這個 job 有哪些權限可被授予」。
 *
 * 輸入的 groups / jobs 已由 service 依 sortOrder 排序。
 */
export function toPermissionCatalog(
  groups: AuthGroup[],
  jobs: AuthGroupJob[],
  permissions: AuthJobPermission[],
): PermissionCatalog {
  const jobsByGroup = groupBy(jobs, (j) => j.groupId);
  const permsByJob = groupBy(permissions, (p) => p.jobId);

  return {
    groups: groups.map((group) => ({
      groupId: Number(group.id),
      groupName: group.groupName,
      jobs: (jobsByGroup.get(group.id) ?? []).map((job) => {
        const permsByAction = new Map(
          (permsByJob.get(job.id) ?? []).map((p) => [p.action, p]),
        );
        return {
          jobId: Number(job.id),
          jobKey: job.jobKey,
          jobName: job.jobName,
          permissions: ACTION_ORDER.flatMap((action) => {
            const permission = permsByAction.get(action);
            return permission ? [toCatalogPermission(action, permission)] : [];
          }),
        };
      }),
    })),
  };
}

/**
 * 單角色權限層級：在目錄上疊加角色資訊與 checked（此角色是否已被授予此權限）。
 */
export function toPermissionMatrix(
  role: AuthRole,
  groups: AuthGroup[],
  jobs: AuthGroupJob[],
  permissions: AuthJobPermission[],
  checkedIds: ReadonlySet<number>,
): PermissionMatrix {
  const catalog = toPermissionCatalog(groups, jobs, permissions);
  return {
    roleId: Number(role.id),
    roleName: role.roleName,
    isAdmin: role.isAdmin,
    groups: catalog.groups.map((group) => ({
      ...group,
      jobs: group.jobs.map((job) => ({
        ...job,
        permissions: job.permissions.map((permission) => ({
          ...permission,
          checked: checkedIds.has(permission.permissionId),
        })),
      })),
    })),
  };
}

function toCatalogPermission(
  action: PermissionAction,
  permission: AuthJobPermission,
): CatalogPermission {
  return {
    permissionId: Number(permission.id),
    action,
    label: ACTION_LABEL[action] ?? action,
    permissionName: permission.permissionName,
  };
}
