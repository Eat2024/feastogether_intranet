// ensure-test-db.ts — 測試 schema 前置：migration 前先確保 feastogether_intranet_test 存在。
// fail-closed：DB 名須為 feastogether_intranet_test* 開頭才動作，杜絕誤建/誤動 dev / prod。
// CLI：pnpm -C server db:test:create
import mysql from 'mysql2/promise';

const TEST_DB_PREFIX = 'feastogether_intranet_test';

/** 讀測試 DB 名並守門：非 feastogether_intranet_test* 一律拒絕（fail-closed，杜絕誤動 dev/prod）。 */
export function assertTestDbName(): string {
  const database = process.env.DB_MYSQL_DB ?? '';
  if (!database.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `[test-db] 拒絕：DB_MYSQL_DB="${database}" 非 ${TEST_DB_PREFIX}* 開頭，避免動到 dev/prod`,
    );
  }
  return database;
}

export async function ensureTestDb(): Promise<string> {
  const database = assertTestDbName();

  const connection = await mysql.createConnection({
    host: process.env.DB_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_MYSQL_PORT ?? '3306'),
    user: process.env.DB_MYSQL_USER ?? 'root',
    password: process.env.DB_MYSQL_PASS ?? '',
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  } finally {
    await connection.end();
  }
  return database;
}

if (require.main === module) {
  ensureTestDb()
    .then((database) => console.log(`[test-db] schema ready: ${database}`))
    .catch((err) => {
      console.error('[test-db] 建立失敗', err);
      process.exit(1);
    });
}
