import { isAdminRole } from '#app/features/auth/auth.constants';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';

/** 角色顯示子物件（list / detail 共用）。 */
export interface UserRoleRef {
  id: number;
  roleName: string;
}

/**
 * GET /api/users/employees 員編片段模糊搜尋 option。
 * 姓名／部門來自 fgapi，啟用狀態取 本地既有帳號（未建檔預設 true）。
 */
export interface EmployeeOption {
  empId: string;
  name: string;
  departmentName: string | null;
  isActive: boolean;
}

/**
 * GET /api/users 列表項。部門/職稱用使用者自帶冗餘欄；brandName 待 BrandDirectoryService 另案補。
 * - personStatus：饗賓人在職狀態（登入時同步，只讀）。
 * - isActive：本地帳號啟用旗標（批次/單筆停用操作的依據）。
 * - isSystemAdmin：是否為系統管理員（走 isAdminRole 單一述詞），供前端灰掉停用鈕。
 */
export interface UserListItem {
  id: number;
  empId: string;
  name: string;
  role: UserRoleRef | null;
  departmentName: string | null;
  lastLoginAt: Date | null;
  personStatus: string | null;
  isActive: boolean;
  isSystemAdmin: boolean;
}

/** GET /api/users/:id 詳情。 */
export interface UserDetail {
  id: number;
  empId: string;
  name: string;
  departmentName: string | null;
  role: UserRoleRef | null;
  description: string | null;
  isActive: boolean;
  isSystemAdmin: boolean;
}

/** 列表查詢的原始列（repository getRawMany 對齊欄位）。 */
export interface UserListRow {
  id: number | string;
  empId: string;
  name: string;
  departmentName: string | null;
  lastLoginAt: Date | string | null;
  personStatus: string | null;
  isActive: number | boolean;
  roleId: number | string | null;
  roleName: string | null;
  roleCode: string | null;
  isAdmin: number | boolean | null;
}

/**
 * 角色是否為系統管理員；無角色→false。委派 auth.constants 的 isAdminRole 判定，勿在此另寫。
 * 註：role.service.ts 目前另有一份私有 isAdminRole 副本（邏輯相同），待日後合併為單一來源。
 */
function rowIsSystemAdmin(row: {
  roleId: number | string | null;
  roleCode: string | null;
  isAdmin: number | boolean | null;
}): boolean {
  if (!row.roleId) return false;
  return isAdminRole({
    roleCode: row.roleCode ?? '',
    isAdmin: Boolean(row.isAdmin),
  });
}

export function toUserListItem(row: UserListRow): UserListItem {
  return {
    id: Number(row.id),
    empId: row.empId,
    name: row.name,
    role: row.roleId
      ? { id: Number(row.roleId), roleName: row.roleName ?? '' }
      : null,
    departmentName: row.departmentName ?? null,
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt) : null,
    personStatus: row.personStatus ?? null,
    isActive: Boolean(row.isActive), // MySQL tinyint(1) → boolean
    isSystemAdmin: rowIsSystemAdmin(row),
  };
}

export function toUserDetail(
  user: AuthUser,
  role: UserRoleRef | null,
  isSystemAdmin: boolean,
): UserDetail {
  return {
    id: Number(user.id),
    empId: user.personEmpid,
    name: user.personName,
    departmentName: user.departmentName ?? null,
    role,
    description: user.description ?? null,
    isActive: user.isActive,
    isSystemAdmin,
  };
}
