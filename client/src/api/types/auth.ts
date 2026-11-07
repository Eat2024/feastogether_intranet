// 目前身分（server/src/features/auth/dto/session-view.dto.ts）

/** 員工會話：user 沿用既有白名單欄位 */
export interface EmployeeSession {
  actor: { kind: 'employee'; userId: number };
  user: {
    id: number;
    empId: string;
    name: string;
    departmentName: string | null;
    titleName: string | null;
    lastLoginAt: string | null;
  };
  expiresAt: string;
}

/** 員工以外的身分：沒有員工資料，畫面只顯示 server 給的名稱 */
export interface OtherActorSession {
  actor: { kind: string; displayName: string };
  user: null;
  expiresAt: string;
}

/** proxy／iframe 身分比對仍使用輕量 auth/session；一般畫面使用 AuthMe。 */
export type AuthSession = EmployeeSession | OtherActorSession;

/** 後端已解析且依 module 分組的有效能力；不包含角色資料。 */
export interface AuthorizationModule {
  moduleKey: string;
  permissions: string[];
}

/** GET auth/me 的共用目前登入者契約。 */
export type EmployeeAuthMe = EmployeeSession & {
  modules: AuthorizationModule[];
};

/** auth/me 的維護身分是精確契約；不沿用 auth/session 為隱藏邊界保留的寬鬆型別。 */
export interface SuperUserAuthMe {
  actor: { kind: 'super_user'; displayName: 'Super user' };
  user: null;
  expiresAt: string;
  modules: AuthorizationModule[];
}

export type AuthMe = EmployeeAuthMe | SuperUserAuthMe;
