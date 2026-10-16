-- 由 `pnpm -C server schema:dump` 自動產生，請勿手動修改。
-- 表結構以 migration（src/infrastructure/database/migrations）為準；本檔僅供閱讀與 review，
-- 建庫請用 `pnpm -C server db:setup`，不要直接匯入本檔。


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `auth_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '認證流程流水號',
  `user_id` bigint DEFAULT NULL COMMENT '員工 ID',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '認證來源',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '認證狀態',
  `source_jti_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '來源 JWT jti SHA-256',
  `launch_code_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '啟動碼 SHA-256',
  `session_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '登入識別摘要 SHA-256',
  `assertion_expires_at` datetime(3) NOT NULL COMMENT '來源 assertion 到期時間',
  `launch_expires_at` datetime(3) DEFAULT NULL COMMENT '啟動碼到期時間',
  `verified_at` datetime(3) DEFAULT NULL COMMENT '員工驗證完成時間',
  `activated_at` datetime(3) DEFAULT NULL COMMENT 'Session 啟用時間',
  `expires_at` datetime(3) DEFAULT NULL COMMENT 'Session 到期時間',
  `revoked_at` datetime(3) DEFAULT NULL COMMENT 'Session 撤銷時間',
  `failure_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失敗分類',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_sessions_source_jti_hash` (`source_jti_hash`),
  UNIQUE KEY `uq_auth_sessions_launch_code_hash` (`launch_code_hash`),
  UNIQUE KEY `uq_auth_sessions_session_token_hash` (`session_token_hash`),
  KEY `idx_auth_sessions_status_launch_expires_at` (`status`,`launch_expires_at`),
  KEY `idx_auth_sessions_status_expires_at` (`status`,`expires_at`),
  KEY `idx_auth_sessions_user_created_at` (`user_id`,`created_at`),
  KEY `idx_auth_sessions_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_auth_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_auth_sessions_status` CHECK ((`status` in (_utf8mb4'validating',_utf8mb4'pending',_utf8mb4'active',_utf8mb4'failed',_utf8mb4'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WebView 啟動與員工登入 Session';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_audit_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_audit_events` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '稽核事件流水號',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
  `signer_id` bigint DEFAULT NULL COMMENT '簽署人 ID',
  `actor_user_id` bigint DEFAULT NULL COMMENT '操作員工 ID',
  `event_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件類型',
  `occurred_at` datetime(6) NOT NULL COMMENT '事件發生時間',
  `previous_event_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '前一事件 hash',
  `event_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '事件 hash',
  `request_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '請求追蹤 ID',
  `metadata_json` json DEFAULT NULL COMMENT '事件中繼資料',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_audit_events_event_hash` (`event_hash`),
  KEY `idx_esign_audit_events_document_occurred_id` (`document_id`,`occurred_at`,`id`),
  KEY `idx_esign_audit_events_signer_id` (`signer_id`),
  KEY `idx_esign_audit_events_actor_user_id` (`actor_user_id`),
  KEY `idx_esign_audit_events_event_type` (`event_type`),
  KEY `idx_esign_audit_events_request_id` (`request_id`),
  KEY `idx_esign_audit_events_occurred_at` (`occurred_at`),
  KEY `idx_esign_audit_events_created_at` (`created_at`),
  CONSTRAINT `fk_esign_audit_events_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_audit_events_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_audit_events_signer` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='不可變文件稽核事件';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_document_fields`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_document_fields` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '欄位流水號',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
  `signer_id` bigint DEFAULT NULL COMMENT '欄位所屬簽署人 ID',
  `field_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '欄位類型',
  `page_number` int unsigned NOT NULL COMMENT '頁碼',
  `x_percent` decimal(6,3) NOT NULL COMMENT 'X 百分比',
  `y_percent` decimal(6,3) NOT NULL COMMENT 'Y 百分比',
  `width_percent` decimal(6,3) NOT NULL COMMENT '寬度百分比',
  `height_percent` decimal(6,3) NOT NULL COMMENT '高度百分比',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_by_user_id` bigint DEFAULT NULL COMMENT '建立者員工 ID',
  `updated_by_user_id` bigint DEFAULT NULL COMMENT '更新者員工 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  KEY `idx_esign_document_fields_doc_page_sort_id` (`document_id`,`page_number`,`sort_order`,`id`),
  KEY `idx_esign_document_fields_signer_id` (`signer_id`),
  KEY `idx_esign_document_fields_created_at` (`created_at`),
  KEY `idx_esign_document_fields_updated_at` (`updated_at`),
  KEY `idx_esign_document_fields_deleted_at` (`deleted_at`),
  KEY `fk_esign_document_fields_created_by` (`created_by_user_id`),
  KEY `fk_esign_document_fields_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_esign_document_fields_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_document_fields_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_document_fields_signer` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_document_fields_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
  ,CONSTRAINT `chk_esign_document_fields_type` CHECK ((`field_type` in (_utf8mb4'signature',_utf8mb4'date')))
  ,CONSTRAINT `chk_esign_document_fields_page` CHECK ((`page_number` >= 1))
  ,CONSTRAINT `chk_esign_document_fields_bounds` CHECK (((`x_percent` >= 0) and (`x_percent` < 100) and (`y_percent` >= 0) and (`y_percent` < 100) and (`width_percent` > 0) and (`height_percent` > 0) and ((`x_percent` + `width_percent`) <= 100) and ((`y_percent` + `height_percent`) <= 100)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件簽署欄位';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_documents` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '文件流水號',
  `doc_number` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文件 UUID',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件名稱',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT '文件狀態',
  `created_by_user_id` bigint NOT NULL COMMENT '建立人 ID',
  `sign_start_at` datetime(6) DEFAULT NULL COMMENT '簽署開始時間',
  `sign_end_at` datetime(6) DEFAULT NULL COMMENT '簽署截止時間',
  `signing_payload_json` json DEFAULT NULL COMMENT '固定簽署 payload',
  `signing_payload_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '簽署 payload SHA-256',
  `initiated_at` datetime(6) DEFAULT NULL COMMENT '發起時間',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '完成時間',
  `stopped_at` datetime(6) DEFAULT NULL COMMENT '停止時間',
  `stop_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '停止原因',
  `finalization_lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '完成檔案 worker lease UUID',
  `finalization_lease_expires_at` datetime(6) DEFAULT NULL COMMENT '完成檔案 worker lease 到期時間',
  `watermark_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否添加浮水印',
  `allow_reject` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否允許拒絕簽署',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_documents_doc_number` (`doc_number`),
  KEY `idx_esign_documents_creator_status_updated_id` (`created_by_user_id`,`status`,`updated_at`,`id`),
  KEY `idx_esign_documents_sign_start_at` (`sign_start_at`),
  KEY `idx_esign_documents_sign_end_at` (`sign_end_at`),
  KEY `idx_esign_documents_initiated_at` (`initiated_at`),
  KEY `idx_esign_documents_completed_at` (`completed_at`),
  KEY `idx_esign_documents_stopped_at` (`stopped_at`),
  KEY `idx_esign_documents_finalization_lease_expires_at` (`finalization_lease_expires_at`),
  KEY `idx_esign_documents_created_at` (`created_at`),
  KEY `idx_esign_documents_updated_at` (`updated_at`),
  KEY `idx_esign_documents_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_esign_documents_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_documents_status` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'active',_utf8mb4'finalizing',_utf8mb4'completed',_utf8mb4'stopped'))),
  CONSTRAINT `chk_esign_documents_sign_period` CHECK (((`sign_start_at` is null) and (`sign_end_at` is null)) or ((`sign_start_at` is not null) and (`sign_end_at` is not null) and (`sign_start_at` < `sign_end_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='電子簽文件';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_export_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_export_jobs` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '匯出工作流水號',
  `export_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '匯出類型',
  `document_id` bigint DEFAULT NULL COMMENT '文件 ID',
  `created_by_user_id` bigint NOT NULL COMMENT '建立員工 ID',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '工作狀態',
  `scope_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '匯出範圍說明',
  `record_count` bigint unsigned DEFAULT NULL COMMENT '匯出筆數',
  `failure_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失敗錯誤碼',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '完成時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  PRIMARY KEY (`id`),
  KEY `idx_esign_export_jobs_document_id` (`document_id`),
  KEY `idx_esign_export_jobs_creator_status_created_id` (`created_by_user_id`,`status`,`created_at`,`id`),
  KEY `idx_esign_export_jobs_status` (`status`),
  KEY `idx_esign_export_jobs_created_at` (`created_at`),
  KEY `idx_esign_export_jobs_updated_at` (`updated_at`),
  KEY `idx_esign_export_jobs_completed_at` (`completed_at`),
  CONSTRAINT `fk_esign_export_jobs_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_export_jobs_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='匯出工作';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_file_objects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_file_objects` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '檔案 metadata 流水號',
  `document_id` bigint DEFAULT NULL COMMENT '文件 ID',
  `signature_record_id` bigint DEFAULT NULL COMMENT '簽署證據 ID',
  `document_field_id` bigint DEFAULT NULL COMMENT '簽名圖對應文件欄位 ID',
  `verification_record_id` bigint DEFAULT NULL COMMENT '驗證紀錄 ID',
  `export_job_id` bigint DEFAULT NULL COMMENT '匯出工作 ID',
  `file_purpose` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '檔案用途',
  `object_key` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '私有物件 key',
  `object_version` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '物件版本',
  `original_file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始檔名',
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'MIME type',
  `file_size` bigint unsigned NOT NULL COMMENT '檔案大小 bytes',
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '檔案 SHA-256',
  `archive_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '封存狀態',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_file_objects_object_key` (`object_key`),
  UNIQUE KEY `uq_esign_file_objects_document_purpose` (`document_id`,`file_purpose`),
  UNIQUE KEY `uq_esign_file_objects_signature_field_purpose` (`signature_record_id`,`document_field_id`,`file_purpose`),
  KEY `idx_esign_file_objects_document_id` (`document_id`),
  KEY `idx_esign_file_objects_signature_record_id` (`signature_record_id`),
  KEY `idx_esign_file_objects_document_field_id` (`document_field_id`),
  KEY `idx_esign_file_objects_verification_record_id` (`verification_record_id`),
  KEY `idx_esign_file_objects_export_job_id` (`export_job_id`),
  KEY `idx_esign_file_objects_file_purpose` (`file_purpose`),
  KEY `idx_esign_file_objects_sha256` (`sha256`),
  KEY `idx_esign_file_objects_archive_status` (`archive_status`),
  KEY `idx_esign_file_objects_created_at` (`created_at`),
  CONSTRAINT `fk_esign_file_objects_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_document_field` FOREIGN KEY (`document_field_id`) REFERENCES `esign_document_fields` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_export` FOREIGN KEY (`export_job_id`) REFERENCES `esign_export_jobs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_signature` FOREIGN KEY (`signature_record_id`) REFERENCES `esign_signature_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_verification` FOREIGN KEY (`verification_record_id`) REFERENCES `esign_verification_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_file_objects_owner` CHECK (((`document_id` is not null) or (`signature_record_id` is not null) or (`verification_record_id` is not null) or (`export_job_id` is not null))),
  CONSTRAINT `chk_esign_file_objects_signature_field` CHECK (((`file_purpose` = _utf8mb4'signature_png') and (`signature_record_id` is not null) and (`document_field_id` is not null)) or ((`file_purpose` <> _utf8mb4'signature_png') and (`document_field_id` is null)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私有物件儲存 metadata';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_notification_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_notification_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '通知批次流水號',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
  `filter_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '通知篩選',
  `target_count` int unsigned NOT NULL COMMENT '目標數量',
  `notified_by_user_id` bigint DEFAULT NULL COMMENT '通知操作員工 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  KEY `idx_esign_notification_batches_document_id` (`document_id`),
  KEY `idx_esign_notification_batches_created_at` (`created_at`),
  KEY `fk_esign_notification_batches_user` (`notified_by_user_id`),
  CONSTRAINT `fk_esign_notification_batches_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_notification_batches_user` FOREIGN KEY (`notified_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知批次';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_notification_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_notification_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '通知明細流水號',
  `batch_id` bigint NOT NULL COMMENT '通知批次 ID',
  `signer_id` bigint NOT NULL COMMENT '簽署人 ID',
  `channel` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '通知管道',
  `result` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '通知結果',
  `error_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '穩定錯誤碼',
  `attempt_count` int unsigned NOT NULL DEFAULT '0' COMMENT '寄送嘗試次數',
  `next_attempt_at` datetime(6) DEFAULT NULL COMMENT '下次可重試時間',
  `processing_started_at` datetime(6) DEFAULT NULL COMMENT '本次處理開始時間',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '完成時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_notification_logs_batch_signer_channel` (`batch_id`,`signer_id`,`channel`),
  KEY `idx_esign_notification_logs_batch_id` (`batch_id`),
  KEY `idx_esign_notification_logs_signer_id` (`signer_id`),
  KEY `idx_esign_notification_logs_result` (`result`),
  KEY `idx_esign_notification_logs_created_at` (`created_at`),
  KEY `idx_esign_notification_logs_completed_at` (`completed_at`),
  KEY `idx_esign_notification_logs_next_attempt_at` (`next_attempt_at`),
  KEY `idx_esign_notification_logs_processing_started_at` (`processing_started_at`),
  KEY `idx_esign_notification_logs_result_next_attempt_id` (`result`,`next_attempt_at`,`id`),
  CONSTRAINT `fk_esign_notification_logs_batch` FOREIGN KEY (`batch_id`) REFERENCES `esign_notification_batches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_notification_logs_signer` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_notification_logs_channel` CHECK ((`channel` = _utf8mb4'email')),
  CONSTRAINT `chk_esign_notification_logs_result` CHECK ((`result` in (_utf8mb4'pending',_utf8mb4'processing',_utf8mb4'delivered',_utf8mb4'failed')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知明細';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_signature_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_signature_records` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '簽署證據流水號',
  `signer_id` bigint NOT NULL COMMENT '簽署人 ID',
  `document_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '文件 SHA-256',
  `signing_payload_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '簽署 payload SHA-256',
  `consent_version` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '同意文案版本',
  `authentication_method` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '身分驗證方式',
  `authentication_event_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '一次性驗證事件 ID',
  `source_ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '來源 IP',
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User-Agent',
  `signed_at_utc` datetime(6) NOT NULL COMMENT '實際簽署時間',
  `verification_code` char(22) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '簽章公開驗證代碼',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_signature_records_signer_id` (`signer_id`),
  UNIQUE KEY `uq_esign_signature_records_auth_event` (`authentication_event_id`),
  UNIQUE KEY `uq_esign_signature_records_verification_code` (`verification_code`),
  KEY `idx_esign_signature_records_signing_payload_sha256` (`signing_payload_sha256`),
  KEY `idx_esign_signature_records_signed_at_utc` (`signed_at_utc`),
  KEY `idx_esign_signature_records_created_at` (`created_at`),
  CONSTRAINT `fk_esign_signature_records_signer` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='不可變簽署證據';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_signers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_signers` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '簽署人流水號',
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '對外顯示的 UUID v4',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
  `signer_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '簽署人類型',
  `user_id` bigint DEFAULT NULL COMMENT '員工 ID',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '正規化外部 Email',
  `empid_snapshot` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '員編快照',
  `name_snapshot` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '姓名快照',
  `department_snapshot` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '部門快照',
  `title_snapshot` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '職稱快照',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '簽署狀態',
  `signed_at` datetime(6) DEFAULT NULL COMMENT '簽署時間',
  `invitation_token_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '外部邀請 token SHA-256',
  `invitation_token_ciphertext` text COLLATE utf8mb4_unicode_ci COMMENT '待寄送外部邀請 token 的 AES-256-GCM 密文',
  `invitation_expires_at` datetime(6) DEFAULT NULL COMMENT '外部邀請到期時間',
  `invitation_delivered_at` datetime(6) DEFAULT NULL COMMENT '外部邀請寄送接受時間',
  `completion_receipt_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '外部完成收據 token SHA-256',
  `completion_receipt_expires_at` datetime(6) DEFAULT NULL COMMENT '外部完成收據到期時間',
  `rejected_at` datetime(6) DEFAULT NULL COMMENT '拒絕時間',
  `reject_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒絕原因',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_by_user_id` bigint DEFAULT NULL COMMENT '建立者員工 ID',
  `updated_by_user_id` bigint DEFAULT NULL COMMENT '更新者員工 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_signers_document_user` (`document_id`,`user_id`),
  UNIQUE KEY `uq_esign_signers_document_email` (`document_id`,`email`),
  UNIQUE KEY `uq_esign_signers_public_id` (`public_id`),
  UNIQUE KEY `uq_esign_signers_invitation_token_sha256` (`invitation_token_sha256`),
  UNIQUE KEY `uq_esign_signers_completion_receipt_sha256` (`completion_receipt_sha256`),
  KEY `idx_esign_signers_user_status_document` (`user_id`,`status`,`document_id`),
  KEY `idx_esign_signers_document_status_sort_id` (`document_id`,`status`,`sort_order`,`id`),
  KEY `idx_esign_signers_signed_at` (`signed_at`),
  KEY `idx_esign_signers_rejected_at` (`rejected_at`),
  KEY `idx_esign_signers_invitation_expires_at` (`invitation_expires_at`),
  KEY `idx_esign_signers_invitation_delivered_at` (`invitation_delivered_at`),
  KEY `idx_esign_signers_completion_receipt_expires_at` (`completion_receipt_expires_at`),
  KEY `idx_esign_signers_created_at` (`created_at`),
  KEY `idx_esign_signers_updated_at` (`updated_at`),
  KEY `idx_esign_signers_deleted_at` (`deleted_at`),
  KEY `fk_esign_signers_created_by` (`created_by_user_id`),
  KEY `fk_esign_signers_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_esign_signers_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_signers_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_signers_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_signers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_signers_identity` CHECK ((((`signer_type` = _utf8mb4'user') and (`user_id` is not null) and (`email` is null) and (`empid_snapshot` is not null) and (`invitation_token_sha256` is null) and (`invitation_token_ciphertext` is null) and (`invitation_expires_at` is null)) or ((`signer_type` = _utf8mb4'email') and (`user_id` is null) and (`email` is not null) and (`empid_snapshot` is null)))),
  CONSTRAINT `chk_esign_signers_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'signed')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件簽署人';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_verification_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_verification_records` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '驗證紀錄流水號',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '公開驗證 UUID',
  `manifest_json` json NOT NULL COMMENT '驗證 manifest',
  `manifest_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'manifest SHA-256',
  `final_pdf_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '最終 PDF SHA-256',
  `audit_root_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '稽核鏈 root hash',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'valid' COMMENT '驗證狀態',
  `issued_at` datetime(6) NOT NULL COMMENT '核發時間',
  `revoked_at` datetime(6) DEFAULT NULL COMMENT '撤銷時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_verification_records_document_id` (`document_id`),
  UNIQUE KEY `uq_esign_verification_records_public_id` (`public_id`),
  KEY `idx_esign_verification_records_manifest_sha256` (`manifest_sha256`),
  KEY `idx_esign_verification_records_final_pdf_sha256` (`final_pdf_sha256`),
  KEY `idx_esign_verification_records_status` (`status`),
  KEY `idx_esign_verification_records_issued_at` (`issued_at`),
  KEY `idx_esign_verification_records_revoked_at` (`revoked_at`),
  KEY `idx_esign_verification_records_created_at` (`created_at`),
  CONSTRAINT `fk_esign_verification_records_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公開驗證證據';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `hr_departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_departments` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '部門流水號',
  `department_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '部門名稱',
  `parent_id` bigint DEFAULT NULL COMMENT '上層部門 ID',
  `start_date` date DEFAULT NULL COMMENT '生效日',
  `stop_date` date DEFAULT NULL COMMENT '停用日',
  `created_by_user_id` bigint DEFAULT NULL COMMENT '建立者員工 ID',
  `updated_by_user_id` bigint DEFAULT NULL COMMENT '更新者員工 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  KEY `idx_hr_departments_parent_id` (`parent_id`),
  KEY `idx_hr_departments_start_date` (`start_date`),
  KEY `idx_hr_departments_stop_date` (`stop_date`),
  KEY `idx_hr_departments_created_at` (`created_at`),
  KEY `idx_hr_departments_updated_at` (`updated_at`),
  KEY `idx_hr_departments_deleted_at` (`deleted_at`),
  KEY `fk_hr_departments_created_by_user` (`created_by_user_id`),
  KEY `fk_hr_departments_updated_by_user` (`updated_by_user_id`),
  CONSTRAINT `fk_hr_departments_created_by_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hr_departments_parent` FOREIGN KEY (`parent_id`) REFERENCES `hr_departments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hr_departments_updated_by_user` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='組織部門';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '員工流水號',
  `empid` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '公司員工編號',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '員工姓名',
  `person_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上游人員狀態',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否可登入',
  `department_id` bigint DEFAULT NULL COMMENT '所屬部門 ID',
  `department_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '部門名稱顯示值',
  `title_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目前職稱',
  `last_login_at` datetime(6) DEFAULT NULL COMMENT '最近登入時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_empid` (`empid`),
  KEY `idx_users_person_status` (`person_status`),
  KEY `idx_users_is_active` (`is_active`),
  KEY `idx_users_department_id` (`department_id`),
  KEY `idx_users_last_login_at` (`last_login_at`),
  KEY `idx_users_created_at` (`created_at`),
  KEY `idx_users_updated_at` (`updated_at`),
  KEY `idx_users_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_users_department` FOREIGN KEY (`department_id`) REFERENCES `hr_departments` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='員工與登入主體';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
