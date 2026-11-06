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

/**
 * 登入成功後要成為瀏覽器目前會話的主體。
 * - employee：已驗證的員工，簽發新列（OAuth callback 用 source=oauth）。
 * - webview_launch：以一次性啟動碼把 launch 時建立的待啟用列轉為 active，員工取自該列。
 * - super_user：帶本次請求的入口值，交易鎖定 singleton 後重驗，避免與入口輪換競爭時用舊入口簽出會話。
 */
export type SessionTarget =
  | { kind: 'employee'; userId: number; source: EmployeeSessionSource }
  | { kind: 'webview_launch'; launchCode: string }
  | { kind: 'super_user'; entryKey: string };

/** 交易 commit 後才交給呼叫端的新會話；token 原值只用於設定 cookie。 */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
}
