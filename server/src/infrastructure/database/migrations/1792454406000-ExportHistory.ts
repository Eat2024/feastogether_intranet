import type { MigrationInterface, QueryRunner } from 'typeorm';

const recordType =
  "(`export_type` <> 'excel' OR (`conditions_json` IS NOT NULL AND `created_by_user_id` IS NOT NULL AND `signer_id` IS NULL)) AND (`export_type` <> 'pdf' OR (`signer_id` IS NOT NULL AND `conditions_json` IS NULL)) AND (`export_type` IN ('excel','pdf') OR (`created_by_user_id` IS NOT NULL AND `signer_id` IS NULL AND `conditions_json` IS NULL))";

/** 匯出工作表兼存 Excel／單人 PDF 紀錄；NULL 匯出人只允許外部簽署人本人下載的 PDF。 */
export class ExportHistory1792454406000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE esign_export_jobs
      MODIFY created_by_user_id bigint NULL COMMENT '建立員工 ID，NULL 為外部簽署人本人下載',
      ADD signer_id bigint NULL COMMENT '單人副本的簽署人' AFTER created_by_user_id,
      ADD conditions_json json NULL COMMENT 'Excel 匯出條件' AFTER signer_id,
      ADD INDEX idx_esign_export_jobs_type_created (export_type,created_at,id),
      ADD INDEX idx_esign_export_jobs_document_type_created (document_id,export_type,created_at,id),
      ADD INDEX idx_esign_export_jobs_signer_created (signer_id,created_at,id),
      ADD CONSTRAINT fk_esign_export_jobs_signer FOREIGN KEY (signer_id) REFERENCES esign_signers (id) ON DELETE RESTRICT,
      ADD CONSTRAINT chk_esign_export_jobs_record_type CHECK (${recordType})`);
  }

  async down(q: QueryRunner): Promise<void> {
    const records = (await q.query(
      "SELECT id FROM esign_export_jobs WHERE export_type IN ('excel','pdf') LIMIT 1",
    )) as Array<{ id: number }>;
    if (records.length)
      throw new Error('無法回滾：已有 Excel／PDF 匯出紀錄，必須保留既有紀錄');
    await q.query(`ALTER TABLE esign_export_jobs
      DROP CHECK chk_esign_export_jobs_record_type,
      DROP FOREIGN KEY fk_esign_export_jobs_signer,
      DROP INDEX idx_esign_export_jobs_type_created,
      DROP INDEX idx_esign_export_jobs_document_type_created,
      DROP INDEX idx_esign_export_jobs_signer_created,
      DROP signer_id,
      DROP conditions_json,
      MODIFY created_by_user_id bigint NOT NULL COMMENT '建立員工 ID'`);
  }
}
