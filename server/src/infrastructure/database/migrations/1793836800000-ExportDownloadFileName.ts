import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 舊紀錄不推測檔名；新增 nullable 快照欄位。 */
export class ExportDownloadFileName1793836800000 implements MigrationInterface {
  name = 'ExportDownloadFileName1793836800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE esign_export_jobs
      ADD download_file_name VARCHAR(1024) NULL COMMENT '首次下載提供的檔名快照，NULL 為尚未記錄'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 回滾會移除已記錄的檔名，需先備份。
    await queryRunner.query(
      'ALTER TABLE esign_export_jobs DROP COLUMN download_file_name',
    );
  }
}
