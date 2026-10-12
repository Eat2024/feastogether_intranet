import { randomUUID } from 'node:crypto';
import mysql, { type Connection } from 'mysql2/promise';

const TEST_DB_PREFIX = 'feastogether_intranet_test';
const SAFE_DATABASE_NAME = /^[a-zA-Z0-9_]+$/;

export interface SchemaTestDatabase {
  database: string;
}

export function assertSchemaTestDatabaseName(database: string): string {
  if (
    !database.startsWith(TEST_DB_PREFIX) ||
    !SAFE_DATABASE_NAME.test(database)
  ) {
    throw new Error(
      `[schema-test-db] 拒絕操作非 ${TEST_DB_PREFIX}* 測試資料庫：${database}`,
    );
  }
  return database;
}

export function createSchemaTestDatabaseName(
  baseName = process.env.DB_MYSQL_DB ?? '',
): string {
  assertSchemaTestDatabaseName(baseName);
  const suffix = randomUUID().replaceAll('-', '');
  return assertSchemaTestDatabaseName(`${baseName}_${suffix}`);
}

async function openAdminConnection(): Promise<Connection> {
  return mysql.createConnection({
    host: process.env.DB_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_MYSQL_PORT ?? '3306'),
    user: process.env.DB_MYSQL_USER ?? 'root',
    password: process.env.DB_MYSQL_PASS ?? '',
  });
}

export async function withSchemaTestDatabase<T>(
  run: (context: SchemaTestDatabase) => Promise<T>,
): Promise<T> {
  const database = createSchemaTestDatabaseName();
  const connection = await openAdminConnection();
  try {
    await connection.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    try {
      return await run({ database });
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    }
  } finally {
    await connection.end();
  }
}
