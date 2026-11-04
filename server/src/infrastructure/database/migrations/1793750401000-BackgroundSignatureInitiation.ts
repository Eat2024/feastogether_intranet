import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 獨立保存背景受理與冪等結果，不改既有簽署證據。 */
export class BackgroundSignatureInitiation1793750401000 implements MigrationInterface {
  name = 'BackgroundSignatureInitiation1793750401000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`esign_initiation_jobs\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '工作流水號',
  \`public_id\` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '工作公開 UUID',
  \`document_id\` bigint NOT NULL COMMENT '文件 ID',
  \`created_by_user_id\` bigint NOT NULL COMMENT '原發起者 ID',
  \`request_key\` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '冪等請求 UUID',
  \`request_hash\` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '正規化請求 SHA256',
  \`parent_job_id\` bigint NULL COMMENT '人工重試來源工作 ID',
  \`input_json\` json NULL COMMENT '本次確認的完整輸入',
  \`document_version_json\` json NULL COMMENT '受理時文件與原檔版本',
  \`status\` varchar(16) NOT NULL DEFAULT 'queued' COMMENT '工作狀態',
  \`stage\` varchar(16) NOT NULL DEFAULT 'queued' COMMENT '工作階段',
  \`total_count\` int NOT NULL COMMENT '本次名單總人數',
  \`processed_count\` int NOT NULL DEFAULT 0 COMMENT '本輪已查核人數',
  \`attempt_count\` int NOT NULL DEFAULT 0 COMMENT '已取得執行權次數',
  \`next_attempt_at\` datetime(6) NULL COMMENT '下次允許執行時間',
  \`lease_token\` char(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '本輪租約 UUID',
  \`lease_expires_at\` datetime(6) NULL COMMENT '本輪租約截止時間',
  \`accepted_at\` datetime(6) NOT NULL COMMENT '可靠受理時間',
  \`deadline_at\` datetime(6) NOT NULL COMMENT '整份工作的最晚提交時間',
  \`last_progress_at\` datetime(6) NULL COMMENT '最新進度時間',
  \`started_at\` datetime(6) NULL COMMENT '首次執行時間',
  \`completed_at\` datetime(6) NULL COMMENT '終態時間',
  \`error_code\` varchar(80) NULL COMMENT '穩定分類錯誤碼',
  \`retryable\` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否可人工重試',
  \`issue_count\` int NOT NULL DEFAULT 0 COMMENT '人員問題總數',
  \`issues_json\` json NULL COMMENT '人員問題分類清單',
  \`input_purged_at\` datetime(6) NULL COMMENT '終態敏感明細清理時間',
  \`active_document_id\` bigint GENERATED ALWAYS AS (CASE WHEN \`status\` IN ('queued','processing') THEN \`document_id\` ELSE NULL END) STORED COMMENT '每份文件唯一非終態工作',
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) NULL COMMENT '軟刪除時間',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_esign_initiation_jobs_public\` (\`public_id\`),
  UNIQUE KEY \`uq_esign_initiation_jobs_request\` (\`document_id\`,\`request_key\`),
  UNIQUE KEY \`uq_esign_initiation_jobs_active\` (\`active_document_id\`),
  KEY \`idx_esign_initiation_jobs_document\` (\`document_id\`,\`id\`),
  KEY \`idx_esign_initiation_jobs_retry\` (\`status\`,\`next_attempt_at\`,\`id\`),
  KEY \`idx_esign_initiation_jobs_lease\` (\`status\`,\`lease_expires_at\`,\`id\`),
  KEY \`idx_esign_initiation_jobs_completed\` (\`status\`,\`completed_at\`,\`id\`),
  CONSTRAINT \`chk_esign_initiation_jobs_status\` CHECK (\`status\` IN ('queued','processing','succeeded','failed')),
  CONSTRAINT \`chk_esign_initiation_jobs_stage\` CHECK (\`stage\` IN ('queued','resolving','validating','committing','completed','failed')),
  CONSTRAINT \`chk_esign_initiation_jobs_counts\` CHECK (\`total_count\` > 0 AND \`processed_count\` >= 0 AND \`processed_count\` <= \`total_count\` AND \`attempt_count\` BETWEEN 0 AND 3 AND \`issue_count\` >= 0),
  CONSTRAINT \`chk_esign_initiation_jobs_input\` CHECK (\`status\` NOT IN ('queued','processing') OR (\`input_json\` IS NOT NULL AND \`document_version_json\` IS NOT NULL AND \`input_purged_at\` IS NULL)),
  CONSTRAINT \`chk_esign_initiation_jobs_lease\` CHECK ((\`status\` = 'processing' AND \`lease_token\` IS NOT NULL AND \`lease_expires_at\` IS NOT NULL) OR (\`status\` <> 'processing' AND \`lease_token\` IS NULL AND \`lease_expires_at\` IS NULL)),
  CONSTRAINT \`chk_esign_initiation_jobs_completion\` CHECK ((\`status\` IN ('queued','processing') AND \`completed_at\` IS NULL) OR (\`status\` IN ('succeeded','failed') AND \`completed_at\` IS NOT NULL)),
  CONSTRAINT \`chk_esign_initiation_jobs_result\` CHECK ((\`status\` = 'succeeded' AND \`stage\` = 'completed' AND \`error_code\` IS NULL) OR (\`status\` = 'failed' AND \`stage\` = 'failed' AND \`error_code\` IS NOT NULL) OR (\`status\` = 'queued' AND \`stage\` = 'queued') OR (\`status\` = 'processing' AND \`stage\` IN ('resolving','validating','committing'))),
  CONSTRAINT \`chk_esign_initiation_jobs_deadline\` CHECK (\`deadline_at\` > \`accepted_at\`),
  CONSTRAINT \`fk_esign_initiation_jobs_document\` FOREIGN KEY (\`document_id\`) REFERENCES \`esign_documents\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`fk_esign_initiation_jobs_creator\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`fk_esign_initiation_jobs_parent\` FOREIGN KEY (\`parent_job_id\`) REFERENCES \`esign_initiation_jobs\` (\`id\`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='背景發起簽署工作'`);
    // generated expression 同步 TypeORM metadata，避免 schema drift。
    await queryRunner.query(
      'INSERT INTO typeorm_metadata (type, `schema`, `table`, name, value) VALUES (?, DATABASE(), ?, ?, ?)',
      [
        'GENERATED_COLUMN',
        'esign_initiation_jobs',
        'active_document_id',
        "CASE WHEN `status` IN ('queued','processing') THEN `document_id` ELSE NULL END",
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.manager.query<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM esign_initiation_jobs',
    );
    if (Number(rows[0].count) !== 0) {
      throw new Error(
        '無法回滾：背景發起工作表仍有受理紀錄，必須保留結果與稽核資料',
      );
    }
    await queryRunner.query('DROP TABLE esign_initiation_jobs');
    await queryRunner.query(
      'DELETE FROM typeorm_metadata WHERE type = ? AND `schema` = DATABASE() AND `table` = ? AND name = ?',
      ['GENERATED_COLUMN', 'esign_initiation_jobs', 'active_document_id'],
    );
  }
}
