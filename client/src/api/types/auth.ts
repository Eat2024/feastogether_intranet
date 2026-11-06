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

/** GET auth/session 的回應 */
export type AuthSession = EmployeeSession | OtherActorSession;
