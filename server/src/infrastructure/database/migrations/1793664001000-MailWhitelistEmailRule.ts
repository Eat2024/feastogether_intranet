import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 部門與員編規則格式，up/down 相同。 */
const DEPARTMENT_OR_EMPLOYEE_RULE = `(\`type\` = 'department' AND CHAR_LENGTH(\`value\`) BETWEEN 1 AND 50 AND NOT REGEXP_LIKE(\`value\`, '[^A-Za-z0-9_-]', 'c'))
        OR (\`type\` = 'employee' AND CHAR_LENGTH(\`value\`) BETWEEN 1 AND 20 AND NOT REGEXP_LIKE(\`value\`, '[^A-Za-z0-9]', 'c'))`;

/**
 * 白名單加入小寫完整收件信箱規則。
 * 信箱結尾用 `\z`：ICU 的 `$` 會在結尾換行前成立。
 * 有 email 列（含已撤銷）時 down 由 CHECK 整句拒絕，不刪資料。
 */
export class MailWhitelistEmailRule1793664001000 implements MigrationInterface {
  name = 'MailWhitelistEmailRule1793664001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`mail_recipient_whitelist\`
      DROP CHECK \`chk_mail_recipient_whitelist_type\`,
      DROP CHECK \`chk_mail_recipient_whitelist_value\`,
      MODIFY \`type\` VARCHAR(20) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '規則類型：department 部門、employee 員工、email 收件信箱',
      MODIFY \`value\` VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '完整部門代碼、員編或小寫收件信箱',
      ADD CONSTRAINT \`chk_mail_recipient_whitelist_type\` CHECK (\`type\` IN ('department', 'employee', 'email')),
      ADD CONSTRAINT \`chk_mail_recipient_whitelist_value\` CHECK (
        ${DEPARTMENT_OR_EMPLOYEE_RULE}
        OR (\`type\` = 'email' AND \`value\` = LOWER(\`value\`) AND REGEXP_LIKE(\`value\`, '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\\\\z', 'c'))
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`mail_recipient_whitelist\`
      DROP CHECK \`chk_mail_recipient_whitelist_type\`,
      DROP CHECK \`chk_mail_recipient_whitelist_value\`,
      MODIFY \`type\` VARCHAR(20) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '規則類型：department 部門、employee 員工',
      MODIFY \`value\` VARCHAR(50) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '完整部門代碼或員編，保留前導零',
      ADD CONSTRAINT \`chk_mail_recipient_whitelist_type\` CHECK (\`type\` IN ('department', 'employee')),
      ADD CONSTRAINT \`chk_mail_recipient_whitelist_value\` CHECK (
        ${DEPARTMENT_OR_EMPLOYEE_RULE}
      )`);
  }
}
