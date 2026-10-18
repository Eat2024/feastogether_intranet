/**
 * 登入 token 的 HttpOnly cookie 名稱（前端 JS 讀不到，防 XSS 竊取）。
 * 須與 client/src/proxy.ts 一致。localhost 的 cookie 不分 port，同機器上的
 * 各專案請用不同名稱，避免互相覆蓋。
 */
export const AUTH_COOKIE_NAME = 'FT_ESIGN_SESSION';

export const WEBVIEW_LAUNCH_TTL_SECONDS = 60;
export const WEBVIEW_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const WEBVIEW_JWT_MAX_TTL_SECONDS = 120;
export const WEBVIEW_JWT_CLOCK_TOLERANCE_SECONDS = 30;
export const WEBVIEW_JWT_TYPE = 'FT-ESIGN-LAUNCH+JWT';

// ── OAuth 登入與未啟用的 DEVMOD 測試能力 ──

/** 開發者登入使用的固定帳號（與真實員工區隔，稽核與帳號管理一眼可辨）。 */
export const DEV_LOGIN_EMPID = 'dev-admin';
export const DEV_LOGIN_NAME = '開發者（DEVMOD）';

/** OAuth 登入交易的瀏覽器綁定 cookie（HttpOnly；只存不透明隨機值，不存 state／nonce）。 */
export const OAUTH_TX_COOKIE_NAME = 'FT_ESIGN_OAUTH_TX';

/** 登入交易（state → nonce／redirectTo）在 Redis 的存活秒數。 */
export const OAUTH_TX_TTL_SECONDS = 10 * 60;

/** 對上游 OAuth Server 每次 HTTP 請求（Discovery／token／UserInfo／logout）的逾時秒數。 */
export const OAUTH_HTTP_TIMEOUT_SECONDS = 5;

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
