import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { MailRecipientWhitelistRepository } from '#app/infrastructure/mail/mail-recipient-whitelist.repository';

async function withWhitelist(run: (ds: DataSource) => Promise<void>) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
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
        ['email', 'a@example.test'],
        ['department', ''],
        ['department', ' D001'],
        ['department', 'D001 '],
        ['department', 'D001\n'],
        ['department', '部門'],
        ['department', 'D'.repeat(51)],
        ['employee', 'E'.repeat(21)],
        ['employee', 'EMP_01'],
        ['employee', 'EMP-01'],
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
      ]) {
        await ds.query(
          'INSERT INTO mail_recipient_whitelist(type,value) VALUES (?,?)',
          [type, value],
        );
      }
      expect(
        await new MailRecipientWhitelistRepository().findActive(ds.manager),
      ).toHaveLength(4);
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
      const rules = await repository.findActive(ds.manager);
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
      expect(await repository.findActive(ds.manager)).toHaveLength(3);
      await expect(
        ds.query(
          "INSERT INTO mail_recipient_whitelist(type,value) VALUES ('employee','09005001')",
        ),
      ).rejects.toThrow();
      await ds.query(
        "UPDATE mail_recipient_whitelist SET deleted_at=NULL, updated_at=UTC_TIMESTAMP(6) WHERE type='employee' AND value='09005001'",
      );
      expect(
        (await repository.findActive(ds.manager)).find(
          (rule) => rule.type === 'employee',
        )?.id,
      ).toBe(employee?.id);
    });
  });
});
