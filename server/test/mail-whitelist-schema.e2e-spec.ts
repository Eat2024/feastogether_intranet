import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { MailRecipientWhitelistRepository } from '#app/infrastructure/mail/mail-recipient-whitelist.repository';
import { lastMigrationName, revertAfter } from './schema-migration.helper';

const EMAIL_RULE_MIGRATION = 'MailWhitelistEmailRule1793664001000';
const MAX_EMAIL = `${'a'.repeat(242)}@example.test`;
const CHECK_VIOLATED =
  /Check constraint 'chk_mail_recipient_whitelist_\w+' is violated/;

const optionsFor = (database: string) =>
  buildMysqlOptions((key) =>
    key === 'DB_MYSQL_DB' ? database : process.env[key],
  );

async function withWhitelist(run: (ds: DataSource) => Promise<void>) {
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

describe('白名單 schema 與維護', () => {
  jest.setTimeout(60_000);

  it('七欄及精確字串限制拒絕非法規則，合法大小寫代碼不合併', async () => {
    await withWhitelist(async (ds) => {
      const columns = await ds.query<Array<{ Field: string }>>(
        'SHOW COLUMNS FROM mail_recipient_whitelist',
      );
      expect(columns.map((column) => column.Field)).toEqual([
        'id',
        'type',
        'value',
        'remark',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      const invalid = [
        ['Department', 'D001'],
        ['employee ', 'E001'],
        ['department', ''],
        ['department', ' D001'],
        ['department', 'D001 '],
        ['department', 'D001\n'],
        ['department', '部門'],
        ['department', 'D'.repeat(51)],
        ['employee', 'E'.repeat(21)],
        ['employee', 'EMP_01'],
        ['employee', 'EMP-01'],
        ['email', 'A@example.test'],
        ['email', ' a@example.test'],
        ['email', 'a@example.test '],
        ['email', 'a b@example.test'],
        ['email', 'a@example.test\n'],
        ['email', 'a\u0007@example.test'],
        ['email', 'example.test'],
        ['email', 'a@b@example.test'],
        ['email', '@example.test'],
        ['email', 'a@'],
        ['email', `a${MAX_EMAIL}`],
      ];
      for (const [type, value] of invalid) {
        await expect(
          ds.query(
            'INSERT INTO mail_recipient_whitelist(type,value) VALUES (?,?)',
            [type, value],
          ),
        ).rejects.toThrow();
      }
      for (const [type, value] of [
        ['department', 'Dept_01-A'],
        ['department', 'dept_01-a'],
        ['department', 'D'.repeat(50)],
        ['employee', 'E'.repeat(20)],
        ['email', 'a@example.test'],
        ['email', MAX_EMAIL],
      ]) {
        await ds.query(
          'INSERT INTO mail_recipient_whitelist(type,value) VALUES (?,?)',
          [type, value],
        );
      }
      expect(
        await new MailRecipientWhitelistRepository().findActiveRules(
          ds.manager,
        ),
      ).toHaveLength(6);
    });
  });

  it('初始規則重跑不改既有列、撤銷不放行、明確恢復沿用原 id', async () => {
    await withWhitelist(async (ds) => {
      const repository = new MailRecipientWhitelistRepository();
      const seed = await readFile(
        join(
          __dirname,
          '../src/infrastructure/mail/seed-mail-recipient-whitelist.sql',
        ),
        'utf8',
      );
      await ds.query(seed);
      const rules = await repository.findActiveRules(ds.manager);
      expect(rules.map(({ type, value }) => [type, value]).sort()).toEqual([
        ['department', '1029010000'],
        ['department', '1029030000'],
        ['department', '1029090000'],
        ['employee', '09005001'],
      ]);
      const employee = rules.find((rule) => rule.type === 'employee');
      expect(employee).toBeDefined();
      await ds.query(
        "UPDATE mail_recipient_whitelist SET deleted_at=UTC_TIMESTAMP(6), remark='維護後備註' WHERE type='employee' AND value='09005001'",
      );
      const revoked: unknown = await ds.query(
        'SELECT * FROM mail_recipient_whitelist ORDER BY id',
      );
      await ds.query(seed);
      expect(
        await ds.query('SELECT * FROM mail_recipient_whitelist ORDER BY id'),
      ).toEqual(revoked);
      expect(await repository.findActiveRules(ds.manager)).toHaveLength(3);
      await expect(
        ds.query(
          "INSERT INTO mail_recipient_whitelist(type,value) VALUES ('employee','09005001')",
        ),
      ).rejects.toThrow();
      await ds.query(
        "UPDATE mail_recipient_whitelist SET deleted_at=NULL, updated_at=UTC_TIMESTAMP(6) WHERE type='employee' AND value='09005001'",
      );
      expect(
        (await repository.findActiveRules(ds.manager)).find(
          (rule) => rule.type === 'employee',
        )?.id,
      ).toBe(employee?.id);
    });
  });

  it('有信箱規則（含已撤銷）時 down 失敗且資料不變，刪除後還原 018 定義並可再 up', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const original = await tableDefinitionBefore021(database);
      const ds = await new DataSource(optionsFor(database)).initialize();
      try {
        await ds.runMigrations();
        await revertAfter(ds, EMAIL_RULE_MIGRATION);
        const insert =
          'INSERT INTO mail_recipient_whitelist(type,value,deleted_at) VALUES (?,?,?)';
        await ds.query(insert, ['employee', 'E001', null]);
        await ds.query(insert, ['email', 'active@example.test', null]);
        await ds.query(insert, ['email', 'revoked@example.test', new Date()]);
        const rowsSql = 'SELECT * FROM mail_recipient_whitelist ORDER BY id';
        const rows: unknown = await ds.query(rowsSql);
        const employeeRuleIdSql =
          "SELECT id FROM mail_recipient_whitelist WHERE type='employee' AND value='E001'";
        const employeeRuleId: unknown = await ds.query(employeeRuleIdSql);

        await expect(ds.undoLastMigration()).rejects.toThrow(CHECK_VIOLATED);
        expect(await ds.query(rowsSql)).toEqual(rows);
        await ds.query(
          "DELETE FROM mail_recipient_whitelist WHERE value='active@example.test'",
        );
        await expect(ds.undoLastMigration()).rejects.toThrow(CHECK_VIOLATED);
        expect(await lastMigrationName(ds)).toBe(EMAIL_RULE_MIGRATION);

        await ds.query(
          "DELETE FROM mail_recipient_whitelist WHERE type='email'",
        );
        await ds.undoLastMigration();
        expect(await tableDefinition(ds)).toBe(original);
        expect(await ds.query(employeeRuleIdSql)).toEqual(employeeRuleId);
        await ds.runMigrations();
        expect(await ds.query(employeeRuleIdSql)).toEqual(employeeRuleId);
        await ds.query(insert, ['email', 'active@example.test', null]);
      } finally {
        await ds.destroy();
      }
    });
  });
});

/** 只套用 021 之前的 migration，取得 018 的白名單表定義。 */
async function tableDefinitionBefore021(database: string): Promise<string> {
  const options = optionsFor(database);
  const ds = await new DataSource({
    ...options,
    migrations: (options.migrations as Array<{ name: string }>).filter(
      ({ name }) => name !== EMAIL_RULE_MIGRATION,
    ),
  } as DataSourceOptions).initialize();
  try {
    await ds.runMigrations();
    return await tableDefinition(ds);
  } finally {
    await ds.destroy();
  }
}

async function tableDefinition(ds: DataSource): Promise<string> {
  const rows = await ds.query<Array<{ 'Create Table': string }>>(
    'SHOW CREATE TABLE mail_recipient_whitelist',
  );
  return rows[0]['Create Table'].replace(/ AUTO_INCREMENT=\d+/, '');
}
