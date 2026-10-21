import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 擴充既有通知表，保留舊邀請及其憑證。 */
export class ExternalReminders1792454402000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE esign_notification_batches
      ADD public_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '通知批次公開 UUID',
      ADD kind varchar(20) NOT NULL DEFAULT 'invitation' COMMENT '初邀或催簽',
      ADD request_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '催簽請求 UUID',
      ADD request_payload_sha256 char(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '正規化請求雜湊'`);
    await q.query(
      'UPDATE esign_notification_batches SET public_id = UUID() WHERE public_id IS NULL',
    );
    await q.query(`ALTER TABLE esign_notification_batches
      MODIFY public_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (uuid()) COMMENT '通知批次公開 UUID',
      ADD UNIQUE KEY uq_esign_notification_batches_public_id (public_id),
      ADD UNIQUE KEY uq_esign_notification_batches_request (document_id,notified_by_user_id,request_id),
      ADD CONSTRAINT chk_esign_notification_batches_kind CHECK (kind IN ('invitation','reminder'))`);
    await q.query(`ALTER TABLE esign_notification_logs
      DROP CHECK chk_esign_notification_logs_result,
      ADD CONSTRAINT chk_esign_notification_logs_result CHECK (result IN ('pending','processing','delivered','failed','skipped','unknown')),
      ADD dispatch_date date NULL COMMENT '台北寄送曆日',
      ADD lease_token char(36) NULL COMMENT '寄送租約 UUID',
      ADD attempt_history_json json NULL COMMENT '有限次投遞狀態歷史，不含憑證',
      ADD reminder_token_sha256 char(64) NULL COMMENT '催簽憑證雜湊',
      ADD reminder_token_ciphertext text NULL COMMENT '催簽憑證密文',
      ADD invitation_generation_sha256 char(64) NULL COMMENT '建立時邀請世代雜湊',
      ADD reminder_expires_at datetime(6) NULL COMMENT '待簽催簽憑證期限',
      ADD UNIQUE KEY uq_esign_notification_logs_reminder_token (reminder_token_sha256),
      ADD KEY idx_esign_notification_logs_dispatch_date (dispatch_date),
      ADD KEY idx_esign_notification_logs_reminder_expires_at (reminder_expires_at),
      ADD KEY idx_esign_notification_logs_signer_result_date (signer_id,result,dispatch_date)`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows: Array<{ count: string }> = await q.query(
      "SELECT COUNT(*) count FROM esign_notification_batches WHERE kind='reminder'",
    );
    if (Number(rows[0]?.count))
      throw new Error('已有催簽紀錄與憑證，不可回退催簽 migration');
    const logs: Array<{ count: string }> = await q.query(
      "SELECT COUNT(*) count FROM esign_notification_logs WHERE result IN ('skipped','unknown')",
    );
    if (Number(logs[0]?.count))
      throw new Error('已有新通知結果，不可回退催簽 migration');
    await q.query(`ALTER TABLE esign_notification_logs DROP CHECK chk_esign_notification_logs_result,
      ADD CONSTRAINT chk_esign_notification_logs_result CHECK (result IN ('pending','processing','delivered','failed')),
      DROP INDEX idx_esign_notification_logs_dispatch_date, DROP INDEX idx_esign_notification_logs_reminder_expires_at,
      DROP INDEX uq_esign_notification_logs_reminder_token, DROP INDEX idx_esign_notification_logs_signer_result_date,
      DROP dispatch_date, DROP lease_token, DROP attempt_history_json, DROP reminder_token_sha256,
      DROP reminder_token_ciphertext, DROP invitation_generation_sha256, DROP reminder_expires_at`);
    await q.query(`ALTER TABLE esign_notification_batches DROP CHECK chk_esign_notification_batches_kind,
      DROP INDEX uq_esign_notification_batches_public_id, DROP INDEX uq_esign_notification_batches_request,
      DROP public_id, DROP kind, DROP request_id, DROP request_payload_sha256`);
  }
}
