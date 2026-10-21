import type { MigrationInterface, QueryRunner } from 'typeorm';

const identity =
  "(`signer_type` = 'user' AND `user_id` IS NOT NULL AND `empid_snapshot` IS NOT NULL) OR (`signer_type` = 'email' AND `user_id` IS NULL AND `email` IS NOT NULL AND `empid_snapshot` IS NULL)";
const oldIdentity =
  "(`signer_type` = 'user' AND `user_id` IS NOT NULL AND `email` IS NULL AND `empid_snapshot` IS NOT NULL AND `invitation_token_sha256` IS NULL AND `invitation_token_ciphertext` IS NULL AND `invitation_expires_at` IS NULL) OR (`signer_type` = 'email' AND `user_id` IS NULL AND `email` IS NOT NULL AND `empid_snapshot` IS NULL)";
const expression =
  "CASE WHEN `signer_type` = 'email' THEN `email` ELSE NULL END";

/** 先建立外部唯一性再替換舊限制；DDL 不依賴交易回滾。 */
export class InternalEmailInvitations1792454405000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const constraints: Array<{ CONSTRAINT_NAME: string }> = await runner.query(
      "SELECT CONSTRAINT_NAME FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='esign_signers' AND CONSTRAINT_NAME IN ('uq_esign_signers_document_email','chk_esign_signers_identity')",
    );
    const columns: Array<{ COLUMN_NAME: string }> = await runner.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='esign_signers' AND COLUMN_NAME='external_email'",
    );
    if (constraints.length !== 2 || columns.length)
      throw new Error(
        '無法套用內部邀請 migration：前置 schema 不符，未執行 DDL',
      );
    await runner.query(
      `ALTER TABLE esign_signers ADD external_email varchar(255) GENERATED ALWAYS AS (${expression}) STORED COMMENT '外部地址唯一性衍生欄位', ADD UNIQUE INDEX uq_esign_signers_document_external_email (document_id,external_email)`,
    );
    await runner.query(
      `ALTER TABLE esign_signers DROP INDEX uq_esign_signers_document_email, DROP CHECK chk_esign_signers_identity, ADD CONSTRAINT chk_esign_signers_identity CHECK (${identity}), MODIFY email varchar(255) NULL COMMENT '固定通知 Email'`,
    );
    // TypeORM 以 metadata 保存 generated expression，避免 schema diff 重建欄位。
    await runner.query(
      "INSERT INTO typeorm_metadata (`type`,`schema`,`table`,`name`,`value`) VALUES ('GENERATED_COLUMN',DATABASE(),'esign_signers','external_email',?)",
      [expression],
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    const incompatible: Array<{ id: number }> = await runner.query(
      "SELECT id FROM esign_signers WHERE signer_type='user' AND (email IS NOT NULL OR invitation_token_sha256 IS NOT NULL OR invitation_token_ciphertext IS NOT NULL OR invitation_expires_at IS NOT NULL) LIMIT 1",
    );
    const duplicates: Array<{ document_id: number }> = await runner.query(
      'SELECT document_id FROM esign_signers WHERE email IS NOT NULL GROUP BY document_id,email HAVING COUNT(*) > 1 LIMIT 1',
    );
    if (incompatible.length || duplicates.length)
      throw new Error('無法回滾：已有內部信箱或邀請資料，必須保留既有證據');
    await runner.query(
      `ALTER TABLE esign_signers ADD UNIQUE INDEX uq_esign_signers_document_email (document_id,email), DROP CHECK chk_esign_signers_identity, ADD CONSTRAINT chk_esign_signers_identity CHECK (${oldIdentity}), MODIFY email varchar(255) NULL COMMENT '正規化外部 Email'`,
    );
    await runner.query(
      'ALTER TABLE esign_signers DROP INDEX uq_esign_signers_document_external_email, DROP COLUMN external_email',
    );
    await runner.query(
      "DELETE FROM typeorm_metadata WHERE `type`='GENERATED_COLUMN' AND `schema`=DATABASE() AND `table`='esign_signers' AND `name`='external_email'",
    );
  }
}
