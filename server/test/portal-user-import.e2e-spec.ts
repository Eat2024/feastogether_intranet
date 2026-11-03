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
