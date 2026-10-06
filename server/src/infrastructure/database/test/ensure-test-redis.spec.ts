import { assertTestRedisDb, flushTestRedis } from './ensure-test-redis';

const mockConnect = jest.fn();
const mockFlushdb = jest.fn();
const mockQuit = jest.fn();
const mockCtor = jest.fn();

jest.mock('ioredis', () =>
  jest.fn().mockImplementation((opts: unknown) => {
    mockCtor(opts);
    return { connect: mockConnect, flushdb: mockFlushdb, quit: mockQuit };
  }),
);

describe('assertTestRedisDb', () => {
  const original = process.env.REDIS_DB;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REDIS_DB;
    } else {
      process.env.REDIS_DB = original;
    }
  });

  it.each(['1', '2', '15'])('允許非 0 的測試 db %s', (db) => {
    process.env.REDIS_DB = db;

    expect(assertTestRedisDb()).toBe(Number(db));
  });

  it('未設定 REDIS_DB → 拒絕(fail-closed,預設 0 是 dev keyspace)', () => {
    delete process.env.REDIS_DB;

    expect(() => assertTestRedisDb()).toThrow('REDIS_DB');
  });

  it.each(['0', 'abc', '-1'])('拒絕危險或非法值 %s', (db) => {
    process.env.REDIS_DB = db;

    expect(() => assertTestRedisDb()).toThrow('REDIS_DB');
  });
});

describe('flushTestRedis', () => {
  const original = process.env.REDIS_DB;

  beforeEach(() => {
    mockCtor.mockClear();
    mockConnect.mockClear();
    mockFlushdb.mockClear();
    mockQuit.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REDIS_DB;
    } else {
      process.env.REDIS_DB = original;
    }
  });

  it('只對設定之非 0 db 執行 FLUSHDB,結束後斷線', async () => {
    process.env.REDIS_DB = '1';

    await flushTestRedis();

    expect(mockCtor).toHaveBeenCalledWith(expect.objectContaining({ db: 1 }));
    expect(mockFlushdb).toHaveBeenCalledTimes(1);
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it('REDIS_DB=0 → 連線前即拒絕,不得觸碰 dev keyspace', async () => {
    process.env.REDIS_DB = '0';

    await expect(flushTestRedis()).rejects.toThrow('REDIS_DB');
    expect(mockCtor).not.toHaveBeenCalled();
    expect(mockFlushdb).not.toHaveBeenCalled();
  });
});
