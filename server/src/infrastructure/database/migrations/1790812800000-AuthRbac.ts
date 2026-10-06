import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auth / RBAC 初始 schema：使用者、角色、三層權限字典（group → job → permission）、
 * 角色 × 權限、端點登錄（@RegisterApi 開機同步）、通用稽核紀錄。
 *
 * 單一 migration 建立全部 auth 表；欄位註解與 FK 名稱
 * 以 entity 為準，`migration:generate` 不會產生差異。
 * 權限字典 / ADMIN 角色 / 超級使用者由 `pnpm seed:rbac` 寫入，不在此處。
 */
const CREATE_TABLES: ReadonlyArray<[table: string, ddl: string]> = [
  [
    'auth_group',
    `CREATE TABLE \`auth_group\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`group_key\` varchar(100) NOT NULL COMMENT '分組鍵，例 permissionManagement',
  \`group_name\` varchar(100) NOT NULL COMMENT '分組名稱，例 權限管理',
  \`sort_order\` int DEFAULT NULL COMMENT '顯示排序',
  \`is_active\` tinyint NOT NULL DEFAULT 1 COMMENT '啟用',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_group_group_key\` (\`group_key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='權限分組（層級第一層）'`,
  ],
  [
    'auth_group_jobs',
    `CREATE TABLE \`auth_group_jobs\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`group_id\` bigint NOT NULL COMMENT '分組（FK→auth_group.id）',
  \`job_key\` varchar(100) NOT NULL COMMENT '功能鍵，例 roleManagement',
  \`job_name\` varchar(100) NOT NULL COMMENT '功能名稱',
  \`sort_order\` int DEFAULT NULL COMMENT '顯示排序',
  \`is_active\` tinyint NOT NULL DEFAULT 1 COMMENT '啟用（隱藏整功能用此）',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_group_jobs_group_job\` (\`group_id\`,\`job_key\`),
  KEY \`idx_auth_group_jobs_group_id\` (\`group_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='功能項目（層級第二層）'`,
  ],
  [
    'auth_job_permission',
    `CREATE TABLE \`auth_job_permission\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`job_id\` bigint NOT NULL COMMENT '功能（FK→auth_group_jobs.id）',
  \`permission_key\` varchar(150) NOT NULL COMMENT '<job_key>.<action>',
  \`action\` varchar(30) NOT NULL COMMENT 'view / createEdit / delete / printExport',
  \`permission_name\` varchar(150) NOT NULL COMMENT '權限全名，例 查看角色管理',
  \`sort_order\` int DEFAULT NULL COMMENT '顯示排序',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_job_permission_key\` (\`permission_key\`),
  UNIQUE KEY \`uq_auth_job_permission_job_action\` (\`job_id\`,\`action\`),
  KEY \`idx_auth_job_permission_job_id\` (\`job_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='功能權限（層級第三層，授權葉節點）'`,
  ],
  [
    'auth_roles',
    `CREATE TABLE \`auth_roles\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`role_code\` varchar(50) NOT NULL COMMENT '角色代碼（後端產生，不可前端編輯；ADMIN 保留）',
  \`role_name\` varchar(100) NOT NULL COMMENT '角色名稱',
  \`is_admin\` tinyint NOT NULL DEFAULT 0 COMMENT '全權限角色',
  \`is_active\` tinyint NOT NULL DEFAULT 1 COMMENT '啟用',
  \`sort_order\` int DEFAULT NULL COMMENT '顯示排序',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_roles_role_code\` (\`role_code\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='本地系統角色'`,
  ],
  [
    'auth_role_permissions',
    `CREATE TABLE \`auth_role_permissions\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`role_id\` bigint NOT NULL COMMENT '角色（FK→auth_roles.id）',
  \`permission_id\` bigint NOT NULL COMMENT '權限（FK→auth_job_permission.id）',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_role_permissions_role_perm\` (\`role_id\`,\`permission_id\`),
  KEY \`idx_auth_role_permissions_role_id\` (\`role_id\`),
  KEY \`idx_auth_role_permissions_permission_id\` (\`permission_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色 × 權限（M:N）'`,
  ],
  [
    'auth_users',
    `CREATE TABLE \`auth_users\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`person_empid\` varchar(32) NOT NULL COMMENT '員工工號（主要識別）',
  \`person_name\` varchar(100) NOT NULL COMMENT '姓名',
  \`person_status\` varchar(50) DEFAULT NULL COMMENT '來源人員狀態',
  \`role_id\` bigint DEFAULT NULL COMMENT '單一系統角色（FK→auth_roles.id）；NULL=無功能權限',
  \`department_code\` varchar(50) DEFAULT NULL COMMENT '部門/門市代碼（顯示）',
  \`department_name\` varchar(150) DEFAULT NULL COMMENT '部門名稱（冗餘顯示；來源同步時一併寫入）',
  \`title_name\` varchar(100) DEFAULT NULL COMMENT '職稱名稱（冗餘顯示；來源同步時一併寫入）',
  \`description\` varchar(500) DEFAULT NULL COMMENT '本地備註（不被登入同步覆蓋）',
  \`is_active\` tinyint NOT NULL DEFAULT 1 COMMENT '帳號啟用',
  \`last_login_at\` datetime(6) DEFAULT NULL COMMENT '最後登入時間',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_users_person_empid\` (\`person_empid\`),
  KEY \`idx_auth_users_role_id\` (\`role_id\`),
  KEY \`idx_auth_users_department_code\` (\`department_code\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='本地使用者'`,
  ],
  [
    'auth_apis',
    `CREATE TABLE \`auth_apis\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`api_key\` varchar(150) NOT NULL COMMENT '由 @RegisterApi 宣告，例 roles.rename',
  \`method\` varchar(10) NOT NULL COMMENT '僅 GET / POST',
  \`route\` varchar(200) NOT NULL COMMENT '路由樣板，例 /api/roles/:id',
  \`is_public\` tinyint NOT NULL DEFAULT 0 COMMENT '同步自 @Public()（稽核 metadata）',
  \`is_active\` tinyint NOT NULL DEFAULT 1 COMMENT '啟用',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_apis_api_key\` (\`api_key\`),
  UNIQUE KEY \`uq_auth_apis_method_route\` (\`method\`,\`route\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='受保護端點登錄表'`,
  ],
  [
    'auth_api_permissions',
    `CREATE TABLE \`auth_api_permissions\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`updated_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6) COMMENT '更新時間',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '刪除時間（軟刪除）',
  \`created_by\` varchar(64) DEFAULT NULL COMMENT '建立者（使用者 ID）',
  \`updated_by\` varchar(64) DEFAULT NULL COMMENT '更新者（使用者 ID）',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`api_id\` bigint NOT NULL COMMENT '端點（FK→auth_apis.id）',
  \`permission_id\` bigint NOT NULL COMMENT '權限（FK→auth_job_permission.id）',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_auth_api_permissions_api_perm\` (\`api_id\`,\`permission_id\`),
  KEY \`idx_auth_api_permissions_api_id\` (\`api_id\`),
  KEY \`idx_auth_api_permissions_permission_id\` (\`permission_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='端點 × 權限（M:N，OR 語意）'`,
  ],
  [
    'audit_logs',
    `CREATE TABLE \`audit_logs\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`action\` varchar(80) NOT NULL COMMENT '稽核動作',
  \`entity_type\` varchar(80) NOT NULL COMMENT '主要目標型別',
  \`entity_id\` varchar(64) NOT NULL COMMENT '主要目標 ID',
  \`actor_user_id\` bigint DEFAULT NULL COMMENT '操作者使用者 ID',
  \`changes\` longtext NOT NULL COMMENT '欄位異動集合，格式為 field: [before, after]',
  \`before_snapshot\` longtext DEFAULT NULL COMMENT '異動前快照',
  \`after_snapshot\` longtext DEFAULT NULL COMMENT '異動後快照',
  \`description\` varchar(500) DEFAULT NULL COMMENT '描述',
  \`ip_address\` varchar(45) DEFAULT NULL COMMENT '來源 IP',
  \`user_agent\` text DEFAULT NULL COMMENT 'User-Agent（TEXT：真實 UA 可能超過 500 字，避免 strict mode 截斷/報錯）',
  PRIMARY KEY (\`id\`),
  KEY \`idx_audit_logs_entity\` (\`entity_type\`,\`entity_id\`,\`created_at\`,\`id\`),
  KEY \`idx_audit_logs_actor\` (\`actor_user_id\`,\`created_at\`,\`id\`),
  KEY \`idx_audit_logs_action\` (\`action\`,\`created_at\`,\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用稽核歷史紀錄'`,
  ],
  [
    'audit_log_targets',
    `CREATE TABLE \`audit_log_targets\` (
  \`created_at\` datetime(6) NOT NULL DEFAULT current_timestamp(6) COMMENT '建立時間',
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '流水號',
  \`audit_log_id\` bigint NOT NULL COMMENT '稽核紀錄 ID（FK→audit_logs.id）',
  \`target_kind\` varchar(20) NOT NULL COMMENT '目標類型：primary / associated',
  \`target_type\` varchar(80) NOT NULL COMMENT '查詢目標型別',
  \`target_id\` varchar(64) NOT NULL COMMENT '查詢目標 ID',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_audit_log_targets_unique\` (\`audit_log_id\`,\`target_kind\`,\`target_type\`,\`target_id\`),
  KEY \`idx_audit_log_targets_lookup\` (\`target_type\`,\`target_id\`,\`target_kind\`,\`audit_log_id\`),
  CONSTRAINT \`FK_ba28256499b81083209b43b8305\` FOREIGN KEY (\`audit_log_id\`) REFERENCES \`audit_logs\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='稽核紀錄查詢目標'`,
  ],
];

export class AuthRbac1790812800000 implements MigrationInterface {
  name = 'AuthRbac1790812800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [, ddl] of CREATE_TABLES) {
      await queryRunner.query(ddl);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table] of [...CREATE_TABLES].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }
}
