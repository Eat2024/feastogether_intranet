import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 草稿可暫存單端日期，正式文件仍須完整期間。 */
export class DraftSettings1792454400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE esign_documents DROP CHECK chk_esign_documents_sign_period, ADD CONSTRAINT chk_esign_documents_sign_period CHECK ((status = 'draft' AND (sign_start_at IS NULL OR sign_end_at IS NULL OR sign_start_at < sign_end_at)) OR (status <> 'draft' AND sign_start_at IS NOT NULL AND sign_end_at IS NOT NULL AND sign_start_at < sign_end_at))",
    );
  }

  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT COUNT(*) AS total FROM esign_documents WHERE (sign_start_at IS NULL) <> (sign_end_at IS NULL)',
    )) as Array<{ total: string }>;
    if (Number(rows[0]?.total))
      throw new Error('已有單端期間草稿，無法回滾且不得清除草稿日期');
    await q.query(
      'ALTER TABLE esign_documents DROP CHECK chk_esign_documents_sign_period, ADD CONSTRAINT chk_esign_documents_sign_period CHECK ((sign_start_at IS NULL AND sign_end_at IS NULL) OR (sign_start_at IS NOT NULL AND sign_end_at IS NOT NULL AND sign_start_at < sign_end_at))',
    );
  }
}
