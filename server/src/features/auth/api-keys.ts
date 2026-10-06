/** RBAC 端點 api_key 統一管理；@RegisterApi 的唯一事實來源。 */
export const API_KEYS = {
  AUTH_ME: 'auth.me',
  ROLES_LIST: 'roles.list',
  ROLES_PERMISSIONS_CATALOG: 'roles.permissions.catalog',
  ROLES_PERMISSIONS_VIEW: 'roles.permissions.view',
  ROLES_USERS_LIST: 'roles.users.list',
  ROLES_CREATE: 'roles.create',
  ROLES_PERMISSIONS_SET: 'roles.permissions.set',
  ROLES_DELETE: 'roles.delete',
  ROLES_REORDER: 'roles.reorder',
  ROLES_RENAME: 'roles.rename',
  USERS_LIST: 'users.list',
  USERS_DETAIL: 'users.detail',
  USERS_UPDATE: 'users.update',
  USERS_EMPLOYEE_OPTIONS: 'users.employee_options',
  USERS_BATCH_STATUS: 'users.batch_status',
} as const;
