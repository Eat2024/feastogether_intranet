import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DataSource } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { PORTAL_HEADER } from '#app/maintenance/portal-users-source';
import {
  applyPortalUsers,
  previewPortalUsers as previewWithAcquiredAt,
  readSnapshots,
} from '#app/maintenance/portal-users-import';

const previewPortalUsers = (ds: DataSource, input: string, output: string) =>
  previewWithAcquiredAt(ds, input, output, '2026-01-01T00:00:00.000Z');
import {
  previewPortalRollback,
  rollbackPortalUsers,
} from '#app/maintenance/portal-users-recovery';

const hex = (value: string | null) =>
  value === null ? 'NULL' : Buffer.from(value).toString('hex');
const row = (id: string, name = '合成新姓名') =>
  [
    hex(id),
    hex(name),
    hex('D01'),
    hex('合成部門'),
    hex('new@example.invalid'),
    '1',
    hex(null),
  ].join('\t');
async function fixture(
  run: (ds: DataSource, path: (name: string) => string) => Promise<void>,
) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    const directory = await mkdtemp(join(tmpdir(), 'portal-recovery-'));
    try {
      await ds.runMigrations();
      await run(ds, (name) => join(directory, name));
    } finally {
      await ds.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
async function imported(
  ds: DataSource,
  path: (name: string) => string,
  rows: string[],
) {
  await writeFile(path('source.tsv'), [PORTAL_HEADER, ...rows, ''].join('\n'), {
    mode: 0o600,
  });
  await previewPortalUsers(ds, path('source.tsv'), path('preview.json'));
  return applyPortalUsers(ds, path('preview.json'), path('result.json'));
}

describe('Portal 主檔受控回復', () => {
  jest.setTimeout(120000);
  it('同批新預覽重跑不更新時間；安全回復保留既有ID與微秒原值並移除未引用的新帳號', async () => {
    await fixture(async (ds, path) => {
      const original = await ds.manager.save(User, {
        empid: 'R0000001',
        name: '合成原姓名',
        email: null,
        isActive: true,
      });
      await ds.manager.query(
        "UPDATE users SET updated_at='2026-01-01 00:00:00.123456' WHERE id=?",
        [original.id],
      );
      const before = await readSnapshots(ds.manager, [original.id], 'id');
      await imported(ds, path, [row('R0000001'), row('R0000002')]);
      const after = await readSnapshots(
        ds.manager,
        ['R0000001', 'R0000002'],
        'empid',
      );
      const next = await previewPortalUsers(
        ds,
        path('source.tsv'),
        path('next.json'),
      );
      expect(next.summary).toMatchObject({ create: 0, update: 0, noop: 2 });
      expect(
        (
          await applyPortalUsers(
            ds,
            path('next.json'),
            path('noop-result.json'),
          )
        ).changes,
      ).toEqual([]);
      expect(
        await readSnapshots(ds.manager, ['R0000001', 'R0000002'], 'empid'),
      ).toEqual(after);
      const preview = await previewPortalRollback(
        ds,
        path('result.json'),
        path('rollback.json'),
      );
      expect(preview.summary).toEqual({ restore: 1, remove: 1 });
      expect(await ds.manager.count(User)).toBe(2);
      await rollbackPortalUsers(ds, path('rollback.json'));
      expect(await readSnapshots(ds.manager, [original.id], 'id')).toEqual(
        before,
      );
      expect(await ds.manager.count(User)).toBe(1);
      await expect(
        rollbackPortalUsers(ds, path('rollback.json')),
      ).rejects.toThrow();
    });
  });
  it('預覽後的登入資料變更、新增同員編與回復前變更都拒絕，不覆蓋合法資料', async () => {
    await fixture(async (ds, path) => {
      const user = await ds.manager.save(User, {
        empid: 'R0000001',
        name: '合成原姓名',
        isActive: true,
      });
      await imported(ds, path, [row('R0000001'), row('R0000002')]);
      await previewPortalRollback(
        ds,
        path('result.json'),
        path('rollback.json'),
      );
      await ds.manager.query(
        'UPDATE users SET last_login_at=NOW(6) WHERE id=?',
        [user.id],
      );
      await expect(
        rollbackPortalUsers(ds, path('rollback.json')),
      ).rejects.toThrow('變更');
      expect(await ds.manager.count(User)).toBe(2);
      await writeFile(
        path('source-new.tsv'),
        [PORTAL_HEADER, row('R0000003'), ''].join('\n'),
        { mode: 0o600 },
      );
      await previewPortalUsers(
        ds,
        path('source-new.tsv'),
        path('new-preview.json'),
      );
      await ds.manager.save(User, {
        empid: 'R0000003',
        name: '合成競態新增',
        isActive: true,
      });
      await expect(
        applyPortalUsers(ds, path('new-preview.json'), path('new-result.json')),
      ).rejects.toThrow('變更');
    });
  });
  it('空的非FK使用者欄位也拒絕刪除，預覽後新增該欄位會重新檢查', async () => {
    await fixture(async (ds, path) => {
      await imported(ds, path, [row('R0000001'), row('R0000002')]);
      await previewPortalRollback(
        ds,
        path('result.json'),
        path('rollback.json'),
      );
      await ds.manager.query(
        'CREATE TABLE synthetic_usage (id INT PRIMARY KEY, actor_user_id BIGINT NOT NULL)',
      );
      await expect(
        previewPortalRollback(ds, path('result.json'), path('retry.json')),
      ).rejects.toThrow('無法確認安全');
      await expect(
        rollbackPortalUsers(ds, path('rollback.json')),
      ).rejects.toThrow('無法確認安全');
      expect(await ds.manager.count(User)).toBe(2);
      expect(await ds.manager.query('SELECT * FROM synthetic_usage')).toEqual(
        [],
      );
    });
  });
  it('非FK欄位存在時仍可回復只有既有帳號更新的批次', async () => {
    await fixture(async (ds, path) => {
      const user = await ds.manager.save(User, {
        empid: 'R0000001',
        name: '原始合成人員',
        isActive: true,
      });
      await imported(ds, path, [row('R0000001')]);
      await ds.manager.query(
        'CREATE TABLE synthetic_usage (id INT PRIMARY KEY, actor_user_id BIGINT NOT NULL)',
      );
      await previewPortalRollback(
        ds,
        path('result.json'),
        path('rollback.json'),
      );
      await rollbackPortalUsers(ds, path('rollback.json'));
      expect(
        (await ds.manager.findOneByOrFail(User, { id: user.id })).name,
      ).toBe('原始合成人員');
    });
  });
  it('commit後artifact失敗必須人工對帳，prepared結果不得拿來回復', async () => {
    await fixture(async (ds, path) => {
      await writeFile(
        path('source.tsv'),
        [PORTAL_HEADER, row('R0000001'), ''].join('\n'),
        { mode: 0o600 },
      );
      await previewPortalUsers(ds, path('source.tsv'), path('preview.json'));
      await writeFile(path('result.json.completed'), '合成阻擋檔', {
        mode: 0o600,
      });
      await expect(
        applyPortalUsers(ds, path('preview.json'), path('result.json')),
      ).rejects.toThrow('已提交');
      expect(await ds.manager.count(User)).toBe(1);
      expect(
        JSON.parse(await readFile(path('result.json'), 'utf8')) as unknown,
      ).toMatchObject({ status: 'prepared' });
      await expect(
        previewPortalRollback(ds, path('result.json'), path('rollback.json')),
      ).rejects.toThrow('完成');
    });
  });
});

it('新帳號存在真實 session 或非慣例欄位的 FK 引用時不刪除', async () => {
  await fixture(async (ds, path) => {
    const result = await imported(ds, path, [row('R0000001')]);
    const id = result.changes[0].after.id;
    await ds.manager.query(
      "INSERT INTO auth_sessions (user_id,source,status,source_jti_hash,assertion_expires_at) VALUES (?,'synthetic','active',?,DATE_ADD(NOW(),INTERVAL 1 DAY))",
      [id, 'a'.repeat(64)],
    );
    await expect(
      previewPortalRollback(ds, path('result.json'), path('session.json')),
    ).rejects.toThrow('引用');
    await ds.manager.query('DELETE FROM auth_sessions WHERE user_id=?', [id]);
    await ds.manager.query(
      'CREATE TABLE synthetic_fk (id INT PRIMARY KEY, owner BIGINT NOT NULL, FOREIGN KEY (owner) REFERENCES users(id))',
    );
    await ds.manager.query('INSERT INTO synthetic_fk VALUES (1,?)', [id]);
    await expect(
      previewPortalRollback(ds, path('result.json'), path('fk.json')),
    ).rejects.toThrow('引用');
    expect(await ds.manager.count(User)).toBe(1);
  });
}, 120000);

it('回復後結果檔失敗回報已回復而非未提交，結果文件不能重播', async () => {
  await fixture(async (ds, path) => {
    await imported(ds, path, [row('R0000001')]);
    await previewPortalRollback(ds, path('result.json'), path('rollback.json'));
    await writeFile(path('rollback.json.rollback-result'), '合成阻擋檔', {
      mode: 0o600,
    });
    await expect(
      rollbackPortalUsers(ds, path('rollback.json')),
    ).rejects.toThrow('已回復');
    expect(await ds.manager.count(User)).toBe(0);
    await expect(
      rollbackPortalUsers(ds, path('rollback.json')),
    ).rejects.toThrow();
  });
}, 120000);
