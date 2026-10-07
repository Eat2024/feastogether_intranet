-- =============================================================================
-- 電子簽署模組 — 建議 DB Table Schema（MySQL 8.x / InnoDB / utf8mb4）
--
-- 依據 feastogether_intranet（e-approval）前端原型實測操作流程整理：
--   - 新增電子簽文件三步驟精靈（上傳文件 → 設定簽署 → 發起簽署）
--   - 文件簽署狀態頁（/forms/[id]）
--   - 我的電子簽（/my-signature）
--   - 歷史匯出文件（/export-history）
--
-- 設計慣例：
--   - 主鍵一律 BIGINT UNSIGNED AUTO_INCREMENT
--   - 業務表都有 created_at/updated_at/deleted_at/created_by/updated_by（軟刪除）
--   - append-only 的 log 表（通知紀錄、匯出紀錄）只有 created_at，不給 UPDATE
--   - 狀態欄位一律 VARCHAR + 註解列舉值，不用 MySQL 原生 ENUM（方便未來擴充值不用改 schema）
--   - 本檔僅供產生 DDL 參考，尚未實際執行；正式套用前請先確認目標資料庫與既有
--     hr_employees / hr_departments 是否已存在（見檔案末段說明）
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

-- -----------------------------------------------------------------------------
-- 參考表（若平台已有由人易/NUEIP 同步的員工與組織架構主檔，請略過這兩張，
-- 並把下方 esign_signers.employee_id / esign_document_fields 等 FK 改接既有表）
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_departments (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  department_name VARCHAR(150)     NOT NULL COMMENT '部門名稱',
  parent_id       BIGINT UNSIGNED  NULL     COMMENT '上層部門（自關聯樹狀結構）',
  start_date      DATE             NULL     COMMENT '部門生效日',
  stop_date       DATE             NULL     COMMENT '部門停用日',
  created_at      DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at      DATETIME(6)      NULL,
  created_by      VARCHAR(64)      NULL,
  updated_by      VARCHAR(64)      NULL,
  PRIMARY KEY (id),
  KEY idx_hr_departments_parent (parent_id),
  CONSTRAINT fk_hr_departments_parent
    FOREIGN KEY (parent_id) REFERENCES hr_departments (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='組織架構樹（對應組織架構圖 JSON：department_name/children/startdate/stopdate）';

CREATE TABLE IF NOT EXISTS hr_employees (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  empid           VARCHAR(32)      NOT NULL COMMENT '員工工號',
  name            VARCHAR(100)     NOT NULL COMMENT '姓名',
  title_name      VARCHAR(100)     NULL     COMMENT '職稱（如：廚務組長）',
  department_id   BIGINT UNSIGNED  NULL     COMMENT 'FK→hr_departments.id',
  department_name VARCHAR(150)     NULL     COMMENT '部門名稱冗餘顯示',
  is_active       TINYINT(1)       NOT NULL DEFAULT 1 COMMENT '在職狀態',
  created_at      DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at      DATETIME(6)      NULL,
  created_by      VARCHAR(64)      NULL,
  updated_by      VARCHAR(64)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hr_employees_empid (empid),
  KEY idx_hr_employees_department (department_id),
  KEY idx_hr_employees_active (is_active),
  CONSTRAINT fk_hr_employees_department
    FOREIGN KEY (department_id) REFERENCES hr_departments (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='員工主檔（人資系統同步，非本登入快取 auth_users）';

-- -----------------------------------------------------------------------------
-- 1. esign_documents — 文件主檔
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esign_documents (
  id                            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  doc_number                    CHAR(36)        NOT NULL DEFAULT (UUID()) COMMENT '文件編號（UUID，建立當下即產生，不再採 ES-yyyy-NNNN 流水號格式）',
  title                         VARCHAR(200)    NOT NULL COMMENT '文件名稱',
  status                        VARCHAR(20)     NOT NULL COMMENT '文件狀態：draft(草稿)|in_progress(簽署中)|completed(已完成)|stopped(已停止)',

  original_file_name            VARCHAR(255)    NOT NULL COMMENT '原始檔名',
  original_file_path            VARCHAR(500)    NOT NULL COMMENT '原始檔案儲存路徑/物件 key',
  original_mime_type            VARCHAR(100)    NOT NULL COMMENT '原始檔案 MIME type（Word/PDF）',
  page_count                    INT             NOT NULL COMMENT '文件頁數（含附加的確認頁）',
  use_system_confirmation_page  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否改用系統公版「簽署確認頁」取代自訂欄位標記',

  sign_start_date               DATETIME        NULL     COMMENT '簽署期間開始時間；精度至分鐘，應用層選日期時預設帶入當日 00:00:00',
  sign_end_date                 DATETIME        NULL     COMMENT '簽署期間結束時間；精度至分鐘，應用層選日期時預設帶入當日 23:59:59',
  initiated_at                  DATETIME(6)     NULL     COMMENT '發起簽署時間（由草稿轉為簽署中）',
  first_signed_at               DATETIME(6)     NULL     COMMENT '第一位簽署人完成簽署的時間；非 NULL 即代表文件內容鎖定、不可再編輯',
  first_signed_user             VARCHAR(32)     NULL     COMMENT '第一位完成簽署者的員編（對應 esign_signers.employee_empid）',
  completed_at                  DATETIME(6)     NULL     COMMENT '全部簽署完成時間',
  stopped_at                    DATETIME(6)     NULL     COMMENT '停止簽署時間',
  stop_reason                   VARCHAR(500)    NULL     COMMENT '停止簽署原因',

  is_active                     TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '啟用狀態：1=啟用，0=已棄用（軟刪除標記，與 deleted_at 搭配使用）',

  created_at                    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at                    DATETIME(6)     NULL     COMMENT '刪除時間（軟刪除）',
  created_by                    VARCHAR(64)     NULL COMMENT '建立者（使用者 ID）＝文件「建立人」',
  updated_by                    VARCHAR(64)     NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_esign_documents_doc_number (doc_number),
  KEY idx_esign_documents_status (status),
  KEY idx_esign_documents_created_by (created_by),
  KEY idx_esign_documents_sign_dates (sign_start_date, sign_end_date),
  KEY idx_esign_documents_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='電子簽文件主檔';

-- -----------------------------------------------------------------------------
-- 2. esign_document_fields — 簽名/日期欄位版面（文件範本層級，非個別簽署人）
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esign_document_fields (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id     BIGINT UNSIGNED NOT NULL COMMENT 'FK→esign_documents.id',
  field_type      VARCHAR(20)     NOT NULL COMMENT '欄位類型：signature(簽名欄位)|date(日期欄位)',
  page_number     INT             NOT NULL COMMENT '第幾頁（從 1 起算）',
  x_percent       DECIMAL(6,3)    NOT NULL COMMENT '座標 x%（相對頁面寬度）',
  y_percent       DECIMAL(6,3)    NOT NULL COMMENT '座標 y%（相對頁面高度）',
  width_percent   DECIMAL(6,3)    NULL     COMMENT '欄位寬度%',
  height_percent  DECIMAL(6,3)    NULL     COMMENT '欄位高度%',
  sort_order      INT             NOT NULL DEFAULT 0 COMMENT '顯示/標記順序',

  created_at      DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at      DATETIME(6)     NULL,
  created_by      VARCHAR(64)     NULL,
  updated_by      VARCHAR(64)     NULL,

  PRIMARY KEY (id),
  KEY idx_esign_fields_document_page (document_id, page_number),
  CONSTRAINT fk_esign_fields_document
    FOREIGN KEY (document_id) REFERENCES esign_documents (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件簽名/日期欄位版面座標（套用到該文件的每位簽署人副本）';

-- -----------------------------------------------------------------------------
-- 3. esign_signers — 簽署人（承載「我的電子簽」與「文件簽署狀態頁」）
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esign_signers (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id                 BIGINT UNSIGNED NOT NULL COMMENT 'FK→esign_documents.id',

  signer_type                 VARCHAR(20)     NOT NULL COMMENT '簽署人來源：employee(組織架構內部同仁)|email(以 Email 新增之外部/未建檔人員)|mobile(以手機號碼新增，無 Email 的外部人員)',
  singer_id              VARCHAR(32)     NULL     COMMENT '簽署人 employee id index, mobile & email 型為 NULL',
  display_name                VARCHAR(100)    NOT NULL COMMENT '簽署人姓名',
  department_name_snapshot    VARCHAR(150)    NULL     COMMENT '部門快照，簽署時當下人的部門, 外部為 null',
  email                       VARCHAR(255)    NULL     COMMENT '通知用 Email；signer_type=email 時必填',
  mobile                VARCHAR(20)     NULL     COMMENT '通知/簡訊驗證用手機號碼；signer_type=mobile 時必填（建議存國際碼格式，如 +886912345678）',

  status                      VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT '簽署狀態：pending(待簽署)|signed(已簽署)|rejected(已拒絕)',
  signed_at                   DATETIME(6)     NULL     COMMENT '簽署完成時間',
  rejected_at                 DATETIME(6)     NULL     COMMENT '拒絕時間',
  reject_reason               VARCHAR(500)    NULL     COMMENT '拒絕原因',
  signed_file_path            VARCHAR(500)    NULL     COMMENT '該簽署人個人版（已疊上簽名）的簽署後檔案路徑，供單筆下載',
  sort_order                  INT             NOT NULL DEFAULT 0 COMMENT '於簽署人清單中的顯示順序（新增順序）',

  created_at                  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at                  DATETIME(6)     NULL,
  created_by                  VARCHAR(64)     NULL,
  updated_by                  VARCHAR(64)     NULL,

  PRIMARY KEY (id),

  -- 避免同一人被重複加入同一份文件（NULL 在 MySQL UNIQUE 索引中視為互不相等，
  -- 所以非該類型的 rows 對應欄位均為 NULL，不會互相衝突）
  UNIQUE KEY uq_esign_signers_doc_employee (document_id, employee_id),
  UNIQUE KEY uq_esign_signers_doc_email (document_id, email),
  UNIQUE KEY uq_esign_signers_doc_mobile (document_id, mobile_number),

  KEY idx_esign_signers_document (document_id),
  KEY idx_esign_signers_employee_status (employee_id, status), -- 支撐「我的電子簽」待簽署/已簽署/已拒絕頁籤
  KEY idx_esign_signers_status (status),

  CONSTRAINT fk_esign_signers_document
    FOREIGN KEY (document_id) REFERENCES esign_documents (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_esign_signers_employee
    FOREIGN KEY (employee_id) REFERENCES hr_employees (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='電子簽文件之簽署人與簽署狀態';

-- -----------------------------------------------------------------------------
-- 4a. esign_notification_batches — 通知事件（每次按「通知」動作 1 筆，append-only）
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esign_notification_batches (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id   BIGINT UNSIGNED NOT NULL COMMENT 'FK→esign_documents.id（方便直接查某份文件的通知歷程，不用 JOIN signers）',
  filter_type  VARCHAR(20)     NOT NULL COMMENT '通知對象篩選方式：all(全部)|pending(待簽署)',
  target_count  INT             NOT NULL COMMENT '這次動作實際通知的人數快照（如 5000）',
  notified_by   VARCHAR(64)     NULL     COMMENT '操作者 ID；系統自動發送 system',

  created_at    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '即通知發送時間',

  PRIMARY KEY (id),
  KEY idx_esign_notif_batch_document (document_id, created_at),
  CONSTRAINT fk_esign_notif_batch_document
    FOREIGN KEY (document_id) REFERENCES esign_documents (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知事件主檔（1 次「通知」動作 1 筆，append-only）';

-- -----------------------------------------------------------------------------
-- 4b. esign_notification_logs — 通知對象明細（每個收件人 1 筆，append-only）
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esign_notification_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id      BIGINT UNSIGNED NOT NULL COMMENT 'FK→esign_notification_batches.id（這筆屬於哪一次通知動作）',
  signer_id     BIGINT UNSIGNED NOT NULL COMMENT 'FK→esign_signers.id（通知對象）',
  channel       VARCHAR(20)     NOT NULL DEFAULT 'email' COMMENT '通知管道：email|sms（依簽署人 signer_type 決定，mobile 型走 sms）',

  created_at    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '即通知發送時間（與所屬 batch.created_at 相近）',
  result        VARCHAR(20)     NULL     COMMENT '通知結果：success|fail|unknown（未知，可能是第三方 API 回傳不明）',

  PRIMARY KEY (id),
  KEY idx_esign_notif_log_batch (batch_id),
  KEY idx_esign_notif_log_signer_created (signer_id, created_at), -- 支撐「某簽署人通知紀錄」查詢
  CONSTRAINT fk_esign_notif_log_batch
    FOREIGN KEY (batch_id) REFERENCES esign_notification_batches (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_esign_notif_log_signer
    FOREIGN KEY (signer_id) REFERENCES esign_signers (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知對象明細（append-only，每個收件人 1 筆）';

-- -----------------------------------------------------------------------------
-- 5. esign_export_jobs — 歷史匯出紀錄
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esign_export_jobs (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  export_type        VARCHAR(30)     NOT NULL COMMENT '匯出類型：signing_log_excel(簽署紀錄清單 Excel)|signed_pdf(已簽署文件 PDF)',
  document_id        BIGINT UNSIGNED NULL     COMMENT 'FK→esign_documents.id；NULL 代表跨文件批次匯出',
  scope_description  VARCHAR(255)    NOT NULL COMMENT '匯出範圍描述（篩選條件/日期區間文字）',
  record_count       INT             NOT NULL COMMENT '筆數',
  file_path          VARCHAR(500)    NOT NULL COMMENT '匯出檔案路徑，供「重新下載」使用',

  created_at         DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '即匯出時間',
  created_by         VARCHAR(64)     NULL COMMENT '匯出人（對應畫面「匯出人」欄）',

  PRIMARY KEY (id),
  KEY idx_esign_export_document (document_id),
  KEY idx_esign_export_type_created (export_type, created_at),
  CONSTRAINT fk_esign_export_document
    FOREIGN KEY (document_id) REFERENCES esign_documents (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='電子簽歷史匯出紀錄（簽署清單 Excel／已簽署 PDF）';