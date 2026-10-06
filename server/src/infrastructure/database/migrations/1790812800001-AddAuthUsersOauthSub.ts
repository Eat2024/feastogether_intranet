import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 038（D3 修訂 2026-09-20）：auth_users 加可空 oauth_sub，記最近一次統一登入的 OAuth sub。
 * 只作管理者辨識「此帳號曾走 SSO」之用，不是識別鍵（識別一律以 person_empid）；不建索引。
 * 既有 rows 為 NULL＝未曾用統一登入，語意正確，不需資料修補。
 */
export class AddAuthUsersOauthSub1790812800001 implements MigrationInterface {
  name = 'AddAuthUsersOauthSub1790812800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET SESSION lock_wait_timeout = 10');
    await queryRunner.query(`ALTER TABLE auth_users
      ADD COLUMN oauth_sub varchar(255) CHARACTER SET ascii COLLATE ascii_bin NULL
        COMMENT '最近一次統一登入的 OAuth sub（NULL＝未曾用統一登入；非識別鍵）',
      ALGORITHM=INSTANT`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET SESSION lock_wait_timeout = 10');
    await queryRunner.query(`ALTER TABLE auth_users
      DROP COLUMN oauth_sub, ALGORITHM=INSTANT`);
  }
}
