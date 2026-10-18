import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from './app-error-code';

export type AppErrorDefinition = readonly [
  code: AppErrorCode,
  message: string,
  status: HttpStatus,
];

/** 業務錯誤的單一來源：錯誤碼、訊息、HTTP 狀態；以 new AppException(...AppErrors.NAME) 使用。 */
export const AppErrors = {
  HTTP_FORBIDDEN: [
    AppErrorCode.FORBIDDEN,
    '沒有權限執行此操作',
    HttpStatus.FORBIDDEN,
  ],
  HTTP_NOT_FOUND: [
    AppErrorCode.NOT_FOUND,
    '找不到請求的資源',
    HttpStatus.NOT_FOUND,
  ],
  HTTP_PAYLOAD_TOO_LARGE: [
    AppErrorCode.INVALID_REQUEST,
    '請求內容超過大小限制',
    HttpStatus.PAYLOAD_TOO_LARGE,
  ],
  ESIGN_INVITATION_SERVICE_UNAVAILABLE: [
    AppErrorCode.ESIGN_UNAVAILABLE,
    '電子簽署服務暫時無法使用，請稍後再試',
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
  ESIGN_INVITATION_EXPIRED: [
    AppErrorCode.ESIGN_EXTERNAL_UNAUTHORIZED,
    '邀請連結無效或已到期',
    HttpStatus.UNAUTHORIZED,
  ],
  ACCOUNT_DISABLED: [
    AppErrorCode.ACCOUNT_DISABLED,
    '帳號已停用',
    HttpStatus.FORBIDDEN,
  ],
  ACCOUNT_DISABLED_CONTACT_IT: [
    AppErrorCode.ACCOUNT_DISABLED,
    '帳號已停用，請聯絡資訊人員',
    HttpStatus.FORBIDDEN,
  ],
  AUTH_DB_UNAVAILABLE: [
    AppErrorCode.AUTH_DB_UNAVAILABLE,
    '登入服務暫時無法使用',
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
  AUTH_EXCHANGE_FAILED: [
    AppErrorCode.AUTH_EXCHANGE_FAILED,
    '無法完成登入交換',
    HttpStatus.UNAUTHORIZED,
  ],
  AUTH_IDENTITY_INVALID: [
    AppErrorCode.UNAUTHORIZED,
    '登入身分無效，請重新登入',
    HttpStatus.UNAUTHORIZED,
  ],
  AUTH_LAUNCH_FORMAT_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '啟動連結格式錯誤',
    HttpStatus.BAD_REQUEST,
  ],
  AUTH_LAUNCH_INVALID: [
    AppErrorCode.AUTH_EXCHANGE_FAILED,
    '啟動連結無效或已到期',
    HttpStatus.UNAUTHORIZED,
  ],
  AUTH_RATE_LIMITED: [
    AppErrorCode.REFUSE_SERVICE,
    '系統拒絕服務，請聯絡IT人員',
    HttpStatus.TOO_MANY_REQUESTS,
  ],
  AUTH_SESSION_INVALID: [
    AppErrorCode.UNAUTHORIZED,
    '登入狀態無效或已到期',
    HttpStatus.UNAUTHORIZED,
  ],
  AUTH_TOKEN_INVALID: [
    AppErrorCode.UNAUTHORIZED,
    '登入已失效，請重新登入',
    HttpStatus.UNAUTHORIZED,
  ],
  AUTH_TOKEN_MISSING: [
    AppErrorCode.UNAUTHORIZED,
    '請先登入',
    HttpStatus.UNAUTHORIZED,
  ],
  CSRF_ORIGIN_REJECTED: [
    AppErrorCode.CSRF_ORIGIN_REJECTED,
    '請求來源不允許',
    HttpStatus.FORBIDDEN,
  ],
  EMPLOYEE_ID_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '請輸入有效的員工編號',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_COMPLETED_DOCUMENT_NOT_READY: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '完成文件尚未產生',
    HttpStatus.CONFLICT,
  ],
  ESIGN_CONSENT_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '請閱讀並接受目前的電子簽署告知',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_DOCUMENT_ID_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '文件識別格式錯誤',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_DOCUMENT_NAME_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '文件名稱必須為 1 至 200 字',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_DOCUMENT_NOT_STOPPABLE: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '只有簽署中或產製中的文件可以停止',
    HttpStatus.CONFLICT,
  ],
  ESIGN_DOCUMENT_SIGNER_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '文件至少需要一名簽署人',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_DRAFT_NOT_EDITABLE: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '文件已發起，無法修改草稿',
    HttpStatus.CONFLICT,
  ],
  ESIGN_DRAFT_PDF_MISSING: [
    AppErrorCode.INVALID_REQUEST,
    '草稿缺少 PDF 文件',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_DRAFT_UPDATE_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '至少需要提供一項草稿更新內容',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_EXTERNAL_SIGNER_IDENTITY_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '外部簽署人姓名或 Email 不正確或重複',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_EXTERNAL_SIGNER_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '外部簽署人資料格式不正確',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_EXTERNAL_UNAUTHORIZED: [
    AppErrorCode.ESIGN_EXTERNAL_UNAUTHORIZED,
    '外部簽署存取已失效',
    HttpStatus.UNAUTHORIZED,
  ],
  ESIGN_FIELD_DOCUMENT_MISMATCH: [
    AppErrorCode.INVALID_REQUEST,
    '簽署欄位與文件不相符',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_FIELD_LIMIT_EXCEEDED: [
    AppErrorCode.INVALID_REQUEST,
    '欄位數量不可超過 200 個',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_FIELD_OUT_OF_BOUNDS: [
    AppErrorCode.INVALID_REQUEST,
    '欄位頁碼或位置超出 PDF 範圍',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_FIELDS_ARRAY_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '欄位資料必須為 JSON 陣列',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_FIELDS_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '文件包含無效簽署欄位',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_INTEGRITY_FAILED: [
    AppErrorCode.ESIGN_INTEGRITY_FAILED,
    '文件完整性驗證失敗',
    HttpStatus.CONFLICT,
  ],
  ESIGN_INTERNAL_SIGNER_DUPLICATE: [
    AppErrorCode.INVALID_REQUEST,
    '內部簽署人不可重複',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_INTERNAL_SIGNER_UNAVAILABLE: [
    AppErrorCode.INVALID_REQUEST,
    '指定的內部簽署人不存在或已停用',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_INVITATION_FORMAT_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '邀請連結格式錯誤',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_OUTSIDE_SIGNING_WINDOW: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '文件目前不在可簽署期間',
    HttpStatus.CONFLICT,
  ],
  ESIGN_PDF_CONTENT_INVALID: [
    AppErrorCode.ESIGN_INVALID_PDF,
    '檔案內容不是有效 PDF',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PDF_EMPTY: [
    AppErrorCode.ESIGN_INVALID_PDF,
    'PDF 檔案不可為空',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PDF_ENCRYPTED: [
    AppErrorCode.ESIGN_INVALID_PDF,
    '不接受加密 PDF',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PDF_ONLY: [
    AppErrorCode.ESIGN_INVALID_PDF,
    '只接受 PDF 檔案',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PDF_PAGE_COUNT_INVALID: [
    AppErrorCode.ESIGN_INVALID_PDF,
    'PDF 頁數必須介於 1 至 100 頁',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PDF_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '請上傳 PDF 文件',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PDF_TOO_LARGE: [
    AppErrorCode.ESIGN_INVALID_PDF,
    'PDF 檔案不可超過 20 MiB',
    HttpStatus.PAYLOAD_TOO_LARGE,
  ],
  ESIGN_PDF_UNREADABLE: [
    AppErrorCode.ESIGN_INVALID_PDF,
    'PDF 檔案損壞或無法讀取',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_PERSONAL_COPY_NOT_READY: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '個人副本尚未產生',
    HttpStatus.CONFLICT,
  ],
  ESIGN_RESOURCE_NOT_FOUND: [
    AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
    '找不到電子簽資源',
    HttpStatus.NOT_FOUND,
  ],
  ESIGN_SHARED_SIGNATURE_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '文件至少需要一個共用簽名欄位',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SIGNATURE_FIELDS_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '簽名欄位不完整或不屬於目前文件',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SIGNATURE_PNG_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '簽名必須是有效 PNG 圖片',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SIGNATURES_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '請完成所有必要簽名欄位',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SIGNER_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '至少需要一名簽署人',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SIGNING_PERIOD_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '簽署開始時間必須早於截止時間',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SIGNING_TASK_COMPLETED: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '此簽署任務已完成',
    HttpStatus.CONFLICT,
  ],
  ESIGN_SIGNING_TASK_UNAVAILABLE: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '簽署任務目前無法操作',
    HttpStatus.CONFLICT,
  ],
  ESIGN_SINGLE_UPLOAD_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '一次只能上傳一個檔案',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_SOURCE_UNAVAILABLE: [
    AppErrorCode.ESIGN_STATE_CONFLICT,
    '簽署文件目前無法讀取',
    HttpStatus.CONFLICT,
  ],
  ESIGN_STOP_REASON_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '停止原因必須為 1 至 500 字',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_TITLE_LENGTH_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '文件標題須為 1 至 200 字',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_TITLE_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '請提供文件標題',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_TITLE_STRING_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '文件標題必須為文字',
    HttpStatus.BAD_REQUEST,
  ],
  ESIGN_VERIFICATION_NOT_FOUND: [
    AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
    '查無此簽章或驗證碼無效',
    HttpStatus.NOT_FOUND,
  ],
  FEASTOGETHER_CONFIG_MISSING: [
    AppErrorCode.EXTERNAL_AUTH_UNAVAILABLE,
    '饗賓 API 未設定（缺少連線環境變數）',
    HttpStatus.BAD_GATEWAY,
  ],
  FEASTOGETHER_UNAUTHORIZED: [
    AppErrorCode.UNAUTHORIZED,
    '饗賓授權已失效，請重新登入',
    HttpStatus.UNAUTHORIZED,
  ],
  FEASTOGETHER_UNAVAILABLE: [
    AppErrorCode.EATOGETHER_API_SERVICE_UNAVAILABLE,
    '饗賓服務暫時無法使用',
    HttpStatus.BAD_GATEWAY,
  ],
  INVALID_CREDENTIALS: [
    AppErrorCode.INVALID_CREDENTIALS,
    '員工編號或密碼錯誤',
    HttpStatus.UNAUTHORIZED,
  ],
  LOGIN_REQUIRED: [
    AppErrorCode.UNAUTHORIZED,
    '需登入才能操作',
    HttpStatus.UNAUTHORIZED,
  ],
  LOGIN_UNAVAILABLE: [
    AppErrorCode.EXTERNAL_AUTH_UNAVAILABLE,
    '登入服務暫時無法使用，請稍後再試',
    HttpStatus.BAD_GATEWAY,
  ],
  NOT_FOUND: [AppErrorCode.NOT_FOUND, '找不到資源', HttpStatus.NOT_FOUND],
  OAUTH_CODE_MISSING: [
    AppErrorCode.OAUTH_TRANSACTION_INVALID,
    '回呼缺少授權碼，請重新發起登入',
    HttpStatus.BAD_REQUEST,
  ],
  OAUTH_EMPLOYEE_ID_MISSING: [
    AppErrorCode.OAUTH_RESPONSE_INVALID,
    '統一登入未提供員工編號，無法對應帳號',
    HttpStatus.UNAUTHORIZED,
  ],
  OAUTH_LOGIN_CANCELLED: [
    AppErrorCode.OAUTH_LOGIN_CANCELLED,
    '統一登入已取消或未完成，請重新登入',
    HttpStatus.BAD_REQUEST,
  ],
  OAUTH_RESPONSE_INVALID: [
    AppErrorCode.OAUTH_RESPONSE_INVALID,
    '統一登入身分驗證失敗，請重新登入',
    HttpStatus.UNAUTHORIZED,
  ],
  OAUTH_STATE_FORMAT_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    'state 只允許可見 ASCII 字元',
    HttpStatus.BAD_REQUEST,
  ],
  OAUTH_TRANSACTION_INVALID: [
    AppErrorCode.OAUTH_TRANSACTION_INVALID,
    '登入交易無效或已過期，請重新發起登入',
    HttpStatus.BAD_REQUEST,
  ],
  OAUTH_UNAVAILABLE: [
    AppErrorCode.OAUTH_UNAVAILABLE,
    '統一登入服務暫時無法使用',
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
  OAUTH_UNAVAILABLE_LOGIN_UNAVAILABLE: [
    AppErrorCode.OAUTH_UNAVAILABLE,
    '登入服務暫時無法使用，請稍後再試',
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
  PASSWORD_REQUIRED: [
    AppErrorCode.INVALID_REQUEST,
    '請輸入密碼',
    HttpStatus.BAD_REQUEST,
  ],
  REQUEST_FORMAT_INVALID: [
    AppErrorCode.INVALID_REQUEST,
    '請求格式錯誤',
    HttpStatus.BAD_REQUEST,
  ],
  STAFF_LOOKUP_FAILED: [
    AppErrorCode.STAFF_LOOKUP_FAILED,
    '系統有錯，請詢問IT部門',
    HttpStatus.BAD_GATEWAY,
  ],

  /** 動態欄位名稱只沿用既有 multipart 驗證回應。 */
  ESIGN_UPLOAD_FIELD_UNSUPPORTED: (field: string): AppErrorDefinition => [
    AppErrorCode.INVALID_REQUEST,
    `不支援的欄位：${field}`,
    HttpStatus.BAD_REQUEST,
  ],
  /** 只帶設定名稱與規則，不帶憑證或設定值。 */
  OAUTH_CONFIG_MISSING: (key: string): AppErrorDefinition => [
    AppErrorCode.OAUTH_UNAVAILABLE,
    `OAuth 設定未就緒（缺少 ${key}）`,
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
  OAUTH_CONFIG_INVALID: (key: string, reason: string): AppErrorDefinition => [
    AppErrorCode.OAUTH_UNAVAILABLE,
    `OAuth 設定錯誤：${key} ${reason}`,
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
  /** DTO constraint 訊息由 ValidationPipe 彙整。 */
  REQUEST_VALIDATION_FAILED: (message: string): AppErrorDefinition => [
    AppErrorCode.INVALID_REQUEST,
    message || '請求參數驗證失敗',
    HttpStatus.BAD_REQUEST,
  ],
  INTERNAL_ERROR: [
    AppErrorCode.INTERNAL_ERROR,
    '系統發生未預期錯誤',
    HttpStatus.INTERNAL_SERVER_ERROR,
  ],
} as const satisfies Record<
  string,
  AppErrorDefinition | ((...args: string[]) => AppErrorDefinition)
>;
