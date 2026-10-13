/**
 * 穩定業務錯誤碼（單一事實來源）。新增 feature 時於此擴充。
 */
export const AppErrorCode = {
  /** DTO / ValidationPipe 驗證失敗（泛用） */
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** 未帶 / 無效 / 已撤銷 token */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 已通過身分驗證，但不允許操作特定業務資源 */
  FORBIDDEN: 'FORBIDDEN',
  /** 資源不存在 */
  NOT_FOUND: 'NOT_FOUND',
  /** 員工查詢或匯入失敗，不透露上游員工狀態。 */
  STAFF_LOOKUP_FAILED: 'STAFF_LOOKUP_FAILED',
  /** 登入身分無效（使用者不存在、已停用或 session 已失效） */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 帳號已停用（P2） */
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** 請求過於頻繁（認證端點速率限制） */
  REFUSE_SERVICE: 'REFUSE_SERVICE',
  /** 請求 Origin 不在允許清單（跨站請求防護） */
  CSRF_ORIGIN_REJECTED: 'CSRF_ORIGIN_REJECTED',
  /** 饗賓 API 連線設定未就緒（缺 FEASTOGETHER_* 環境變數） */
  EXTERNAL_AUTH_UNAVAILABLE: 'EXTERNAL_AUTH_UNAVAILABLE',
  /** 外部資料服務（饗賓 brand/department/hr/字典）不可用（003） */
  EATOGETHER_API_SERVICE_UNAVAILABLE: 'EATOGETHER_API_SERVICE_UNAVAILABLE',
  // ── 038 饗賓 OAuth 登入 ──
  /** 登入交易無效、到期、已消耗或瀏覽器綁定不符；請重新發起登入 */
  OAUTH_TRANSACTION_INVALID: 'OAUTH_TRANSACTION_INVALID',
  /** 使用者於統一登入中心取消或上游回傳 error */
  OAUTH_LOGIN_CANCELLED: 'OAUTH_LOGIN_CANCELLED',
  /** 授權碼交換、ID token、UserInfo 驗證失敗或缺必要員工識別 */
  OAUTH_RESPONSE_INVALID: 'OAUTH_RESPONSE_INVALID',
  /** OAuth 上游或設定尚未就緒 */
  OAUTH_UNAVAILABLE: 'OAUTH_UNAVAILABLE',
  /** WebView launch assertion、員工資格或一次性 credential 驗證失敗。 */
  AUTH_EXCHANGE_FAILED: 'AUTH_EXCHANGE_FAILED',
  /** MySQL 無法安全建立或驗證認證狀態。 */
  AUTH_DB_UNAVAILABLE: 'AUTH_DB_UNAVAILABLE',
  /** 未預期錯誤（既有 handler 預設） */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];
