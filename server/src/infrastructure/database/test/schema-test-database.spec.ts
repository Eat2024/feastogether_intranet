import mysql from 'mysql2/promise';
import {
  assertSchemaTestDatabaseName,
  createSchemaTestDatabaseName,
  withSchemaTestDatabase,
} from './schema-test-database';

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: { createConnection: jest.fn() },
}));

describe('schema test database', () => {
  const originalDatabase = process.env.DB_MYSQL_DB;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalDatabase === undefined) delete process.env.DB_MYSQL_DB;
    else process.env.DB_MYSQL_DB = originalDatabase;
  });

  it.each(['', 'feastogether_intranet', 'production', 'test-db;DROP'])(
    '拒絕非隔離測試資料庫名稱 %s',
    (database) => {
      expect(() => assertSchemaTestDatabaseName(database)).toThrow('拒絕操作');
    },
  );

  it('產生具有唯一 suffix 的安全測試資料庫名稱', () => {
    const first = createSchemaTestDatabaseName('feastogether_intranet_test');
    const second = createSchemaTestDatabaseName('feastogether_intranet_test');

    expect(first).toMatch(/^feastogether_intranet_test_[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
  });

  it('即使 callback 失敗仍刪除 disposable database 並關閉連線', async () => {
    process.env.DB_MYSQL_DB = 'feastogether_intranet_test';
    const query = jest.fn().mockResolvedValue(undefined);
    const end = jest.fn().mockResolvedValue(undefined);
    jest.mocked(mysql.createConnection).mockResolvedValue({
      query,
      end,
    } as never);

    await expect(
      withSchemaTestDatabase(async () => {
        throw new Error('test failure');
      }),
    ).rejects.toThrow('test failure');

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0]?.[0])).toContain('CREATE DATABASE');
    expect(String(query.mock.calls[1]?.[0])).toContain('DROP DATABASE');
    expect(end).toHaveBeenCalledTimes(1);
  });
});
