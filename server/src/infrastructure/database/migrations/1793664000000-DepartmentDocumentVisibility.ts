import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 只新增部門欄位；指定環境的舊文件回填由獨立切換程序執行。 */
export class DepartmentDocumentVisibility1793664000000 implements MigrationInterface {
  name = 'DepartmentDocumentVisibility1793664000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users
      ADD department_code VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL COMMENT '可信上游部門代碼'`);
    await queryRunner.query(`ALTER TABLE esign_documents
      ADD created_by_department_code VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL COMMENT '建立時部門代碼快照',
      ADD created_by_department_name VARCHAR(150) NULL COMMENT '建立時部門名稱快照',
      ADD INDEX idx_esign_documents_department_deleted_updated_id (created_by_department_code, deleted_at, updated_at, id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE esign_documents
      DROP INDEX idx_esign_documents_department_deleted_updated_id,
      DROP COLUMN created_by_department_name,
      DROP COLUMN created_by_department_code`);
    await queryRunner.query('ALTER TABLE users DROP COLUMN department_code');
  }
}
