import { mkdtemp, writeFile, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  previewPortalUsers as previewWithAcquiredAt,
  applyPortalUsers,
  readSnapshots,
} from '#app/maintenance/portal-users-import';

const previewPortalUsers = (ds: DataSource, input: string, output: string) =>
  previewWithAcquiredAt(ds, input, output, '2026-01-01T00:00:00.000Z');
import { PORTAL_HEADER } from '#app/maintenance/portal-users-source';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { DataSource } from 'typeorm';

/** 每個案例使用獨立 schema，不清理其他 e2e 正在使用的資料。 */
async function withUsers(run: (ds: DataSource) => Promise<void>) {
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

describe('Portal 主檔專用查詢', () => {
  jest.setTimeout(60_000);
  const users = new UserRepository();

  it('一般查詢隱藏 email，專用查詢包含 NULL、停用與軟刪除資料', async () => {
    await withUsers(async (ds) => {
      const first = await ds.manager.save(User, {
        empid: '00000001',
        name: '合成員工一',
        email: 'one@example.invalid',
        isActive: true,
      });
      const second = await ds.manager.save(User, {
        empid: '00000002',
        name: '合成員工二',
        email: null,
        isActive: false,
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const ids = [Number(second.id), Number(first.id)];
      expect(
        (await users.findByIds(ids, ds.manager)).every(
          (u) => u.email === undefined,
        ),
      ).toBe(true);
      const result = await users.findByIdsWithEmail(ids, ds.manager);
      expect(
        result.map((u) => [Number(u.id), u.email, u.isActive, !!u.deletedAt]),
      ).toEqual([
        [Number(first.id), 'one@example.invalid', true, false],
        [Number(second.id), null, false, true],
      ]);
      const ordinary = await users.findById(Number(first.id), ds.manager);
      expect(ordinary).not.toBeNull();
      await ds.manager.save(ordinary!);
      expect(
        (await users.findByIdsWithEmail([Number(first.id)], ds.manager))[0]
          .email,
      ).toBe('one@example.invalid');
    });
  });

  it('員編精確比對保留前導零與大小寫，部門代碼維持 binary 語意', async () => {
    await withUsers(async (ds) => {
      await ds.manager.save(User, {
        empid: '00Ab1234',
        name: '合成人員',
        email: 'case@example.invalid',
        departmentCode: '00Ab',
        isActive: true,
      });
      expect(
        await users.findByEmpidsWithEmail(['00ab1234', 'Ab1234'], ds.manager),
      ).toEqual([]);
      expect(
        (await users.findByEmpidsWithEmail(['00Ab1234'], ds.manager))[0].email,
      ).toBe('case@example.invalid');
      expect(
        await ds.manager.count(User, { where: { departmentCode: '00ab' } }),
      ).toBe(0);
      expect(
        await ds.manager.count(User, { where: { departmentCode: '00Ab' } }),
      ).toBe(1);
    });
  });

  it('超過 500 個 ID 去重排序後分批查詢，空集合不查 DB', async () => {
    await withUsers(async (ds) => {
      await ds.manager.insert(
        User,
        Array.from({ length: 501 }, (_, index) => ({
          empid: `S${String(index).padStart(7, '0')}`,
          name: '合成員工',
          email: 'shared@example.invalid',
          isActive: true,
        })),
      );
      const ids = (await ds.manager.find(User))
        .map((u) => Number(u.id))
        .sort((a, b) => a - b);
      const runner = ds.createQueryRunner();
      await runner.connect();
      const query = jest.spyOn(runner, 'query');
      try {
        expect(await users.findByIdsWithEmail([], runner.manager)).toEqual([]);
        expect(query).not.toHaveBeenCalled();
        const result = await users.findByIdsWithEmail(
          [...ids].reverse().concat(ids[0]),
          runner.manager,
        );
        expect(result.map((u) => Number(u.id))).toEqual(ids);
        const selects = query.mock.calls.filter(([sql]) =>
          sql.startsWith('SELECT'),
        );
        expect(selects).toHaveLength(2);
        expect(selects.map(([, params]) => params?.length)).toEqual([500, 1]);
        expect(selects[0][1]).toEqual(ids.slice(0, 500));
        expect(selects[1][1]).toEqual(ids.slice(500));
        expect(result.every((u) => u.email === 'shared@example.invalid')).toBe(
          true,
        );
      } finally {
        query.mockRestore();
        await runner.release();
      }
    });
  });

  it('交易鎖在提交前阻止其他連線更新，未開交易不得要求鎖定', async () => {
    await withUsers(async (ds) => {
      const user = await ds.manager.save(User, {
        empid: '00000001',
        name: '合成員工',
        email: 'old@example.invalid',
        isActive: true,
      });
      const id = Number(user.id);
      await expect(
        users.findByIdsWithEmail([id], ds.manager, true),
      ).rejects.toThrow();
      const owner = ds.createQueryRunner();
      const other = ds.createQueryRunner();
      await owner.connect();
      await other.connect();
      await owner.startTransaction();
      try {
        await users.findByIdsWithEmail([id], owner.manager, true);
        await other.query('SET SESSION innodb_lock_wait_timeout = 1');
        await expect(
          other.query('UPDATE users SET email=? WHERE id=?', [
            'new@example.invalid',
            id,
          ]),
        ).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
        await owner.commitTransaction();
        await other.query('UPDATE users SET email=? WHERE id=?', [
          'new@example.invalid',
          id,
        ]);
        expect(
          (await users.findByIdsWithEmail([id], other.manager))[0].email,
        ).toBe('new@example.invalid');
      } finally {
        if (owner.isTransactionActive) await owner.rollbackTransaction();
        await other.query('SET SESSION innodb_lock_wait_timeout = DEFAULT');
        await owner.release();
        await other.release();
      }
    });
  });
});

const importHex = (value: string | null) =>
  value === null ? 'NULL' : Buffer.from(value).toString('hex');
function importRow(
  empid: string,
  email: string | null = 'shared@example.invalid',
  status = '1',
) {
  return [
    importHex(empid),
    importHex('合成匯入姓名'),
    importHex('D001'),
    importHex('合成匯入部門'),
    importHex(email),
    status,
    importHex('合成職稱'),
  ].join('\t');
}
async function withImportFiles(
  rows: string[],
  run: (files: {
    input: string;
    preview: string;
    result: string;
    directory: string;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'portal-import-'));
  const input = join(directory, 'source.tsv');
  await writeFile(input, [PORTAL_HEADER, ...rows, ''].join('\n'), {
    mode: 0o600,
  });
  try {
    await run({
      input,
      preview: join(directory, 'preview.json'),
      result: join(directory, 'result.json'),
      directory,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Portal 主檔受控預覽與 apply', () => {
  jest.setTimeout(180_000);
  it('5001 人預覽與寫入一致，保護停用帳號、保留ID、空email清除、原值完整保存', async () => {
    await withUsers(async (ds) => {
      const updated = await ds.manager.save(User, {
        empid: 'I0000000',
        name: '合成舊姓名',
        email: 'old@example.invalid',
        isActive: true,
      });
      const protectedUser = await ds.manager.save(User, {
        empid: 'I0000001',
        name: '合成保護姓名',
        email: 'protected@example.invalid',
        isActive: false,
      });
      const rows = Array.from({ length: 5001 }, (_, i) =>
        importRow(
          `I${String(i).padStart(7, '0')}`,
          i === 0 ? null : 'shared@example.invalid',
        ),
      );
      await withImportFiles(rows, async (files) => {
        const preview = await previewPortalUsers(
          ds,
          files.input,
          files.preview,
        );
        expect(preview.summary).toMatchObject({
          sourceRows: 5001,
          uniqueEmployees: 5001,
          create: 4999,
          update: 1,
          protected: 1,
          missingEmail: 1,
          clearedEmail: 1,
        });
        expect(await ds.manager.count(User)).toBe(2);
        expect((await stat(files.preview)).mode & 0o777).toBe(0o600);
        const result = await applyPortalUsers(ds, files.preview, files.result);
        expect(result.status).toBe('applied');
        expect(result.changes).toHaveLength(5000);
        expect(await ds.manager.count(User)).toBe(5001);
        const after = await readSnapshots(
          ds.manager,
          [updated.id, protectedUser.id],
          'id',
        );
        expect(after[0]).toMatchObject({
          id: updated.id,
          email: null,
          name: '合成匯入姓名',
        });
        expect(after[1]).toMatchObject({
          id: protectedUser.id,
          isActive: false,
          name: '合成保護姓名',
        });
        expect(
          result.changes.find((c) => c.after.id === updated.id)?.before?.email,
        ).toBe('old@example.invalid');
        await expect(
          applyPortalUsers(
            ds,
            files.preview,
            join(files.directory, 'again.json'),
          ),
        ).rejects.toThrow();
        const next = await previewPortalUsers(
          ds,
          files.input,
          join(files.directory, 'next.json'),
        );
        expect(next.summary).toMatchObject({
          create: 0,
          update: 0,
          noop: 5000,
          protected: 1,
        });
        expect(
          JSON.parse(await readFile(files.result, 'utf8')) as unknown,
        ).toMatchObject({ status: 'applied' });
      });
    });
  });
  it('預覽後來源、目標微秒時間或員編大小寫衝突會拒絕，不覆寫登入資料', async () => {
    await withUsers(async (ds) => {
      const user = await ds.manager.save(User, {
        empid: 'Case0001',
        name: '原值',
        isActive: true,
      });
      await withImportFiles([importRow('case0001')], async (files) => {
        await expect(
          previewPortalUsers(ds, files.input, files.preview),
        ).rejects.toThrow('collation');
      });
      await withImportFiles([importRow('Case0001')], async (files) => {
        await previewPortalUsers(ds, files.input, files.preview);
        await ds.manager.query(
          'UPDATE users SET updated_at = DATE_ADD(updated_at, INTERVAL 1 MICROSECOND) WHERE id=?',
          [user.id],
        );
        await expect(
          applyPortalUsers(ds, files.preview, files.result),
        ).rejects.toThrow('目標資料已變更');
        expect(
          (await ds.manager.findOneByOrFail(User, { id: user.id })).name,
        ).toBe('原值');
      });
      await withImportFiles([importRow('Case0001')], async (files) => {
        await previewPortalUsers(ds, files.input, files.preview);
        await writeFile(
          files.input,
          PORTAL_HEADER + '\n' + importRow('Case0002') + '\n',
        );
        await expect(
          applyPortalUsers(ds, files.preview, files.result),
        ).rejects.toThrow('來源已變更');
      });
    });
  });
  it('中途寫入失敗整批回滾，備份先存在', async () => {
    await withUsers(async (ds) => {
      await withImportFiles(
        [importRow('F0000001'), importRow('F0000002')],
        async (files) => {
          await previewPortalUsers(ds, files.input, files.preview);
          let calls = 0;
          const spy = jest
            .spyOn(UserRepository.prototype, 'save')
            .mockImplementation(async function (user, manager) {
              calls++;
              if (calls === 2) throw new Error('合成寫入失敗');
              expect((await stat(files.result + '.intent')).mode & 0o777).toBe(
                0o600,
              );
              return manager.save(user);
            });
          try {
            await expect(
              applyPortalUsers(ds, files.preview, files.result),
            ).rejects.toThrow('合成寫入失敗');
          } finally {
            spy.mockRestore();
          }
          expect(await ds.manager.count(User)).toBe(0);
        },
      );
    });
  });
});

it('Portal 匯入拒絕跨資料庫套用同一預覽', async () => {
  await withUsers(async (first) => {
    await withUsers(async (other) => {
      await withImportFiles([importRow('X0000001')], async (files) => {
        await previewPortalUsers(first, files.input, files.preview);
        await expect(
          applyPortalUsers(other, files.preview, files.result),
        ).rejects.toThrow('目標資料庫不一致');
        expect(await first.manager.count(User)).toBe(0);
        expect(await other.manager.count(User)).toBe(0);
      });
    });
  });
});
