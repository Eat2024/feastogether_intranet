import { DataSource } from 'typeorm';
import {
  assertTestDbName,
  ensureTestDb,
} from '#app/infrastructure/database/test/ensure-test-db';
import {
  assertTestRedisDb,
  flushTestRedis,
} from '#app/infrastructure/database/test/ensure-test-redis';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';

/**
 * e2e 全套件啟動前跑一次：確保 feastogether_intranet_test 存在並套用目前啟用的 migration。
 * Auth/RBAC/Audit 目前停用，因此不載入其 migration，也不執行 RBAC seed。
 * 走 jest(ts-jest) 的 #app 解析（與 e2e 測試一致），不依賴 ts-node CLI。
 * fail-closed：DB 名非 feastogether_intranet_test* 一律中止，e2e 僅可對測試 DB 執行。
 */
export default async function globalSetup(): Promise<void> {
  assertTestDbName(); // fail-closed：DB 名非 feastogether_intranet_test* 一律中止，e2e 僅可對測試 DB 執行
  assertTestRedisDb(); // fail-closed：REDIS_DB 非 0 才可跑,杜絕誤刷 dev keyspace

  // 清空 e2e 專屬 Redis db(跨輪殘留:session/cache/限流計數)。
  // 範圍受 REDIS_DB 隔離保護,只刷 e2e 自己的 db。
  await flushTestRedis();

  await ensureTestDb(); // CREATE DATABASE IF NOT EXISTS

  const dataSource = new DataSource(buildMysqlOptions());
  await dataSource.initialize();
  try {
    await dataSource.runMigrations(); // schema 與 prod 同源
  } finally {
    await dataSource.destroy();
  }
}
