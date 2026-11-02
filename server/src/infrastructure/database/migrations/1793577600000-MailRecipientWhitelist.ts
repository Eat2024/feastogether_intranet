import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MailRecipientWhitelist1793577600000 implements MigrationInterface {
  name = 'MailRecipientWhitelist1793577600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`mail_recipient_whitelist\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '白名單規則流水號',
      \`type\` VARCHAR(20) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '規則類型：department 部門、employee 員工',
      \`value\` VARCHAR(50) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '完整部門代碼或員編，保留前導零',
      \`remark\` VARCHAR(255) NULL COMMENT '維護備註',
      \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
      \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
      \`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_mail_recipient_whitelist_type_value\` (\`type\`, \`value\`),
      CONSTRAINT \`chk_mail_recipient_whitelist_type\` CHECK (\`type\` IN ('department', 'employee')),
      CONSTRAINT \`chk_mail_recipient_whitelist_value\` CHECK (
        (\`type\` = 'department' AND CHAR_LENGTH(\`value\`) BETWEEN 1 AND 50 AND NOT REGEXP_LIKE(\`value\`, '[^A-Za-z0-9_-]', 'c'))
        OR (\`type\` = 'employee' AND CHAR_LENGTH(\`value\`) BETWEEN 1 AND 20 AND NOT REGEXP_LIKE(\`value\`, '[^A-Za-z0-9]', 'c'))
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='非正式環境寄信收件人白名單'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `mail_recipient_whitelist`');
  }
}
