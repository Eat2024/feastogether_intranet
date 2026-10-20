import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SignerNote1792454404000 implements MigrationInterface {
  name = 'SignerNote1792454404000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE esign_signers ADD COLUMN note varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '建立人管理備註，不屬簽署證據'",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE esign_signers DROP COLUMN note');
  }
}
