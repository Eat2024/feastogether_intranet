import type { MigrationInterface, QueryRunner } from 'typeorm';
/** 一般匯出與本人副本使用各自的真實操作者，不變更任何簽章證據。 */
export class EsignExportActors1793923203000 implements MigrationInterface {
  name = 'EsignExportActors1793923203000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE esign_export_jobs ADD created_by_actor_kind VARCHAR(20) NOT NULL DEFAULT 'employee' COMMENT '實際匯出操作者種類'",
    );
    await q.query(
      "UPDATE esign_export_jobs SET created_by_actor_kind='external_signer' WHERE created_by_user_id IS NULL AND export_type='pdf' AND signer_id IS NOT NULL",
    );
    await q.query(
      "ALTER TABLE esign_export_jobs DROP CHECK chk_esign_export_jobs_record_type, ADD CONSTRAINT chk_esign_export_jobs_record_type CHECK ((export_type='pdf' AND signer_id IS NOT NULL AND conditions_json IS NULL AND ((created_by_actor_kind='employee' AND created_by_user_id IS NOT NULL) OR (created_by_actor_kind='external_signer' AND created_by_user_id IS NULL))) OR (export_type IN ('excel','signed_copies_zip') AND signer_id IS NULL AND ((export_type='excel' AND conditions_json IS NOT NULL) OR (export_type='signed_copies_zip' AND conditions_json IS NULL)) AND ((created_by_actor_kind='employee' AND created_by_user_id IS NOT NULL) OR (created_by_actor_kind='super_user' AND created_by_user_id IS NULL))))",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const [row]: Array<{ total: number }> = await q.query(
      "SELECT (SELECT COUNT(*) FROM esign_export_jobs WHERE created_by_actor_kind='super_user')+(SELECT COUNT(*) FROM authorization_events) AS total",
    );
    if (Number(row.total) > 0)
      throw new Error('無法回滾：匯出操作者或授權稽核必須保留');
    await q.query(
      'ALTER TABLE esign_export_jobs DROP CHECK chk_esign_export_jobs_record_type, DROP COLUMN created_by_actor_kind, ADD CONSTRAINT chk_esign_export_jobs_record_type CHECK (' +
        "(`export_type` <> 'excel' OR (`conditions_json` IS NOT NULL AND `created_by_user_id` IS NOT NULL AND `signer_id` IS NULL)) AND (`export_type` <> 'pdf' OR (`signer_id` IS NOT NULL AND `conditions_json` IS NULL)) AND (`export_type` IN ('excel','pdf') OR (`created_by_user_id` IS NOT NULL AND `signer_id` IS NULL AND `conditions_json` IS NULL))" +
        ')',
    );
  }
}
