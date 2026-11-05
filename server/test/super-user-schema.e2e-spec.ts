import { randomBytes } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { lastMigrationName } from './schema-migration.helper';

const MIGRATION = 'SuperUserAccess1793836802000';
const NEW_SESSION_COLUMNS = [
  'actor_kind',
  'credential_generation',
  'replacement_session_id',
];

const optionsFor = (database: string, includeMigration = true) => {
  const options = buildMysqlOptions((key) =>
    key === 'DB_MYSQL_DB' ? database : process.env[key],
  );
  return includeMigration
    ? options
    : ({
        ...options,
        migrations: (options.migrations as Array<{ name: string }>).filter(
          ({ name }) => name !== MIGRATION,
        ),
      } as DataSourceOptions);
};

async function withMigrated(run: (ds: DataSource) => Promise<void>) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(optionsFor(database)).initialize();
    try {
      await ds.runMigrations();
      await run(ds);
    } finally {
      await ds.destroy();
    }
  });
}

const hash = () => randomBytes(32).toString('hex');

function insertRow(
  ds: DataSource,
  table: string,
  fields: Record<string, unknown>,
) {
  const names = Object.keys(fields);
  return ds.query(
    `INSERT INTO \`${table}\` (${names.map((name) => `\`${name}\``).join(',')}) VALUES (${names.map(() => '?').join(',')})`,
    Object.values(fields),
  );
}
const entryKey = () => randomBytes(32).toString('base64url');

/** 以舊／新 schema 都有的欄位建立 session；未指定的 source_jti_hash 每列唯一。 */
function insertSession(ds: DataSource, fields: Record<string, unknown>) {
  return insertRow(ds, 'auth_sessions', {
    source: 'webview',
    source_jti_hash: hash(),
    assertion_expires_at: new Date(),
    ...fields,
  });
}

const activeFields = () => ({
  status: 'active',
  session_token_hash: hash(),
  activated_at: new Date(),
  expires_at: new Date(Date.now() + 60_000),
});

const superSession = (fields: Record<string, unknown> = {}) => ({
  actor_kind: 'super_user',
  source: 'super_user',
  credential_generation: 1,
  ...activeFields(),
  ...fields,
});

function insertAccess(ds: DataSource, fields: Record<string, unknown> = {}) {
  const now = new Date();
  return insertRow(ds, 'super_user_access', {
    id: 1,
    entry_key: entryKey(),
    entry_generation: 1,
    rotated_at: now,
    period_start_at: now,
    active_credential_fingerprint: hash(),
    credential_generation: 1,
    credential_activated_at: now,
    ...fields,
  });
}

function insertEvent(ds: DataSource, fields: Record<string, unknown>) {
  return insertRow(ds, 'auth_security_events', {
    event_type: 'login.succeeded',
    actor_kind: 'super_user',
    outcome_code: 'succeeded',
    occurred_at: new Date(),
    ...fields,
  });
}

async function expectRejected(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}

async function tableDefinition(ds: DataSource, table: string) {
  const rows = await ds.query<Array<{ 'Create Table': string }>>(
    `SHOW CREATE TABLE \`${table}\``,
  );
  return rows[0]['Create Table'].replace(/ AUTO_INCREMENT=\d+/, '');
}

async function tableNames(ds: DataSource, database: string) {
  const rows = await ds.query<Array<{ TABLE_NAME: string }>>(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=? AND TABLE_NAME IN ('super_user_access','auth_security_events') ORDER BY TABLE_NAME",
    [database],
  );
  return rows.map((row) => row.TABLE_NAME);
}

async function columns(ds: DataSource, database: string, table: string) {
  const rows = await ds.query<
    Array<{
      COLUMN_NAME: string;
      COLUMN_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
      COLLATION_NAME: string | null;
    }>
  >(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME
      FROM information_schema.columns WHERE table_schema=? AND table_name=?
      ORDER BY ORDINAL_POSITION`,
    [database, table],
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.COLUMN_NAME,
      [
        row.COLUMN_TYPE,
        row.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL',
        row.COLUMN_DEFAULT,
        row.COLLATION_NAME,
      ],
    ]),
  );
}

async function constraints(ds: DataSource, database: string, table: string) {
  const checks = await ds.query<Array<{ CONSTRAINT_NAME: string }>>(
    "SELECT CONSTRAINT_NAME FROM information_schema.table_constraints WHERE constraint_schema=? AND table_name=? AND constraint_type='CHECK' ORDER BY CONSTRAINT_NAME",
    [database, table],
  );
  const foreignKeys = await ds.query<
    Array<{
      CONSTRAINT_NAME: string;
      REFERENCED_TABLE_NAME: string;
      DELETE_RULE: string;
    }>
  >(
    'SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, DELETE_RULE FROM information_schema.referential_constraints WHERE constraint_schema=? AND table_name=? ORDER BY CONSTRAINT_NAME',
    [database, table],
  );
  const indexRows = await ds.query<
    Array<{ INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number }>
  >(
    'SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.statistics WHERE table_schema=? AND table_name=? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
    [database, table],
  );
  const indexes: Record<string, string> = {};
  for (const row of indexRows) {
    const prefix = indexes[row.INDEX_NAME]
      ? `${indexes[row.INDEX_NAME]},`
      : Number(row.NON_UNIQUE) === 0
        ? 'unique:'
        : '';
    indexes[row.INDEX_NAME] = `${prefix}${row.COLUMN_NAME}`;
  }
  return {
    checks: checks.map((row) => row.CONSTRAINT_NAME),
    foreignKeys: foreignKeys.map(
      (row) =>
        `${row.CONSTRAINT_NAME}:${row.REFERENCED_TABLE_NAME}:${row.DELETE_RULE}`,
    ),
    indexes,
  };
}

describe('Spec 027 Super user schema migration', () => {
  jest.setTimeout(120_000);

  it('空庫套用後落實資料模型的型別、NULL、CHECK、FK、unique 與索引，且 entity 無 drift', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = await new DataSource(optionsFor(database)).initialize();
      try {
        await ds.runMigrations();
        const sessionColumns = await columns(ds, database, 'auth_sessions');
        expect(sessionColumns).toMatchObject({
          actor_kind: [
            'varchar(20)',
            'NOT NULL',
            'employee',
            'utf8mb4_unicode_ci',
          ],
          user_id: ['bigint', 'NULL', null, null],
          source: ['varchar(20)', 'NOT NULL', null, 'utf8mb4_unicode_ci'],
          credential_generation: ['bigint unsigned', 'NULL', null, null],
          replacement_session_id: ['bigint unsigned', 'NULL', null, null],
        });
        expect(await constraints(ds, database, 'auth_sessions')).toEqual({
          checks: [
            'chk_auth_sessions_active_session',
            'chk_auth_sessions_actor',
            'chk_auth_sessions_status',
          ],
          foreignKeys: [
            'fk_auth_sessions_replacement:auth_sessions:RESTRICT',
            'fk_auth_sessions_user:users:RESTRICT',
          ],
          indexes: expect.objectContaining({
            uq_auth_sessions_replacement_session_id:
              'unique:replacement_session_id',
            idx_auth_sessions_actor_generation_status:
              'actor_kind,credential_generation,status',
            idx_auth_sessions_user_created_at: 'user_id,created_at',
          }) as unknown,
        });

        expect(await columns(ds, database, 'super_user_access')).toEqual({
          id: ['tinyint unsigned', 'NOT NULL', null, null],
          entry_key: ['char(43)', 'NOT NULL', null, 'ascii_bin'],
          entry_generation: ['bigint unsigned', 'NOT NULL', null, null],
          rotated_at: ['datetime(6)', 'NOT NULL', null, null],
          period_start_at: ['datetime(6)', 'NOT NULL', null, null],
          active_credential_fingerprint: [
            'char(64)',
            'NOT NULL',
            null,
            'ascii_bin',
          ],
          credential_generation: ['bigint unsigned', 'NOT NULL', null, null],
          credential_activated_at: ['datetime(6)', 'NOT NULL', null, null],
          created_at: ['datetime(6)', 'NOT NULL', 'CURRENT_TIMESTAMP(6)', null],
          updated_at: ['datetime(6)', 'NOT NULL', 'CURRENT_TIMESTAMP(6)', null],
          deleted_at: ['datetime(6)', 'NULL', null, null],
        });
        expect(await constraints(ds, database, 'super_user_access')).toEqual({
          checks: [
            'chk_super_user_access_credential_generation',
            'chk_super_user_access_entry_generation',
            'chk_super_user_access_singleton',
          ],
          foreignKeys: [],
          indexes: {
            PRIMARY: 'unique:id',
            idx_super_user_access_rotated_at: 'rotated_at',
            idx_super_user_access_period_start_at: 'period_start_at',
            idx_super_user_access_credential_activated_at:
              'credential_activated_at',
            idx_super_user_access_created_at: 'created_at',
            idx_super_user_access_updated_at: 'updated_at',
            idx_super_user_access_deleted_at: 'deleted_at',
          },
        });

        expect(await columns(ds, database, 'auth_security_events')).toEqual({
          id: ['bigint unsigned', 'NOT NULL', null, null],
          event_type: ['varchar(64)', 'NOT NULL', null, 'utf8mb4_unicode_ci'],
          actor_kind: ['varchar(20)', 'NOT NULL', null, 'utf8mb4_unicode_ci'],
          actor_user_id: ['bigint', 'NULL', null, null],
          session_id: ['bigint unsigned', 'NULL', null, null],
          outcome_code: ['varchar(64)', 'NOT NULL', null, 'utf8mb4_unicode_ci'],
          credential_generation: ['bigint unsigned', 'NULL', null, null],
          entry_generation: ['bigint unsigned', 'NULL', null, null],
          request_id: ['varchar(64)', 'NULL', null, 'utf8mb4_unicode_ci'],
          occurred_at: ['datetime(6)', 'NOT NULL', null, null],
          created_at: ['datetime(6)', 'NOT NULL', 'CURRENT_TIMESTAMP(6)', null],
        });
        expect(await constraints(ds, database, 'auth_security_events')).toEqual(
          {
            checks: [
              'chk_auth_security_events_actor_kind',
              'chk_auth_security_events_actor_user',
              'chk_auth_security_events_event_type',
            ],
            foreignKeys: [
              'fk_auth_security_events_actor_user:users:RESTRICT',
              'fk_auth_security_events_session:auth_sessions:RESTRICT',
            ],
            indexes: expect.objectContaining({
              idx_auth_security_events_occurred_at: 'occurred_at',
              idx_auth_security_events_created_at: 'created_at',
            }) as unknown,
          },
        );
        expect((await ds.driver.createSchemaBuilder().log()).upQueries).toEqual(
          [],
        );
      } finally {
        await ds.destroy();
      }
    });
  });

  it('CHECK、FK 與 unique 拒絕不合法的操作者、會話、入口與事件', async () => {
    await withMigrated(async (ds) => {
      await ds.query(
        "INSERT INTO users (empid,name) VALUES ('SUS001','合成員工'),('SUS002','只被事件引用')",
      );
      await insertSession(ds, { status: 'validating' });
      await insertSession(ds, { status: 'failed', failure_code: 'X' });
      await insertSession(ds, {
        source: 'oauth',
        user_id: 1,
        ...activeFields(),
      });
      await insertSession(ds, superSession());
      await insertSession(ds, superSession({ status: 'revoked' }));
      for (const fields of [
        { actor_kind: 'admin', status: 'validating' },
        { status: 'validating', credential_generation: 1 },
        { source: 'super_user', status: 'validating' },
        { source: 'password', status: 'validating' },
        { ...activeFields() },
        { status: 'pending', launch_code_hash: hash() },
        { ...activeFields(), status: 'revoked', revoked_at: new Date() },
        superSession({ user_id: 1 }),
        superSession({ credential_generation: null }),
        superSession({ source: 'webview' }),
        superSession({ status: 'pending' }),
        superSession({ status: 'validating' }),
        { user_id: 1, ...activeFields(), session_token_hash: null },
        { user_id: 1, ...activeFields(), activated_at: null },
        { user_id: 1, ...activeFields(), expires_at: null },
        { user_id: 1, ...activeFields(), replacement_session_id: 999_999 },
      ]) {
        await expectRejected(insertSession(ds, fields));
      }
      await ds.query(
        "UPDATE auth_sessions SET status='revoked', replacement_session_id=4 WHERE source='oauth'",
      );
      await expectRejected(
        ds.query(
          "UPDATE auth_sessions SET replacement_session_id=4 WHERE actor_kind='super_user' AND status='revoked'",
        ),
      );
      await expectRejected(ds.query('DELETE FROM auth_sessions WHERE id=4'));

      await insertAccess(ds);
      for (const fields of [
        { id: 2 },
        { entry_generation: 0 },
        { credential_generation: 0 },
        { entry_key: null },
        { active_credential_fingerprint: null },
      ]) {
        await ds.query('DELETE FROM super_user_access');
        await expectRejected(insertAccess(ds, fields));
      }
      await insertAccess(ds);
      await expectRejected(insertAccess(ds));

      await insertEvent(ds, {
        actor_kind: 'employee',
        actor_user_id: 2,
        session_id: 3,
      });
      for (const kind of ['super_user', 'operator', 'system', 'anonymous']) {
        await insertEvent(ds, { actor_kind: kind });
      }
      for (const fields of [
        { event_type: 'login.unknown' },
        { actor_kind: 'admin' },
        { actor_kind: 'employee' },
        { actor_kind: 'super_user', actor_user_id: 1 },
        { session_id: 999_999 },
        { actor_kind: 'employee', actor_user_id: 999_999 },
        { outcome_code: null },
      ]) {
        await expectRejected(insertEvent(ds, fields));
      }
      await expectRejected(ds.query('DELETE FROM auth_sessions WHERE id=3'));
      await expectRejected(ds.query('DELETE FROM users WHERE id=2'));
    });
  });

  it('既有員工 session 回填 employee、users 與文件關聯不變；空維護資料可 down 還原原定義再 reapply', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const before = await new DataSource(
        optionsFor(database, false),
      ).initialize();
      let original: string;
      let sessionRows: Array<Record<string, unknown>>;
      let otherRows: unknown;
      const otherSql =
        'SELECT u.*, d.id AS document_id, d.created_by_user_id FROM users u LEFT JOIN esign_documents d ON d.created_by_user_id = u.id ORDER BY u.id';
      try {
        await before.runMigrations();
        original = await tableDefinition(before, 'auth_sessions');
        await before.query(
          "INSERT INTO users (empid,name) VALUES ('SUS101','合成員工'),('SUS102','合成員工乙')",
        );
        await before.query(
          "INSERT INTO esign_documents (doc_number,title,created_by_user_id) VALUES ('00000000-0000-4000-8000-000000002701','合成文件',1)",
        );
        await insertSession(before, { status: 'validating' });
        await insertSession(before, { status: 'failed', failure_code: 'X' });
        await insertSession(before, {
          status: 'failed',
          user_id: 2,
          failure_code: 'Y',
        });
        await insertSession(before, {
          status: 'pending',
          user_id: 1,
          launch_code_hash: hash(),
          verified_at: new Date(),
          launch_expires_at: new Date(Date.now() + 60_000),
        });
        await insertSession(before, { user_id: 1, ...activeFields() });
        await insertSession(before, {
          user_id: 2,
          ...activeFields(),
          status: 'revoked',
          revoked_at: new Date(),
        });
        sessionRows = await before.query(
          'SELECT * FROM auth_sessions ORDER BY id',
        );
        otherRows = await before.query(otherSql);
      } finally {
        await before.destroy();
      }

      const ds = await new DataSource(optionsFor(database)).initialize();
      try {
        await ds.runMigrations();
        expect(await lastMigrationName(ds)).toBe(MIGRATION);
        const migrated = await ds.query<Array<Record<string, unknown>>>(
          'SELECT * FROM auth_sessions ORDER BY id',
        );
        expect(
          migrated.map((row) => NEW_SESSION_COLUMNS.map((name) => row[name])),
        ).toEqual(sessionRows.map(() => ['employee', null, null]));
        expect(
          migrated.map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(
                ([name]) => !NEW_SESSION_COLUMNS.includes(name),
              ),
            ),
          ),
        ).toEqual(sessionRows);
        expect(await ds.query(otherSql)).toEqual(otherRows);

        await ds.undoLastMigration();
        expect(await tableNames(ds, database)).toEqual([]);
        expect(await tableDefinition(ds, 'auth_sessions')).toBe(original);
        expect(
          await ds.query('SELECT * FROM auth_sessions ORDER BY id'),
        ).toEqual(sessionRows);
        expect(await ds.query(otherSql)).toEqual(otherRows);

        await ds.runMigrations();
        expect(await tableNames(ds, database)).toEqual([
          'auth_security_events',
          'super_user_access',
        ]);
        expect(
          (
            await ds.query<Array<{ actor_kind: string }>>(
              'SELECT actor_kind FROM auth_sessions',
            )
          ).every((row) => row.actor_kind === 'employee'),
        ).toBe(true);
        expect((await ds.driver.createSchemaBuilder().log()).upQueries).toEqual(
          [],
        );
      } finally {
        await ds.destroy();
      }
    });
  });

  it('歷史資料不符新約束時整句失敗，不留下新欄位或新表', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const before = await new DataSource(
        optionsFor(database, false),
      ).initialize();
      let original: string;
      try {
        await before.runMigrations();
        await before.query(
          "INSERT INTO users (empid,name) VALUES ('SUS201','合成員工')",
        );
        // 舊 schema 允許 active 缺到期時間；新約束不接受，不能靜默改寫歷史列。
        await insertSession(before, {
          user_id: 1,
          ...activeFields(),
          expires_at: null,
        });
        original = await tableDefinition(before, 'auth_sessions');
      } finally {
        await before.destroy();
      }
      const ds = await new DataSource(optionsFor(database)).initialize();
      try {
        await expect(ds.runMigrations()).rejects.toThrow(
          /chk_auth_sessions_active_session/,
        );
        expect(await tableDefinition(ds, 'auth_sessions')).toBe(original);
        expect(await tableNames(ds, database)).toEqual([]);
        expect(await lastMigrationName(ds)).not.toBe(MIGRATION);
      } finally {
        await ds.destroy();
      }
    });
  });

  it.each([
    ['安全事件', (ds: DataSource) => insertEvent(ds, { actor_kind: 'system' })],
    ['維護入口', (ds: DataSource) => insertAccess(ds)],
    ['Super user 會話', (ds: DataSource) => insertSession(ds, superSession())],
  ])('有%s時拒絕破壞性 down 且資料不變', async (_label, seed) => {
    await withMigrated(async (ds) => {
      await seed(ds);
      const snapshot = async () => ({
        sessions: (await ds.query(
          'SELECT * FROM auth_sessions ORDER BY id',
        )) as unknown,
        access: (await ds.query('SELECT * FROM super_user_access')) as unknown,
        events: (await ds.query(
          'SELECT * FROM auth_security_events ORDER BY id',
        )) as unknown,
      });
      const before = await snapshot();
      await expect(ds.undoLastMigration()).rejects.toThrow('無法回滾');
      expect(await snapshot()).toEqual(before);
      expect(await lastMigrationName(ds)).toBe(MIGRATION);
    });
  });
});
