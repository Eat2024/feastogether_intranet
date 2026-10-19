import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 到期是可重新開放的狀態，不改寫歷史停止文件與固定證據。 */
export class ExpiredDocuments1792368000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE esign_documents DROP CHECK chk_esign_documents_status,
      ADD CONSTRAINT chk_esign_documents_status CHECK (status IN ('draft','active','expired','finalizing','completed','stopped'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`SELECT
      (EXISTS(SELECT 1 FROM esign_documents WHERE status='expired') OR
       EXISTS(SELECT 1 FROM esign_audit_events WHERE event_type='document.reopened')) AS used`)) as Array<{
      used: number;
    }>;
    if (Number(rows[0]?.used))
      throw new Error('已存在到期文件或補簽歷程，無法回滾已到期狀態');
    await queryRunner.query(`ALTER TABLE esign_documents DROP CHECK chk_esign_documents_status,
      ADD CONSTRAINT chk_esign_documents_status CHECK (status IN ('draft','active','finalizing','completed','stopped'))`);
  }
}
