import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  'hr_departments',
  'users',
  'esign_documents',
  'esign_document_fields',
  'esign_signers',
  'esign_signature_records',
  'esign_audit_events',
  'esign_verification_records',
  'esign_notification_batches',
  'esign_notification_logs',
  'esign_export_jobs',
  'esign_file_objects',
] as const;

export class InitialEsignSchema1791763200000 implements MigrationInterface {
  name = 'InitialEsignSchema1791763200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`CREATE TABLE \`hr_departments\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '部門流水號',
        \`department_name\` VARCHAR(150) NOT NULL COMMENT '部門名稱',
        \`parent_id\` BIGINT NULL COMMENT '上層部門 ID',
        \`start_date\` DATE NULL COMMENT '生效日',
        \`stop_date\` DATE NULL COMMENT '停用日',
        \`created_by_user_id\` BIGINT NULL COMMENT '建立者員工 ID',
        \`updated_by_user_id\` BIGINT NULL COMMENT '更新者員工 ID',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
        \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
        PRIMARY KEY (\`id\`),
        KEY \`idx_hr_departments_parent_id\` (\`parent_id\`),
        KEY \`idx_hr_departments_start_date\` (\`start_date\`),
        KEY \`idx_hr_departments_stop_date\` (\`stop_date\`),
        KEY \`idx_hr_departments_created_at\` (\`created_at\`),
        KEY \`idx_hr_departments_updated_at\` (\`updated_at\`),
        KEY \`idx_hr_departments_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`fk_hr_departments_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`hr_departments\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='組織部門'`);

      await queryRunner.query(`CREATE TABLE \`users\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '員工流水號',
        \`empid\` VARCHAR(32) NOT NULL COMMENT '公司員工編號',
        \`name\` VARCHAR(100) NOT NULL COMMENT '員工姓名',
        \`person_status\` VARCHAR(50) NULL COMMENT '上游人員狀態',
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否可登入',
        \`department_id\` BIGINT NULL COMMENT '所屬部門 ID',
        \`department_name\` VARCHAR(150) NULL COMMENT '部門名稱顯示值',
        \`title_name\` VARCHAR(100) NULL COMMENT '目前職稱',
        \`last_login_at\` DATETIME(6) NULL COMMENT '最近登入時間',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
        \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_users_empid\` (\`empid\`),
        KEY \`idx_users_person_status\` (\`person_status\`),
        KEY \`idx_users_is_active\` (\`is_active\`),
        KEY \`idx_users_department_id\` (\`department_id\`),
        KEY \`idx_users_last_login_at\` (\`last_login_at\`),
        KEY \`idx_users_created_at\` (\`created_at\`),
        KEY \`idx_users_updated_at\` (\`updated_at\`),
        KEY \`idx_users_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`fk_users_department\` FOREIGN KEY (\`department_id\`) REFERENCES \`hr_departments\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='員工與登入主體'`);

      await queryRunner.query(`ALTER TABLE \`hr_departments\`
        ADD CONSTRAINT \`fk_hr_departments_created_by_user\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        ADD CONSTRAINT \`fk_hr_departments_updated_by_user\` FOREIGN KEY (\`updated_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);

      await queryRunner.query(`CREATE TABLE \`esign_documents\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '文件流水號',
        \`doc_number\` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文件 UUID',
        \`title\` VARCHAR(200) NOT NULL COMMENT '文件名稱',
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT '文件狀態',
        \`created_by_user_id\` BIGINT NOT NULL COMMENT '建立人 ID',
        \`sign_start_at\` DATETIME(6) NULL COMMENT '簽署開始時間',
        \`sign_end_at\` DATETIME(6) NULL COMMENT '簽署截止時間',
        \`signing_payload_json\` JSON NULL COMMENT '固定簽署 payload',
        \`signing_payload_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '簽署 payload SHA-256',
        \`initiated_at\` DATETIME(6) NULL COMMENT '發起時間',
        \`completed_at\` DATETIME(6) NULL COMMENT '完成時間',
        \`stopped_at\` DATETIME(6) NULL COMMENT '停止時間',
        \`stop_reason\` VARCHAR(500) NULL COMMENT '停止原因',
        \`watermark_enabled\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否添加浮水印',
        \`allow_reject\` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允許拒絕簽署',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
        \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_esign_documents_doc_number\` (\`doc_number\`),
        KEY \`idx_esign_documents_creator_status_updated_id\` (\`created_by_user_id\`,\`status\`,\`updated_at\`,\`id\`),
        KEY \`idx_esign_documents_sign_start_at\` (\`sign_start_at\`),
        KEY \`idx_esign_documents_sign_end_at\` (\`sign_end_at\`),
        KEY \`idx_esign_documents_initiated_at\` (\`initiated_at\`),
        KEY \`idx_esign_documents_completed_at\` (\`completed_at\`),
        KEY \`idx_esign_documents_stopped_at\` (\`stopped_at\`),
        KEY \`idx_esign_documents_created_at\` (\`created_at\`),
        KEY \`idx_esign_documents_updated_at\` (\`updated_at\`),
        KEY \`idx_esign_documents_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`fk_esign_documents_creator\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='電子簽文件'`);

      await queryRunner.query(`CREATE TABLE \`esign_document_fields\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '欄位流水號', \`document_id\` BIGINT NOT NULL COMMENT '文件 ID',
        \`field_type\` VARCHAR(20) NOT NULL COMMENT '欄位類型', \`page_number\` INT UNSIGNED NOT NULL COMMENT '頁碼',
        \`x_percent\` DECIMAL(6,3) NOT NULL COMMENT 'X 百分比', \`y_percent\` DECIMAL(6,3) NOT NULL COMMENT 'Y 百分比',
        \`width_percent\` DECIMAL(6,3) NULL COMMENT '寬度百分比', \`height_percent\` DECIMAL(6,3) NULL COMMENT '高度百分比',
        \`sort_order\` INT NOT NULL DEFAULT 0 COMMENT '排序', \`created_by_user_id\` BIGINT NULL COMMENT '建立者員工 ID',
        \`updated_by_user_id\` BIGINT NULL COMMENT '更新者員工 ID',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
        \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間', PRIMARY KEY (\`id\`),
        KEY \`idx_esign_document_fields_doc_page_sort_id\` (\`document_id\`,\`page_number\`,\`sort_order\`,\`id\`),
        KEY \`idx_esign_document_fields_created_at\` (\`created_at\`), KEY \`idx_esign_document_fields_updated_at\` (\`updated_at\`), KEY \`idx_esign_document_fields_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`fk_esign_document_fields_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_document_fields_created_by\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_document_fields_updated_by\` FOREIGN KEY (\`updated_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件簽署欄位'`);

      await queryRunner.query(`CREATE TABLE \`esign_signers\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '簽署人流水號', \`document_id\` BIGINT NOT NULL COMMENT '文件 ID',
        \`signer_type\` VARCHAR(20) NOT NULL COMMENT '簽署人類型', \`user_id\` BIGINT NULL COMMENT '員工 ID',
        \`email\` VARCHAR(255) NULL COMMENT '正規化外部 Email', \`empid_snapshot\` VARCHAR(32) NULL COMMENT '員編快照',
        \`name_snapshot\` VARCHAR(100) NOT NULL COMMENT '姓名快照', \`department_snapshot\` VARCHAR(150) NULL COMMENT '部門快照',
        \`title_snapshot\` VARCHAR(100) NULL COMMENT '職稱快照', \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '簽署狀態',
        \`signed_at\` DATETIME(6) NULL COMMENT '簽署時間', \`rejected_at\` DATETIME(6) NULL COMMENT '拒絕時間',
        \`reject_reason\` VARCHAR(500) NULL COMMENT '拒絕原因', \`sort_order\` INT NOT NULL DEFAULT 0 COMMENT '排序',
        \`created_by_user_id\` BIGINT NULL COMMENT '建立者員工 ID', \`updated_by_user_id\` BIGINT NULL COMMENT '更新者員工 ID',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
        \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間', PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_esign_signers_document_user\` (\`document_id\`,\`user_id\`), UNIQUE KEY \`uq_esign_signers_document_email\` (\`document_id\`,\`email\`),
        KEY \`idx_esign_signers_user_status_document\` (\`user_id\`,\`status\`,\`document_id\`), KEY \`idx_esign_signers_document_status_sort_id\` (\`document_id\`,\`status\`,\`sort_order\`,\`id\`),
        KEY \`idx_esign_signers_signed_at\` (\`signed_at\`), KEY \`idx_esign_signers_rejected_at\` (\`rejected_at\`), KEY \`idx_esign_signers_created_at\` (\`created_at\`), KEY \`idx_esign_signers_updated_at\` (\`updated_at\`), KEY \`idx_esign_signers_deleted_at\` (\`deleted_at\`),
        CONSTRAINT \`chk_esign_signers_identity\` CHECK ((\`signer_type\` = 'user' AND \`user_id\` IS NOT NULL AND \`email\` IS NULL AND \`empid_snapshot\` IS NOT NULL) OR (\`signer_type\` = 'email' AND \`user_id\` IS NULL AND \`email\` IS NOT NULL AND \`empid_snapshot\` IS NULL)),
        CONSTRAINT \`fk_esign_signers_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_signers_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_signers_created_by\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_signers_updated_by\` FOREIGN KEY (\`updated_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件簽署人'`);

      await queryRunner.query(`CREATE TABLE \`esign_signature_records\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '簽署證據流水號', \`signer_id\` BIGINT NOT NULL COMMENT '簽署人 ID',
        \`document_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文件 SHA-256',
        \`signing_payload_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '簽署 payload SHA-256',
        \`consent_version\` VARCHAR(50) NOT NULL COMMENT '同意文案版本', \`authentication_method\` VARCHAR(50) NOT NULL COMMENT '身分驗證方式',
        \`authentication_event_id\` VARCHAR(255) NOT NULL COMMENT '一次性驗證事件 ID', \`source_ip\` VARCHAR(45) NULL COMMENT '來源 IP',
        \`user_agent\` VARCHAR(500) NULL COMMENT 'User-Agent', \`signed_at_utc\` DATETIME(6) NOT NULL COMMENT '實際簽署時間',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_esign_signature_records_signer_id\` (\`signer_id\`), UNIQUE KEY \`uq_esign_signature_records_auth_event\` (\`authentication_event_id\`),
        KEY \`idx_esign_signature_records_signing_payload_sha256\` (\`signing_payload_sha256\`), KEY \`idx_esign_signature_records_signed_at_utc\` (\`signed_at_utc\`), KEY \`idx_esign_signature_records_created_at\` (\`created_at\`),
        CONSTRAINT \`fk_esign_signature_records_signer\` FOREIGN KEY (\`signer_id\`) REFERENCES \`esign_signers\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='不可變簽署證據'`);

      await queryRunner.query(`CREATE TABLE \`esign_audit_events\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '稽核事件流水號', \`document_id\` BIGINT NOT NULL COMMENT '文件 ID', \`signer_id\` BIGINT NULL COMMENT '簽署人 ID', \`actor_user_id\` BIGINT NULL COMMENT '操作員工 ID',
        \`event_type\` VARCHAR(50) NOT NULL COMMENT '事件類型', \`occurred_at\` DATETIME(6) NOT NULL COMMENT '事件發生時間',
        \`previous_event_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '前一事件 hash', \`event_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '事件 hash',
        \`request_id\` VARCHAR(100) NULL COMMENT '請求追蹤 ID', \`metadata_json\` JSON NULL COMMENT '事件中繼資料',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_esign_audit_events_event_hash\` (\`event_hash\`),
        KEY \`idx_esign_audit_events_document_occurred_id\` (\`document_id\`,\`occurred_at\`,\`id\`), KEY \`idx_esign_audit_events_signer_id\` (\`signer_id\`), KEY \`idx_esign_audit_events_actor_user_id\` (\`actor_user_id\`), KEY \`idx_esign_audit_events_event_type\` (\`event_type\`), KEY \`idx_esign_audit_events_request_id\` (\`request_id\`), KEY \`idx_esign_audit_events_occurred_at\` (\`occurred_at\`), KEY \`idx_esign_audit_events_created_at\` (\`created_at\`),
        CONSTRAINT \`fk_esign_audit_events_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_audit_events_signer\` FOREIGN KEY (\`signer_id\`) REFERENCES \`esign_signers\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_esign_audit_events_actor\` FOREIGN KEY (\`actor_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='不可變文件稽核事件'`);

      await queryRunner.query(`CREATE TABLE \`esign_verification_records\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '驗證紀錄流水號', \`document_id\` BIGINT NOT NULL COMMENT '文件 ID', \`public_id\` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '公開驗證 UUID',
        \`manifest_json\` JSON NOT NULL COMMENT '驗證 manifest', \`manifest_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'manifest SHA-256', \`final_pdf_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '最終 PDF SHA-256', \`audit_root_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '稽核鏈 root hash',
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'valid' COMMENT '驗證狀態', \`issued_at\` DATETIME(6) NOT NULL COMMENT '核發時間', \`revoked_at\` DATETIME(6) NULL COMMENT '撤銷時間', \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_esign_verification_records_document_id\` (\`document_id\`), UNIQUE KEY \`uq_esign_verification_records_public_id\` (\`public_id\`), KEY \`idx_esign_verification_records_manifest_sha256\` (\`manifest_sha256\`), KEY \`idx_esign_verification_records_final_pdf_sha256\` (\`final_pdf_sha256\`), KEY \`idx_esign_verification_records_status\` (\`status\`), KEY \`idx_esign_verification_records_issued_at\` (\`issued_at\`), KEY \`idx_esign_verification_records_revoked_at\` (\`revoked_at\`), KEY \`idx_esign_verification_records_created_at\` (\`created_at\`),
        CONSTRAINT \`fk_esign_verification_records_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公開驗證證據'`);

      await queryRunner.query(`CREATE TABLE \`esign_notification_batches\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '通知批次流水號', \`document_id\` BIGINT NOT NULL COMMENT '文件 ID', \`filter_type\` VARCHAR(20) NOT NULL COMMENT '通知篩選', \`target_count\` INT UNSIGNED NOT NULL COMMENT '目標數量', \`notified_by_user_id\` BIGINT NULL COMMENT '通知操作員工 ID', \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', PRIMARY KEY (\`id\`), KEY \`idx_esign_notification_batches_document_id\` (\`document_id\`), KEY \`idx_esign_notification_batches_created_at\` (\`created_at\`),
        CONSTRAINT \`fk_esign_notification_batches_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT \`fk_esign_notification_batches_user\` FOREIGN KEY (\`notified_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知批次'`);

      await queryRunner.query(`CREATE TABLE \`esign_notification_logs\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '通知明細流水號', \`batch_id\` BIGINT NOT NULL COMMENT '通知批次 ID', \`signer_id\` BIGINT NOT NULL COMMENT '簽署人 ID', \`channel\` VARCHAR(20) NOT NULL COMMENT '通知管道', \`result\` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '通知結果', \`error_code\` VARCHAR(100) NULL COMMENT '穩定錯誤碼', \`completed_at\` DATETIME(6) NULL COMMENT '完成時間', \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_esign_notification_logs_batch_signer_channel\` (\`batch_id\`,\`signer_id\`,\`channel\`), KEY \`idx_esign_notification_logs_batch_id\` (\`batch_id\`), KEY \`idx_esign_notification_logs_signer_id\` (\`signer_id\`), KEY \`idx_esign_notification_logs_result\` (\`result\`), KEY \`idx_esign_notification_logs_created_at\` (\`created_at\`), KEY \`idx_esign_notification_logs_completed_at\` (\`completed_at\`),
        CONSTRAINT \`fk_esign_notification_logs_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`esign_notification_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT \`fk_esign_notification_logs_signer\` FOREIGN KEY (\`signer_id\`) REFERENCES \`esign_signers\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知明細'`);

      await queryRunner.query(`CREATE TABLE \`esign_export_jobs\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '匯出工作流水號', \`export_type\` VARCHAR(30) NOT NULL COMMENT '匯出類型', \`document_id\` BIGINT NULL COMMENT '文件 ID', \`created_by_user_id\` BIGINT NOT NULL COMMENT '建立員工 ID', \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '工作狀態', \`scope_description\` VARCHAR(255) NOT NULL COMMENT '匯出範圍說明', \`record_count\` BIGINT UNSIGNED NULL COMMENT '匯出筆數', \`failure_code\` VARCHAR(100) NULL COMMENT '失敗錯誤碼', \`completed_at\` DATETIME(6) NULL COMMENT '完成時間', \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間', PRIMARY KEY (\`id\`),
        KEY \`idx_esign_export_jobs_document_id\` (\`document_id\`), KEY \`idx_esign_export_jobs_creator_status_created_id\` (\`created_by_user_id\`,\`status\`,\`created_at\`,\`id\`), KEY \`idx_esign_export_jobs_status\` (\`status\`), KEY \`idx_esign_export_jobs_created_at\` (\`created_at\`), KEY \`idx_esign_export_jobs_updated_at\` (\`updated_at\`), KEY \`idx_esign_export_jobs_completed_at\` (\`completed_at\`),
        CONSTRAINT \`fk_esign_export_jobs_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT \`fk_esign_export_jobs_user\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='匯出工作'`);

      await queryRunner.query(`CREATE TABLE \`esign_file_objects\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '檔案 metadata 流水號', \`document_id\` BIGINT NULL COMMENT '文件 ID', \`signature_record_id\` BIGINT NULL COMMENT '簽署證據 ID', \`verification_record_id\` BIGINT NULL COMMENT '驗證紀錄 ID', \`export_job_id\` BIGINT NULL COMMENT '匯出工作 ID', \`file_purpose\` VARCHAR(30) NOT NULL COMMENT '檔案用途', \`object_key\` VARCHAR(500) COLLATE utf8mb4_bin NOT NULL COMMENT '私有物件 key', \`object_version\` VARCHAR(255) NULL COMMENT '物件版本', \`original_file_name\` VARCHAR(255) NULL COMMENT '原始檔名', \`mime_type\` VARCHAR(100) NOT NULL COMMENT 'MIME type', \`file_size\` BIGINT UNSIGNED NOT NULL COMMENT '檔案大小 bytes', \`sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '檔案 SHA-256', \`archive_status\` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '封存狀態', \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間', PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_esign_file_objects_object_key\` (\`object_key\`), KEY \`idx_esign_file_objects_document_id\` (\`document_id\`), KEY \`idx_esign_file_objects_signature_record_id\` (\`signature_record_id\`), KEY \`idx_esign_file_objects_verification_record_id\` (\`verification_record_id\`), KEY \`idx_esign_file_objects_export_job_id\` (\`export_job_id\`), KEY \`idx_esign_file_objects_file_purpose\` (\`file_purpose\`), KEY \`idx_esign_file_objects_sha256\` (\`sha256\`), KEY \`idx_esign_file_objects_archive_status\` (\`archive_status\`), KEY \`idx_esign_file_objects_created_at\` (\`created_at\`),
        CONSTRAINT \`chk_esign_file_objects_owner\` CHECK (\`document_id\` IS NOT NULL OR \`signature_record_id\` IS NOT NULL OR \`verification_record_id\` IS NOT NULL OR \`export_job_id\` IS NOT NULL),
        CONSTRAINT \`fk_esign_file_objects_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT \`fk_esign_file_objects_signature\` FOREIGN KEY (\`signature_record_id\`) REFERENCES \`esign_signature_records\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT \`fk_esign_file_objects_verification\` FOREIGN KEY (\`verification_record_id\`) REFERENCES \`esign_verification_records\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT \`fk_esign_file_objects_export\` FOREIGN KEY (\`export_job_id\`) REFERENCES \`esign_export_jobs\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私有物件儲存 metadata'`);
    } catch (error) {
      await this.cleanupPartialSchema(queryRunner);
      throw error;
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `hr_departments` DROP FOREIGN KEY `fk_hr_departments_created_by_user`, DROP FOREIGN KEY `fk_hr_departments_updated_by_user`',
    );
    for (const table of [...TABLES].reverse()) {
      await queryRunner.query(`DROP TABLE \`${table}\``);
    }
  }

  private async cleanupPartialSchema(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of [...TABLES].reverse()) {
        await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
    } finally {
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  }
}
