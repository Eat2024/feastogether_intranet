import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Spec 04：簽署成功時保存簽章的公開驗證代碼，驗證網址為 /verify/{code}。
 * 既有簽署紀錄維持 NULL，不回補（FR-011）。
 */
export class SignatureVerificationCode1792108800000 implements MigrationInterface {
  name = 'SignatureVerificationCode1792108800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`esign_signature_records\`
      ADD COLUMN \`verification_code\` CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '簽章公開驗證代碼' AFTER \`signed_at_utc\`,
      ADD UNIQUE KEY \`uq_esign_signature_records_verification_code\` (\`verification_code\`)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`esign_signature_records\`
      DROP INDEX \`uq_esign_signature_records_verification_code\`,
      DROP COLUMN \`verification_code\``);
  }
}
