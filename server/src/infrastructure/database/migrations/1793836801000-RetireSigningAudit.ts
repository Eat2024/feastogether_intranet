import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Spec 026：停用簽署歷程。部署前停止舊版 server/worker 並備份事件資料。 */
export class RetireSigningAudit1793836801000 implements MigrationInterface {
  name = 'RetireSigningAudit1793836801000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE esign_verification_records
      MODIFY audit_root_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
      COMMENT '停用前稽核鏈 root hash（僅歷史參考）'`);
    await queryRunner.query('DROP TABLE esign_audit_events');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ count: string | number }> = await queryRunner.query(
      'SELECT COUNT(*) AS count FROM esign_verification_records',
    );
    if (Number(rows[0].count) > 0) {
      throw new Error(
        '無法還原已刪除的稽核鏈；有驗證紀錄時請依 Spec 026 從備份恢復，不可直接回滾。',
      );
    }
    // 僅供沒有驗證紀錄的空資料庫回滾；不會重建任何歷史事件。
    await queryRunner.query(`CREATE TABLE \`esign_audit_events\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '稽核事件流水號',
  \`document_id\` bigint NOT NULL COMMENT '文件 ID',
  \`signer_id\` bigint DEFAULT NULL COMMENT '簽署人 ID',
  \`actor_user_id\` bigint DEFAULT NULL COMMENT '操作員工 ID',
  \`event_type\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件類型',
  \`occurred_at\` datetime(6) NOT NULL COMMENT '事件發生時間',
  \`previous_event_hash\` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '前一事件 hash',
  \`event_hash\` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '事件 hash',
  \`request_id\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '請求追蹤 ID',
  \`metadata_json\` json DEFAULT NULL COMMENT '事件中繼資料',
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_esign_audit_events_event_hash\` (\`event_hash\`),
  KEY \`idx_esign_audit_events_document_occurred_id\` (\`document_id\`,\`occurred_at\`,\`id\`),
  KEY \`idx_esign_audit_events_signer_id\` (\`signer_id\`),
  KEY \`idx_esign_audit_events_actor_user_id\` (\`actor_user_id\`),
  KEY \`idx_esign_audit_events_event_type\` (\`event_type\`),
  KEY \`idx_esign_audit_events_request_id\` (\`request_id\`),
  KEY \`idx_esign_audit_events_occurred_at\` (\`occurred_at\`),
  KEY \`idx_esign_audit_events_created_at\` (\`created_at\`),
  CONSTRAINT \`fk_esign_audit_events_actor\` FOREIGN KEY (\`actor_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`fk_esign_audit_events_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`fk_esign_audit_events_signer\` FOREIGN KEY (\`signer_id\`) REFERENCES \`esign_signers\` (\`id\`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='不可變文件稽核事件';`);
    await queryRunner.query(`ALTER TABLE esign_verification_records
      MODIFY audit_root_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '稽核鏈 root hash'`);
  }
}
