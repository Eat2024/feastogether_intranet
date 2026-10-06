export const ADMIN_ROLE_CODE = 'ADMIN';

export function isAdminRole(role: {
  roleCode: string;
  isAdmin: boolean;
}): boolean {
  return role.isAdmin === true || role.roleCode === ADMIN_ROLE_CODE;
}

/** 登入 JWT 與 Redis token 的存活秒數（兩者一致，到期同步失效）。 */
export const AUTH_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** 使用者授權快照的 Redis 存活秒數。 */
export const AUTHORIZATION_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * 登入 token 的 HttpOnly cookie 名稱（前端 JS 讀不到，防 XSS 竊取）。
 * 須與 client/src/proxy.ts 一致。localhost 的 cookie 不分 port，同機器上的
 * 各專案請用不同名稱，避免互相覆蓋。
 */
export const AUTH_COOKIE_NAME = 'NEST_SEED_AUTH_TOKEN';

// ── 登入（饗賓 OAuth 統一登入；本機另有 DEVMOD 開發者登入）──

/** session 來源：統一登入，或 DEVMOD 開發者登入（無上游 token）。 */
export const SESSION_SOURCE = {
  OAUTH: 'oauth',
  DEV: 'dev',
} as const;
export type SessionSource =
  (typeof SESSION_SOURCE)[keyof typeof SESSION_SOURCE];

/** 開發者登入使用的固定帳號（與真實員工區隔，稽核與帳號管理一眼可辨）。 */
export const DEV_LOGIN_EMPID = 'dev-admin';
export const DEV_LOGIN_NAME = '開發者（DEVMOD）';

/** OAuth 登入交易的瀏覽器綁定 cookie（HttpOnly；只存不透明隨機值，不存 state／nonce）。 */
export const OAUTH_TX_COOKIE_NAME = 'NEST_SEED_OAUTH_TX';

/** 登入交易（state → nonce／redirectTo）在 Redis 的存活秒數。 */
export const OAUTH_TX_TTL_SECONDS = 10 * 60;

/** 對上游 OAuth Server 每次 HTTP 請求（Discovery／token／UserInfo／logout）的逾時秒數。 */
export const OAUTH_HTTP_TIMEOUT_SECONDS = 5;

/** 上游 logout 結果；本地登出一律完成，上游只如實回報（FR-013）。 */
export const UPSTREAM_LOGOUT = {
  CONFIRMED: 'confirmed',
  UNCONFIRMED: 'unconfirmed',
  NOT_ATTEMPTED: 'not_attempted',
  /** 開發者登入沒有上游可登出 */
  NOT_APPLICABLE: 'not_applicable',
} as const;
export type UpstreamLogoutStatus =
  (typeof UPSTREAM_LOGOUT)[keyof typeof UPSTREAM_LOGOUT];

/** 上游登出未確認時的固定提示文案（spec FR-013）。 */
export const OAUTH_LOGOUT_UNCONFIRMED_MESSAGE =
  '系統已登出，統一登入登出尚未確認';

/** 權限層級動作固定欄序：view → createEdit → delete → printExport。 */
export const ACTION_ORDER = [
  'view',
  'createEdit',
  'delete',
  'printExport',
] as const;

export type PermissionAction = (typeof ACTION_ORDER)[number];

/** 動作短標籤（層級欄位 label，與 permissionName 全名區分）。 */
export const ACTION_LABEL: Record<PermissionAction, string> = {
  view: '檢視',
  createEdit: '新增/編輯',
  delete: '刪除',
  printExport: '列印/匯出',
};

export const AUDIT_ACTION = {
  ROLE_CREATED: 'role_created',
  ROLE_UPDATED: 'role_updated',
  ROLE_PERMISSIONS_UPDATED: 'role_permissions_updated',
  ROLE_REORDERED: 'role_reordered',
  ROLE_DELETED: 'role_deleted',
  USER_ROLE_UPDATED: 'user_role_updated',
  USER_STATUS_UPDATED: 'user_status_updated',
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** 稽核目標型別（audit_logs.entity_type / audit_log_targets.target_type）。 */
export const AUDIT_ENTITY = {
  ROLE: 'role',
  USER: 'user',
  ROLE_COLLECTION: 'role_collection',
} as const;

/** 稽核查詢目標種類。 */
export const AUDIT_TARGET_KIND = {
  PRIMARY: 'primary',
  ASSOCIATED: 'associated',
} as const;

/** 集合層級稽核固定 ID。 */
export const AUDIT_COLLECTION_ID = {
  ALL: 'all',
} as const;

// ── 032 認證端點速率限制（防密碼暴力破解）──
// 兩個視窗同時生效：短視窗擋單機高速猜測，長視窗擋壓在短視窗閾值下的持續嘗試。
// 這裡是唯一的事實來源——刻意不提供 env 覆寫：env 若重複同一組數值，日後改了常數
// 卻被既有部署的 env 壓著、且沒人記得誰設過，是最難查的一種狀況。要調就改這裡。

/** 短視窗：60 秒內至多 10 次。 */
export const AUTH_RATE_LIMIT_SHORT_NAME = 'short';
export const AUTH_RATE_LIMIT_SHORT_LIMIT = 10;
export const AUTH_RATE_LIMIT_SHORT_TTL_SECONDS = 60;

/** 長視窗：300 秒內至多 50 次。 */
export const AUTH_RATE_LIMIT_LONG_NAME = 'long';
export const AUTH_RATE_LIMIT_LONG_LIMIT = 50;
export const AUTH_RATE_LIMIT_LONG_TTL_SECONDS = 300;

/**
 * 超限回應訊息。刻意不含數字與帳號資訊——不洩漏剩餘額度，
 * 也不透露該工號是否存在（憲章 IV：錯誤訊息不得洩漏內部細節）。
 */
export const AUTH_RATE_LIMIT_MESSAGE = '系統拒絕服務，請聯絡IT人員';
