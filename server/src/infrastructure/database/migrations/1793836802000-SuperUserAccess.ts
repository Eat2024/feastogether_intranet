import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 027：auth_sessions 增加 employee／super_user 操作者，新增維護入口 singleton 與安全事件表。
 * 既有列由欄位預設值回填為 employee；CHECK 與欄位在同一個 ALTER 內，歷史資料不符時整句失敗、不留半套 schema。
 * 不寫入任何入口或帳密；初始化由 REPL 明確執行。部署前停止舊版 server／worker 並備份。
 */
export class SuperUserAccess1793836802000 implements MigrationInterface {
  name = 'SuperUserAccess1793836802000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`auth_sessions\`
      ADD COLUMN \`actor_kind\` VARCHAR(20) NOT NULL DEFAULT 'employee' COMMENT '操作者類型' AFTER \`id\`,
      ADD COLUMN \`credential_generation\` BIGINT UNSIGNED NULL COMMENT 'Super user 帳密啟用版本' AFTER \`source\`,
      ADD COLUMN \`replacement_session_id\` BIGINT UNSIGNED NULL COMMENT '取代本會話的新會話 ID' AFTER \`revoked_at\`,
      ADD UNIQUE KEY \`uq_auth_sessions_replacement_session_id\` (\`replacement_session_id\`),
      ADD KEY \`idx_auth_sessions_actor_generation_status\` (\`actor_kind\`, \`credential_generation\`, \`status\`),
      ADD CONSTRAINT \`fk_auth_sessions_replacement\` FOREIGN KEY (\`replacement_session_id\`) REFERENCES \`auth_sessions\` (\`id\`) ON DELETE RESTRICT,
      ADD CONSTRAINT \`chk_auth_sessions_actor\` CHECK ((\`actor_kind\` = 'employee' AND \`credential_generation\` IS NULL AND \`source\` IN ('webview','oauth') AND (\`status\` IN ('validating','failed') OR \`user_id\` IS NOT NULL)) OR (\`actor_kind\` = 'super_user' AND \`user_id\` IS NULL AND \`credential_generation\` IS NOT NULL AND \`source\` = 'super_user' AND \`status\` NOT IN ('validating','pending'))),
      ADD CONSTRAINT \`chk_auth_sessions_active_session\` CHECK (\`status\` <> 'active' OR (\`session_token_hash\` IS NOT NULL AND \`activated_at\` IS NOT NULL AND \`expires_at\` IS NOT NULL))`);

    await queryRunner.query(`CREATE TABLE \`super_user_access\` (
      \`id\` TINYINT UNSIGNED NOT NULL COMMENT '固定單列識別（恆為 1，不是員工 ID）',
      \`entry_key\` CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '目前隱藏入口識別（base64url）',
      \`entry_generation\` BIGINT UNSIGNED NOT NULL COMMENT '入口輪換版本',
      \`rotated_at\` DATETIME(6) NOT NULL COMMENT '目前入口生效時間',
      \`period_start_at\` DATETIME(6) NOT NULL COMMENT '最近已處理的輪換週期起點',
      \`active_credential_fingerprint\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '目前啟用的帳密設定指紋',
      \`credential_generation\` BIGINT UNSIGNED NOT NULL COMMENT '帳密啟用版本',
      \`credential_activated_at\` DATETIME(6) NOT NULL COMMENT '帳密啟用時間',
      \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
      \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
      \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
      PRIMARY KEY (\`id\`),
      KEY \`idx_super_user_access_rotated_at\` (\`rotated_at\`),
      KEY \`idx_super_user_access_period_start_at\` (\`period_start_at\`),
      KEY \`idx_super_user_access_credential_activated_at\` (\`credential_activated_at\`),
      KEY \`idx_super_user_access_created_at\` (\`created_at\`),
      KEY \`idx_super_user_access_updated_at\` (\`updated_at\`),
      KEY \`idx_super_user_access_deleted_at\` (\`deleted_at\`),
      CONSTRAINT \`chk_super_user_access_singleton\` CHECK (\`id\` = 1),
      CONSTRAINT \`chk_super_user_access_entry_generation\` CHECK (\`entry_generation\` >= 1),
      CONSTRAINT \`chk_super_user_access_credential_generation\` CHECK (\`credential_generation\` >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Super user 維護入口與帳密啟用版本（單列）'`);

    await queryRunner.query(`CREATE TABLE \`auth_security_events\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '事件流水號',
      \`event_type\` VARCHAR(64) NOT NULL COMMENT '事件種類',
      \`actor_kind\` VARCHAR(20) NOT NULL COMMENT '操作身分類型',
      \`actor_user_id\` BIGINT NULL COMMENT '員工 ID（僅員工事件）',
      \`session_id\` BIGINT UNSIGNED NULL COMMENT '關聯會話 ID',
      \`outcome_code\` VARCHAR(64) NOT NULL COMMENT '白名單結果碼',
      \`credential_generation\` BIGINT UNSIGNED NULL COMMENT '相關帳密啟用版本',
      \`entry_generation\` BIGINT UNSIGNED NULL COMMENT '相關入口輪換版本',
      \`request_id\` VARCHAR(64) NULL COMMENT '請求追蹤 ID',
      \`occurred_at\` DATETIME(6) NOT NULL COMMENT '事件發生時間',
      \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
      PRIMARY KEY (\`id\`),
      KEY \`idx_auth_security_events_occurred_at\` (\`occurred_at\`),
      KEY \`idx_auth_security_events_created_at\` (\`created_at\`),
      CONSTRAINT \`fk_auth_security_events_actor_user\` FOREIGN KEY (\`actor_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
      CONSTRAINT \`fk_auth_security_events_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`auth_sessions\` (\`id\`) ON DELETE RESTRICT,
      CONSTRAINT \`chk_auth_security_events_event_type\` CHECK (\`event_type\` IN ('login.succeeded','login.rejected','session.replaced','session.revoked','credentials.activated','entry.initialized','entry.rotated')),
      CONSTRAINT \`chk_auth_security_events_actor_kind\` CHECK (\`actor_kind\` IN ('employee','super_user','operator','system','anonymous')),
      CONSTRAINT \`chk_auth_security_events_actor_user\` CHECK ((\`actor_kind\` = 'employee' AND \`actor_user_id\` IS NOT NULL) OR (\`actor_kind\` <> 'employee' AND \`actor_user_id\` IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登入與維護安全事件（append-only）'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT (SELECT COUNT(*) FROM \`auth_security_events\`)
        + (SELECT COUNT(*) FROM \`super_user_access\`)
        + (SELECT COUNT(*) FROM \`auth_sessions\` WHERE \`actor_kind\` = 'super_user') AS count`,
    )) as Array<{ count: string | number }>;
    if (Number(rows[0].count) > 0) {
      throw new Error(
        '無法回滾：已有安全事件、維護入口或 Super user 會話；請保留 schema 以程式回復，或依備份復原。',
      );
    }
    await queryRunner.query('DROP TABLE `auth_security_events`');
    await queryRunner.query('DROP TABLE `super_user_access`');
    await queryRunner.query(`ALTER TABLE \`auth_sessions\`
      DROP CHECK \`chk_auth_sessions_actor\`,
      DROP CHECK \`chk_auth_sessions_active_session\`,
      DROP FOREIGN KEY \`fk_auth_sessions_replacement\`,
      DROP INDEX \`uq_auth_sessions_replacement_session_id\`,
      DROP INDEX \`idx_auth_sessions_actor_generation_status\`,
      DROP COLUMN \`replacement_session_id\`,
      DROP COLUMN \`credential_generation\`,
      DROP COLUMN \`actor_kind\``);
  }
}
