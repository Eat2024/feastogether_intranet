import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 只新增員工信箱；Portal 資料另行依員編匯入。 */
export class UserNotificationEmail1793750400000 implements MigrationInterface {
  name = 'UserNotificationEmail1793750400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users
      ADD email VARCHAR(255) NULL COMMENT 'Portal 匯入的員工通知信箱'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 已匯入資料時須先備份；移除欄位會丟失其中的信箱。
    await queryRunner.query('ALTER TABLE users DROP COLUMN email');
  }
}
