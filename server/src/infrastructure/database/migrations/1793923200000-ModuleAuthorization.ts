import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 授權目錄、角色與原子稽核；初始化只透過明確 console 操作。 */
export class ModuleAuthorization1793923200000 implements MigrationInterface {
  name = 'ModuleAuthorization1793923200000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`authorization_roles\` (
\`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '識別碼',
\`module_key\` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
\`role_code\` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '穩定角色代碼',
\`role_name\` VARCHAR(100) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '角色名稱',
\`is_active\` BOOLEAN NOT NULL DEFAULT 1 COMMENT '是否啟用',
\`version\` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '設定版本',
\`active_role_name\` VARCHAR(100) COLLATE utf8mb4_0900_bin GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN role_name ELSE NULL END) VIRTUAL COMMENT '未刪除角色名稱',
\`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
\`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
\`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
PRIMARY KEY (\`id\`),
KEY \`idx_authorization_roles_created_at\` (\`created_at\`),
KEY \`idx_authorization_roles_updated_at\` (\`updated_at\`),
KEY \`idx_authorization_roles_deleted_at\` (\`deleted_at\`),
UNIQUE KEY \`uq_authorization_roles_code\` (\`module_key\`, \`role_code\`),
UNIQUE KEY \`uq_authorization_roles_scope\` (\`module_key\`, \`id\`),
UNIQUE KEY \`uq_authorization_roles_name\` (\`module_key\`, \`active_role_name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色'`);
    await queryRunner.query(`CREATE TABLE \`authorization_permissions\` (
\`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '識別碼',
\`module_key\` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
\`permission_key\` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '權限代碼',
\`permission_name\` VARCHAR(100) NOT NULL COMMENT '權限名稱',
\`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
\`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
\`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
PRIMARY KEY (\`id\`),
KEY \`idx_authorization_permissions_created_at\` (\`created_at\`),
KEY \`idx_authorization_permissions_updated_at\` (\`updated_at\`),
KEY \`idx_authorization_permissions_deleted_at\` (\`deleted_at\`),
UNIQUE KEY \`uq_authorization_permissions_key\` (\`permission_key\`),
UNIQUE KEY \`uq_authorization_permissions_scope\` (\`module_key\`, \`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='權限目錄'`);
    await queryRunner.query(`CREATE TABLE \`authorization_role_permissions\` (
\`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '識別碼',
\`module_key\` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
\`role_id\` BIGINT UNSIGNED NOT NULL COMMENT '角色 ID',
\`permission_id\` BIGINT UNSIGNED NOT NULL COMMENT '權限 ID',
\`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
\`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
\`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
PRIMARY KEY (\`id\`),
KEY \`idx_authorization_role_permissions_created_at\` (\`created_at\`),
KEY \`idx_authorization_role_permissions_updated_at\` (\`updated_at\`),
KEY \`idx_authorization_role_permissions_deleted_at\` (\`deleted_at\`),
UNIQUE KEY \`uq_authorization_role_permissions_pair\` (\`role_id\`, \`permission_id\`),
CONSTRAINT \`fk_authorization_role_permissions_role_scope\` FOREIGN KEY (\`module_key\`, \`role_id\`) REFERENCES \`authorization_roles\` (\`module_key\`, \`id\`) ON DELETE RESTRICT,
CONSTRAINT \`fk_authorization_role_permissions_permission_scope\` FOREIGN KEY (\`module_key\`, \`permission_id\`) REFERENCES \`authorization_permissions\` (\`module_key\`, \`id\`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色權限關聯'`);
    await queryRunner.query(`CREATE TABLE \`authorization_user_roles\` (
\`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '識別碼',
\`user_id\` BIGINT NOT NULL COMMENT '員工 ID',
\`module_key\` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '子功能代碼',
\`role_id\` BIGINT UNSIGNED NOT NULL COMMENT '角色 ID',
\`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
\`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新時間',
\`deleted_at\` DATETIME(6) NULL COMMENT '軟刪除時間',
PRIMARY KEY (\`id\`),
KEY \`idx_authorization_user_roles_created_at\` (\`created_at\`),
KEY \`idx_authorization_user_roles_updated_at\` (\`updated_at\`),
KEY \`idx_authorization_user_roles_deleted_at\` (\`deleted_at\`),
UNIQUE KEY \`uq_authorization_user_roles_pair\` (\`user_id\`, \`role_id\`),
KEY \`idx_authorization_user_roles_user_scope\` (\`user_id\`, \`module_key\`, \`deleted_at\`),
CONSTRAINT \`fk_authorization_user_roles_role_scope\` FOREIGN KEY (\`module_key\`, \`role_id\`) REFERENCES \`authorization_roles\` (\`module_key\`, \`id\`) ON DELETE RESTRICT,
CONSTRAINT \`fk_authorization_user_roles_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='員工角色關聯'`);
    await queryRunner.query(`CREATE TABLE \`audit_logs\` (
\`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '識別碼',
\`action\` VARCHAR(80) NOT NULL COMMENT '稽核動作',
\`entity_type\` VARCHAR(80) NOT NULL COMMENT '主要目標型別',
\`entity_id\` VARCHAR(64) NOT NULL COMMENT '主要目標 ID',
\`actor_user_id\` BIGINT NULL COMMENT '操作者本地使用者 ID',
\`actor_kind\` VARCHAR(20) NOT NULL COMMENT '操作者種類',
\`source\` VARCHAR(20) NOT NULL COMMENT '操作來源',
\`module_key\` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '子功能代碼',
\`request_id\` VARCHAR(64) NULL COMMENT '請求追蹤 ID',
\`changes\` JSON NOT NULL COMMENT '欄位異動集合',
\`before_snapshot\` JSON NULL COMMENT '異動前快照',
\`after_snapshot\` JSON NULL COMMENT '異動後快照',
\`description\` VARCHAR(500) NULL COMMENT '描述',
\`ip_address\` VARCHAR(45) NULL COMMENT '來源 IP',
\`user_agent\` TEXT NULL COMMENT 'User-Agent',
\`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '建立時間',
PRIMARY KEY (\`id\`),
KEY \`idx_audit_logs_created_at\` (\`created_at\`),
KEY \`idx_audit_logs_entity\` (\`entity_type\`, \`entity_id\`, \`created_at\`, \`id\`),
KEY \`idx_audit_logs_actor\` (\`actor_user_id\`, \`created_at\`, \`id\`),
KEY \`idx_audit_logs_action\` (\`action\`, \`created_at\`, \`id\`),
KEY \`idx_audit_logs_module\` (\`module_key\`, \`created_at\`, \`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用稽核歷史紀錄（append-only）'`);
    await queryRunner.query(
      'INSERT INTO typeorm_metadata (type, `schema`, `table`, name, value) VALUES (?, DATABASE(), ?, ?, ?)',
      [
        'GENERATED_COLUMN',
        'authorization_roles',
        'active_role_name',
        'CASE WHEN deleted_at IS NULL THEN role_name ELSE NULL END',
      ],
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'authorization_roles',
      'authorization_permissions',
      'authorization_role_permissions',
      'authorization_user_roles',
      'audit_logs',
    ]) {
      const rows = (await queryRunner.query(
        `SELECT COUNT(*) AS total FROM ${table}`,
      )) as Array<{ total: number }>;
      if (Number(rows[0].total) > 0)
        throw new Error(
          '無法回滾：授權資料或稽核必須保留，請向前修復或使用一致備份',
        );
    }
    await queryRunner.query('DROP TABLE audit_logs');
    await queryRunner.query('DROP TABLE authorization_user_roles');
    await queryRunner.query('DROP TABLE authorization_role_permissions');
    await queryRunner.query('DROP TABLE authorization_permissions');
    await queryRunner.query('DROP TABLE authorization_roles');
    await queryRunner.query(
      'DELETE FROM typeorm_metadata WHERE type = ? AND `schema` = DATABASE() AND `table` = ?',
      ['GENERATED_COLUMN', 'authorization_roles'],
    );
  }
}
