import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';

/** 程式版本的唯一權限目錄，不接受動態新增子功能。 */
export const AUTHORIZATION_PERMISSIONS = [
  {
    moduleKey: 'esign',
    permissionKey: 'esign.document.read',
    permissionName: '閱讀文件',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.signing.read',
    permissionName: '閱讀本人簽署任務',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.signing.submit',
    permissionName: '本人簽署與拒簽',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.signing.copy',
    permissionName: '取得本人副本',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.document.create',
    permissionName: '建立文件',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.document.manage',
    permissionName: '管理文件',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.export.read',
    permissionName: '閱讀與下載一般匯出',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.export.create',
    permissionName: '產生一般匯出',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.document.read-all',
    permissionName: '跨部門閱讀文件',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.document.manage-all',
    permissionName: '跨部門管理文件',
    assignable: true,
  },
  {
    moduleKey: 'esign',
    permissionKey: 'esign.export.all',
    permissionName: '跨部門一般匯出',
    assignable: true,
  },
  {
    moduleKey: 'platform',
    permissionKey: 'platform.authorization.manage',
    permissionName: '管理授權',
    assignable: false,
  },
] as const;
export type PermissionKey =
  (typeof AUTHORIZATION_PERMISSIONS)[number]['permissionKey'];
export type ModuleKey = (typeof AUTHORIZATION_PERMISSIONS)[number]['moduleKey'];
export const AUTHORIZATION_MODULES = [
  { moduleKey: 'esign', moduleName: '電子簽' },
  { moduleKey: 'platform', moduleName: '平台' },
] as const;
export const BASELINE_PERMISSIONS: readonly PermissionKey[] = [
  'esign.document.read',
  'esign.signing.read',
  'esign.signing.submit',
  'esign.signing.copy',
];
export const INITIAL_ROLES = [
  {
    moduleKey: 'esign',
    roleCode: 'colleague',
    roleName: '同仁',
    isProtected: true,
    permissionKeys: BASELINE_PERMISSIONS,
  },
  {
    moduleKey: 'esign',
    roleCode: 'document_creator',
    roleName: '文件建立者',
    isProtected: false,
    permissionKeys: [
      'esign.document.create',
      'esign.document.manage',
      'esign.export.read',
      'esign.export.create',
    ],
  },
  {
    moduleKey: 'esign',
    roleCode: 'esign_admin',
    roleName: '電子簽管理員',
    isProtected: false,
    permissionKeys: AUTHORIZATION_PERMISSIONS.filter(
      (p) => p.moduleKey === 'esign',
    ).map((p) => p.permissionKey),
  },
] as const;

/** 同角色內的範圍修飾碼不能孤立存在；一般角色不授予平台維護身分。 */
export function validateRolePermissions(
  moduleKey: string,
  permissionKeys: readonly string[],
): void {
  const valid = new Set<string>(
    AUTHORIZATION_PERMISSIONS.filter(
      (p) => p.moduleKey === moduleKey && p.assignable,
    ).map((p) => p.permissionKey),
  );
  if (
    !AUTHORIZATION_MODULES.some((m) => m.moduleKey === moduleKey) ||
    permissionKeys.some((key) => !valid.has(key)) ||
    new Set(permissionKeys).size !== permissionKeys.length ||
    permissionKeys.length > 100
  )
    throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
  const keys = new Set(permissionKeys);
  if (
    (keys.has('esign.document.read-all') && !keys.has('esign.document.read')) ||
    (keys.has('esign.document.manage-all') &&
      !keys.has('esign.document.manage')) ||
    (keys.has('esign.export.all') &&
      !keys.has('esign.export.read') &&
      !keys.has('esign.export.create'))
  )
    throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
}
