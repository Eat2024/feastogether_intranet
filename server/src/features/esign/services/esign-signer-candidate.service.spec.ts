import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { EsignSignerCandidateService } from './esign-signer-candidate.service';

describe('簽署人組織樹快取', () => {
  function setup(source = 'https://synthetic.invalid') {
    const redis = {
      get: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const departments = { getOrgChart: jest.fn().mockResolvedValue([]) };
    const users = { save: jest.fn() };
    const mysql = { getManager: jest.fn(), transaction: jest.fn() };
    const hr = { lookupEligibleStaff: jest.fn() };
    const service = new EsignSignerCandidateService(
      users as never,
      mysql as never,
      departments as never,
      redis as never,
      { baseUrl: source } as never,
    );
    return { service, redis, departments, users, mysql, hr };
  }

  it('合法空快取直接回傳、不續期、不查上游或寫入 MySQL', async () => {
    const { service, redis, departments, users, mysql, hr } = setup();
    redis.get.mockResolvedValue(JSON.stringify({ version: 1, data: [] }));
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(redis.set).not.toHaveBeenCalled();
    expect(departments.getOrgChart).not.toHaveBeenCalled();
    expect(hr.lookupEligibleStaff).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
    expect(mysql.transaction).not.toHaveBeenCalled();
  });
  it.each([
    'broken',
    JSON.stringify({ version: 0, data: [] }),
    JSON.stringify({ version: 1, data: [{}] }),
  ])('無效快取經同一更新流程修復 %#', async (raw) => {
    const { service, redis, departments } = setup();
    redis.get.mockResolvedValue(raw);
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      { version: 1, data: [] },
      1_800,
    );
  });
  it('不同來源／環境隔離快取 namespace，不包含來源明文', async () => {
    const previous = process.env.NODE_ENV;
    try {
      const { service, redis, departments } = setup();
      await service.getOrgChart();
      const other = new EsignSignerCandidateService(
        {} as never,
        { getManager: jest.fn() } as never,
        departments as never,
        redis as never,
        { baseUrl: 'https://other.invalid' } as never,
      );
      await other.getOrgChart();
      process.env.NODE_ENV = 'synthetic-other-environment';
      await service.getOrgChart();
      const locks = redis.get.mock.calls.map(([key]) => key);
      expect(new Set(locks).size).toBe(3);
      expect(locks.join()).not.toContain('https://');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
  it('T+1,799 命中，T+1,800 後新請求更新，讀取不續期且無請求不刷新', async () => {
    jest.useFakeTimers();
    try {
      const { service, redis, departments } = setup();
      let cached: { raw: string; expiresAt: number } | null = null;
      redis.get.mockImplementation(() =>
        Promise.resolve(
          cached && Date.now() < cached.expiresAt ? cached.raw : null,
        ),
      );
      redis.set.mockImplementation(
        (_key: string, value: unknown, ttl: number) => {
          cached = {
            raw: JSON.stringify(value),
            expiresAt: Date.now() + ttl * 1000,
          };
          return Promise.resolve();
        },
      );
      await service.getOrgChart();
      await jest.advanceTimersByTimeAsync(1_799_000);
      await service.getOrgChart();
      expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
      await service.getOrgChart();
      expect(departments.getOrgChart).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
  it('不沿用 v1 的兩小時快取，以 v2 取得新資料且維持 payload version 1', async () => {
    const { service, redis, departments } = setup();
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(
        key.startsWith('esign:org-chart:v1:')
          ? JSON.stringify({ version: 1, data: [] })
          : null,
      ),
    );
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^esign:org-chart:v2:/),
      { version: 1, data: [] },
      1_800,
    );
  });
  it.each(['get', 'set'] as const)(
    'Redis %s 失敗回 503，不直連 fallback',
    async (operation) => {
      const { service, redis, departments } = setup();
      redis[operation].mockRejectedValue(new Error('synthetic-private'));
      await expect(service.getOrgChart()).rejects.toMatchObject({
        code: 'ORG_CHART_UNAVAILABLE',
        status: 503,
      });
      expect(departments.getOrgChart).toHaveBeenCalledTimes(
        operation === 'set' ? 1 : 0,
      );
    },
  );
  it('有效快取時不查不可用的上游', async () => {
    const { service, redis, departments } = setup();
    redis.get.mockResolvedValue(JSON.stringify({ version: 1, data: [] }));
    departments.getOrgChart.mockRejectedValue(
      new AppException(...AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE),
    );
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(departments.getOrgChart).not.toHaveBeenCalled();
  });
  it('上游失敗不寫入快取或重試', async () => {
    const { service, redis, departments } = setup();
    departments.getOrgChart.mockRejectedValue(
      new AppException(...AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE),
    );
    await expect(service.getOrgChart()).rejects.toMatchObject({
      code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
    });
    expect(redis.set).not.toHaveBeenCalled();
    expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
  });
});
