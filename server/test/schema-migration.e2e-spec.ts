import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { revertAfter } from './schema-migration.helper';

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

  it('內部邀請 migration 前置 schema 不符時，任何 DDL 前拒絕', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = await new DataSource(optionsFor(database)).initialize();
      try {
        await ds.runMigrations();
        await revertAfter(ds, 'SignerNote1792454404000');
        await ds.query(
          'ALTER TABLE esign_signers RENAME INDEX uq_esign_signers_document_email TO unexpected_email_index',
        );
        await expect(ds.runMigrations()).rejects.toThrow();
        expect(
          await hasColumn(ds, database, 'esign_signers', 'external_email'),
        ).toBe(false);
      } finally {
        await ds.destroy();
      }
    });
  });

  it('既有單人完成文件只轉換 owner metadata，不改原檔、完成檔摘要或簽署 payload', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = new DataSource(optionsFor(database));
      await ds.initialize();
      try {
        await ds.runMigrations();
        await revertAfter(ds, 'SharedFieldsPersonalCopies1792195200000');
        await ds.undoLastMigration(); // 個人副本
        await ds.query(
          "INSERT INTO users (empid,name) VALUES ('MIGRATION001','合成員工')",
        );
        await ds.query(
          "INSERT INTO esign_documents (doc_number,title,created_by_user_id,status,sign_start_at,sign_end_at,signing_payload_json,signing_payload_sha256) VALUES ('00000000-0000-4000-8000-000000000001','既有單人文件',1,'completed','2026-01-01','2026-12-31',?,?)",
          [
            JSON.stringify({ schemaVersion: 1, original: true }),
            'a'.repeat(64),
          ],
        );
        await ds.query(
          "INSERT INTO esign_signers (public_id,document_id,signer_type,user_id,empid_snapshot,name_snapshot,status,signed_at) VALUES ('00000000-0000-4000-8000-000000000002',1,'user',1,'MIGRATION001','合成員工','signed',NOW(6))",
        );
        await ds.query(
          "INSERT INTO esign_signature_records (signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES (1,?,?,'v1','employee_session','migration-record',NOW(6))",
          ['b'.repeat(64), 'a'.repeat(64)],
        );
        await ds.query(
          "INSERT INTO esign_file_objects (document_id,file_purpose,object_key,mime_type,file_size,sha256) VALUES (1,'source_pdf','existing-source','application/pdf',123,?),(1,'completed_pdf','existing-completed','application/pdf',456,?)",
          ['b'.repeat(64), 'c'.repeat(64)],
        );
        const before: unknown[] = await ds.query(
          'SELECT signing_payload_json, signing_payload_sha256 FROM esign_documents WHERE id=1',
        );
        await ds.runMigrations();
        expect(
          await ds.query(
            'SELECT signing_payload_json, signing_payload_sha256 FROM esign_documents WHERE id=1',
          ),
        ).toEqual(before);
        const files: Array<{
          document_id: number | null;
          signature_record_id: number | null;
          object_key: string;
          sha256: string;
          file_size: string;
        }> = await ds.query(
          'SELECT document_id,signature_record_id,object_key,sha256,file_size FROM esign_file_objects ORDER BY id',
        );
        expect(files[0]).toMatchObject({
          document_id: 1,
          signature_record_id: null,
          object_key: 'existing-source',
          sha256: 'b'.repeat(64),
        });
        expect(files[1]).toMatchObject({
          document_id: null,
          signature_record_id: 1,
          object_key: 'existing-completed',
          sha256: 'c'.repeat(64),
        });
        expect(Number(files[1].file_size)).toBe(456);
        expect(
          await ds.query(
            'SELECT completion_status FROM esign_signers WHERE id=1',
          ),
        ).toEqual([{ completion_status: 'ready' }]);
      } finally {
        await ds.destroy();
      }
    });
  });

  it.each(['expired', 'reopened'])(
    '存在 %s 資料時禁止回滾且不改寫資料',
    async (kind) => {
      await withSchemaTestDatabase(async ({ database }) => {
        const ds = new DataSource(optionsFor(database));
        await ds.initialize();
        try {
          await ds.runMigrations();
          await ds.query(
            "INSERT INTO users (empid,name) VALUES ('EXPIRY001','合成員工')",
          );
          await ds.query(
            "INSERT INTO esign_documents (doc_number,title,created_by_user_id,status,sign_start_at,sign_end_at) VALUES ('00000000-0000-4000-8000-000000000001','到期文件',1,?,'2026-01-01','2026-12-31')",
            [kind === 'expired' ? 'expired' : 'stopped'],
          );
          if (kind === 'reopened')
            await ds.query(
              "INSERT INTO esign_audit_events (document_id,event_type,occurred_at,event_hash) VALUES (1,'document.reopened',NOW(6),?)",
              ['a'.repeat(64)],
            );
          const before: unknown = await ds.query(
            'SELECT * FROM esign_documents',
          );
          await revertAfter(ds, 'ExpiredDocuments1792368000000');
          await expect(ds.undoLastMigration()).rejects.toThrow('無法回滾');
          expect(await ds.query('SELECT * FROM esign_documents')).toEqual(
            before,
          );
        } finally {
          await ds.destroy();
        }
      });
    },
  );

  it('單端期間草稿禁止回滾，不能遺失已保存日期', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = new DataSource(optionsFor(database));
      await ds.initialize();
      try {
        await ds.runMigrations();
        await ds.query(
          "INSERT INTO users (empid,name) VALUES ('DRAFT009','合成員工')",
        );
        await ds.query(
          "INSERT INTO esign_documents (doc_number,title,created_by_user_id,sign_start_at) VALUES ('00000000-0000-4000-8000-000000000009','單端草稿',1,'2020-01-01')",
        );
        const before: unknown = await ds.query('SELECT * FROM esign_documents');
        await revertAfter(ds, 'DraftSettings1792454400000');
        await expect(ds.undoLastMigration()).rejects.toThrow('無法回滾');
        expect(await ds.query('SELECT * FROM esign_documents')).toEqual(before);
      } finally {
        await ds.destroy();
      }
    });
  });

  it('匯出紀錄 migration 保留既有 ZIP 工作，可 up → down → up', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = new DataSource(optionsFor(database));
      await ds.initialize();
      try {
        await ds.runMigrations();
        await revertAfter(ds, 'InternalEmailInvitations1792454405000');
        const reverted = await exportJobsShape(ds, database);
        await seedExportDocument(ds);
        await ds.query(
          "INSERT INTO esign_export_jobs (public_id,export_type,document_id,created_by_user_id,status,scope_description,snapshot_json) VALUES ('00000000-0000-4000-8000-000000000033','signed_copies_zip',1,1,'completed','全部簽署人',JSON_ARRAY())",
        );

        await ds.runMigrations();
        const applied = await exportJobsShape(ds, database);
        expect(applied).toEqual({
          createdByNullable: 'YES',
          newColumns: ['conditions_json', 'signer_id'],
          indexes: expect.objectContaining({
            idx_esign_export_jobs_type_created: 'export_type,created_at,id',
            idx_esign_export_jobs_document_type_created:
              'document_id,export_type,created_at,id',
            idx_esign_export_jobs_signer_created: 'signer_id,created_at,id',
            idx_esign_export_jobs_created_at: 'created_at',
            idx_esign_export_jobs_completed_at: 'completed_at',
          }) as unknown,
          checks: ['chk_esign_export_jobs_record_type'],
          foreignKeys: [
            'fk_esign_export_jobs_document:RESTRICT',
            'fk_esign_export_jobs_signer:RESTRICT',
            'fk_esign_export_jobs_user:RESTRICT',
          ],
        });
        // 既有 ZIP 工作在 CHECK 下仍可更新。
        await ds.query(
          "UPDATE esign_export_jobs SET scope_description='全部簽署人（重新整理）' WHERE id=1",
        );

        await ds.undoLastMigration();
        expect(await exportJobsShape(ds, database)).toEqual(reverted);
        expect(reverted).toMatchObject({
          createdByNullable: 'NO',
          newColumns: [],
          checks: [],
        });

        await ds.runMigrations();
        expect(await exportJobsShape(ds, database)).toEqual(applied);
      } finally {
        await ds.destroy();
      }
    });
  });

  it.each([
    [
      'excel',
      "INSERT INTO esign_export_jobs (public_id,export_type,document_id,created_by_user_id,conditions_json,status,scope_description,record_count,completed_at) VALUES ('00000000-0000-4000-8000-000000000034','excel',1,1,JSON_OBJECT('statuses',JSON_ARRAY('signed'),'depts',JSON_ARRAY(),'fields',JSON_ARRAY('name')),'completed','全部',1,NOW(6))",
    ],
    [
      'pdf',
      "INSERT INTO esign_export_jobs (public_id,export_type,document_id,created_by_user_id,signer_id,status,scope_description,record_count,completed_at) VALUES ('00000000-0000-4000-8000-000000000035','pdf',1,NULL,1,'completed','外部（external@example.test）',1,NOW(6))",
    ],
  ])(
    '已有 %s 紀錄時，匯出紀錄 migration 在任何 DDL 前拒絕回滾',
    async (_type, insertRecord) => {
      await withSchemaTestDatabase(async ({ database }) => {
        const ds = new DataSource(optionsFor(database));
        await ds.initialize();
        try {
          await ds.runMigrations();
          await seedExportDocument(ds);
          await ds.query(insertRecord);
          const rows: unknown = await ds.query(
            'SELECT * FROM esign_export_jobs ORDER BY id',
          );
          const shape = await exportJobsShape(ds, database);

          await expect(ds.undoLastMigration()).rejects.toThrow('無法回滾');
          expect(
            await ds.query('SELECT * FROM esign_export_jobs ORDER BY id'),
          ).toEqual(rows);
          expect(await exportJobsShape(ds, database)).toEqual(shape);
        } finally {
          await ds.destroy();
        }
      });
    },
  );

  it('最新 migration 可 apply → 無 drift → 單獨 revert → reapply', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const dataSource = new DataSource(optionsFor(database));
      await dataSource.initialize();
      try {
        await dataSource.runMigrations();
        const first = await schemaSnapshot(dataSource, database);
        expect(first.tables).toEqual(BUSINESS_TABLES);
        expect(first.timeColumns).toHaveLength(60);
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
          await hasColumn(
            dataSource,
            database,
            'esign_signers',
            'completion_status',
          ),
        ).toBe(true);

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
      WHERE table_schema = ? AND TABLE_NAME NOT IN ('migrations','typeorm_metadata')
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

async function seedExportDocument(ds: DataSource): Promise<void> {
  await ds.query(
    "INSERT INTO users (empid,name) VALUES ('EXPORT001','合成員工')",
  );
  await ds.query(
    "INSERT INTO esign_documents (doc_number,title,created_by_user_id) VALUES ('00000000-0000-4000-8000-000000000031','匯出文件',1)",
  );
  await ds.query(
    "INSERT INTO esign_signers (public_id,document_id,signer_type,name_snapshot,email) VALUES ('00000000-0000-4000-8000-000000000032',1,'email','外部','external@example.test')",
  );
}

/** 匯出紀錄 migration 影響的欄位、索引、CHECK 與外鍵。 */
async function exportJobsShape(dataSource: DataSource, database: string) {
  const columns = await dataSource.query<
    Array<{ COLUMN_NAME: string; IS_NULLABLE: string }>
  >(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.columns
      WHERE table_schema = ? AND table_name = 'esign_export_jobs'
        AND COLUMN_NAME IN ('created_by_user_id','signer_id','conditions_json')
      ORDER BY COLUMN_NAME`,
    [database],
  );
  const indexRows = await dataSource.query<
    Array<{ INDEX_NAME: string; COLUMN_NAME: string }>
  >(
    `SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = 'esign_export_jobs'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  const indexes: Record<string, string> = {};
  for (const { INDEX_NAME, COLUMN_NAME } of indexRows) {
    indexes[INDEX_NAME] = indexes[INDEX_NAME]
      ? `${indexes[INDEX_NAME]},${COLUMN_NAME}`
      : COLUMN_NAME;
  }
  const checks = await dataSource.query<Array<{ CONSTRAINT_NAME: string }>>(
    `SELECT CONSTRAINT_NAME FROM information_schema.table_constraints
      WHERE constraint_schema = ? AND table_name = 'esign_export_jobs'
        AND constraint_type = 'CHECK'
      ORDER BY CONSTRAINT_NAME`,
    [database],
  );
  const foreignKeys = await dataSource.query<
    Array<{ CONSTRAINT_NAME: string; DELETE_RULE: string }>
  >(
    `SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.referential_constraints
      WHERE constraint_schema = ? AND table_name = 'esign_export_jobs'
      ORDER BY CONSTRAINT_NAME`,
    [database],
  );
  return {
    createdByNullable: columns.find(
      (column) => column.COLUMN_NAME === 'created_by_user_id',
    )?.IS_NULLABLE,
    newColumns: columns
      .map((column) => column.COLUMN_NAME)
      .filter((name) => name !== 'created_by_user_id'),
    indexes,
    checks: checks.map((check) => check.CONSTRAINT_NAME),
    foreignKeys: foreignKeys.map(
      (key) => `${key.CONSTRAINT_NAME}:${key.DELETE_RULE}`,
    ),
  };
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
