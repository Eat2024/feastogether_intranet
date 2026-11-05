// 目前身分與 Super user 登入（server/src/features/auth/dto/session-view.dto.ts、super-user-login.dto.ts）

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

/** Super user 會話：只有固定顯示名稱，沒有員工資料 */
export interface SuperUserSession {
  actor: { kind: 'super_user'; displayName: string };
  user: null;
  expiresAt: string;
}

/** GET auth/session 的回應 */
export type AuthSession = EmployeeSession | SuperUserSession;

/** POST auth/super-user-entries/:entryKey/sessions 的 body；帳密原樣送出，不 trim */
export interface SuperUserLoginBody {
  account: string;
  password: string;
}
