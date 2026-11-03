import { createHash } from 'node:crypto';
import type { PortalOrgChartSource } from '#app/infrastructure/portal/portal.types';
import { EsignSignerCandidateService } from './esign-signer-candidate.service';

const source = (): PortalOrgChartSource => ({
  departments: [
    {
      department_ch_id: '100',
      department_name: '合成總部',
      department_parent_guid: '',
      startdate: '2025-01-01',
      stopdate: null,
    },
  ],
  employees: [
    {
      person_empid: '000123',
      person_name: '合成員工',
      title: '專員',
      department_id: '100',
    },
  ],
});

const tree = [
  {
    department_ch_id: '100',
    department_name: '合成總部',
    department_parent_guid: null,
    startdate: '2025-01-01',
    stopdate: null,
    children: [],
    employees: [
      { person_empid: '000123', person_name: '合成員工', title: '專員' },
    ],
  },
];

const PORTAL = {
  host: 'portal.synthetic.invalid',
  port: 3306,
  database: 'synthetic_portal',
};

describe('簽署人組織樹（Portal 來源）', () => {
  function setup(config: object = PORTAL) {
    const redis = {
      get: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const portal = {
      listOrgChartSource: jest
        .fn<Promise<PortalOrgChartSource>, []>()
        .mockResolvedValue(source()),
    };
    const logger = { warn: jest.fn() };
    const users = { save: jest.fn() };
    const mysql = { getManager: jest.fn(), transaction: jest.fn() };
    const service = new EsignSignerCandidateService(
      users as never,
      mysql as never,
      portal as never,
      redis as never,
      config as never,
      logger as never,
    );
    return { service, redis, portal, logger, users, mysql };
  }

  it('快取未命中時由 Portal 組樹，寫入 1,800 秒快取', async () => {
    const { service, redis, portal } = setup();
    await expect(service.getOrgChart()).resolves.toEqual(tree);
    expect(portal.listOrgChartSource).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^esign:org-chart:v2:[0-9a-f]{64}$/),
      { version: 1, data: tree },
      1_800,
    );
  });

  it('合法空快取直接回傳、不續期、不查 Portal 或寫入 MySQL', async () => {
    const { service, redis, portal, users, mysql } = setup();
    redis.get.mockResolvedValue(JSON.stringify({ version: 1, data: [] }));
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(redis.set).not.toHaveBeenCalled();
    expect(portal.listOrgChartSource).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
    expect(mysql.transaction).not.toHaveBeenCalled();
  });

  it('Portal 合法空資料回傳空陣列並快取', async () => {
    const { service, redis, portal } = setup();
    portal.listOrgChartSource.mockResolvedValue({
      departments: [],
      employees: [],
    });
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      { version: 1, data: [] },
      1_800,
    );
  });

  it.each([
    'broken',
    JSON.stringify({ version: 0, data: [] }),
    JSON.stringify({ version: 1, data: [{}] }),
  ])('無效快取經同一更新流程修復 %#', async (raw) => {
    const { service, redis, portal } = setup();
    redis.get.mockResolvedValue(raw);
    await expect(service.getOrgChart()).resolves.toEqual(tree);
    expect(portal.listOrgChartSource).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      { version: 1, data: tree },
      1_800,
    );
  });

  it('不同 Portal 主機、埠、資料庫或環境隔離快取 namespace，不包含來源明文', async () => {
    const previous = process.env.NODE_ENV;
    try {
      const keys: string[] = [];
      for (const config of [
        PORTAL,
        { ...PORTAL, host: 'other.synthetic.invalid' },
        { ...PORTAL, port: 3307 },
        { ...PORTAL, database: 'other_portal' },
      ]) {
        const { service, redis } = setup(config);
        await service.getOrgChart();
        keys.push(redis.get.mock.calls[0][0]);
      }
      process.env.NODE_ENV = 'synthetic-other-environment';
      const { service, redis } = setup();
      await service.getOrgChart();
      keys.push(redis.get.mock.calls[0][0]);
      expect(new Set(keys).size).toBe(5);
      expect(keys.join()).not.toMatch(/synthetic\.invalid|portal_|3306/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('不讀饗賓人來源的 v2 快取與 v1 快取，維持 payload version 1', async () => {
    const { service, redis, portal } = setup();
    const feastogether = createHash('sha256')
      .update(
        JSON.stringify([
          process.env.NODE_ENV ?? 'development',
          'https://synthetic.invalid',
        ]),
      )
      .digest('hex');
    const legacy = [
      `esign:org-chart:v2:${feastogether}`,
      `esign:org-chart:v1:${feastogether}`,
    ];
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(
        legacy.includes(key) ? JSON.stringify({ version: 1, data: [] }) : null,
      ),
    );
    await expect(service.getOrgChart()).resolves.toEqual(tree);
    expect(portal.listOrgChartSource).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^esign:org-chart:v2:/),
      { version: 1, data: tree },
      1_800,
    );
  });

  it('T+1,799 命中，T+1,800 後新請求更新，讀取不續期且無請求不刷新', async () => {
    jest.useFakeTimers();
    try {
      const { service, redis, portal } = setup();
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
      expect(portal.listOrgChartSource).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(portal.listOrgChartSource).toHaveBeenCalledTimes(1);
      await service.getOrgChart();
      expect(portal.listOrgChartSource).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['get', 'set'] as const)(
    'Redis %s 失敗回 503，不直連 fallback',
    async (operation) => {
      const { service, redis, portal } = setup();
      redis[operation].mockRejectedValue(new Error('synthetic-private'));
      await expect(service.getOrgChart()).rejects.toMatchObject({
        code: 'ORG_CHART_UNAVAILABLE',
        status: 503,
      });
      expect(portal.listOrgChartSource).toHaveBeenCalledTimes(
        operation === 'set' ? 1 : 0,
      );
    },
  );

  it('有效快取時不查不可用的 Portal', async () => {
    const { service, redis, portal } = setup();
    redis.get.mockResolvedValue(JSON.stringify({ version: 1, data: [] }));
    portal.listOrgChartSource.mockRejectedValue(new Error('synthetic-down'));
    await expect(service.getOrgChart()).resolves.toEqual([]);
    expect(portal.listOrgChartSource).not.toHaveBeenCalled();
  });

  it('Portal 查詢失敗回 502，不寫快取、不重試，也不帶出原始錯誤', async () => {
    const { service, redis, portal, logger } = setup();
    portal.listOrgChartSource.mockRejectedValue(
      new Error(
        "Access denied for user 'synthetic_reader'@'portal.synthetic.invalid'",
      ),
    );
    const error: unknown = await service.getOrgChart().catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
      status: 502,
    });
    expect(JSON.stringify(error)).not.toContain('synthetic');
    expect(redis.set).not.toHaveBeenCalled();
    expect(portal.listOrgChartSource).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('組樹失敗（部門代碼重複）回 502，不寫快取', async () => {
    const { service, redis, portal } = setup();
    const { departments, employees } = source();
    portal.listOrgChartSource.mockResolvedValue({
      departments: [...departments, ...departments],
      employees,
    });
    await expect(service.getOrgChart()).rejects.toMatchObject({
      code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
      status: 502,
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('Portal 設定缺漏回 502，不讀快取也不查 Portal', async () => {
    const config = {
      get host(): string {
        throw new Error('Portal 連線設定缺少 PORTAL_MYSQL_HOST');
      },
      port: 3306,
      database: 'synthetic_portal',
    };
    const { service, redis, portal } = setup(config);
    await expect(service.getOrgChart()).rejects.toMatchObject({
      code: 'ORG_CHART_UPSTREAM_UNAVAILABLE',
      status: 502,
    });
    expect(redis.get).not.toHaveBeenCalled();
    expect(portal.listOrgChartSource).not.toHaveBeenCalled();
  });

  it('對不到部門的正式員工只記人數，不記員編或姓名', async () => {
    const { service, portal, logger } = setup();
    const { departments } = source();
    portal.listOrgChartSource.mockResolvedValue({
      departments,
      employees: [
        {
          person_empid: 'X00987',
          person_name: '無部門合成員工',
          title: '',
          department_id: '999',
        },
        ...source().employees,
      ],
    });
    await expect(service.getOrgChart()).resolves.toEqual(tree);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { unmappedEmployees: 1 } }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
      /X00987|無部門合成員工|000123|合成員工/,
    );
  });

  it('所有正式員工都對得到部門時不記 log', async () => {
    const { service, logger } = setup();
    await service.getOrgChart();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
