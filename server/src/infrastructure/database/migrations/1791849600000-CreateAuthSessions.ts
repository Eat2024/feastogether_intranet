import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSessions1791849600000 implements MigrationInterface {
  name = 'CreateAuthSessions1791849600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`auth_sessions\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '認證流程流水號',
      \`user_id\` BIGINT NULL COMMENT '員工 ID',
      \`source\` VARCHAR(20) NOT NULL COMMENT '認證來源',
      \`status\` VARCHAR(20) NOT NULL COMMENT '認證狀態',
      \`source_jti_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '來源 JWT jti SHA-256',
      \`launch_code_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '啟動碼 SHA-256',
      \`session_token_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '登入識別摘要 SHA-256',
      \`assertion_expires_at\` DATETIME(3) NOT NULL COMMENT '來源 assertion 到期時間',
      \`launch_expires_at\` DATETIME(3) NULL COMMENT '啟動碼到期時間',
      \`verified_at\` DATETIME(3) NULL COMMENT '員工驗證完成時間',
      \`activated_at\` DATETIME(3) NULL COMMENT 'Session 啟用時間',
      \`expires_at\` DATETIME(3) NULL COMMENT 'Session 到期時間',
      \`revoked_at\` DATETIME(3) NULL COMMENT 'Session 撤銷時間',
      \`failure_code\` VARCHAR(50) NULL COMMENT '失敗分類',
      \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
      \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
      \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_auth_sessions_source_jti_hash\` (\`source_jti_hash\`),
      UNIQUE KEY \`uq_auth_sessions_launch_code_hash\` (\`launch_code_hash\`),
      UNIQUE KEY \`uq_auth_sessions_session_token_hash\` (\`session_token_hash\`),
      KEY \`idx_auth_sessions_status_launch_expires_at\` (\`status\`, \`launch_expires_at\`),
      KEY \`idx_auth_sessions_status_expires_at\` (\`status\`, \`expires_at\`),
      KEY \`idx_auth_sessions_user_created_at\` (\`user_id\`, \`created_at\`),
      KEY \`idx_auth_sessions_deleted_at\` (\`deleted_at\`),
      CONSTRAINT \`chk_auth_sessions_status\` CHECK (\`status\` IN ('validating','pending','active','failed','revoked')),
      CONSTRAINT \`fk_auth_sessions_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WebView 啟動與員工登入 Session'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `auth_sessions`');
  }
}
