import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

const BUSINESS_TABLES = [
  'hr_departments',
  'users',
  'auth_sessions',
  'esign_documents',
  'esign_document_fields',
  'esign_signers',
  'esign_signature_records',
  'esign_file_objects',
  'esign_audit_events',
  'esign_verification_records',
  'esign_notification_batches',
  'esign_notification_logs',
  'esign_export_jobs',
].sort();

const optionsFor = (database: string) =>
  buildMysqlOptions((key) =>
    key === 'DB_MYSQL_DB' ? database : process.env[key],
  );

describe('e-sign schema migrations', () => {
  jest.setTimeout(60_000);

  it('Spec 03 migration 可 apply → 無 drift → 單獨 revert → reapply', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const dataSource = new DataSource(optionsFor(database));
      await dataSource.initialize();
      try {
        await dataSource.runMigrations();
        const first = await schemaSnapshot(dataSource, database);
        expect(first.tables).toEqual(BUSINESS_TABLES);
        expect(first.timeColumns).toHaveLength(54);
        expect(first.missingTimeIndexes).toEqual([]);
        expect(first.legacyTables).toEqual([]);
        expect(first.authSessionIndexes).toEqual(
          expect.arrayContaining([
            'uq_auth_sessions_source_jti_hash',
            'uq_auth_sessions_launch_code_hash',
            'uq_auth_sessions_session_token_hash',
            'idx_auth_sessions_status_launch_expires_at',
            'idx_auth_sessions_status_expires_at',
            'idx_auth_sessions_user_created_at',
            'idx_auth_sessions_deleted_at',
          ]),
        );
        expect(await authSessionForeignKeys(dataSource, database)).toEqual([
          'fk_auth_sessions_user',
        ]);
        expect(
          (await dataSource.driver.createSchemaBuilder().log()).upQueries,
        ).toEqual([]);

        await dataSource.undoLastMigration();
        expect(await listBusinessTables(dataSource, database)).toEqual(
          BUSINESS_TABLES,
        );
        expect(
          await hasColumn(dataSource, database, 'esign_signers', 'public_id'),
        ).toBe(false);

        await dataSource.runMigrations();
        expect(await schemaSnapshot(dataSource, database)).toEqual(first);
      } finally {
        await dataSource.destroy();
      }
    });
  });
});

async function listBusinessTables(dataSource: DataSource, database: string) {
  const rows = await dataSource.query<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.tables
      WHERE table_schema = ? AND TABLE_NAME <> 'migrations'
      ORDER BY TABLE_NAME`,
    [database],
  );
  return rows.map((row) => row.TABLE_NAME);
}

async function hasColumn(
  dataSource: DataSource,
  database: string,
  table: string,
  column: string,
) {
  const rows = await dataSource.query<Array<{ count: number }>>(
    `SELECT COUNT(*) count FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [database, table, column],
  );
  return Number(rows[0]?.count) === 1;
}

async function schemaSnapshot(dataSource: DataSource, database: string) {
  const timeColumns = await dataSource.query<
    Array<{ TABLE_NAME: string; COLUMN_NAME: string }>
  >(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = ? AND DATA_TYPE IN ('date', 'datetime')
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const missingTimeIndexes: string[] = [];
  for (const column of timeColumns) {
    if (column.TABLE_NAME === 'auth_sessions') continue;
    const expectedName = `idx_${column.TABLE_NAME}_${column.COLUMN_NAME}`;
    const rows = await dataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*) count FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ? AND index_name = ?
          AND column_name = ? AND seq_in_index = 1`,
      [database, column.TABLE_NAME, expectedName, column.COLUMN_NAME],
    );
    if (Number(rows[0]?.count) !== 1) {
      missingTimeIndexes.push(`${column.TABLE_NAME}.${column.COLUMN_NAME}`);
    }
  }
  const legacyRows = await dataSource.query<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.tables
      WHERE table_schema = ? AND (
        (TABLE_NAME LIKE 'auth\\_%' AND TABLE_NAME <> 'auth_sessions') OR TABLE_NAME IN ('roles','permissions','audit_logs','audit_log_targets')
      ) ORDER BY TABLE_NAME`,
    [database],
  );
  return {
    tables: await listBusinessTables(dataSource, database),
    timeColumns,
    missingTimeIndexes,
    legacyTables: legacyRows.map((row) => row.TABLE_NAME),
    authSessionIndexes: await authSessionIndexes(dataSource, database),
  };
}

async function authSessionIndexes(dataSource: DataSource, database: string) {
  const rows = await dataSource.query<Array<{ INDEX_NAME: string }>>(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = 'auth_sessions'
      ORDER BY INDEX_NAME`,
    [database],
  );
  return rows.map((row) => row.INDEX_NAME);
}

async function authSessionForeignKeys(
  dataSource: DataSource,
  database: string,
) {
  const rows = await dataSource.query<Array<{ CONSTRAINT_NAME: string }>>(
    `SELECT CONSTRAINT_NAME FROM information_schema.referential_constraints
      WHERE constraint_schema = ? AND table_name = 'auth_sessions'
      ORDER BY CONSTRAINT_NAME`,
    [database],
  );
  return rows.map((row) => row.CONSTRAINT_NAME);
}
