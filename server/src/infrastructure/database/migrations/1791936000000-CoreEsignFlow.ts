import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Spec 03 只擴充既有電子簽資料表，不建立新 table。
 */
export class CoreEsignFlow1791936000000 implements MigrationInterface {
  name = 'CoreEsignFlow1791936000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`esign_documents\`
      ADD COLUMN \`finalization_lease_token\` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '完成檔案 worker lease UUID' AFTER \`stop_reason\`,
      ADD COLUMN \`finalization_lease_expires_at\` DATETIME(6) NULL COMMENT '完成檔案 worker lease 到期時間' AFTER \`finalization_lease_token\`,
      ALTER COLUMN \`allow_reject\` SET DEFAULT 0,
      ADD KEY \`idx_esign_documents_finalization_lease_expires_at\` (\`finalization_lease_expires_at\`),
      ADD CONSTRAINT \`chk_esign_documents_status\` CHECK (\`status\` IN ('draft','active','finalizing','completed','stopped')),
      ADD CONSTRAINT \`chk_esign_documents_sign_period\` CHECK ((\`sign_start_at\` IS NULL AND \`sign_end_at\` IS NULL) OR (\`sign_start_at\` IS NOT NULL AND \`sign_end_at\` IS NOT NULL AND \`sign_start_at\` < \`sign_end_at\`))`);

    await queryRunner.query(`ALTER TABLE \`esign_signers\`
      ADD COLUMN \`public_id\` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '對外顯示的 UUID v4' AFTER \`id\`,
      ADD COLUMN \`invitation_token_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部邀請 token SHA-256' AFTER \`signed_at\`,
      ADD COLUMN \`invitation_token_ciphertext\` TEXT NULL COMMENT '待寄送外部邀請 token 的 AES-256-GCM 密文' AFTER \`invitation_token_sha256\`,
      ADD COLUMN \`invitation_expires_at\` DATETIME(6) NULL COMMENT '外部邀請到期時間' AFTER \`invitation_token_ciphertext\`,
      ADD COLUMN \`invitation_delivered_at\` DATETIME(6) NULL COMMENT '外部邀請寄送接受時間' AFTER \`invitation_expires_at\`,
      ADD COLUMN \`completion_receipt_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部完成收據 token SHA-256' AFTER \`invitation_delivered_at\`,
      ADD COLUMN \`completion_receipt_expires_at\` DATETIME(6) NULL COMMENT '外部完成收據到期時間' AFTER \`completion_receipt_sha256\``);
    await queryRunner.query(`UPDATE \`esign_signers\`
      SET \`public_id\` = LOWER(CONCAT(
        SUBSTRING(UUID(), 1, 14), '4', SUBSTRING(UUID(), 16, 3), '-',
        ELT(1 + FLOOR(RAND() * 4), '8', '9', 'a', 'b'),
        SUBSTRING(UUID(), 21)
      ))
      WHERE \`public_id\` IS NULL`);
    await queryRunner.query(`ALTER TABLE \`esign_signers\`
      MODIFY COLUMN \`public_id\` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '對外顯示的 UUID v4',
      DROP CHECK \`chk_esign_signers_identity\`,
      ADD CONSTRAINT \`chk_esign_signers_identity\` CHECK ((\`signer_type\` = 'user' AND \`user_id\` IS NOT NULL AND \`email\` IS NULL AND \`empid_snapshot\` IS NOT NULL AND \`invitation_token_sha256\` IS NULL AND \`invitation_token_ciphertext\` IS NULL AND \`invitation_expires_at\` IS NULL) OR (\`signer_type\` = 'email' AND \`user_id\` IS NULL AND \`email\` IS NOT NULL AND \`empid_snapshot\` IS NULL)),
      ADD CONSTRAINT \`chk_esign_signers_status\` CHECK (\`status\` IN ('pending','signed')),
      ADD UNIQUE KEY \`uq_esign_signers_public_id\` (\`public_id\`),
      ADD UNIQUE KEY \`uq_esign_signers_invitation_token_sha256\` (\`invitation_token_sha256\`),
      ADD UNIQUE KEY \`uq_esign_signers_completion_receipt_sha256\` (\`completion_receipt_sha256\`),
      ADD KEY \`idx_esign_signers_invitation_expires_at\` (\`invitation_expires_at\`),
      ADD KEY \`idx_esign_signers_invitation_delivered_at\` (\`invitation_delivered_at\`),
      ADD KEY \`idx_esign_signers_completion_receipt_expires_at\` (\`completion_receipt_expires_at\`)`);

    await queryRunner.query(`ALTER TABLE \`esign_document_fields\`
      ADD COLUMN \`signer_id\` BIGINT NULL COMMENT '欄位所屬簽署人 ID' AFTER \`document_id\`,
      MODIFY COLUMN \`width_percent\` DECIMAL(6,3) NOT NULL COMMENT '寬度百分比',
      MODIFY COLUMN \`height_percent\` DECIMAL(6,3) NOT NULL COMMENT '高度百分比',
      ADD KEY \`idx_esign_document_fields_signer_id\` (\`signer_id\`),
      ADD CONSTRAINT \`fk_esign_document_fields_signer\` FOREIGN KEY (\`signer_id\`) REFERENCES \`esign_signers\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
      ADD CONSTRAINT \`chk_esign_document_fields_type\` CHECK (\`field_type\` IN ('signature','date')),
      ADD CONSTRAINT \`chk_esign_document_fields_page\` CHECK (\`page_number\` >= 1),
      ADD CONSTRAINT \`chk_esign_document_fields_bounds\` CHECK (\`x_percent\` >= 0 AND \`x_percent\` < 100 AND \`y_percent\` >= 0 AND \`y_percent\` < 100 AND \`width_percent\` > 0 AND \`height_percent\` > 0 AND \`x_percent\` + \`width_percent\` <= 100 AND \`y_percent\` + \`height_percent\` <= 100)`);

    await queryRunner.query(`ALTER TABLE \`esign_file_objects\`
      ADD COLUMN \`document_field_id\` BIGINT NULL COMMENT '簽名圖對應文件欄位 ID' AFTER \`signature_record_id\`,
      ADD KEY \`idx_esign_file_objects_document_field_id\` (\`document_field_id\`),
      ADD UNIQUE KEY \`uq_esign_file_objects_document_purpose\` (\`document_id\`, \`file_purpose\`),
      ADD UNIQUE KEY \`uq_esign_file_objects_signature_field_purpose\` (\`signature_record_id\`, \`document_field_id\`, \`file_purpose\`),
      ADD CONSTRAINT \`fk_esign_file_objects_document_field\` FOREIGN KEY (\`document_field_id\`) REFERENCES \`esign_document_fields\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
      ADD CONSTRAINT \`chk_esign_file_objects_signature_field\` CHECK ((\`file_purpose\` = 'signature_png' AND \`signature_record_id\` IS NOT NULL AND \`document_field_id\` IS NOT NULL) OR (\`file_purpose\` <> 'signature_png' AND \`document_field_id\` IS NULL))`);

    await queryRunner.query(`ALTER TABLE \`esign_notification_logs\`
      ADD COLUMN \`attempt_count\` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '寄送嘗試次數' AFTER \`error_code\`,
      ADD COLUMN \`next_attempt_at\` DATETIME(6) NULL COMMENT '下次可重試時間' AFTER \`attempt_count\`,
      ADD COLUMN \`processing_started_at\` DATETIME(6) NULL COMMENT '本次處理開始時間' AFTER \`next_attempt_at\`,
      ADD KEY \`idx_esign_notification_logs_next_attempt_at\` (\`next_attempt_at\`),
      ADD KEY \`idx_esign_notification_logs_processing_started_at\` (\`processing_started_at\`),
      ADD KEY \`idx_esign_notification_logs_result_next_attempt_id\` (\`result\`, \`next_attempt_at\`, \`id\`),
      ADD CONSTRAINT \`chk_esign_notification_logs_channel\` CHECK (\`channel\` = 'email'),
      ADD CONSTRAINT \`chk_esign_notification_logs_result\` CHECK (\`result\` IN ('pending','processing','delivered','failed'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`esign_notification_logs\`
      DROP CHECK \`chk_esign_notification_logs_result\`,
      DROP CHECK \`chk_esign_notification_logs_channel\`,
      DROP INDEX \`idx_esign_notification_logs_result_next_attempt_id\`,
      DROP INDEX \`idx_esign_notification_logs_processing_started_at\`,
      DROP INDEX \`idx_esign_notification_logs_next_attempt_at\`,
      DROP COLUMN \`processing_started_at\`,
      DROP COLUMN \`next_attempt_at\`,
      DROP COLUMN \`attempt_count\``);

    await queryRunner.query(`ALTER TABLE \`esign_file_objects\`
      DROP CHECK \`chk_esign_file_objects_signature_field\`,
      DROP FOREIGN KEY \`fk_esign_file_objects_document_field\`,
      DROP INDEX \`uq_esign_file_objects_signature_field_purpose\`,
      DROP INDEX \`uq_esign_file_objects_document_purpose\`,
      DROP INDEX \`idx_esign_file_objects_document_field_id\`,
      DROP COLUMN \`document_field_id\``);

    await queryRunner.query(`ALTER TABLE \`esign_document_fields\`
      DROP CHECK \`chk_esign_document_fields_bounds\`,
      DROP CHECK \`chk_esign_document_fields_page\`,
      DROP CHECK \`chk_esign_document_fields_type\`,
      DROP FOREIGN KEY \`fk_esign_document_fields_signer\`,
      DROP INDEX \`idx_esign_document_fields_signer_id\`,
      DROP COLUMN \`signer_id\`,
      MODIFY COLUMN \`width_percent\` DECIMAL(6,3) NULL COMMENT '寬度百分比',
      MODIFY COLUMN \`height_percent\` DECIMAL(6,3) NULL COMMENT '高度百分比'`);

    await queryRunner.query(`ALTER TABLE \`esign_signers\`
      DROP CHECK \`chk_esign_signers_status\`,
      DROP CHECK \`chk_esign_signers_identity\`,
      DROP INDEX \`idx_esign_signers_completion_receipt_expires_at\`,
      DROP INDEX \`idx_esign_signers_invitation_delivered_at\`,
      DROP INDEX \`idx_esign_signers_invitation_expires_at\`,
      DROP INDEX \`uq_esign_signers_completion_receipt_sha256\`,
      DROP INDEX \`uq_esign_signers_invitation_token_sha256\`,
      DROP INDEX \`uq_esign_signers_public_id\`,
      DROP COLUMN \`completion_receipt_expires_at\`,
      DROP COLUMN \`completion_receipt_sha256\`,
      DROP COLUMN \`invitation_delivered_at\`,
      DROP COLUMN \`invitation_expires_at\`,
      DROP COLUMN \`invitation_token_ciphertext\`,
      DROP COLUMN \`invitation_token_sha256\`,
      DROP COLUMN \`public_id\`,
      ADD CONSTRAINT \`chk_esign_signers_identity\` CHECK ((\`signer_type\` = 'user' AND \`user_id\` IS NOT NULL AND \`email\` IS NULL AND \`empid_snapshot\` IS NOT NULL) OR (\`signer_type\` = 'email' AND \`user_id\` IS NULL AND \`email\` IS NOT NULL AND \`empid_snapshot\` IS NULL))`);

    await queryRunner.query(`ALTER TABLE \`esign_documents\`
      DROP CHECK \`chk_esign_documents_sign_period\`,
      DROP CHECK \`chk_esign_documents_status\`,
      DROP INDEX \`idx_esign_documents_finalization_lease_expires_at\`,
      ALTER COLUMN \`allow_reject\` SET DEFAULT 1,
      DROP COLUMN \`finalization_lease_expires_at\`,
      DROP COLUMN \`finalization_lease_token\``);
  }
}
