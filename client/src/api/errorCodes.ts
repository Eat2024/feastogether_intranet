/**
 * 後端 error.code 對照的使用者訊息（後端定義見 server/src/common/errors/app-error-code.ts）。
 * getErrorMessage 優先使用後端回傳的 message，後端沒有給 message 時才使用這裡的對照。
 */
export const ERROR_CODE_MAP: Record<string, string> = {
  ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE: '本機員工資料暫時無法使用，請稍後再試',
  ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE: '本機員工信箱資料暫時無法使用，請稍後再試',

  // --- Auth ---
  UNAUTHORIZED: '登入已過期，請從入口網重新進入電子簽',
  ACCOUNT_DISABLED: '帳號已停用，請聯繫管理員',
  REFUSE_SERVICE: '操作過於頻繁，請稍後再試',
  CSRF_ORIGIN_REJECTED: '請求來源不允許，請重新整理頁面後再試',
  AUTH_EXCHANGE_FAILED: '登入驗證失敗，請重新登入',
  AUTH_DB_UNAVAILABLE: '登入服務暫時無法使用，請稍後再試',
  AUTH_SESSION_REPLACED: '登入身分已更新，請重新整理',
  AUTH_ACTOR_NOT_ALLOWED: '目前身分無法使用此功能',

  // --- Permission / Resource ---
  FORBIDDEN: '您沒有執行此操作的權限',
  NOT_FOUND: '找不到相關資料',

  // --- Validation ---
  INVALID_REQUEST: '輸入資料格式有誤，請確認後再試',

  // --- 電子簽 ---
  ESIGN_INVALID_PDF: 'PDF 格式、大小或頁數不符合規格',
  ESIGN_DEPARTMENT_UNAVAILABLE: '無法取得您的部門資料，請重新登入或聯絡系統管理員',
  ESIGN_RESOURCE_NOT_FOUND: '找不到此文件，或您沒有權限存取',
  ESIGN_INTERNAL_LOGIN_REQUIRED: '請登入入口網，至我的電子簽完成操作',
  ESIGN_EXTERNAL_UNAUTHORIZED: '簽署連結無效或已過期',
  ESIGN_STATE_CONFLICT: '文件目前的狀態不允許此操作，請重新整理後再試',
  ESIGN_INTEGRITY_FAILED: '文件驗證失敗，請重新整理後再試',
  ESIGN_UNAVAILABLE: '電子簽服務暫時無法使用，請稍後再試',
  ESIGN_REJECTION_REASON_INVALID: '拒絕原因須為最多 200 字的文字',
  ESIGN_REJECTION_CONFLICT: '簽署人已完成簽署或拒簽，無法變更結果',
  ESIGN_REJECTION_NOT_ALLOWED: '此文件未開放拒絕簽署',

  // --- 外部服務 ---
  STAFF_LOOKUP_FAILED: '查詢員工資料失敗，請稍後再試',

  // --- Server ---
  AUTHORIZATION_UNAVAILABLE: '授權服務暫時無法使用',
  INTERNAL_ERROR: '伺服器發生錯誤，請稍後再試',
};
