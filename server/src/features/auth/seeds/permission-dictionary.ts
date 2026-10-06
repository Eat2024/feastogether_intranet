export interface DictPermission {
  action: string;
  permissionKey: string;
  permissionName: string;
}

export interface DictJob {
  jobKey: string;
  jobName: string;
  permissions: DictPermission[];
}

export interface DictGroup {
  groupKey: string;
  groupName: string;
  jobs: DictJob[];
}

// ── 各 job 權限鍵 enum（權限鍵字串唯一出處；供字典本體與 @RegisterApi 引用）──

export enum ROLE_MANAGEMENT {
  VIEW = 'roleManagement.view',
  CREATE_EDIT = 'roleManagement.createEdit',
  DELETE = 'roleManagement.delete',
}

export enum ACCOUNT_MANAGEMENT {
  VIEW = 'accountManagement.view',
  CREATE_EDIT = 'accountManagement.createEdit',
  DELETE = 'accountManagement.delete',
}

/** 上列各 job 權限 enum 的彙整（drift 防護 spec 用：與字典雙向逐值驗證）。 */
export const PERMISSION_KEY_ENUMS = {
  ROLE_MANAGEMENT,
  ACCOUNT_MANAGEMENT,
} as const;

export const PERMISSION_DICTIONARY: DictGroup[] = [
  {
    groupKey: 'permissionManagement',
    groupName: '權限管理',
    jobs: [
      {
        jobKey: 'roleManagement',
        jobName: '角色管理',
        permissions: [
          {
            action: 'view',
            permissionKey: ROLE_MANAGEMENT.VIEW,
            permissionName: '查看角色管理',
          },
          {
            action: 'createEdit',
            permissionKey: ROLE_MANAGEMENT.CREATE_EDIT,
            permissionName: '新增或編輯角色管理',
          },
          {
            action: 'delete',
            permissionKey: ROLE_MANAGEMENT.DELETE,
            permissionName: '刪除角色管理資料',
          },
        ],
      },
      {
        jobKey: 'accountManagement',
        jobName: '帳號管理',
        permissions: [
          {
            action: 'view',
            permissionKey: ACCOUNT_MANAGEMENT.VIEW,
            permissionName: '查看帳號管理',
          },
          {
            action: 'createEdit',
            permissionKey: ACCOUNT_MANAGEMENT.CREATE_EDIT,
            permissionName: '新增或編輯帳號管理',
          },
          {
            action: 'delete',
            permissionKey: ACCOUNT_MANAGEMENT.DELETE,
            permissionName: '刪除帳號管理資料',
          },
        ],
      },
    ],
  },
];
