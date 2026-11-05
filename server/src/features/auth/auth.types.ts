import type { User } from '#app/features/users/entities/user.entity';

/** 員工操作者：對應本地 users 列。 */
export interface EmployeeActor {
  kind: 'employee';
  userId: number;
}

/** 部署管理的唯一維護身分；不對應任何員工，也沒有員編或部門。 */
export interface SuperUserActor {
  kind: 'super_user';
}

/** 會話操作者。只有員工帶本地員工 ID，不為 Super user 偽造員工資料。 */
export type Actor = EmployeeActor | SuperUserActor;

export type ActorKind = Actor['kind'];

/** 會話建立來源；員工為 webview／oauth，Super user 固定為 super_user。 */
export type EmployeeSessionSource = 'webview' | 'oauth';
export type SessionSource = EmployeeSessionSource | 'super_user';

/** 已驗證的有效會話；員工帶通過狀態檢查的 users 列，Super user 不帶。 */
export type AuthenticatedSession =
  | { actor: EmployeeActor; user: User; expiresAt: Date }
  | { actor: SuperUserActor; user: null; expiresAt: Date };

/** 登入成功後要簽發的新會話主體。 */
export type SessionTarget =
  | { kind: 'employee'; userId: number; source: EmployeeSessionSource }
  | { kind: 'super_user' };

/** 交易 commit 後才交給呼叫端的新會話；token 原值只用於設定 cookie。 */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
}
