import type { MigrationInterface, QueryRunner } from 'typeorm';
export class LocalZipExports1792454403000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE esign_export_jobs ADD `public_id` char(36) NULL COMMENT '公開工作 UUID', ADD `snapshot_at` datetime(6) NULL COMMENT '固定快照時間', ADD `snapshot_json` json NULL COMMENT '不可變簽署快照', ADD `snapshot_sha256` char(64) NULL COMMENT '快照 SHA-256', ADD `resolved_files_json` json NULL COMMENT '已固定來源副本', ADD `processed_count` int unsigned NULL COMMENT '當次處理數', ADD `waiting_count` int unsigned NULL COMMENT '等待副本數', ADD `expires_at` datetime(6) NULL COMMENT '成果到期時間', ADD `lease_token` char(36) NULL COMMENT '工作 generation', ADD `lease_expires_at` datetime(6) NULL COMMENT '租約到期時間', ADD `attempt_count` int unsigned NULL COMMENT '嘗試次數', ADD `next_attempt_at` datetime(6) NULL COMMENT '再次排入時間', ADD `staging_json` json NULL COMMENT '暫存成果位置', ADD UNIQUE INDEX uq_esign_export_jobs_public_id (public_id), ADD INDEX idx_esign_exports_reuse (document_id,export_type,status,expires_at,id), ADD INDEX idx_esign_exports_retry (status,next_attempt_at,id), ADD INDEX idx_esign_export_jobs_lease_expires_at (lease_expires_at), ADD INDEX idx_esign_export_jobs_snapshot_at (snapshot_at), ADD INDEX idx_esign_export_jobs_expires_at (expires_at), ADD INDEX idx_esign_export_jobs_next_attempt_at (next_attempt_at)",
    );
    await q.query(
      "ALTER TABLE esign_file_objects ADD UNIQUE INDEX uq_esign_files_export_purpose (export_job_id,file_purpose), ADD CONSTRAINT chk_esign_files_export_owner CHECK (file_purpose <> 'signed_copies_zip' OR (export_job_id IS NOT NULL AND document_id IS NULL AND signature_record_id IS NULL AND verification_record_id IS NULL AND mime_type = 'application/zip'))",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT COUNT(*) total FROM esign_export_jobs WHERE snapshot_json IS NOT NULL',
    )) as Array<{ total: string }>;
    if (Number(rows[0].total))
      throw new Error('已有匯出快照，禁止移除歷史資料');
    await q.query(
      'ALTER TABLE esign_file_objects DROP INDEX uq_esign_files_export_purpose, DROP CHECK chk_esign_files_export_owner',
    );
    await q.query(
      'ALTER TABLE esign_export_jobs DROP INDEX uq_esign_export_jobs_public_id, DROP INDEX idx_esign_exports_reuse, DROP INDEX idx_esign_exports_retry, DROP INDEX idx_esign_export_jobs_lease_expires_at, DROP INDEX idx_esign_export_jobs_snapshot_at, DROP INDEX idx_esign_export_jobs_expires_at, DROP INDEX idx_esign_export_jobs_next_attempt_at, DROP public_id, DROP snapshot_at, DROP snapshot_json, DROP snapshot_sha256, DROP resolved_files_json, DROP processed_count, DROP waiting_count, DROP expires_at, DROP lease_token, DROP lease_expires_at, DROP attempt_count, DROP next_attempt_at, DROP staging_json',
    );
  }
}
