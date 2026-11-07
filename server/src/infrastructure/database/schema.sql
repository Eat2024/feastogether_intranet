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
DROP TABLE IF EXISTS `auth_security_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_security_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '事件流水號',
  `event_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件種類',
  `actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作身分類型',
  `actor_user_id` bigint DEFAULT NULL COMMENT '員工 ID（僅員工事件）',
  `session_id` bigint unsigned DEFAULT NULL COMMENT '關聯會話 ID',
  `outcome_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '白名單結果碼',
  `credential_generation` bigint unsigned DEFAULT NULL COMMENT '相關帳密啟用版本',
  `entry_generation` bigint unsigned DEFAULT NULL COMMENT '相關入口輪換版本',
  `request_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '請求追蹤 ID',
  `occurred_at` datetime(6) NOT NULL COMMENT '事件發生時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  KEY `idx_auth_security_events_occurred_at` (`occurred_at`),
  KEY `idx_auth_security_events_created_at` (`created_at`),
  KEY `fk_auth_security_events_actor_user` (`actor_user_id`),
  KEY `fk_auth_security_events_session` (`session_id`),
  CONSTRAINT `fk_auth_security_events_actor_user` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_auth_security_events_session` FOREIGN KEY (`session_id`) REFERENCES `auth_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_auth_security_events_actor_kind` CHECK ((`actor_kind` in (_utf8mb4'employee',_utf8mb4'super_user',_utf8mb4'operator',_utf8mb4'system',_utf8mb4'anonymous'))),
  CONSTRAINT `chk_auth_security_events_actor_user` CHECK ((((`actor_kind` = _utf8mb4'employee') and (`actor_user_id` is not null)) or ((`actor_kind` <> _utf8mb4'employee') and (`actor_user_id` is null)))),
  CONSTRAINT `chk_auth_security_events_event_type` CHECK ((`event_type` in (_utf8mb4'login.succeeded',_utf8mb4'login.rejected',_utf8mb4'session.replaced',_utf8mb4'session.revoked',_utf8mb4'credentials.activated',_utf8mb4'entry.initialized',_utf8mb4'entry.rotated')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登入與維護安全事件（append-only）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `auth_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '認證流程流水號',
  `actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee' COMMENT '操作者類型',
  `user_id` bigint DEFAULT NULL COMMENT '員工 ID',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '認證來源',
  `credential_generation` bigint unsigned DEFAULT NULL COMMENT 'Super user 帳密啟用版本',
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
  `replacement_session_id` bigint unsigned DEFAULT NULL COMMENT '取代本會話的新會話 ID',
  `failure_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失敗分類',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_sessions_source_jti_hash` (`source_jti_hash`),
  UNIQUE KEY `uq_auth_sessions_launch_code_hash` (`launch_code_hash`),
  UNIQUE KEY `uq_auth_sessions_session_token_hash` (`session_token_hash`),
  UNIQUE KEY `uq_auth_sessions_replacement_session_id` (`replacement_session_id`),
  KEY `idx_auth_sessions_status_launch_expires_at` (`status`,`launch_expires_at`),
  KEY `idx_auth_sessions_status_expires_at` (`status`,`expires_at`),
  KEY `idx_auth_sessions_user_created_at` (`user_id`,`created_at`),
  KEY `idx_auth_sessions_deleted_at` (`deleted_at`),
  KEY `idx_auth_sessions_actor_generation_status` (`actor_kind`,`credential_generation`,`status`),
  CONSTRAINT `fk_auth_sessions_replacement` FOREIGN KEY (`replacement_session_id`) REFERENCES `auth_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_auth_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_auth_sessions_active_session` CHECK (((`status` <> _utf8mb4'active') or ((`session_token_hash` is not null) and (`activated_at` is not null) and (`expires_at` is not null)))),
  CONSTRAINT `chk_auth_sessions_actor` CHECK ((((`actor_kind` = _utf8mb4'employee') and (`credential_generation` is null) and (`source` in (_utf8mb4'webview',_utf8mb4'oauth')) and ((`status` in (_utf8mb4'validating',_utf8mb4'failed')) or (`user_id` is not null))) or ((`actor_kind` = _utf8mb4'super_user') and (`user_id` is null) and (`credential_generation` is not null) and (`source` = _utf8mb4'super_user') and (`status` not in (_utf8mb4'validating',_utf8mb4'pending'))))),
  CONSTRAINT `chk_auth_sessions_status` CHECK ((`status` in (_utf8mb4'validating',_utf8mb4'pending',_utf8mb4'active',_utf8mb4'failed',_utf8mb4'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WebView 啟動與員工登入 Session';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `authorization_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `authorization_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '識別碼',
  `occurred_at` datetime(6) NOT NULL COMMENT '事件時間',
  `actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作者種類',
  `source` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作來源',
  `module_key` varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
  `event_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件種類',
  `target_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '目標種類',
  `target_id` bigint DEFAULT NULL COMMENT '目標 ID',
  `request_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '請求追蹤 ID',
  `before_json` json DEFAULT NULL COMMENT '異動前白名單內容',
  `after_json` json DEFAULT NULL COMMENT '異動後白名單內容',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (`id`),
  KEY `idx_authorization_events_created_at` (`created_at`),
  KEY `idx_authorization_events_occurred_at` (`occurred_at`),
  CONSTRAINT `chk_authorization_events_actor_kind` CHECK ((`actor_kind` in (_utf8mb4'super_user',_utf8mb4'operator',_utf8mb4'system'))),
  CONSTRAINT `chk_authorization_events_source` CHECK ((`source` in (_utf8mb4'http',_utf8mb4'repl',_utf8mb4'migration'))),
  CONSTRAINT `chk_authorization_events_target_kind` CHECK ((`target_kind` in (_utf8mb4'role',_utf8mb4'user',_utf8mb4'catalog')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='授權異動紀錄（append-only）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `authorization_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `authorization_permissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '識別碼',
  `module_key` varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
  `permission_key` varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '權限代碼',
  `permission_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '權限名稱',
  `assignable` tinyint(1) NOT NULL COMMENT '可否指派',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_authorization_permissions_key` (`permission_key`),
  UNIQUE KEY `uq_authorization_permissions_scope` (`module_key`,`id`),
  KEY `idx_authorization_permissions_created_at` (`created_at`),
  KEY `idx_authorization_permissions_updated_at` (`updated_at`),
  KEY `idx_authorization_permissions_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='權限目錄';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `authorization_role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `authorization_role_permissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '識別碼',
  `module_key` varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
  `role_id` bigint unsigned NOT NULL COMMENT '角色 ID',
  `permission_id` bigint unsigned NOT NULL COMMENT '權限 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_authorization_role_permissions_pair` (`role_id`,`permission_id`),
  KEY `idx_authorization_role_permissions_created_at` (`created_at`),
  KEY `idx_authorization_role_permissions_updated_at` (`updated_at`),
  KEY `idx_authorization_role_permissions_deleted_at` (`deleted_at`),
  KEY `fk_authorization_role_permissions_role_scope` (`module_key`,`role_id`),
  KEY `fk_authorization_role_permissions_permission_scope` (`module_key`,`permission_id`),
  CONSTRAINT `fk_authorization_role_permissions_permission_scope` FOREIGN KEY (`module_key`, `permission_id`) REFERENCES `authorization_permissions` (`module_key`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_authorization_role_permissions_role_scope` FOREIGN KEY (`module_key`, `role_id`) REFERENCES `authorization_roles` (`module_key`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色權限關聯';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `authorization_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `authorization_roles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '識別碼',
  `module_key` varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
  `role_code` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '穩定角色代碼',
  `role_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '角色名稱',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否啟用',
  `is_protected` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否受保護',
  `version` int unsigned NOT NULL DEFAULT '1' COMMENT '設定版本',
  `active_role_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin GENERATED ALWAYS AS ((case when (`deleted_at` is null) then `role_name` else NULL end)) VIRTUAL COMMENT '未刪除角色名稱',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_authorization_roles_code` (`module_key`,`role_code`),
  UNIQUE KEY `uq_authorization_roles_scope` (`module_key`,`id`),
  UNIQUE KEY `uq_authorization_roles_name` (`module_key`,`active_role_name`),
  KEY `idx_authorization_roles_created_at` (`created_at`),
  KEY `idx_authorization_roles_updated_at` (`updated_at`),
  KEY `idx_authorization_roles_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `authorization_user_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `authorization_user_roles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '識別碼',
  `user_id` bigint NOT NULL COMMENT '員工 ID',
  `module_key` varchar(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
  `role_id` bigint unsigned NOT NULL COMMENT '角色 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_authorization_user_roles_pair` (`user_id`,`role_id`),
  KEY `idx_authorization_user_roles_created_at` (`created_at`),
  KEY `idx_authorization_user_roles_updated_at` (`updated_at`),
  KEY `idx_authorization_user_roles_deleted_at` (`deleted_at`),
  KEY `idx_authorization_user_roles_user_scope` (`user_id`,`module_key`,`deleted_at`),
  KEY `fk_authorization_user_roles_role_scope` (`module_key`,`role_id`),
  CONSTRAINT `fk_authorization_user_roles_role_scope` FOREIGN KEY (`module_key`, `role_id`) REFERENCES `authorization_roles` (`module_key`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_authorization_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='員工角色關聯';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_document_fields`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_document_fields` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '欄位流水號',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
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
  `created_by_actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system' COMMENT '建立操作者種類',
  `updated_by_actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system' COMMENT '更新操作者種類',
  PRIMARY KEY (`id`),
  KEY `idx_esign_document_fields_doc_page_sort_id` (`document_id`,`page_number`,`sort_order`,`id`),
  KEY `idx_esign_document_fields_created_at` (`created_at`),
  KEY `idx_esign_document_fields_updated_at` (`updated_at`),
  KEY `idx_esign_document_fields_deleted_at` (`deleted_at`),
  KEY `fk_esign_document_fields_created_by` (`created_by_user_id`),
  KEY `fk_esign_document_fields_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_esign_document_fields_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_document_fields_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_document_fields_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_document_fields_bounds` CHECK (((`x_percent` >= 0) and (`x_percent` < 100) and (`y_percent` >= 0) and (`y_percent` < 100) and (`width_percent` > 0) and (`height_percent` > 0) and ((`x_percent` + `width_percent`) <= 100) and ((`y_percent` + `height_percent`) <= 100))),
  CONSTRAINT `chk_esign_document_fields_created_actor` CHECK ((((`created_by_actor_kind` = _utf8mb4'employee') and (`created_by_user_id` is not null)) or ((`created_by_actor_kind` in (_utf8mb4'super_user',_utf8mb4'system',_utf8mb4'legacy_unknown')) and (`created_by_user_id` is null)))),
  CONSTRAINT `chk_esign_document_fields_page` CHECK ((`page_number` >= 1)),
  CONSTRAINT `chk_esign_document_fields_type` CHECK ((`field_type` in (_utf8mb4'signature',_utf8mb4'date'))),
  CONSTRAINT `chk_esign_document_fields_updated_actor` CHECK ((((`updated_by_actor_kind` = _utf8mb4'employee') and (`updated_by_user_id` is not null)) or ((`updated_by_actor_kind` in (_utf8mb4'super_user',_utf8mb4'system',_utf8mb4'legacy_unknown')) and (`updated_by_user_id` is null))))
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
  `created_by_user_id` bigint DEFAULT NULL COMMENT '建立人 ID',
  `sign_start_at` datetime(6) DEFAULT NULL COMMENT '簽署開始時間',
  `sign_end_at` datetime(6) DEFAULT NULL COMMENT '簽署截止時間',
  `signing_payload_json` json DEFAULT NULL COMMENT '固定簽署 payload',
  `signing_payload_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '簽署 payload SHA-256',
  `initiated_at` datetime(6) DEFAULT NULL COMMENT '發起時間',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '完成時間',
  `stopped_at` datetime(6) DEFAULT NULL COMMENT '停止時間',
  `stop_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '停止原因',
  `watermark_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否添加浮水印',
  `allow_reject` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否允許拒絕簽署',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  `created_by_department_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL COMMENT '建立時部門代碼快照',
  `created_by_department_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '建立時部門名稱快照',
  `created_by_actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee' COMMENT '建立操作者種類',
  `updated_by_actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最後管理操作者種類',
  `updated_by_user_id` bigint DEFAULT NULL COMMENT '最後管理員工 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_documents_doc_number` (`doc_number`),
  KEY `idx_esign_documents_creator_status_updated_id` (`created_by_user_id`,`status`,`updated_at`,`id`),
  KEY `idx_esign_documents_sign_start_at` (`sign_start_at`),
  KEY `idx_esign_documents_sign_end_at` (`sign_end_at`),
  KEY `idx_esign_documents_initiated_at` (`initiated_at`),
  KEY `idx_esign_documents_completed_at` (`completed_at`),
  KEY `idx_esign_documents_stopped_at` (`stopped_at`),
  KEY `idx_esign_documents_created_at` (`created_at`),
  KEY `idx_esign_documents_updated_at` (`updated_at`),
  KEY `idx_esign_documents_deleted_at` (`deleted_at`),
  KEY `idx_esign_documents_department_deleted_updated_id` (`created_by_department_code`,`deleted_at`,`updated_at`,`id`),
  KEY `fk_esign_documents_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_esign_documents_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_documents_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_documents_created_actor` CHECK ((((`created_by_actor_kind` = _utf8mb4'employee') and (`created_by_user_id` is not null)) or ((`created_by_actor_kind` = _utf8mb4'super_user') and (`created_by_user_id` is null)))),
  CONSTRAINT `chk_esign_documents_sign_period` CHECK ((((`status` = _utf8mb4'draft') and ((`sign_start_at` is null) or (`sign_end_at` is null) or (`sign_start_at` < `sign_end_at`))) or ((`status` <> _utf8mb4'draft') and (`sign_start_at` is not null) and (`sign_end_at` is not null) and (`sign_start_at` < `sign_end_at`)))),
  CONSTRAINT `chk_esign_documents_status` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'active',_utf8mb4'expired',_utf8mb4'finalizing',_utf8mb4'completed',_utf8mb4'stopped'))),
  CONSTRAINT `chk_esign_documents_updated_actor` CHECK ((((`updated_by_actor_kind` is null) and (`updated_by_user_id` is null)) or ((`updated_by_actor_kind` is not null) and (((`updated_by_actor_kind` = _utf8mb4'employee') and (`updated_by_user_id` is not null)) or ((`updated_by_actor_kind` = _utf8mb4'super_user') and (`updated_by_user_id` is null))))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='電子簽文件';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_export_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_export_jobs` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '匯出工作流水號',
  `export_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '匯出類型',
  `document_id` bigint DEFAULT NULL COMMENT '文件 ID',
  `created_by_user_id` bigint DEFAULT NULL COMMENT '建立員工 ID，NULL 為外部簽署人本人下載',
  `signer_id` bigint DEFAULT NULL COMMENT '單人副本的簽署人',
  `conditions_json` json DEFAULT NULL COMMENT 'Excel 匯出條件',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '工作狀態',
  `scope_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '匯出範圍說明',
  `record_count` bigint unsigned DEFAULT NULL COMMENT '匯出筆數',
  `failure_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失敗錯誤碼',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '完成時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `public_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '公開工作 UUID',
  `snapshot_at` datetime(6) DEFAULT NULL COMMENT '固定快照時間',
  `snapshot_json` json DEFAULT NULL COMMENT '不可變簽署快照',
  `snapshot_sha256` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '快照 SHA-256',
  `resolved_files_json` json DEFAULT NULL COMMENT '已固定來源副本',
  `processed_count` int unsigned DEFAULT NULL COMMENT '當次處理數',
  `waiting_count` int unsigned DEFAULT NULL COMMENT '等待副本數',
  `expires_at` datetime(6) DEFAULT NULL COMMENT '成果到期時間',
  `lease_token` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '工作 generation',
  `lease_expires_at` datetime(6) DEFAULT NULL COMMENT '租約到期時間',
  `attempt_count` int unsigned DEFAULT NULL COMMENT '嘗試次數',
  `next_attempt_at` datetime(6) DEFAULT NULL COMMENT '再次排入時間',
  `staging_json` json DEFAULT NULL COMMENT '暫存成果位置',
  `download_file_name` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '首次下載提供的檔名快照，NULL 為尚未記錄',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_export_jobs_public_id` (`public_id`),
  KEY `idx_esign_export_jobs_document_id` (`document_id`),
  KEY `idx_esign_export_jobs_creator_status_created_id` (`created_by_user_id`,`status`,`created_at`,`id`),
  KEY `idx_esign_export_jobs_status` (`status`),
  KEY `idx_esign_export_jobs_created_at` (`created_at`),
  KEY `idx_esign_export_jobs_updated_at` (`updated_at`),
  KEY `idx_esign_export_jobs_completed_at` (`completed_at`),
  KEY `idx_esign_exports_reuse` (`document_id`,`export_type`,`status`,`expires_at`,`id`),
  KEY `idx_esign_exports_retry` (`status`,`next_attempt_at`,`id`),
  KEY `idx_esign_export_jobs_lease_expires_at` (`lease_expires_at`),
  KEY `idx_esign_export_jobs_snapshot_at` (`snapshot_at`),
  KEY `idx_esign_export_jobs_expires_at` (`expires_at`),
  KEY `idx_esign_export_jobs_next_attempt_at` (`next_attempt_at`),
  KEY `idx_esign_export_jobs_type_created` (`export_type`,`created_at`,`id`),
  KEY `idx_esign_export_jobs_document_type_created` (`document_id`,`export_type`,`created_at`,`id`),
  KEY `idx_esign_export_jobs_signer_created` (`signer_id`,`created_at`,`id`),
  CONSTRAINT `fk_esign_export_jobs_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_export_jobs_signer` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_export_jobs_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_export_jobs_record_type` CHECK ((((`export_type` <> _utf8mb4'excel') or ((`conditions_json` is not null) and (`created_by_user_id` is not null) and (`signer_id` is null))) and ((`export_type` <> _utf8mb4'pdf') or ((`signer_id` is not null) and (`conditions_json` is null))) and ((`export_type` in (_utf8mb4'excel',_utf8mb4'pdf')) or ((`created_by_user_id` is not null) and (`signer_id` is null) and (`conditions_json` is null)))))
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
  `completed_signature_record_id` bigint GENERATED ALWAYS AS ((case when (`file_purpose` = _utf8mb4'completed_pdf') then `signature_record_id` else NULL end)) VIRTUAL COMMENT '個人完成檔唯一簽署證據 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_file_objects_object_key` (`object_key`),
  UNIQUE KEY `uq_esign_file_objects_document_purpose` (`document_id`,`file_purpose`),
  UNIQUE KEY `uq_esign_file_objects_signature_field_purpose` (`signature_record_id`,`document_field_id`,`file_purpose`),
  UNIQUE KEY `uq_esign_files_export_purpose` (`export_job_id`,`file_purpose`),
  UNIQUE KEY `uq_esign_file_objects_completed_signature` (`completed_signature_record_id`),
  KEY `idx_esign_file_objects_document_id` (`document_id`),
  KEY `idx_esign_file_objects_signature_record_id` (`signature_record_id`),
  KEY `idx_esign_file_objects_verification_record_id` (`verification_record_id`),
  KEY `idx_esign_file_objects_export_job_id` (`export_job_id`),
  KEY `idx_esign_file_objects_file_purpose` (`file_purpose`),
  KEY `idx_esign_file_objects_sha256` (`sha256`),
  KEY `idx_esign_file_objects_archive_status` (`archive_status`),
  KEY `idx_esign_file_objects_created_at` (`created_at`),
  KEY `idx_esign_file_objects_document_field_id` (`document_field_id`),
  CONSTRAINT `fk_esign_file_objects_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_document_field` FOREIGN KEY (`document_field_id`) REFERENCES `esign_document_fields` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_export` FOREIGN KEY (`export_job_id`) REFERENCES `esign_export_jobs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_signature` FOREIGN KEY (`signature_record_id`) REFERENCES `esign_signature_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_file_objects_verification` FOREIGN KEY (`verification_record_id`) REFERENCES `esign_verification_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_file_objects_completed_owner` CHECK (((`file_purpose` <> _utf8mb4'completed_pdf') or ((((`document_id` is not null) and (`signature_record_id` is null)) or ((`document_id` is null) and (`signature_record_id` is not null))) and (`document_field_id` is null) and (`verification_record_id` is null) and (`export_job_id` is null)))),
  CONSTRAINT `chk_esign_file_objects_owner` CHECK (((`document_id` is not null) or (`signature_record_id` is not null) or (`verification_record_id` is not null) or (`export_job_id` is not null))),
  CONSTRAINT `chk_esign_file_objects_signature_field` CHECK ((((`file_purpose` = _utf8mb4'signature_png') and (`signature_record_id` is not null) and (`document_field_id` is not null)) or ((`file_purpose` <> _utf8mb4'signature_png') and (`document_field_id` is null)))),
  CONSTRAINT `chk_esign_file_objects_source_owner` CHECK (((`file_purpose` <> _utf8mb4'source_pdf') or ((`document_id` is not null) and (`signature_record_id` is null) and (`document_field_id` is null) and (`verification_record_id` is null) and (`export_job_id` is null)))),
  CONSTRAINT `chk_esign_files_export_owner` CHECK (((`file_purpose` <> _utf8mb4'signed_copies_zip') or ((`export_job_id` is not null) and (`document_id` is null) and (`signature_record_id` is null) and (`verification_record_id` is null) and (`mime_type` = _utf8mb4'application/zip'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私有物件儲存 metadata';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `esign_initiation_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `esign_initiation_jobs` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '工作流水號',
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '工作公開 UUID',
  `document_id` bigint NOT NULL COMMENT '文件 ID',
  `created_by_user_id` bigint NOT NULL COMMENT '原發起者 ID',
  `request_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '冪等請求 UUID',
  `request_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '正規化請求 SHA256',
  `parent_job_id` bigint DEFAULT NULL COMMENT '人工重試來源工作 ID',
  `input_json` json DEFAULT NULL COMMENT '本次確認的完整輸入',
  `document_version_json` json DEFAULT NULL COMMENT '受理時文件與原檔版本',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued' COMMENT '工作狀態',
  `stage` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued' COMMENT '工作階段',
  `total_count` int NOT NULL COMMENT '本次名單總人數',
  `processed_count` int NOT NULL DEFAULT '0' COMMENT '本輪已查核人數',
  `attempt_count` int NOT NULL DEFAULT '0' COMMENT '已取得執行權次數',
  `next_attempt_at` datetime(6) DEFAULT NULL COMMENT '下次允許執行時間',
  `lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '本輪租約 UUID',
  `lease_expires_at` datetime(6) DEFAULT NULL COMMENT '本輪租約截止時間',
  `accepted_at` datetime(6) NOT NULL COMMENT '可靠受理時間',
  `deadline_at` datetime(6) NOT NULL COMMENT '整份工作的最晚提交時間',
  `last_progress_at` datetime(6) DEFAULT NULL COMMENT '最新進度時間',
  `started_at` datetime(6) DEFAULT NULL COMMENT '首次執行時間',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '終態時間',
  `error_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '穩定分類錯誤碼',
  `retryable` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否可人工重試',
  `issue_count` int NOT NULL DEFAULT '0' COMMENT '人員問題總數',
  `issues_json` json DEFAULT NULL COMMENT '人員問題分類清單',
  `input_purged_at` datetime(6) DEFAULT NULL COMMENT '終態敏感明細清理時間',
  `active_document_id` bigint GENERATED ALWAYS AS ((case when (`status` in (_utf8mb4'queued',_utf8mb4'processing')) then `document_id` else NULL end)) STORED COMMENT '每份文件唯一非終態工作',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_initiation_jobs_public` (`public_id`),
  UNIQUE KEY `uq_esign_initiation_jobs_request` (`document_id`,`request_key`),
  UNIQUE KEY `uq_esign_initiation_jobs_active` (`active_document_id`),
  KEY `idx_esign_initiation_jobs_document` (`document_id`,`id`),
  KEY `idx_esign_initiation_jobs_retry` (`status`,`next_attempt_at`,`id`),
  KEY `idx_esign_initiation_jobs_lease` (`status`,`lease_expires_at`,`id`),
  KEY `idx_esign_initiation_jobs_completed` (`status`,`completed_at`,`id`),
  KEY `fk_esign_initiation_jobs_creator` (`created_by_user_id`),
  KEY `fk_esign_initiation_jobs_parent` (`parent_job_id`),
  CONSTRAINT `fk_esign_initiation_jobs_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_initiation_jobs_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_initiation_jobs_parent` FOREIGN KEY (`parent_job_id`) REFERENCES `esign_initiation_jobs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_initiation_jobs_completion` CHECK ((((`status` in (_utf8mb4'queued',_utf8mb4'processing')) and (`completed_at` is null)) or ((`status` in (_utf8mb4'succeeded',_utf8mb4'failed')) and (`completed_at` is not null)))),
  CONSTRAINT `chk_esign_initiation_jobs_counts` CHECK (((`total_count` > 0) and (`processed_count` >= 0) and (`processed_count` <= `total_count`) and (`attempt_count` between 0 and 3) and (`issue_count` >= 0))),
  CONSTRAINT `chk_esign_initiation_jobs_deadline` CHECK ((`deadline_at` > `accepted_at`)),
  CONSTRAINT `chk_esign_initiation_jobs_input` CHECK (((`status` not in (_utf8mb4'queued',_utf8mb4'processing')) or ((`input_json` is not null) and (`document_version_json` is not null) and (`input_purged_at` is null)))),
  CONSTRAINT `chk_esign_initiation_jobs_lease` CHECK ((((`status` = _utf8mb4'processing') and (`lease_token` is not null) and (`lease_expires_at` is not null)) or ((`status` <> _utf8mb4'processing') and (`lease_token` is null) and (`lease_expires_at` is null)))),
  CONSTRAINT `chk_esign_initiation_jobs_result` CHECK ((((`status` = _utf8mb4'succeeded') and (`stage` = _utf8mb4'completed') and (`error_code` is null)) or ((`status` = _utf8mb4'failed') and (`stage` = _utf8mb4'failed') and (`error_code` is not null)) or ((`status` = _utf8mb4'queued') and (`stage` = _utf8mb4'queued')) or ((`status` = _utf8mb4'processing') and (`stage` in (_utf8mb4'resolving',_utf8mb4'validating',_utf8mb4'committing'))))),
  CONSTRAINT `chk_esign_initiation_jobs_stage` CHECK ((`stage` in (_utf8mb4'queued',_utf8mb4'resolving',_utf8mb4'validating',_utf8mb4'committing',_utf8mb4'completed',_utf8mb4'failed'))),
  CONSTRAINT `chk_esign_initiation_jobs_status` CHECK ((`status` in (_utf8mb4'queued',_utf8mb4'processing',_utf8mb4'succeeded',_utf8mb4'failed')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='背景發起簽署工作';
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
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (uuid()) COMMENT '通知批次公開 UUID',
  `kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'invitation' COMMENT '初邀或催簽',
  `request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '催簽請求 UUID',
  `request_payload_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '正規化請求雜湊',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_notification_batches_public_id` (`public_id`),
  UNIQUE KEY `uq_esign_notification_batches_request` (`document_id`,`notified_by_user_id`,`request_id`),
  KEY `idx_esign_notification_batches_document_id` (`document_id`),
  KEY `idx_esign_notification_batches_created_at` (`created_at`),
  KEY `fk_esign_notification_batches_user` (`notified_by_user_id`),
  CONSTRAINT `fk_esign_notification_batches_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_notification_batches_user` FOREIGN KEY (`notified_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_notification_batches_kind` CHECK ((`kind` in (_utf8mb4'invitation',_utf8mb4'reminder')))
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
  `dispatch_date` date DEFAULT NULL COMMENT '台北寄送曆日',
  `lease_token` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '寄送租約 UUID',
  `attempt_history_json` json DEFAULT NULL COMMENT '有限次投遞狀態歷史，不含憑證',
  `reminder_token_sha256` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '催簽憑證雜湊',
  `reminder_token_ciphertext` text COLLATE utf8mb4_unicode_ci COMMENT '催簽憑證密文',
  `invitation_generation_sha256` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '建立時邀請世代雜湊',
  `reminder_expires_at` datetime(6) DEFAULT NULL COMMENT '待簽催簽憑證期限',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_notification_logs_batch_signer_channel` (`batch_id`,`signer_id`,`channel`),
  UNIQUE KEY `uq_esign_notification_logs_reminder_token` (`reminder_token_sha256`),
  KEY `idx_esign_notification_logs_batch_id` (`batch_id`),
  KEY `idx_esign_notification_logs_signer_id` (`signer_id`),
  KEY `idx_esign_notification_logs_result` (`result`),
  KEY `idx_esign_notification_logs_created_at` (`created_at`),
  KEY `idx_esign_notification_logs_completed_at` (`completed_at`),
  KEY `idx_esign_notification_logs_next_attempt_at` (`next_attempt_at`),
  KEY `idx_esign_notification_logs_processing_started_at` (`processing_started_at`),
  KEY `idx_esign_notification_logs_result_next_attempt_id` (`result`,`next_attempt_at`,`id`),
  KEY `idx_esign_notification_logs_dispatch_date` (`dispatch_date`),
  KEY `idx_esign_notification_logs_reminder_expires_at` (`reminder_expires_at`),
  KEY `idx_esign_notification_logs_signer_result_date` (`signer_id`,`result`,`dispatch_date`),
  CONSTRAINT `fk_esign_notification_logs_batch` FOREIGN KEY (`batch_id`) REFERENCES `esign_notification_batches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_notification_logs_signer` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_notification_logs_channel` CHECK ((`channel` = _utf8mb4'email')),
  CONSTRAINT `chk_esign_notification_logs_result` CHECK ((`result` in (_utf8mb4'pending',_utf8mb4'processing',_utf8mb4'delivered',_utf8mb4'failed',_utf8mb4'skipped',_utf8mb4'unknown')))
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
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '固定通知 Email',
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
  `rejected_at` datetime(6) DEFAULT NULL COMMENT '拒絕時間',
  `reject_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒絕原因',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_by_user_id` bigint DEFAULT NULL COMMENT '建立者員工 ID',
  `updated_by_user_id` bigint DEFAULT NULL COMMENT '更新者員工 ID',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  `completion_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '個人副本產製狀態',
  `completion_lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '個人副本 worker lease UUID',
  `completion_lease_expires_at` datetime(6) DEFAULT NULL COMMENT '個人副本 worker lease 到期時間',
  `completion_ready_at` datetime(6) DEFAULT NULL COMMENT '個人副本完成時間',
  `reject_request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '拒簽冪等請求 UUID',
  `note` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '建立人管理備註，不屬簽署證據',
  `external_email` varchar(255) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS ((case when (`signer_type` = _utf8mb4'email') then `email` else NULL end)) STORED COMMENT '外部地址唯一性衍生欄位',
  `created_by_actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system' COMMENT '建立操作者種類',
  `updated_by_actor_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system' COMMENT '更新操作者種類',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esign_signers_public_id` (`public_id`),
  UNIQUE KEY `uq_esign_signers_document_user` (`document_id`,`user_id`),
  UNIQUE KEY `uq_esign_signers_invitation_token_sha256` (`invitation_token_sha256`),
  UNIQUE KEY `uq_esign_signers_document_external_email` (`document_id`,`external_email`),
  KEY `idx_esign_signers_user_status_document` (`user_id`,`status`,`document_id`),
  KEY `idx_esign_signers_document_status_sort_id` (`document_id`,`status`,`sort_order`,`id`),
  KEY `idx_esign_signers_signed_at` (`signed_at`),
  KEY `idx_esign_signers_rejected_at` (`rejected_at`),
  KEY `idx_esign_signers_created_at` (`created_at`),
  KEY `idx_esign_signers_updated_at` (`updated_at`),
  KEY `idx_esign_signers_deleted_at` (`deleted_at`),
  KEY `fk_esign_signers_created_by` (`created_by_user_id`),
  KEY `fk_esign_signers_updated_by` (`updated_by_user_id`),
  KEY `idx_esign_signers_invitation_expires_at` (`invitation_expires_at`),
  KEY `idx_esign_signers_invitation_delivered_at` (`invitation_delivered_at`),
  KEY `idx_esign_signers_completion_lease_expires_at` (`completion_lease_expires_at`),
  KEY `idx_esign_signers_completion_ready_at` (`completion_ready_at`),
  KEY `idx_esign_signers_completion_status_id` (`completion_status`,`id`),
  CONSTRAINT `fk_esign_signers_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_signers_document` FOREIGN KEY (`document_id`) REFERENCES `esign_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_signers_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_esign_signers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_esign_signers_completion` CHECK ((((`status` in (_utf8mb4'pending',_utf8mb4'rejected')) and (`completion_status` is null) and (`completion_lease_token` is null) and (`completion_lease_expires_at` is null) and (`completion_ready_at` is null)) or ((`status` = _utf8mb4'signed') and (`completion_status` is not null) and (((`completion_status` in (_utf8mb4'pending',_utf8mb4'failed')) and (`completion_lease_token` is null) and (`completion_lease_expires_at` is null) and (`completion_ready_at` is null)) or ((`completion_status` = _utf8mb4'processing') and (`completion_lease_token` is not null) and (`completion_lease_expires_at` is not null) and (`completion_ready_at` is null)) or ((`completion_status` = _utf8mb4'ready') and (`completion_lease_token` is null) and (`completion_lease_expires_at` is null) and (`completion_ready_at` is not null)))))),
  CONSTRAINT `chk_esign_signers_created_actor` CHECK ((((`created_by_actor_kind` = _utf8mb4'employee') and (`created_by_user_id` is not null)) or ((`created_by_actor_kind` in (_utf8mb4'super_user',_utf8mb4'system',_utf8mb4'legacy_unknown')) and (`created_by_user_id` is null)))),
  CONSTRAINT `chk_esign_signers_identity` CHECK ((((`signer_type` = _utf8mb4'user') and (`user_id` is not null) and (`empid_snapshot` is not null)) or ((`signer_type` = _utf8mb4'email') and (`user_id` is null) and (`email` is not null) and (`empid_snapshot` is null)))),
  CONSTRAINT `chk_esign_signers_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'signed',_utf8mb4'rejected'))),
  CONSTRAINT `chk_esign_signers_terminal_times` CHECK ((((`signed_at` is null) or (`rejected_at` is null)) and ((`status` <> _utf8mb4'rejected') or ((`rejected_at` is not null) and (`reject_request_id` is not null) and (`reject_reason` is not null))))),
  CONSTRAINT `chk_esign_signers_updated_actor` CHECK ((((`updated_by_actor_kind` = _utf8mb4'employee') and (`updated_by_user_id` is not null)) or ((`updated_by_actor_kind` in (_utf8mb4'super_user',_utf8mb4'system',_utf8mb4'legacy_unknown')) and (`updated_by_user_id` is null))))
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
  `final_pdf_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '最終 PDF SHA-256',
  `audit_root_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '停用前稽核鏈 root hash（僅歷史參考）',
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
DROP TABLE IF EXISTS `mail_recipient_whitelist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mail_recipient_whitelist` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '白名單規則流水號',
  `type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '規則類型：department 部門、employee 員工、email 收件信箱',
  `value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '完整部門代碼、員編或小寫收件信箱',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '維護備註',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mail_recipient_whitelist_type_value` (`type`,`value`),
  CONSTRAINT `chk_mail_recipient_whitelist_type` CHECK ((`type` in (_utf8mb4'department',_utf8mb4'employee',_utf8mb4'email'))),
  CONSTRAINT `chk_mail_recipient_whitelist_value` CHECK ((((`type` = _utf8mb4'department') and (char_length(`value`) between 1 and 50) and (not(regexp_like(`value`,_utf8mb4'[^A-Za-z0-9_-]',_utf8mb4'c')))) or ((`type` = _utf8mb4'employee') and (char_length(`value`) between 1 and 20) and (not(regexp_like(`value`,_utf8mb4'[^A-Za-z0-9]',_utf8mb4'c')))) or ((`type` = _utf8mb4'email') and (`value` = lower(`value`)) and regexp_like(`value`,_utf8mb4'^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\\z',_utf8mb4'c'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='非正式環境寄信收件人白名單';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `super_user_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `super_user_access` (
  `id` tinyint unsigned NOT NULL COMMENT '固定單列識別（恆為 1，不是員工 ID）',
  `entry_key` char(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '目前隱藏入口識別（base64url）',
  `entry_generation` bigint unsigned NOT NULL COMMENT '入口輪換版本',
  `rotated_at` datetime(6) NOT NULL COMMENT '目前入口生效時間',
  `period_start_at` datetime(6) NOT NULL COMMENT '最近已處理的輪換週期起點',
  `active_credential_fingerprint` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '目前啟用的帳密設定指紋',
  `credential_generation` bigint unsigned NOT NULL COMMENT '帳密啟用版本',
  `credential_activated_at` datetime(6) NOT NULL COMMENT '帳密啟用時間',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '軟刪除時間',
  PRIMARY KEY (`id`),
  KEY `idx_super_user_access_rotated_at` (`rotated_at`),
  KEY `idx_super_user_access_period_start_at` (`period_start_at`),
  KEY `idx_super_user_access_credential_activated_at` (`credential_activated_at`),
  KEY `idx_super_user_access_created_at` (`created_at`),
  KEY `idx_super_user_access_updated_at` (`updated_at`),
  KEY `idx_super_user_access_deleted_at` (`deleted_at`),
  CONSTRAINT `chk_super_user_access_credential_generation` CHECK ((`credential_generation` >= 1)),
  CONSTRAINT `chk_super_user_access_entry_generation` CHECK ((`entry_generation` >= 1)),
  CONSTRAINT `chk_super_user_access_singleton` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Super user 維護入口與帳密啟用版本（單列）';
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
  `department_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL COMMENT '可信上游部門代碼',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Portal 匯入的員工通知信箱',
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
