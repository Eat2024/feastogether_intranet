import { AppErrors } from '#app/common/errors/app-errors';
import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { EsignSignerCandidateService } from './esign-signer-candidate.service';

describe('EsignSignerCandidateService', () => {
  const manager = {} as never;
  const empid = '11506071';
  const staff = {
    person_empid: empid,
    person_name: '陳柏丞',
    department_id: 'D003',
    department_name: '系統維運部',
    title: '工程師',
    person_status: 1,
    person_status_name: '正式',
  };

  function setup(options: { found?: object[]; existing?: object } = {}) {
    const users = {
      findActiveCandidates: jest.fn(async () => options.found ?? []),
      findByEmpidForUpdate: jest.fn(async () => options.existing ?? null),
      findByEmpid: jest.fn(async () => null),
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => ({ id: 31, ...value })),
    };
    const mysql = {
      getManager: jest.fn(() => manager),
      transaction: jest.fn((run: (value: never) => Promise<unknown>) =>
        run(manager),
      ),
    };
    const hr = { lookupEligibleStaff: jest.fn(async () => staff) };
    const service = new EsignSignerCandidateService(
      users as never,
      mysql as never,
      hr as never,
      { getOrgChart: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
    );
    return { service, users, hr };
  }

  it('本地已有該員編時不呼叫饗賓人 API', async () => {
    const local = { id: 7, empid, name: '陳柏丞', isActive: true };
    const { service, hr } = setup({ found: [local] });

    await expect(service.list(empid)).resolves.toEqual([local]);
    expect(hr.lookupEligibleStaff).not.toHaveBeenCalled();
  });

  it('本地查無完整員編時向饗賓人 API 查詢，並比照登入流程建立帳號', async () => {
    const { service, users, hr } = setup();

    const result = await service.list(` ${empid} `);

    expect(hr.lookupEligibleStaff).toHaveBeenCalledWith(empid);
    expect(users.create).toHaveBeenCalledWith(
      {
        empid,
        name: '陳柏丞',
        isActive: true,
        personStatus: '正式',
        departmentName: '系統維運部',
        titleName: '工程師',
      },
      manager,
    );
    expect(result).toEqual([expect.objectContaining({ id: 31, empid })]);
  });

  it.each([undefined, '', '陳', '1150', 'dev001', '115060711'])(
    '查詢不是完整八碼員編（%p）時不呼叫饗賓人 API',
    async (query) => {
      const { service, hr } = setup();
      await service.list(query);
      expect(hr.lookupEligibleStaff).not.toHaveBeenCalled();
    },
  );

  it('饗賓人 API 查無此人或資格不符時回傳空清單，不建立帳號', async () => {
    const { service, users, hr } = setup();
    hr.lookupEligibleStaff.mockRejectedValueOnce(
      new AppException(
        AppErrorCode.AUTH_EXCHANGE_FAILED,
        '無法完成登入交換',
        HttpStatus.UNAUTHORIZED,
      ),
    );

    await expect(service.list(empid)).resolves.toEqual([]);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('饗賓人 API 連線失敗時照常拋出錯誤', async () => {
    const { service, hr } = setup();
    hr.lookupEligibleStaff.mockRejectedValueOnce(
      new AppException(
        AppErrorCode.STAFF_LOOKUP_FAILED,
        '系統有錯，請詢問IT部門',
        HttpStatus.BAD_GATEWAY,
      ),
    );

    await expect(service.list(empid)).rejects.toMatchObject({
      code: AppErrorCode.STAFF_LOOKUP_FAILED,
    });
  });

  it('本地帳號已停用時不重新啟用', async () => {
    const { service, users } = setup({
      existing: { id: 9, empid, name: '陳柏丞', isActive: false },
    });

    await expect(service.list(empid)).resolves.toEqual([]);
    expect(users.save).not.toHaveBeenCalled();
  });
});

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
      hr as never,
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
      7_200,
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
        {} as never,
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
  it('T+7,199 命中，T+7,200 後新請求更新，無請求不自動刷新', async () => {
    jest.useFakeTimers();
    try {
      const { service, redis, departments } = setup();
      const expiresAt = Date.now() + 7_200_000;
      redis.get.mockImplementation(() =>
        Promise.resolve(
          Date.now() < expiresAt
            ? JSON.stringify({ version: 1, data: [] })
            : null,
        ),
      );
      await jest.advanceTimersByTimeAsync(7_199_000);
      await service.getOrgChart();
      expect(departments.getOrgChart).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1_001);
      expect(departments.getOrgChart).not.toHaveBeenCalled();
      await service.getOrgChart();
      expect(departments.getOrgChart).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
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
