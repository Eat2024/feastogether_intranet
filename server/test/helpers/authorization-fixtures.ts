import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { SuperUserAccessRepository } from '#app/features/auth/repositories/super-user-access.repository';
import { AuthorizationRepository } from '#app/features/authorization/repositories/authorization.repository';
import { AuditLogRepository } from '#app/features/audit/repositories/audit-log.repository';
import { AuditLogService } from '#app/features/audit/services/audit-log.service';
import { AuthorizationAuditService } from '#app/features/authorization/services/authorization-audit.service';
import { AuthorizationCatalogService } from '#app/features/authorization/services/authorization-catalog.service';

/** 每次獨立空測試庫；helper 自身強制 feastogether_intranet_test 前綴。 */
export async function withAuthorizationDatabase(
  run: (db: DataSource) => Promise<void>,
) {
  await withSchemaTestDatabase(async ({ database }) => {
    const db = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    try {
      await db.runMigrations();
      await run(db);
    } finally {
      if (db.isInitialized) await db.destroy();
    }
  });
}

/** 真實 service/repository 與合成維護設定；沒有 Portal、Redis、HTTP 或 worker。 */
export function authorizationServices(db: DataSource) {
  const mysql = new MysqlService(db);
  const repository = new AuthorizationRepository();
  const events = new AuditLogRepository();
  const audit = new AuthorizationAuditService(new AuditLogService(events));
  const config = new SuperUserConfigService(new ConfigService(process.env));
  const catalog = new AuthorizationCatalogService(
    mysql,
    repository,
    audit,
    new SuperUserAccessRepository(),
    config,
  );
  return { mysql, repository, events, audit, config, catalog };
}

export async function initializeAuthorizationOperator(db: DataSource) {
  const services = authorizationServices(db);
  await db.query(
    `INSERT INTO super_user_access (id, entry_key, entry_generation, rotated_at, period_start_at, active_credential_fingerprint, credential_generation, credential_activated_at) VALUES (1, ?, 1, NOW(6), NOW(6), ?, 1, NOW(6))`,
    ['a'.repeat(43), services.config.fingerprint],
  );
  return services;
}

/** 第二子功能僅存在測試 DB，絕不加入正式 catalog。 */
export async function createAuthorizationScopeFixtures(db: DataSource) {
  await db.query(
    "INSERT INTO hr_departments (department_name) VALUES ('測試甲部門'),('測試乙部門')",
  );
  await db.query(
    "INSERT INTO users (empid,name,department_id) SELECT 'AZ-001','合成甲員工',id FROM hr_departments WHERE department_name='測試甲部門'",
  );
  await db.query(
    "INSERT INTO users (empid,name,department_id) SELECT 'AZ-002','合成乙員工',id FROM hr_departments WHERE department_name='測試乙部門'",
  );
  await db.query(
    "INSERT INTO authorization_roles (module_key,role_code,role_name) VALUES ('esign','test-role','同名角色'),('test-module','test-role','同名角色')",
  );
  await db.query(
    "INSERT INTO authorization_permissions (module_key,permission_key,permission_name) VALUES ('esign','esign.document.read','閱讀文件'),('test-module','test-module.document.read','測試閱讀')",
  );
}

/** 既有業務 e2e 的明確目錄前置；只在測試 app.init 前執行，不是正式啟動行為。 */
export async function seedAuthorizationCatalog(db: DataSource) {
  const services = authorizationServices(db);
  if ((await services.repository.permissions(db.manager)).length) {
    await services.catalog.assertReady();
    return;
  }
  const access = new SuperUserAccessRepository();
  const existing = await access.find(db.manager);
  if (!existing) await initializeAuthorizationOperator(db);
  try {
    await services.catalog.syncCatalog();
  } finally {
    if (!existing) await db.query('DELETE FROM super_user_access WHERE id = 1');
  }
}
