/**
 * 後端 error.code 對照的使用者訊息（後端定義見 server/src/common/errors/app-error-code.ts）。
 * getErrorMessage 優先使用後端回傳的 message，後端沒有給 message 時才使用這裡的對照。
 */
export const ERROR_CODE_MAP: Record<string, string> = {
  ESIGN_REJECTION_REASON_INVALID: '拒絕原因須為最多 200 字的文字',
  ESIGN_REJECTION_CONFLICT: '簽署人已完成簽署或拒簽，無法變更結果',
  ESIGN_REJECTION_NOT_ALLOWED: '此文件未開放拒絕簽署',
  // --- Auth ---
  UNAUTHORIZED: '登入已過期，請從入口網重新進入電子簽',
  INVALID_CREDENTIALS: '員工編號或密碼錯誤，或登入已失效',
  ACCOUNT_DISABLED: '帳號已停用，請聯繫管理員',
  REFUSE_SERVICE: '操作過於頻繁，請稍後再試',
  CSRF_ORIGIN_REJECTED: '請求來源不允許，請重新整理頁面後再試',
  EXTERNAL_AUTH_UNAVAILABLE: '登入服務暫時無法使用，請稍後再試',
  AUTH_EXCHANGE_FAILED: '登入驗證失敗，請重新登入',
  AUTH_DB_UNAVAILABLE: '登入服務暫時無法使用，請稍後再試',

  // --- Permission / Resource ---
  FORBIDDEN: '您沒有執行此操作的權限',
  NOT_FOUND: '找不到相關資料',

  // --- Validation ---
  INVALID_REQUEST: '輸入資料格式有誤，請確認後再試',

  // --- 電子簽 ---
  ESIGN_SIGNER_NOTE_INVALID: '備註須為最多 30 字的文字',
  ESIGN_DRAFT_OPTIONS_INVALID: '草稿選項必須為布林值',
  ESIGN_INVALID_PDF: 'PDF 格式、大小或頁數不符合規格',
  ESIGN_RESOURCE_NOT_FOUND: '找不到此文件，或您沒有權限存取',
  ESIGN_EXTERNAL_UNAUTHORIZED: '簽署連結無效或已過期',
  ESIGN_STATE_CONFLICT: '文件目前的狀態不允許此操作，請重新整理後再試',
  ESIGN_INTEGRITY_FAILED: '文件驗證失敗，請重新整理後再試',
  ESIGN_UNAVAILABLE: '電子簽服務暫時無法使用，請稍後再試',

  // --- 外部服務 ---
  STAFF_LOOKUP_FAILED: '查詢員工資料失敗，請稍後再試',
  EATOGETHER_API_SERVICE_UNAVAILABLE: '外部服務暫時無法使用，請稍後再試',

  // --- Server ---
  INTERNAL_ERROR: '伺服器發生錯誤，請稍後再試',
};
