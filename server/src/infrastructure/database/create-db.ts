// create-db.ts — 開發資料庫前置：migration 前先確保 DB_MYSQL_DB 存在（utf8mb4）。
// 連線設定與 app／migration CLI 共用 buildMysqlOptions（含 TLS 選項），避免漂移。
// 已部署環境（NODE_ENV=production / staging）一律拒絕：正式庫由部署流程建立。
//
// CLI：pnpm -C server db:create
//      pnpm -C server db:setup（依序 db:create → migration:run → seed:rbac）
import mysql from 'mysql2/promise';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { AppEnvironment } from '#app/config/app.environment';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';

/** DB 名直接組進 CREATE DATABASE，只接受英數、底線、連字號。 */
const SAFE_DB_NAME = /^[A-Za-z0-9_-]+$/;

/** 檢查目標可建立：非已部署環境、DB 名合法；回傳 DB 名。 */
export function assertDevDbTarget(
  nodeEnv: string | undefined,
  database: string | undefined,
): string {
  if (
    nodeEnv === AppEnvironment.Production ||
    nodeEnv === AppEnvironment.Staging
  ) {
    throw new Error(
      `[db:create] 拒絕：NODE_ENV=${nodeEnv}，已部署環境的資料庫由部署流程建立`,
    );
  }
  if (!database || !SAFE_DB_NAME.test(database)) {
    throw new Error(
      `[db:create] DB_MYSQL_DB="${database ?? ''}" 不合法（只接受英數、底線、連字號）`,
    );
  }
  return database;
}

/** 建立資料庫（已存在則不動）；回傳 DB 名與是否為本次新建。 */
export async function ensureDevDb(): Promise<{
  database: string;
  created: boolean;
}> {
  const options = buildMysqlOptions() as MysqlConnectionOptions;
  const database = assertDevDbTarget(process.env.NODE_ENV, options.database);

  // 不指定 database 連線（目標庫可能還不存在）
  const connection = await mysql.createConnection({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    ...(options.ssl ? { ssl: options.ssl as mysql.SslOptions } : {}),
  });
  try {
    const [rows] = await connection.query(
      'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [database],
    );
    const existed = (rows as unknown[]).length > 0;
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    return { database, created: !existed };
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  ensureDevDb()
    .then(({ database, created }) =>
      console.log(
        created
          ? `[db:create] 已建立資料庫：${database}`
          : `[db:create] 資料庫已存在，未變更：${database}`,
      ),
    )
    .catch((err) => {
      console.error('[db:create] 失敗', err);
      process.exit(1);
    });
}
