import { DataSource } from 'typeorm';
import {
  assertTestDbName,
  ensureTestDb,
} from '#app/infrastructure/database/test/ensure-test-db';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';

/**
 * e2e 全套件啟動前跑一次：確保 feastogether_intranet_test 存在並套用目前啟用的 migration。
 * 套用 Spec 1 的乾淨 baseline migration；不需要任何 RBAC seed。
 * 走 jest(ts-jest) 的 #app 解析（與 e2e 測試一致），不依賴 ts-node CLI。
 * fail-closed：DB 名非 feastogether_intranet_test* 一律中止。Spec 2 runtime 不依賴 Redis，
 * 因此此 setup 不連線或清空 Redis；需要 Redis 的獨立測試須自行提供隔離資源。
 */
export default async function globalSetup(): Promise<void> {
  assertTestDbName(); // fail-closed：DB 名非 feastogether_intranet_test* 一律中止，e2e 僅可對測試 DB 執行
  await ensureTestDb(); // CREATE DATABASE IF NOT EXISTS

  const dataSource = new DataSource(buildMysqlOptions());
  await dataSource.initialize();
  try {
    await dataSource.runMigrations(); // schema 與 prod 同源
  } finally {
    await dataSource.destroy();
  }
}
