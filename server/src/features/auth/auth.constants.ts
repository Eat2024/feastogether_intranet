/** 登入 JWT 與 Redis token 的存活秒數（兩者一致，到期同步失效）。 */
export const AUTH_TOKEN_TTL_SECONDS = 24 * 60 * 60;

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
