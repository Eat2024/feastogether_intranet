import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 拒簽是不可逆終態，保留冪等請求及互斥證據。 */
export class RejectionCompletion1792454401000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE esign_signers ADD COLUMN reject_request_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '拒簽冪等請求 UUID'",
    );
    await queryRunner.query(
      'ALTER TABLE esign_signers DROP CHECK chk_esign_signers_status, DROP CHECK chk_esign_signers_completion',
    );
    await queryRunner.query(
      "ALTER TABLE esign_signers ADD CONSTRAINT chk_esign_signers_status CHECK (`status` IN ('pending','signed','rejected')), ADD CONSTRAINT chk_esign_signers_completion CHECK ((`status` IN ('pending','rejected') AND `completion_status` IS NULL AND `completion_lease_token` IS NULL AND `completion_lease_expires_at` IS NULL AND `completion_ready_at` IS NULL) OR (`status` = 'signed' AND `completion_status` IS NOT NULL AND ((`completion_status` IN ('pending','failed') AND `completion_lease_token` IS NULL AND `completion_lease_expires_at` IS NULL AND `completion_ready_at` IS NULL) OR (`completion_status` = 'processing' AND `completion_lease_token` IS NOT NULL AND `completion_lease_expires_at` IS NOT NULL AND `completion_ready_at` IS NULL) OR (`completion_status` = 'ready' AND `completion_lease_token` IS NULL AND `completion_lease_expires_at` IS NULL AND `completion_ready_at` IS NOT NULL)))), ADD CONSTRAINT chk_esign_signers_terminal_times CHECK ((`signed_at` IS NULL OR `rejected_at` IS NULL) AND (`status` <> 'rejected' OR (`rejected_at` IS NOT NULL AND `reject_request_id` IS NOT NULL AND `reject_reason` IS NOT NULL)))",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ count: string }> = await queryRunner.query(
      "SELECT COUNT(*) AS count FROM esign_signers WHERE status = 'rejected'",
    );
    if (Number(rows[0]?.count) > 0)
      throw new Error('已有拒簽證據，不可回退拒簽 migration');
    await queryRunner.query(
      'ALTER TABLE esign_signers DROP CHECK chk_esign_signers_terminal_times, DROP CHECK chk_esign_signers_status, DROP CHECK chk_esign_signers_completion',
    );
    await queryRunner.query(
      "ALTER TABLE esign_signers ADD CONSTRAINT chk_esign_signers_status CHECK (`status` IN ('pending','signed')), ADD CONSTRAINT chk_esign_signers_completion CHECK ((`status` = 'pending' AND `completion_status` IS NULL AND `completion_lease_token` IS NULL AND `completion_lease_expires_at` IS NULL AND `completion_ready_at` IS NULL) OR (`status` = 'signed' AND `completion_status` IS NOT NULL AND ((`completion_status` IN ('pending','failed') AND `completion_lease_token` IS NULL AND `completion_lease_expires_at` IS NULL AND `completion_ready_at` IS NULL) OR (`completion_status` = 'processing' AND `completion_lease_token` IS NOT NULL AND `completion_lease_expires_at` IS NOT NULL AND `completion_ready_at` IS NULL) OR (`completion_status` = 'ready' AND `completion_lease_token` IS NULL AND `completion_lease_expires_at` IS NULL AND `completion_ready_at` IS NOT NULL))))",
    );
    await queryRunner.query(
      'ALTER TABLE esign_signers DROP COLUMN reject_request_id',
    );
  }
}
